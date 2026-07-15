export interface RetrievalCacheKeyInput {
  repositoryId: string;
  query: string;
  mode: string;
  limits?: Readonly<Record<string, number | null | undefined>>;
  selectedContext?: unknown;
  options?: unknown;
  repositoryVersion?: string;
}

export interface RetrievalCacheMetrics {
  incrementRetrievalCacheHit(): void;
  incrementRetrievalCacheMiss(): void;
  incrementRetrievalCacheEviction(): void;
  setRetrievalCacheEntries(entries: number): void;
}

export interface RetrievalCacheLogger {
  info(event: string, fields?: Record<string, unknown>): void;
}

export interface RetrievalCacheOptions {
  ttlMs: number;
  maxEntries: number;
  metrics: RetrievalCacheMetrics;
  logger: RetrievalCacheLogger;
  now?: () => number;
  versionProvider?: (repositoryId: string) => string | Promise<string>;
}

export interface RetrievalCacheLoadOptions {
  signal?: AbortSignal;
}

interface CacheEntry {
  repositoryId: string;
  value: unknown;
  expiresAt: number;
}

interface InFlightEntry {
  repositoryId: string;
  controller: AbortController;
  promise: Promise<unknown>;
  waiters: number;
  settled: boolean;
}

const WHITESPACE_PATTERN = /\s+/g;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(WHITESPACE_PATTERN, " ");
}

function stableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Retrieval cache keys require finite numbers");
    }
    return value;
  }
  if (typeof value === "string") return normalizeWhitespace(value);
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  throw new TypeError("Retrieval cache keys must contain serializable values");
}

