import { Hono } from "hono";
import { z } from "zod";
import { setRequestLogContext } from "../middleware/requestContext.js";
import {
  runtimeMetrics,
  type MetricsRegistry,
  type RepositorySessionApiAction,
} from "../observability/metrics.js";
import {
  getAuthenticatedUser,
  requireAuthenticatedUser,
  setAuthenticatedUser,
} from "../services/auth/authContext.js";
import {
  parseBearerToken,
  verifyAccessToken,
} from "../services/auth/jwt.js";
import {
  runtimeRepositorySessionEngine,
  type RepositorySessionEngine,
} from "../services/repositorySession/service.js";
import { RepositorySessionError } from
  "../services/repositorySession/types.js";
import {
  RepositorySessionApiSchemas,
  publicRepositorySessionDiagnostic,
  publicRepositorySessionRecord,
  publicRepositorySessionSummary,
  repositorySessionApiFailure,
  repositorySessionApiSuccess,
  sanitizeRepositorySessionApiValue,
  type PublicRepositorySessionDiagnostic,
} from "../services/repositorySessionApi/contracts.js";

type SessionApiEngine = Pick<
  RepositorySessionEngine,
  "create" | "list" | "get" | "archive" | "query" | "plan" |
  "specification" | "insights" | "coordinate"
>;

type SessionApiStatus = 400 | 401 | 403 | 404 | 409 | 424 | 429 | 500 | 503;

function diagnosticFromError(
  code: string,
  message: string,
  details?: unknown,
): PublicRepositorySessionDiagnostic {
  const sanitized = sanitizeRepositorySessionApiValue(details);
  return {
    code,
    message,
    severity: "error",
    ...(sanitized && typeof sanitized === "object" &&
      !Array.isArray(sanitized)
      ? { details: sanitized as Readonly<Record<string, unknown>> }
      : {}),
  };
}

function statusForCode(code: string): SessionApiStatus {
  if (/access_denied|ownership|forbidden|not_owned/.test(code)) return 403;
  if (/not_found/.test(code)) return 404;
  if (
    /revision_conflict|version_conflict|identity_conflict|workflow_required|inactive|expired|stale/.test(
      code,
    )
  ) return 409;
  if (/intelligence_unavailable|sources_invalid|lineage_invalid/.test(code)) {
    return 424;
  }
  if (/persistence|dependency|startup|unavailable/.test(code)) return 503;
  if (/validation|invalid|required|empty/.test(code)) return 400;
  return 500;
}

function normalizedError(error: unknown) {
  if (error instanceof SyntaxError) {
    return {
      status: 400 as const,
      code: "repository_session_api_invalid_json",
      message: "The repository session request body is not valid JSON.",
      retryable: false,
      diagnostics: [
        diagnosticFromError(
          "repository_session_api_invalid_json",
          "The repository session request body is not valid JSON.",
        ),
      ],
    };
  }
  if (error instanceof z.ZodError) {
    const details = {
      fields: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    };
    return {
      status: 400 as const,
      code: "repository_session_api_validation_failed",
      message: "The repository session request failed validation.",
      retryable: false,
      diagnostics: [
        diagnosticFromError(
          "repository_session_api_validation_failed",
          "The repository session request failed validation.",
          details,
        ),
      ],
    };
  }

  const item = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  const code = typeof item?.code === "string" && item.code
    ? item.code : "repository_session_api_failure";
  const status = statusForCode(code);
  const known = error instanceof RepositorySessionError ||
    typeof item?.code === "string";
  const message = known && typeof item?.message === "string" && item.message
    ? item.message : "The repository session request could not be completed.";
  return {
    status,
    code,
    message,
    retryable: [424, 500, 503].includes(status),
    diagnostics: [diagnosticFromError(code, message, item?.details)],
  };
}

function resultDiagnostics(value: unknown):
readonly PublicRepositorySessionDiagnostic[] {
  if (!value || typeof value !== "object") return [];
  const diagnostics = (value as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.code !== "string" ||
        typeof candidate.message !== "string") return [];
    return [{
      code: candidate.code,
      message: candidate.message,
      severity: candidate.severity === "warning" ||
        candidate.severity === "error"
        ? candidate.severity : "info",
      ...(candidate.details && typeof candidate.details === "object"
        ? {
            details: sanitizeRepositorySessionApiValue(
              candidate.details,
            ) as Readonly<Record<string, unknown>>,
          }
        : {}),
    }];
  });
}

export function repositorySessionApiAuthMiddleware(
  metrics: Pick<MetricsRegistry, "incrementRepositorySessionApi"> =
    runtimeMetrics,
) {
  return async (c: any, next: () => Promise<void>) => {
    if (getAuthenticatedUser(c)) {
      await next();
      return;
    }
    const token = parseBearerToken(c.req.header("Authorization"));
    const payload = token ? await verifyAccessToken(token) : null;
    if (!payload) {
      metrics.incrementRepositorySessionApi("failure");
      return repositorySessionApiFailure(c, {
        status: 401,
        code: token
          ? "repository_session_api_invalid_token"
          : "repository_session_api_unauthorized",
        message: token
          ? "The authorization token is invalid."
          : "Authorization is required.",
        retryable: false,
      });
    }
    setAuthenticatedUser(c, {
      userId: payload.userId,
      email: payload.email,
    });
    await next();
  };
}

