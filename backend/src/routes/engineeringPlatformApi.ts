import { Hono } from "hono";
import { z } from "zod";
import { fail, ok } from "../lib/response.js";
import { setRequestLogContext } from "../middleware/requestContext.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { runtimeMetrics } from "../observability/metrics.js";
import { requireAuthenticatedUser } from "../services/auth/authContext.js";
import { AutonomousWorkflowError } from "../services/autonomousWorkflow/index.js";
import {
  EngineeringPlatformApiError,
  publicWorkflow,
  runtimeEngineeringPlatformApiService,
  type EngineeringPlatformApiService,
} from "../services/engineeringPlatformApi/service.js";
import {
  EngineeringApiIdempotencyConflictError,
  executeEngineeringApiIdempotent,
} from "../services/engineeringPlatformApi/idempotencyStore.js";
import { engineeringPlatformOpenApi } from "../services/engineeringPlatformApi/openapi.js";
import { KNOWLEDGE_NAMESPACES } from "../services/repositoryKnowledge/types.js";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

const createWorkflowSchema = z.object({
  repositoryId: z.string().min(1).max(512),
  repositoryRevision: z.string().min(1).max(256),
  task: z.string().min(1).max(20_000),
  executionConfiguration: z.object({
    policy: z.enum(["review_only", "agent_assisted"]).optional(),
    maxParallelism: z.number().int().min(1).max(16).optional(),
  }).strict().optional().default({}),
  idempotencyKey: z.string().min(1).max(256).optional(),
}).strict();

const paginationSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

const knowledgeQuerySchema = paginationSchema.extend({
  namespace: z.enum(KNOWLEDGE_NAMESPACES).optional(),
  subject: z.string().min(1).max(512).optional(),
  repositoryRevision: z.string().min(1).max(256).optional(),
  executionId: z.string().min(1).max(256).optional(),
  minimumConfidence: z.coerce.number().min(0).max(1).optional(),
  version: z.coerce.number().int().min(1).optional(),
});

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded || encodeCursor(decoded) !== cursor) throw new Error();
    return decoded;
  } catch {
    throw new EngineeringPlatformApiError(
      "invalid_request", "The pagination cursor is invalid.");
  }
}

function page<T>(
  items: readonly T[],
  limit: number,
  cursor: string | undefined,
  key: (item: T) => string,
) {
  const after = decodeCursor(cursor);
  const start = after === undefined
    ? 0
    : items.findIndex((item) => key(item) === after) + 1;
  if (after !== undefined && start === 0) {
    throw new EngineeringPlatformApiError(
      "invalid_request", "The pagination cursor is stale.");
  }
  const selected = items.slice(start, start + limit);
  const hasMore = start + selected.length < items.length;
  return Object.freeze({
    items: selected,
    nextCursor: hasMore && selected.length > 0
      ? encodeCursor(key(selected[selected.length - 1]!))
      : null,
    limit,
  });
}

function parseIfMatch(value: string | undefined): number {
  if (!value) {
    throw new EngineeringPlatformApiError(
      "precondition_failed", "If-Match is required.");
  }
  const match = /^(?:W\/)?\"?([1-9]\d*)\"?$/.exec(value.trim());
  if (!match) {
    throw new EngineeringPlatformApiError(
      "precondition_failed", "If-Match must contain a workflow version.");
  }
  return Number(match[1]);
}

function publicArtifact(artifact: any) {
  return Object.freeze({
    artifactId: artifact.artifactId,
    workspaceId: artifact.workspaceId,
    executionId: artifact.executionId,
    workUnitId: artifact.workUnitId,
    artifactVersion: artifact.artifactVersion,
    artifactType: artifact.artifactType,
    lifecycle: artifact.lifecycle,
    content: artifact.content,
    affectedFiles: artifact.affectedFiles,
    affectedSymbols: artifact.affectedSymbols,
    diagnostics: artifact.diagnostics,
    confidence: artifact.confidence,
    warnings: artifact.warnings,
    generationMetadata: artifact.generationMetadata,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  });
}

function publicStageResource(resource: any) {
  const blocked = new Set([
    "tenantId", "ownerId", "leaseToken", "validationLeaseExpiresAt",
    "assemblyLeaseExpiresAt", "preparationLeaseExpiresAt", "writeLeaseExpiresAt",
    "persistenceVersion", "deterministicSeed", "stack", "databaseId",
    "databaseIdentifier", "secret", "token",
  ]);
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return Object.freeze(value.map(sanitize));
    if (!value || typeof value !== "object") return value;
    return Object.freeze(Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !blocked.has(key))
        .map(([key, child]) => [key, sanitize(child)]),
    ));
  };
  return sanitize(resource);
}

