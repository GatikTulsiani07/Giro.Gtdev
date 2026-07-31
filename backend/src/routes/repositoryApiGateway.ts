import { Hono } from "hono";
import { z } from "zod";
import { requireAuthenticatedUser } from "../services/auth/authContext.js";
import { setAuthenticatedUser } from "../services/auth/authContext.js";
import { parseBearerToken, verifyAccessToken } from "../services/auth/jwt.js";
import { setRequestLogContext } from "../middleware/requestContext.js";
import {
  runtimeRepositoryApiGateway,
  type RepositoryApiGateway,
} from "../services/repositoryApiGateway/service.js";
import {
  RepositoryGatewayError,
  type RepositoryGatewayDiagnostic,
  type RepositoryGatewayService,
} from "../services/repositoryApiGateway/types.js";

const revision = z.string().regex(/^[0-9a-f]{40}$/);
const text = z.string().trim().min(1).max(20_000);
const workflowId = z.string().trim().min(1).max(256);
const fenced = z.object({ revision }).strict();
const schemas = {
  "repository-query": fenced.extend({
    query: text,
    workflowId: workflowId.optional(),
    sessionId: z.string().trim().min(1).max(256).optional(),
  }).strict(),
  "repository-insights": fenced.extend({
    filters: z.object({
      limit: z.number().int().min(1).max(500).optional(),
      featureId: z.string().trim().min(1).max(256).optional(),
      module: z.string().trim().min(1).max(1_024).optional(),
      file: z.string().trim().min(1).max(4_096).optional(),
      category: z.enum([
        "architectural hotspots",
        "duplicated logic",
        "dependency issues",
        "documentation issues",
      ]).optional(),
    }).strict().optional(),
  }).strict(),
  "feature-navigation": fenced.extend({
    operation: z.enum([
      "feature", "entry-points", "exit-points", "files", "symbols",
      "dependencies", "upstream", "downstream",
    ]),
    name: z.string().trim().min(1).max(1_024),
  }).strict(),
  "semantic-navigation": fenced.extend({
    operation: z.enum([
      "definition", "references", "implementations", "callers", "callees",
      "inheritance", "dependencies",
    ]),
    query: z.string().trim().min(1).max(1_024),
  }).strict(),
  "change-impact": fenced.extend({
    workflowId,
    target: z.object({
      kind: z.enum([
        "feature", "module", "file", "symbol", "api_endpoint", "route",
        "service", "repository_component",
      ]),
      value: z.string().trim().min(1).max(4_096),
    }).strict(),
    changeType: z.enum(["add", "modify", "remove", "refactor", "fix", "migrate"]),
    rationale: text,
  }).strict(),
  "task-planning": fenced.extend({
    objective: text,
    workflowId: workflowId.optional(),
  }).strict(),
  "engineering-specification": fenced.extend({
    objective: text,
    taskId: z.string().trim().min(1).max(256).optional(),
    workflowId: workflowId.optional(),
  }).strict(),
  "execution-coordination": fenced.extend({
    objective: text,
    workflowId,
  }).strict(),
  "repository-evolution": fenced.extend({
    baseRevision: revision,
  }).strict(),
} as const;

const pathPart = z.string().regex(/^[A-Za-z0-9._-]{1,200}$/);
const requestId = (c: any) => String(c.get("requestId"));
const serviceByPath: Readonly<Record<string, RepositoryGatewayService>> = {
  overview: "repository-overview",
  query: "repository-query",
  insights: "repository-insights",
  features: "feature-navigation",
  semantics: "semantic-navigation",
  "change-impact": "change-impact",
  "task-plan": "task-planning",
  specification: "engineering-specification",
  execution: "execution-coordination",
  evolution: "repository-evolution",
};

export function repositoryApiGatewayAuthMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    const token = parseBearerToken(c.req.header("Authorization"));
    const payload = token ? await verifyAccessToken(token) : null;
    if (payload) {
      setAuthenticatedUser(c, {
        userId: payload.userId,
        email: payload.email,
      });
      await next();
      return;
    }
    const receivedAt = new Date().toISOString();
    const parts = new URL(c.req.url).pathname.split("/").filter(Boolean);
    const gatewayIndex = parts.indexOf("repository-gateway");
    const owner = parts[gatewayIndex + 1] ?? "";
    const repo = parts[gatewayIndex + 2] ?? "";
    const operation = parts[gatewayIndex + 3] ?? "";
    const service = serviceByPath[operation] ?? "repository-overview";
    let requestedRevision = c.req.query("revision") ?? "";
    if (!requestedRevision && c.req.method !== "GET") {
      const body = await c.req.raw.clone().json().catch(() => null) as
        { revision?: unknown } | null;
      if (typeof body?.revision === "string") {
        requestedRevision = body.revision;
      }
    }
    return c.json({
      requestId: requestId(c),
      repositoryId: owner && repo ? `${owner}/${repo}` : "",
      revision: requestedRevision,
      service,
      status: "error",
      payload: null,
      diagnostics: [{
        code: "gateway_authorization_failed",
        message: token
          ? "The authorization token is invalid."
          : "Authorization is required.",
        severity: "error",
        service,
      }],
      timestamps: {
        receivedAt,
        completedAt: new Date().toISOString(),
      },
    }, 401);
  };
}

