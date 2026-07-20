import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { MetricsRegistry } from "../observability/metrics.js";

const KNOWN_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function safeMethod(method: string): string {
  const normalized = method.toUpperCase();
  return KNOWN_METHODS.has(normalized) ? normalized : "OTHER";
}

function safeRoute(matchedRoute: string): string {
  return matchedRoute && matchedRoute !== "*" ? matchedRoute : "__unmatched__";
}

function statusClass(status: number): string {
  return status >= 100 && status <= 599 ? `${Math.floor(status / 100)}xx` : "unknown";
}

function recordOperationalRoute(
  registry: MetricsRegistry,
  method: string,
  path: string,
): void {
  if (method !== "POST") return;
  if (/^\/sessions\/[^/]+\/ask$/.test(path)) registry.incrementAskGiroRequests();
  if (path === "/retrieval" || path.startsWith("/retrieval/")) {
    registry.incrementRetrievalRequests();
  }
}

export interface MetricsMiddlewareOptions {
  monotonicNow?: () => number;
}

export function createMetricsMiddleware(
  registry: MetricsRegistry,
  options: MetricsMiddlewareOptions = {},
): MiddlewareHandler {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());

  return async (c, next) => {
    const startedAt = monotonicNow();
    registry.beginRequest();
    recordOperationalRoute(registry, c.req.method.toUpperCase(), c.req.path);
    let status = 500;
    try {
      await next();
      status = c.res.status;
    } finally {
      const route = safeRoute(routePath(c, -1));
      const method = safeMethod(c.req.method);
      if (
        method === "POST" &&
        c.req.path === "/repos/connect" &&
        status >= 200 && status < 300
      ) {
        registry.incrementRepositoryConnects();
      }
      registry.completeRequest({
        route,
        method,
        status,
        statusClass: statusClass(status),
        durationMs: Math.max(0, monotonicNow() - startedAt),
      });
    }
  };
}
