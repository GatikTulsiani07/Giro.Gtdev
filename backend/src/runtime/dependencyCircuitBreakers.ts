import { dependencyCircuitConfig } from "../config/env.js";
import { logger as runtimeLogger } from "../lib/logger.js";
import { runtimeMetrics, type MetricsRegistry } from "../observability/metrics.js";
import { isDeadlineExceeded } from "./deadline.js";
import { createCircuitBreaker, isDependencyUnavailable, type CircuitBreaker, type CircuitDependency, type CircuitLogger } from "./circuitBreaker.js";
import { isTransientTransportError } from "./retry.js";

export type DependencyCircuitBreakers = Readonly<Record<CircuitDependency, CircuitBreaker>>;

function status(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

function code(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value.toUpperCase() : "";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

function providerFailure(error: unknown): boolean {
  if (isDeadlineExceeded(error) || isDependencyUnavailable(error)) return false;
  const httpStatus = status(error);
  if (httpStatus !== undefined) {
    return httpStatus === 408 || httpStatus === 429 || [500, 502, 503, 504].includes(httpStatus);
  }
  const name = error instanceof Error ? error.name : "";
  return name === "APIConnectionError" || name === "APIConnectionTimeoutError" || isTransientTransportError(error);
}

function databaseFailure(error: unknown): boolean {
  if (isDeadlineExceeded(error) || isDependencyUnavailable(error)) return false;
  const errorCode = code(error);
  return errorCode.startsWith("08") ||
    ["PGRST000", "PGRST001", "53300", "57P01", "57P02", "57P03"].includes(errorCode) ||
    isTransientTransportError(error);
}

function cloneFailure(error: unknown): boolean {
  if (isDeadlineExceeded(error) || isDependencyUnavailable(error)) return false;
  const text = message(error);
  if ([
    "repository not found",
    "authentication failed",
    "permission denied",
    "access denied",
    "could not read username",
    "spawn git enoent",
    "git: command not found",
    "destination path",
  ].some((fragment) => text.includes(fragment))) return false;
  return isTransientTransportError(error) || [
    "timeout",
    "timed out",
    "could not resolve host",
    "connection reset",
    "early eof",
    "rpc failed",
    "remote end hung up",
    "tls connection",
  ].some((fragment) => text.includes(fragment));
}

const classifiers: Record<CircuitDependency, (error: unknown) => boolean> = {
  ai: providerFailure,
  embedding: providerFailure,
  database: databaseFailure,
  clone: cloneFailure,
};

export interface DependencyCircuitBreakerOptions {
  clock?: () => number;
  logger?: CircuitLogger;
  metrics?: MetricsRegistry;
}

export function createDependencyCircuitBreakers(
  options: DependencyCircuitBreakerOptions = {},
): DependencyCircuitBreakers {
  const metrics = options.metrics ?? runtimeMetrics;
  const logger = options.logger ?? runtimeLogger;
  return Object.freeze(Object.fromEntries(
    (["ai", "embedding", "database", "clone"] as const).map((dependency) => [
      dependency,
      createCircuitBreaker({
        name: dependency,
        ...dependencyCircuitConfig[dependency],
        shouldCountFailure: classifiers[dependency],
        clock: options.clock,
        logger,
        metrics,
      }),
    ]),
  ) as unknown as DependencyCircuitBreakers);
}

export const runtimeDependencyCircuitBreakers = createDependencyCircuitBreakers();