function publicKnowledge(entry: any) {
  return Object.freeze({
    knowledgeId: entry.knowledgeId,
    repositoryId: entry.repositoryId,
    repositoryRevision: entry.repositoryRevision,
    namespace: entry.namespace,
    subject: entry.subject,
    contentHash: entry.contentHash,
    sourceType: entry.sourceType,
    confidence: entry.confidence,
    version: entry.version,
    lifecycle: entry.lifecycle,
    content: entry.versions?.find((version: any) =>
      version.version === entry.version)?.content ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  });
}

function publicMemory(memory: any) {
  return Object.freeze({
    memoryId: memory.memoryId,
    agentId: memory.agentId,
    runtimeVersion: memory.runtimeVersion,
    repositoryId: memory.repositoryId,
    repositoryRevision: memory.repositoryRevision,
    executionId: memory.executionId,
    memoryScope: memory.memoryScope,
    confidence: memory.confidence,
    knowledgeId: memory.knowledgeId,
    knowledgeVersion: memory.knowledgeVersion,
    retrievalMetadata: memory.retrievalMetadata,
    createdAt: memory.createdAt,
    expiresAt: memory.expiresAt,
  });
}

function historyFor(workflow: any) {
  return [...workflow.lifecycleHistory]
    .sort((a, b) => a.workflowVersion - b.workflowVersion ||
      a.createdAt.localeCompare(b.createdAt))
    .map((event) => {
      const attempt = workflow.attemptHistory.find((item: any) =>
        item.workflowVersion === event.workflowVersion);
      const diagnostics = workflow.diagnostics.filter((item: any) =>
        item.workflowVersion === event.workflowVersion);
      return Object.freeze({
        version: event.workflowVersion,
        stage: event.stage,
        lifecycle: event.to,
        transition: Object.freeze({
          from: event.from,
          to: event.to,
          reason: event.reason,
        }),
        attempt: attempt ? Object.freeze({
          number: attempt.attempt,
          event: attempt.event,
        }) : null,
        timestamp: event.createdAt,
        diagnostics: Object.freeze({
          info: diagnostics.filter((item: any) => item.severity === "info").length,
          warnings: diagnostics.filter((item: any) =>
            item.severity === "warning").length,
          errors: diagnostics.filter((item: any) =>
            item.severity === "error").length,
          codes: diagnostics.map((item: any) => item.code).sort(),
        }),
      });
    });
}