function statusCode(error: RepositoryGatewayError) {
  return error.httpStatus;
}

export function createRepositoryApiGatewayRoute(options: {
  gateway?: RepositoryApiGateway;
} = {}) {
  const gateway = options.gateway ?? runtimeRepositoryApiGateway;
  const route = new Hono();

  const repository = (c: any) => {
    const owner = pathPart.parse(c.req.param("owner"));
    const repo = pathPart.parse(c.req.param("repo"));
    return `${owner}/${repo}`;
  };

  const errorResponse = (
    c: any,
    service: RepositoryGatewayService,
    repositoryId: string,
    requestedRevision: string,
    error: unknown,
    receivedAt: string,
  ) => {
    const normalized = error instanceof RepositoryGatewayError
      ? error
      : error instanceof z.ZodError
        ? new RepositoryGatewayError(
          "gateway_validation_failed",
          "The gateway request failed validation.",
          400,
          { fields: error.issues.map((issue) => issue.path.join(".")) },
        )
        : new RepositoryGatewayError(
          "gateway_dependency_unavailable",
          "The repository gateway is unavailable.",
          503,
        );
    const diagnostic: RepositoryGatewayDiagnostic = {
      code: normalized.code,
      message: normalized.message,
      severity: "error",
      service,
      ...(Object.keys(normalized.details).length
        ? { details: normalized.details } : {}),
    };
    return c.json({
      requestId: requestId(c),
      repositoryId,
      revision: requestedRevision,
      service,
      status: "error",
      payload: null,
      diagnostics: [diagnostic],
      timestamps: {
        receivedAt,
        completedAt: new Date().toISOString(),
      },
    }, statusCode(normalized));
  };

  const post = (
    path: string,
    service: Exclude<RepositoryGatewayService, "repository-overview">,
    schema: z.ZodTypeAny,
  ) => route.post(path, async (c) => {
    const receivedAt = new Date().toISOString();
    let repositoryId = `${c.req.param("owner")}/${c.req.param("repo")}`;
    let requestedRevision = "";
    try {
      const user = requireAuthenticatedUser(c);
      repositoryId = repository(c);
      const raw = await c.req.json().catch(() => null);
      const input = schema.parse(raw) as Record<string, unknown> & {
        revision: string;
      };
      requestedRevision = input.revision;
      setRequestLogContext(c, {
        repositoryId,
        operation: `repository_gateway.${service}`,
      });
      const response = await gateway.execute({
        requestId: requestId(c),
        ownerId: user.userId,
        repositoryId,
        revision: input.revision,
        service,
        input: Object.fromEntries(Object.entries(input)
          .filter(([key]) => key !== "revision")),
        receivedAt,
      });
      return c.json(response, response.status === "partial" ? 207 : 200);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const user = requireAuthenticatedUser(c);
        await gateway.recordFailure(user.userId, service, 0);
      }
      return errorResponse(c, service, repositoryId, requestedRevision,
        error, receivedAt);
    }
  });

  route.get("/:owner/:repo/overview", async (c) => {
    const receivedAt = new Date().toISOString();
    let repositoryId = `${c.req.param("owner")}/${c.req.param("repo")}`;
    const service = "repository-overview";
    let requestedRevision = c.req.query("revision") ?? "";
    try {
      const user = requireAuthenticatedUser(c);
      repositoryId = repository(c);
      requestedRevision = revision.parse(requestedRevision);
      setRequestLogContext(c, {
        repositoryId,
        operation: "repository_gateway.repository-overview",
      });
      return c.json(await gateway.execute({
        requestId: requestId(c),
        ownerId: user.userId,
        repositoryId,
        revision: requestedRevision,
        service,
        input: {},
        receivedAt,
      }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        const user = requireAuthenticatedUser(c);
        await gateway.recordFailure(user.userId, service, 0);
      }
      return errorResponse(c, service, repositoryId, requestedRevision,
        error, receivedAt);
    }
  });

  post("/:owner/:repo/query", "repository-query", schemas["repository-query"]);
  post("/:owner/:repo/insights", "repository-insights",
    schemas["repository-insights"]);
  post("/:owner/:repo/features", "feature-navigation",
    schemas["feature-navigation"]);
  post("/:owner/:repo/semantics", "semantic-navigation",
    schemas["semantic-navigation"]);
  post("/:owner/:repo/change-impact", "change-impact",
    schemas["change-impact"]);
  post("/:owner/:repo/task-plan", "task-planning",
    schemas["task-planning"]);
  post("/:owner/:repo/specification", "engineering-specification",
    schemas["engineering-specification"]);
  post("/:owner/:repo/execution", "execution-coordination",
    schemas["execution-coordination"]);
  post("/:owner/:repo/evolution", "repository-evolution",
    schemas["repository-evolution"]);

  return route;
}
