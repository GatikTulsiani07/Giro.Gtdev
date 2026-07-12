// OpenAI streaming completion provider.

import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, RateLimitError } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { env } from "../../config/env.js";
import { createDeadline, DeadlineExceededError, isDeadlineExceeded } from "../../runtime/deadline.js";
import { retry, isTransientTransportError, type RetryRuntimeOptions } from "../../runtime/retry.js";
import { createRetryObservability, type RetryLogger, type RetryMetrics } from "../../observability/retryObservability.js";
import { logger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export function normalizeAiProviderError(error: unknown, signal?: AbortSignal): unknown {
  return (signal?.aborted && isDeadlineExceeded(signal.reason)) || error instanceof APIConnectionTimeoutError
    ? new DeadlineExceededError()
    : error;
}

export function isTransientAiError(error: unknown): boolean {
  if (error instanceof RateLimitError || error instanceof APIConnectionTimeoutError || error instanceof APIConnectionError) return true;
  if (error instanceof APIError) return error.status === 408 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
  return isTransientTransportError(error);
}

export async function streamCompletion(
  messages: ChatCompletionMessageParam[],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    client?: OpenAI;
    requestId?: string;
    logger?: RetryLogger;
    metrics?: RetryMetrics;
    retryRuntime?: RetryRuntimeOptions;
  } = {},
): Promise<AsyncIterable<string>> {
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? env.AI_REQUEST_TIMEOUT_MS, env.AI_REQUEST_TIMEOUT_MS));
  const deadline = createDeadline(timeoutMs, { parentSignal: options.signal });
  let stream: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>>;
  const observability = createRetryObservability({
    category: "ai",
    operation: "chat_completion",
    logger: options.logger ?? logger,
    metrics: options.metrics ?? runtimeMetrics,
    fields: { requestId: options.requestId },
  });
  try {
    stream = await retry(
      async (attempt) => {
        const attemptsRemaining = env.AI_MAX_RETRIES + 2 - attempt;
        const attemptTimeoutMs = Math.max(1, Math.floor(deadline.remainingMs() / attemptsRemaining));
        return (options.client ?? openai).chat.completions.create({
          model: env.MODEL_NAME,
          messages,
          temperature: 0.1,
          stream: true,
        }, { signal: deadline.signal, timeout: attemptTimeoutMs, maxRetries: 0 });
      },
      {
        maxAttempts: env.AI_MAX_RETRIES + 1,
        baseDelayMs: env.AI_RETRY_BASE_MS,
        maxDelayMs: 5_000,
        deadline,
        isRetryable: isTransientAiError,
        ...observability,
        ...options.retryRuntime,
      },
    );
  } catch (error) {
    deadline.dispose();
    throw normalizeAiProviderError(error, deadline.signal);
  }

  return {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield delta;
        }
      } finally {
        deadline.dispose();
      }
    },
  };
}