function mapError(c: any, error: unknown, metrics: MetricsRegistry) {
  if (error instanceof EngineeringPlatformApiError) {
    const status = {
      invalid_request: 400,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      precondition_failed: 412,
      validation_failed: 422,
      service_unavailable: 503,
    }[error.code] as 400 | 403 | 404 | 409 | 412 | 422 | 503;
    if (status === 412) metrics.incrementEngineeringApi("stale_version_failure");
    return fail(c, { code: error.code, message: {
      invalid_request: "The request is invalid.",
      forbidden: "Access is forbidden.",
      not_found: "The requested resource was not found.",
      conflict: "The request conflicts with the current resource state.",
      precondition_failed: "The resource version precondition failed.",
      validation_failed: "The request failed validation.",
      service_unavailable: "The engineering platform is unavailable.",
    }[error.code] }, status);
  }
  if (error instanceof EngineeringApiIdempotencyConflictError) {
    return fail(c, {
      code: "conflict",
      message: "The idempotency key was already used with a different request.",
    }, 409);
  }
  if (error instanceof AutonomousWorkflowError) {
    return fail(c, {
      code: "conflict",
      message: "The workflow action is invalid for its current state.",
    }, 409);
  }
  if (error instanceof z.ZodError) {
    return fail(c, {
      code: "validation_failed",
      message: "The request failed validation.",
      details: { fields: error.issues.map((issue) => issue.path.join(".")) },
    }, 422);
  }
  c.get("requestLogger")?.error("engineering_api_failure", {
    requestId: c.get("requestId"),
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return fail(c, {
    code: "service_unavailable",
    message: "The engineering platform is unavailable.",
  }, 503);
}

export function createEngineeringPlatformApiRoute(options: {
  service?: EngineeringPlatformApiService;
  metrics?: MetricsRegistry;
} = {}) {
  const service = options.service ?? runtimeEngineeringPlatformApiService;
  const metrics = options.metrics ?? runtimeMetrics;
  const route = new Hono();

  const handled = (handler: (c: any) => Promise<Response>) =>
    async (c: any) => {
      try {
        return await handler(c);
      } catch (error) {
        return mapError(c, error, metrics);
      }
    };

  route.get("/openapi.json", handled(async (c) => ok(c, engineeringPlatformOpenApi)));

  route.post("/workflows", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const input = createWorkflowSchema.parse(await c.req.json());
    const idempotencyKey = c.req.header("Idempotency-Key") ??
      input.idempotencyKey;
    if (!idempotencyKey) {
      throw new EngineeringPlatformApiError(
        "invalid_request", "An idempotency key is required.");
    }
    setRequestLogContext(c, {
      repositoryId: input.repositoryId,
      operation: "engineering.workflow.create",
    });
    const result = await executeEngineeringApiIdempotent({
      store: service.dependencies.idempotency,
      key: {
        ownerId: user.userId,
        route: "POST /api/v1/workflows",
        target: input.repositoryId,
        idempotencyKey,
      },
      payload: input,
      ttlMs: IDEMPOTENCY_TTL_MS,
      operation: async () => ({
        status: 201,
        response: publicWorkflow(await service.createWorkflow({
          ownerId: user.userId,
          repositoryId: input.repositoryId,
          repositoryRevision: input.repositoryRevision,
          task: input.task,
          executionConfiguration: input.executionConfiguration,
          idempotencyKey,
        })),
      }),
    });
    if (result.replayed) {
      c.header("Idempotency-Replayed", "true");
      metrics.incrementEngineeringApi("idempotency_hit");
    } else {
      metrics.incrementEngineeringApi("workflow_creation");
    }
    c.header("ETag", `\"${result.response.version}\"`);
    return ok(c, result.response, result.status as 200 | 201);
  }));

  route.get("/workflows", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const query = paginationSchema.parse(c.req.query());
    const workflows = await service.listWorkflows(user.userId);
    const result = page(
      workflows.map(publicWorkflow),
      query.limit,
      query.cursor,
      (item) => `${item.updatedAt}\0${item.workflowId}`,
    );
    if (query.cursor || c.req.query("limit")) metrics.incrementEngineeringApi("pagination");
    if (result.nextCursor) c.header("X-Next-Cursor", result.nextCursor);
    return ok(c, result);
  }));

  route.get("/workflows/:workflowId", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const workflow = await service.getWorkflow(user.userId, c.req.param("workflowId"));
    const resource = publicWorkflow(workflow);
    c.header("ETag", `\"${resource.version}\"`);
    return ok(c, resource);
  }));

  const action = (
    name: "approve" | "retry" | "resume" | "cancel" | "replay",
    metric: "approval" | "retry" | "resume" | "cancellation" | "replay",
  ) => handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const workflowId = c.req.param("workflowId");
    const expectedVersion = parseIfMatch(c.req.header("If-Match"));
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new EngineeringPlatformApiError(
        "invalid_request", "An idempotency key is required.");
    }
    setRequestLogContext(c, {
      operation: `engineering.workflow.${name}`,
    });
    const result = await executeEngineeringApiIdempotent({
      store: service.dependencies.idempotency,
      key: {
        ownerId: user.userId,
        route: `POST /api/v1/workflows/:workflowId/${name}`,
        target: workflowId,
        idempotencyKey,
      },
      payload: { expectedVersion },
      ttlMs: IDEMPOTENCY_TTL_MS,
      operation: async () => ({
        status: 200,
        response: publicWorkflow(
          await service[name](user.userId, workflowId, expectedVersion)),
      }),
    });
    if (result.replayed) {
      c.header("Idempotency-Replayed", "true");
      metrics.incrementEngineeringApi("idempotency_hit");
    } else {
      metrics.incrementEngineeringApi(metric);
    }
    c.header("ETag", `\"${result.response.version}\"`);
    return ok(c, result.response);
  });

  route.post("/workflows/:workflowId/approve", action("approve", "approval"));
  route.post("/workflows/:workflowId/retry", action("retry", "retry"));
  route.post("/workflows/:workflowId/resume", action("resume", "resume"));
  route.post("/workflows/:workflowId/cancel", action("cancel", "cancellation"));
  route.post("/workflows/:workflowId/replay", action("replay", "replay"));

  route.get("/workflows/:workflowId/history", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const query = paginationSchema.parse(c.req.query());
    const workflow = await service.getWorkflow(user.userId, c.req.param("workflowId"));
    const result = page(
      historyFor(workflow), query.limit, query.cursor,
      (item) => String(item.version),
    );
    if (query.cursor || c.req.query("limit")) metrics.incrementEngineeringApi("pagination");
    if (result.nextCursor) c.header("X-Next-Cursor", result.nextCursor);
    return ok(c, result);
  }));

  route.get("/workflows/:workflowId/artifacts", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const query = paginationSchema.parse(c.req.query());
    await service.getWorkflow(user.userId, c.req.param("workflowId"));
    try {
      const artifact = publicArtifact(await service.artifact(
        user.userId, c.req.param("workflowId")));
      return ok(c, page([artifact], query.limit, query.cursor,
        (item) => item.artifactId));
    } catch (error) {
      if (error instanceof EngineeringPlatformApiError &&
          error.code === "not_found") {
        return ok(c, { items: [], nextCursor: null, limit: query.limit });
      }
      throw error;
    }
  }));

  route.get("/workflows/:workflowId/artifacts/:artifactId", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    return ok(c, publicArtifact(await service.artifact(
      user.userId, c.req.param("workflowId"), c.req.param("artifactId"))));
  }));

  for (const [path, method] of [
    ["review", "review"],
    ["proposal", "proposal"],
    ["apply-plan", "applyPlan"],
  ] as const) {
    route.get(`/workflows/:workflowId/${path}`, handled(async (c) => {
      const user = requireAuthenticatedUser(c);
      return ok(c, publicStageResource(await service[method](
        user.userId, c.req.param("workflowId"))));
    }));
  }

  route.get("/repositories/:owner/:repo/knowledge", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const query = knowledgeQuerySchema.parse(c.req.query());
    const repositoryId = `${c.req.param("owner")}/${c.req.param("repo")}`;
    const entries = await service.retrieveKnowledge({
      ownerId: user.userId,
      repositoryId,
      repositoryRevision: query.repositoryRevision,
      namespace: query.namespace,
      subject: query.subject,
      executionId: query.executionId,
      minimumConfidence: query.minimumConfidence,
      version: query.version,
      limit: MAX_PAGE_SIZE,
    });
    const result = page(entries.map(publicKnowledge), query.limit, query.cursor,
      (item) => `${item.knowledgeId}\0${item.version}`);
    if (query.cursor || c.req.query("limit")) metrics.incrementEngineeringApi("pagination");
    if (result.nextCursor) c.header("X-Next-Cursor", result.nextCursor);
    return ok(c, result);
  }));

  route.get("/repositories/:owner/:repo/knowledge/:knowledgeId", handled(
    async (c) => {
      const user = requireAuthenticatedUser(c);
      const repositoryId = `${c.req.param("owner")}/${c.req.param("repo")}`;
      return ok(c, publicKnowledge(await service.getKnowledge(
        user.userId, repositoryId, c.req.param("knowledgeId"))));
    },
  ));

  route.get("/repositories/:owner/:repo/memory", handled(async (c) => {
    const user = requireAuthenticatedUser(c);
    const query = knowledgeQuerySchema.parse(c.req.query());
    const repositoryId = `${c.req.param("owner")}/${c.req.param("repo")}`;
    let memories = (await service.memories(user.userId, repositoryId))
      .map(publicMemory)
      .filter((memory) =>
        (!query.repositoryRevision ||
          memory.repositoryRevision === query.repositoryRevision) &&
        (!query.executionId || memory.executionId === query.executionId) &&
        (query.minimumConfidence === undefined ||
          memory.confidence >= query.minimumConfidence) &&
        (query.version === undefined ||
          memory.knowledgeVersion === query.version));
    if (query.namespace || query.subject) {
      const knowledge = await service.retrieveKnowledge({
        ownerId: user.userId,
        repositoryId,
        namespace: query.namespace,
        subject: query.subject,
        limit: MAX_PAGE_SIZE,
      });
      const ids = new Set(knowledge.map((entry) => entry.knowledgeId));
      memories = memories.filter((memory) =>
        ids.has(memory.knowledgeId));
    }
    const result = page(memories, query.limit, query.cursor,
      (item) => `${item.createdAt}\0${item.memoryId}`);
    if (query.cursor || c.req.query("limit")) metrics.incrementEngineeringApi("pagination");
    if (result.nextCursor) c.header("X-Next-Cursor", result.nextCursor);
    return ok(c, result);
  }));

  return route;
}
