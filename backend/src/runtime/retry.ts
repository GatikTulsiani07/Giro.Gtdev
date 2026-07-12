import { DeadlineExceededError, type Deadline } from "./deadline.js";

export type RetryResult = "scheduled" | "succeeded" | "exhausted";

export interface RetryEvent {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryBudgetMs?: number;
  signal?: AbortSignal;
  deadline?: Deadline;
  isRetryable(error: unknown): boolean;
  onRetry?(event: RetryEvent): void;
  onResult?(result: RetryResult, attempt: number): void;
  random?: () => number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type RetryRuntimeOptions = Pick<
  RetryOptions,
  "random" | "now" | "setTimer" | "clearTimer"
>;

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

export function retryDelayMs(
  retryNumber: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  positiveInteger(retryNumber, "retryNumber");
  positiveInteger(baseDelayMs, "baseDelayMs");
  positiveInteger(maxDelayMs, "maxDelayMs");
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.max(1, Math.round(Math.min(maxDelayMs, baseDelayMs * 2 ** (retryNumber - 1)) * jitter));
}

function abortReason(options: RetryOptions): unknown | undefined {
  if (options.signal?.aborted) return options.signal.reason;
  if (options.deadline?.signal.aborted) return options.deadline.signal.reason;
  return undefined;
}

async function sleep(delayMs: number, options: RetryOptions): Promise<void> {
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const signals = [options.signal, options.deadline?.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let handle: unknown;
    const cleanup = () => {
      for (const signal of signals) signal.removeEventListener("abort", onAbort);
      if (handle !== undefined) clearTimer(handle);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(abortReason(options)));
    for (const signal of signals) signal.addEventListener("abort", onAbort, { once: true });
    handle = setTimer(() => finish(resolve), delayMs);
    if (settled) clearTimer(handle);
    const reason = abortReason(options);
    if (reason !== undefined) onAbort();
  });
}

export async function retry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  positiveInteger(options.maxAttempts, "maxAttempts");
  positiveInteger(options.baseDelayMs, "baseDelayMs");
  positiveInteger(options.maxDelayMs, "maxDelayMs");
  if (options.retryBudgetMs !== undefined) positiveInteger(options.retryBudgetMs, "retryBudgetMs");
  const now = options.now ?? Date.now;
  const startedAt = now();
  let retried = false;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const reason = abortReason(options);
    if (reason !== undefined) throw reason;
    options.deadline?.throwIfExpired();
    try {
      const value = await operation(attempt);
      if (retried) options.onResult?.("succeeded", attempt);
      return value;
    } catch (error) {
      const canRetry = attempt < options.maxAttempts && options.isRetryable(error);
      if (!canRetry) {
        if (retried) options.onResult?.("exhausted", attempt);
        throw error;
      }
      const delayMs = retryDelayMs(attempt, options.baseDelayMs, options.maxDelayMs, options.random);
      const elapsed = Math.max(0, now() - startedAt);
      const budgetRemaining = options.retryBudgetMs === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, options.retryBudgetMs - elapsed);
      const deadlineRemaining = options.deadline?.remainingMs() ?? Number.POSITIVE_INFINITY;
      if (delayMs >= deadlineRemaining) throw new DeadlineExceededError();
      if (delayMs > budgetRemaining) {
        if (retried) options.onResult?.("exhausted", attempt);
        throw error;
      }
      retried = true;
      options.onRetry?.({ attempt, maxAttempts: options.maxAttempts, delayMs });
      options.onResult?.("scheduled", attempt);
      await sleep(delayMs, options);
    }
  }
  throw new Error("Retry loop exhausted unexpectedly");
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ??
    (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof code === "string" ? code.toUpperCase() : "";
}

export function isTransientTransportError(error: unknown): boolean {
  const code = errorCode(error);
  if (["ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "ECONNREFUSED"].includes(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return ["fetch failed", "network error", "connection reset", "temporary failure", "timed out"].some(
    (fragment) => message.includes(fragment),
  );
}
