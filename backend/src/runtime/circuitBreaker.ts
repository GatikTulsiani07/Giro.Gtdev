export type CircuitState = "closed" | "open" | "half_open";
export type CircuitDependency = "ai" | "embedding" | "database" | "clone";

export class DependencyUnavailableError extends Error {
  constructor() {
    super("A required service is temporarily unavailable.");
    this.name = "DependencyUnavailableError";
  }
}

export function isDependencyUnavailable(error: unknown): boolean {
  return error instanceof DependencyUnavailableError ||
    (error instanceof Error && error.name === "DependencyUnavailableError");
}

export interface CircuitContext {
  requestId?: string;
  jobId?: string;
  repositoryId?: string;
  signal?: AbortSignal;
}

export interface CircuitSnapshot {
  readonly state: CircuitState;
  readonly sampleCount: number;
  readonly failureCount: number;
  readonly openedAt: number | null;
  readonly nextProbeAt: number | null;
  readonly activeHalfOpenCalls: number;
}

export interface CircuitLogger {
  info(event: string, fields?: Record<string, unknown>): void;
}

export interface CircuitMetrics {
  setCircuitState(dependency: CircuitDependency, state: CircuitState): void;
  incrementCircuitTransition(dependency: CircuitDependency, from: CircuitState, to: CircuitState): void;
  incrementCircuitRejection(dependency: CircuitDependency): void;
}

export interface CircuitBreakerOptions {
  name: CircuitDependency;
  minimumSamples: number;
  failureThreshold: number;
  rollingWindowMs: number;
  openDurationMs: number;
  halfOpenMaxCalls: number;
  shouldCountFailure(error: unknown): boolean;
  clock?: () => number;
  logger?: CircuitLogger;
  metrics?: CircuitMetrics;
  maxSamples?: number;
}

export interface CircuitBreaker {
  execute<T>(operation: () => Promise<T>, context?: CircuitContext): Promise<T>;
  getState(): CircuitState;
  getSnapshot(): CircuitSnapshot;
}

type Sample = { at: number; failed: boolean };

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  for (const [name, value] of [
    ["minimumSamples", options.minimumSamples],
    ["failureThreshold", options.failureThreshold],
    ["rollingWindowMs", options.rollingWindowMs],
    ["openDurationMs", options.openDurationMs],
    ["halfOpenMaxCalls", options.halfOpenMaxCalls],
  ] as const) positiveInteger(value, name);
  if (options.failureThreshold > options.minimumSamples) {
    throw new TypeError("failureThreshold must not exceed minimumSamples");
  }
  const maxSamples = options.maxSamples ?? 1_000;
  positiveInteger(maxSamples, "maxSamples");
  const clock = options.clock ?? Date.now;
  const samples: Sample[] = [];
  let state: CircuitState = "closed";
  let openedAt: number | null = null;
  let activeHalfOpenCalls = 0;
  let halfOpenGeneration = 0;
  let halfOpenFailed = false;
  options.metrics?.setCircuitState(options.name, state);

  const safeFields = (context: CircuitContext = {}) => ({
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.repositoryId ? { repositoryId: context.repositoryId } : {}),
  });
  const prune = (now: number) => {
    const cutoff = now - options.rollingWindowMs;
    while (samples[0] && samples[0].at < cutoff) samples.shift();
  };
  const counts = (now: number) => {
    prune(now);
    return {
      sampleCount: samples.length,
      failureCount: samples.reduce((count, sample) => count + (sample.failed ? 1 : 0), 0),
    };
  };
  const transition = (next: CircuitState, context: CircuitContext = {}) => {
    if (state === next) return;
    const previous = state;
    state = next;
    if (next === "open") {
      openedAt = clock();
      activeHalfOpenCalls = 0;
      halfOpenGeneration += 1;
    }
    if (next === "half_open") {
      activeHalfOpenCalls = 0;
      halfOpenFailed = false;
      halfOpenGeneration += 1;
    }
    if (next === "closed") {
      openedAt = null;
      activeHalfOpenCalls = 0;
      samples.length = 0;
    }
    options.metrics?.setCircuitState(options.name, next);
    options.metrics?.incrementCircuitTransition(options.name, previous, next);
    const current = counts(clock());
    const event = next === "open" ? "circuit_opened" : next === "half_open" ? "circuit_half_opened" : "circuit_closed";
    options.logger?.info(event, {
      dependency: options.name,
      previousState: previous,
      nextState: next,
      ...safeFields(context),
      ...current,
      cooldownMs: options.openDurationMs,
    });
  };
  const reject = (context: CircuitContext) => {
    options.metrics?.incrementCircuitRejection(options.name);
    options.logger?.info("circuit_rejected", {
      dependency: options.name,
      ...safeFields(context),
      ...counts(clock()),
      cooldownMs: options.openDurationMs,
    });
    throw new DependencyUnavailableError();
  };
  const refresh = (context: CircuitContext) => {
    if (state === "open" && openedAt !== null && clock() - openedAt >= options.openDurationMs) {
      transition("half_open", context);
    }
  };
  const recordClosed = (failed: boolean, context: CircuitContext) => {
    const now = clock();
    prune(now);
    samples.push({ at: now, failed });
    while (samples.length > maxSamples) samples.shift();
    const current = counts(now);
    if (
      state === "closed" &&
      current.sampleCount >= options.minimumSamples &&
      current.failureCount >= options.failureThreshold
    ) transition("open", context);
  };

  return {
    async execute<T>(operation: () => Promise<T>, context: CircuitContext = {}): Promise<T> {
      refresh(context);
      if (state === "open") reject(context);
      const probe = state === "half_open";
      const generation = halfOpenGeneration;
      if (probe) {
        if (activeHalfOpenCalls >= options.halfOpenMaxCalls) reject(context);
        activeHalfOpenCalls += 1;
        options.logger?.info("circuit_probe_started", {
          dependency: options.name,
          ...safeFields(context),
        });
      }
      try {
        const result = await operation();
        if (probe && generation === halfOpenGeneration && state === "half_open") {
          activeHalfOpenCalls = Math.max(0, activeHalfOpenCalls - 1);
          options.logger?.info("circuit_probe_succeeded", {
            dependency: options.name,
            ...safeFields(context),
          });
          if (activeHalfOpenCalls === 0 && !halfOpenFailed) transition("closed", context);
        } else if (!probe) recordClosed(false, context);
        return result;
      } catch (error) {
        const callerCancelled = context.signal?.aborted === true;
        const qualifying = !callerCancelled && options.shouldCountFailure(error);
        if (probe && generation === halfOpenGeneration && state === "half_open") {
          activeHalfOpenCalls = Math.max(0, activeHalfOpenCalls - 1);
          if (qualifying) {
            halfOpenFailed = true;
            options.logger?.info("circuit_probe_failed", {
              dependency: options.name,
              ...safeFields(context),
            });
            transition("open", context);
          } else if (activeHalfOpenCalls === 0 && !halfOpenFailed) {
            transition("closed", context);
          }
        } else if (!probe && qualifying) recordClosed(true, context);
        throw error;
      }
    },
    getState() {
      refresh({});
      return state;
    },
    getSnapshot() {
      refresh({});
      const current = counts(clock());
      return Object.freeze({
        state,
        ...current,
        openedAt,
        nextProbeAt: openedAt === null ? null : openedAt + options.openDurationMs,
        activeHalfOpenCalls,
      });
    },
  };
}
