import type { RetryMetricCategory, RetryMetricResult } from "./metrics.js";
import type { RetryEvent, RetryResult } from "../runtime/retry.js";

export interface RetryLogger {
  info(event: string, fields?: Record<string, unknown>): void;
}

export interface RetryMetrics {
  incrementRetry(category: RetryMetricCategory, result: RetryMetricResult, attempt: number): void;
}

export interface RetryObservabilityOptions {
  category: RetryMetricCategory;
  operation: string;
  logger?: RetryLogger;
  metrics?: RetryMetrics;
  fields?: Readonly<{
    requestId?: string;
    jobId?: string;
    repositoryId?: string;
  }>;
}

export function createRetryObservability(options: RetryObservabilityOptions) {
  return {
    onRetry(event: RetryEvent): void {
      options.logger?.info("retry_attempt", {
        ...options.fields,
        operation: options.operation,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        category: options.category,
      });
    },
    onResult(result: RetryResult, attempt: number): void {
      options.metrics?.incrementRetry(options.category, result, attempt);
    },
  };
}
