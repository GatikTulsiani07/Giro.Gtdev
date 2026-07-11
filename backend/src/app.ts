// Builds and exports the Hono application without listening.
// Kept separate from index.ts so it's trivial to import for tests later.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./config/env.js";
import {
  createRequestContextMiddleware,
  type RequestContextOptions,
  type RequestContextVariables,
} from "./middleware/requestContext.js";
import { onError, onNotFound } from "./middleware/errorHandler.js";
import { createRoutes } from "./routes/index.js";
import type { ReadinessCheck } from "./routes/health.js";
import type { IndexingJobStore } from "./services/indexing/jobs/indexingJobStore.js";
import { runtimeIndexingJobStore } from "./services/indexing/jobs/runtimeIndexingJobStore.js";
import { createRuntimeReadinessCheck } from "./services/health/runtimeReadiness.js";

type Variables = RequestContextVariables & {
  indexingJobStore: IndexingJobStore;
};

export interface CreateAppOptions {
  indexingJobStore?: IndexingJobStore;
  readinessCheck?: ReadinessCheck;
  isShuttingDown?: () => boolean;
  requestContext?: RequestContextOptions;
}

export function createApp(options: CreateAppOptions = {}) {
  const indexingJobStore = options.indexingJobStore ?? runtimeIndexingJobStore;
  const readinessCheck =
    options.readinessCheck ??
    createRuntimeReadinessCheck({
      indexingJobStore,
      isShuttingDown: options.isShuttingDown,
    });
  const app = new Hono<{ Variables: Variables }>();

  // Order matters: correlation context wraps every later middleware and route.
  app.use("*", createRequestContextMiddleware(options.requestContext));
  app.use("*", async (c, next) => {
    c.set("indexingJobStore", indexingJobStore);
    await next();
  });
  app.use(
    "*",
    cors({
      origin: env.CORS_ORIGINS,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
      exposeHeaders: ["X-Request-ID"],
      credentials: true,
    }),
  );

  app.route("/", createRoutes(readinessCheck));

  app.notFound(onNotFound);
  app.onError(onError);

  return app;
}
