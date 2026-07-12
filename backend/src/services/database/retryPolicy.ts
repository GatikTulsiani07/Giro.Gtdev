import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import { createRetryObservability, type RetryLogger, type RetryMetrics } from "../../observability/retryObservability.js";
import type { Deadline } from "../../runtime/deadline.js";
import { isTransientTransportError, retry, type RetryRuntimeOptions } from "../../runtime/retry.js";

export interface DatabaseRetryOptions {
  deadline: Deadline;
  operation: string;
  requestId?: string;
  logger?: RetryLogger;
  metrics?: RetryMetrics;
  retryRuntime?: RetryRuntimeOptions;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : "";
}

export function isTransientDatabaseError(error: unknown): boolean {
  const code = errorCode(error);
  return code.startsWith("08") ||
    ["PGRST000", "PGRST001", "53300", "57P01", "57P02", "57P03"].includes(code) ||
    isTransientTransportError(error);
}

export async function retryDatabaseRead<T>(
  operation: () => PromiseLike<{ data: T; error: unknown | null }>,
  options: DatabaseRetryOptions,
): Promise<{ data: T; error: unknown | null }> {
  const observability = createRetryObservability({
    category: "database",
    operation: options.operation,
    logger: options.logger ?? logger,
    metrics: options.metrics ?? runtimeMetrics,
    fields: { requestId: options.requestId },
  });
  return retry(
    async () => {
      const result = await operation();
      if (result.error) throw result.error;
      return result;
    },
    {
      maxAttempts: env.DATABASE_MAX_RETRIES + 1,
      baseDelayMs: env.DATABASE_RETRY_BASE_MS,
      maxDelayMs: 2_000,
      deadline: options.deadline,
      isRetryable: isTransientDatabaseError,
      ...observability,
      ...options.retryRuntime,
    },
  );
}