export function buildRetrievalCacheKey(input: RetrievalCacheKeyInput): string {
  return JSON.stringify(stableValue({
    repositoryId: normalizeWhitespace(input.repositoryId).toLowerCase(),
    query: normalizeWhitespace(input.query),
    mode: normalizeWhitespace(input.mode).toLowerCase(),
    limits: input.limits ?? {},
    selectedContext: input.selectedContext ?? null,
    options: input.options ?? {},
    repositoryVersion: input.repositoryVersion ?? "unversioned",
  }));
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export class RetrievalCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly metrics: RetrievalCacheMetrics;
  private readonly logger: RetrievalCacheLogger;
  private readonly now: () => number;
  private readonly versionProvider?: RetrievalCacheOptions["versionProvider"];
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightEntry>();
  private readonly repositoryVersions = new Map<string, string>();
  private readonly repositoryGenerations = new Map<string, number>();

  constructor(options: RetrievalCacheOptions) {
    if (!Number.isInteger(options.ttlMs) || options.ttlMs <= 0) {
      throw new TypeError("ttlMs must be a positive integer");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new TypeError("maxEntries must be a positive integer");
    }
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
    this.versionProvider = options.versionProvider;
    this.metrics.setRetrievalCacheEntries(0);
  }

  async getOrLoad<T>(
    input: RetrievalCacheKeyInput,
    loader: (signal: AbortSignal) => Promise<T>,
    options: RetrievalCacheLoadOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const repositoryId = normalizeWhitespace(input.repositoryId).toLowerCase();
    let repositoryVersion = input.repositoryVersion;

    if (this.versionProvider) {
      try {
        repositoryVersion = await this.resolveVersion(repositoryId, options.signal);
      } catch {
        if (options.signal?.aborted) throw abortReason(options.signal);
        const bypassKey = `uncached:${buildRetrievalCacheKey({
          ...input,
          repositoryId,
          repositoryVersion: "version_unavailable",
        })}`;
        const existing = this.inFlight.get(bypassKey);
        if (existing) {
          this.recordHit(repositoryId, input.mode, "in_flight");
          return this.waitFor<T>(existing, options.signal);
        }
        this.recordMiss(repositoryId, input.mode, "version_unavailable");
        const controller = new AbortController();
        const entry: InFlightEntry = {
          repositoryId,
          controller,
          promise: Promise.resolve(undefined),
          waiters: 0,
          settled: false,
        };
        entry.promise = loader(controller.signal)
          .then(immutableCopy)
          .finally(() => {
            entry.settled = true;
            if (this.inFlight.get(bypassKey) === entry) this.inFlight.delete(bypassKey);
          });
        this.inFlight.set(bypassKey, entry);
        return this.waitFor<T>(entry, options.signal);
      }
    }

    this.observeRepositoryVersion(repositoryId, repositoryVersion ?? "unversioned");
    const key = buildRetrievalCacheKey({ ...input, repositoryId, repositoryVersion });
    const cached = this.entries.get(key);
    if (cached) {
      if (cached.expiresAt > this.now()) {
        this.entries.delete(key);
        this.entries.set(key, cached);
        this.recordHit(repositoryId, input.mode, "cache");
        return cached.value as T;
      }
      this.evict(key, cached, "expired");
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      this.recordHit(repositoryId, input.mode, "in_flight");
      return this.waitFor<T>(existing, options.signal);
    }

    this.recordMiss(repositoryId, input.mode, "cache");
    const generation = this.repositoryGenerations.get(repositoryId) ?? 0;
    const controller = new AbortController();
    const entry: InFlightEntry = {
      repositoryId,
      controller,
      promise: Promise.resolve(undefined),
      waiters: 0,
      settled: false,
    };
    entry.promise = loader(controller.signal)
      .then((result) => {
        const immutable = immutableCopy(result);
        const unchanged = (this.repositoryGenerations.get(repositoryId) ?? 0) === generation;
        if (!controller.signal.aborted && unchanged) this.put(key, repositoryId, immutable);
        return immutable;
      })
      .finally(() => {
        entry.settled = true;
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
      });
    this.inFlight.set(key, entry);
    return this.waitFor<T>(entry, options.signal);
  }

  invalidateRepository(repositoryId: string, reason = "manual"): number {
    const normalized = normalizeWhitespace(repositoryId).toLowerCase();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.repositoryId !== normalized) continue;
      this.entries.delete(key);
      removed += 1;
    }
    for (const [key, entry] of this.inFlight) {
      if (entry.repositoryId !== normalized) continue;
      this.inFlight.delete(key);
      entry.controller.abort(new Error("Retrieval cache invalidated"));
    }
    this.repositoryGenerations.set(normalized, (this.repositoryGenerations.get(normalized) ?? 0) + 1);
    this.metrics.setRetrievalCacheEntries(this.entries.size);
    this.logger.info("retrieval_cache_invalidated", {
      repositoryId: normalized,
      reason,
      entriesRemoved: removed,
    });
    return removed;
  }

  invalidateAll(reason = "manual"): number {
    const repositories = new Set<string>();
    for (const entry of this.entries.values()) repositories.add(entry.repositoryId);
    for (const entry of this.inFlight.values()) repositories.add(entry.repositoryId);
    let removed = 0;
    for (const repositoryId of repositories) removed += this.invalidateRepository(repositoryId, reason);
    return removed;
  }

  size(): number {
    return this.entries.size;
  }

  private observeRepositoryVersion(repositoryId: string, version: string): void {
    const previous = this.repositoryVersions.get(repositoryId);
    if (previous !== undefined && previous !== version) {
      this.invalidateRepository(repositoryId, "repository_version_changed");
    }
    this.repositoryVersions.set(repositoryId, version);
  }

  private async resolveVersion(
    repositoryId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const pending = Promise.resolve(this.versionProvider!(repositoryId));
    if (!signal) return pending;
    if (signal.aborted) throw abortReason(signal);
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      pending.then(
        (version) => {
          signal.removeEventListener("abort", onAbort);
          resolve(version);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private put(key: string, repositoryId: string, value: unknown): void {
    this.entries.delete(key);
    this.entries.set(key, { repositoryId, value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldest) break;
      this.evict(oldest[0], oldest[1], "capacity");
    }
    this.metrics.setRetrievalCacheEntries(this.entries.size);
  }

  private evict(key: string, entry: CacheEntry, reason: "expired" | "capacity"): void {
    if (!this.entries.delete(key)) return;
    this.metrics.incrementRetrievalCacheEviction();
    this.metrics.setRetrievalCacheEntries(this.entries.size);
    this.logger.info("retrieval_cache_evicted", { repositoryId: entry.repositoryId, reason });
  }

  private recordHit(repositoryId: string, mode: string, source: "cache" | "in_flight"): void {
    this.metrics.incrementRetrievalCacheHit();
    this.logger.info("retrieval_cache_hit", {
      repositoryId,
      mode: normalizeWhitespace(mode).toLowerCase(),
      source,
    });
  }

  private recordMiss(repositoryId: string, mode: string, reason: string): void {
    this.metrics.incrementRetrievalCacheMiss();
    this.logger.info("retrieval_cache_miss", {
      repositoryId,
      mode: normalizeWhitespace(mode).toLowerCase(),
      reason,
    });
  }

  private waitFor<T>(entry: InFlightEntry, signal?: AbortSignal): Promise<T> {
    entry.waiters += 1;
    if (!signal) {
      return entry.promise.finally(() => { entry.waiters -= 1; }) as Promise<T>;
    }
    if (signal.aborted) {
      entry.waiters -= 1;
      if (entry.waiters === 0 && !entry.settled) entry.controller.abort(abortReason(signal));
      return Promise.reject(abortReason(signal));
    }

    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        entry.waiters -= 1;
        return true;
      };
      const onAbort = () => {
        if (!finish()) return;
        if (entry.waiters === 0 && !entry.settled) entry.controller.abort(abortReason(signal));
        reject(abortReason(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => { if (finish()) resolve(value as T); },
        (error) => { if (finish()) reject(error); },
      );
    });
  }
}