export function createRepositorySessionsApiRoute(options: {
  engine?: SessionApiEngine;
  metrics?: Pick<MetricsRegistry, "incrementRepositorySessionApi">;
} = {}) {
  const engine = options.engine ?? runtimeRepositorySessionEngine;
  const metrics = options.metrics ?? runtimeMetrics;
  const route = new Hono();

  const record = (action: RepositorySessionApiAction) =>
    metrics.incrementRepositorySessionApi(action);

  const handled = (
    operation: string,
    handler: (c: any) => Promise<Response>,
  ) => async (c: any) => {
    try {
      setRequestLogContext(c, {
        operation: `repository_session_api.${operation}`,
      });
      return await handler(c);
    } catch (error) {
      record("failure");
      const normalized = normalizedError(error);
      return repositorySessionApiFailure(c, normalized);
    }
  };

  const sessionId = (c: any) =>
    RepositorySessionApiSchemas.params.parse({
      sessionId: c.req.param("sessionId"),
    }).sessionId;

  const operation = (
    name: "query" | "plan" | "specification" | "execution",
    action: RepositorySessionApiAction,
    execute: (
      engine: SessionApiEngine,
      input: {
        tenantId: string;
        ownerId: string;
        sessionId: string;
        value: string;
      },
    ) => Promise<unknown>,
  ) => route.post(`/:sessionId/${name}`, handled(name, async (c) => {
    const user = requireAuthenticatedUser(c);
    const id = sessionId(c);
    const body = await c.req.json();
    const value = name === "query"
      ? RepositorySessionApiSchemas.query.parse(body).query
      : RepositorySessionApiSchemas.objective.parse(body).objective;
    setRequestLogContext(c, { sessionId: id });
    const result = await execute(engine, {
      tenantId: user.userId,
      ownerId: user.userId,
      sessionId: id,
      value,
    });
    const current = await engine.get(user.userId, user.userId, id);
    record(action);
    return repositorySessionApiSuccess(c, {
      status: 200,
      code: `repository_session_${name}_completed`,
      message: `Repository session ${name} completed.`,
      diagnostics: resultDiagnostics(result),
      data: {
        session: publicRepositorySessionRecord(current),
        result: sanitizeRepositorySessionApiValue(result),
      },
    });
  }));

  route.post("/", handled("create", async (c) => {
    const user = requireAuthenticatedUser(c);
    const input = RepositorySessionApiSchemas.create.parse(await c.req.json());
    const result = await engine.create({
      tenantId: user.userId,
      ownerId: user.userId,
      userId: user.userId,
      repositoryOwnerId: user.userId,
      repositoryId: `${input.owner}/${input.repo}`,
      repositoryRevision: input.revision,
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    });
    const reused = result.reuseCount > 0;
    record(reused ? "reuse" : "creation");
    return repositorySessionApiSuccess(c, {
      status: reused ? 200 : 201,
      code: reused
        ? "repository_session_reused"
        : "repository_session_created",
      message: reused
        ? "The existing repository session was resumed."
        : "The repository session was created.",
      data: publicRepositorySessionRecord(result),
    });
  }));

  route.get("/", handled("list", async (c) => {
    const user = requireAuthenticatedUser(c);
    const sessions = await engine.list(user.userId, user.userId);
    return repositorySessionApiSuccess(c, {
      status: 200,
      code: "repository_sessions_listed",
      message: "Repository sessions were listed.",
      data: {
        sessions: sessions.map(publicRepositorySessionSummary),
        count: sessions.length,
      },
    });
  }));

  route.get("/:sessionId", handled("retrieve", async (c) => {
    const user = requireAuthenticatedUser(c);
    const id = sessionId(c);
    setRequestLogContext(c, { sessionId: id });
    const result = await engine.get(user.userId, user.userId, id);
    return repositorySessionApiSuccess(c, {
      status: 200,
      code: "repository_session_retrieved",
      message: "The repository session was retrieved.",
      data: publicRepositorySessionRecord(result),
    });
  }));

  const archive = (empty: boolean) => handled("archive", async (c) => {
    const user = requireAuthenticatedUser(c);
    const id = sessionId(c);
    setRequestLogContext(c, { sessionId: id });
    const result = await engine.archive(user.userId, user.userId, id);
    record("archive");
    if (empty) return c.body(null, 204);
    return repositorySessionApiSuccess(c, {
      status: 200,
      code: "repository_session_archived",
      message: "The repository session was archived.",
      data: publicRepositorySessionRecord(result),
    });
  });

  route.delete("/:sessionId", archive(true));

  operation("query", "query", (service, input) => service.query({
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    sessionId: input.sessionId,
    question: input.value,
  }));
  operation("plan", "plan", (service, input) => service.plan({
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    sessionId: input.sessionId,
    objective: input.value,
  }));
  operation(
    "specification",
    "specification",
    (service, input) => service.specification({
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      objective: input.value,
    }),
  );

  route.post("/:sessionId/insights", handled("insights", async (c) => {
    const user = requireAuthenticatedUser(c);
    const id = sessionId(c);
    RepositorySessionApiSchemas.insights.parse(
      await c.req.json().catch(() => ({})),
    );
    setRequestLogContext(c, { sessionId: id });
    const result = await engine.insights({
      tenantId: user.userId,
      ownerId: user.userId,
      sessionId: id,
    });
    const current = await engine.get(user.userId, user.userId, id);
    record("insights");
    return repositorySessionApiSuccess(c, {
      status: 200,
      code: "repository_session_insights_completed",
      message: "Repository session insights completed.",
      diagnostics: resultDiagnostics(result),
      data: {
        session: publicRepositorySessionRecord(current),
        result: sanitizeRepositorySessionApiValue(result),
      },
    });
  }));

  operation("execution", "execution", (service, input) =>
    service.coordinate({
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      objective: input.value,
    }));

  route.post("/:sessionId/archive", archive(false));

  return route;
}
