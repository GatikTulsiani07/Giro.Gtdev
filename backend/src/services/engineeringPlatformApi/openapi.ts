import { WORKFLOW_ENGINE_REGISTRY, WORKFLOW_STAGES } from "../autonomousWorkflow/index.js";

const workflowPaths = [
  ["/api/v1/workflows", "post", "createWorkflow"],
  ["/api/v1/workflows", "get", "listWorkflows"],
  ["/api/v1/workflows/{workflowId}", "get", "getWorkflow"],
  ["/api/v1/workflows/{workflowId}/approve", "post", "approveWorkflow"],
  ["/api/v1/workflows/{workflowId}/retry", "post", "retryWorkflow"],
  ["/api/v1/workflows/{workflowId}/resume", "post", "resumeWorkflow"],
  ["/api/v1/workflows/{workflowId}/cancel", "post", "cancelWorkflow"],
  ["/api/v1/workflows/{workflowId}/replay", "post", "replayWorkflow"],
  ["/api/v1/workflows/{workflowId}/history", "get", "getWorkflowHistory"],
  ["/api/v1/workflows/{workflowId}/artifacts", "get", "listWorkflowArtifacts"],
  ["/api/v1/workflows/{workflowId}/artifacts/{artifactId}", "get", "getWorkflowArtifact"],
  ["/api/v1/workflows/{workflowId}/review", "get", "getWorkflowReview"],
  ["/api/v1/workflows/{workflowId}/proposal", "get", "getWorkflowProposal"],
  ["/api/v1/workflows/{workflowId}/apply-plan", "get", "getWorkflowApplyPlan"],
  ["/api/v1/repositories/{owner}/{repo}/knowledge", "get", "listRepositoryKnowledge"],
  ["/api/v1/repositories/{owner}/{repo}/knowledge/{knowledgeId}", "get", "getRepositoryKnowledge"],
  ["/api/v1/repositories/{owner}/{repo}/memory", "get", "listRepositoryMemory"],
] as const;

const bearer = [{ bearerAuth: [] }];
const response = (schema: string) => ({
  "200": {
    description: "Successful response",
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schema}` },
      },
    },
  },
  "400": { $ref: "#/components/responses/Error" },
  "401": { $ref: "#/components/responses/Error" },
  "403": { $ref: "#/components/responses/Error" },
  "404": { $ref: "#/components/responses/Error" },
  "409": { $ref: "#/components/responses/Error" },
  "412": { $ref: "#/components/responses/Error" },
  "422": { $ref: "#/components/responses/Error" },
  "429": { $ref: "#/components/responses/Error" },
  "503": { $ref: "#/components/responses/Error" },
});

function buildPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, method, operationId] of workflowPaths) {
    const isCreate = path === "/api/v1/workflows" && method === "post";
    const isMutation = method === "post";
    const isCollection = path === "/api/v1/workflows" ||
      path.endsWith("/history") || path.endsWith("/artifacts") ||
      path.endsWith("/knowledge") || path.endsWith("/memory");
    const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1], in: "path", required: true,
      schema: { type: "string", minLength: 1 },
    }));
    const knowledgeParameters = path.includes("/repositories/") &&
      (path.endsWith("/knowledge") || path.endsWith("/memory")) ? [
        { name: "namespace", in: "query", required: false,
          schema: { type: "string" } },
        { name: "subject", in: "query", required: false,
          schema: { type: "string" } },
        { name: "repositoryRevision", in: "query", required: false,
          schema: { type: "string" } },
        { name: "executionId", in: "query", required: false,
          schema: { type: "string" } },
        { name: "minimumConfidence", in: "query", required: false,
          schema: { type: "number", minimum: 0, maximum: 1 } },
        { name: "version", in: "query", required: false,
          schema: { type: "integer", minimum: 1 } },
      ] : [];
    const responseSchema = path.includes("history") ||
      (path.endsWith("workflows") && method === "get") ||
      path.endsWith("artifacts") ||
      path.endsWith("knowledge") ||
      path.endsWith("memory") ? "CollectionResponse" : "ResourceResponse";
    const operationResponses:
      Record<string, unknown> = response(responseSchema);
    if (isCreate) {
      operationResponses["201"] = operationResponses["200"];
      delete operationResponses["200"];
    }
    paths[path] ??= {};
    paths[path]![method] = {
      operationId,
      summary: operationId.replaceAll(/([A-Z])/g, " $1"),
      description: isMutation
        ? "Invokes the existing autonomous workflow service with durable idempotency and workflow version fencing."
        : "Returns an ownership-scoped resource using deterministic cursor pagination where applicable.",
      security: bearer,
      parameters: method === "get" && isCollection
        ? [...pathParameters, ...knowledgeParameters, {
        name: "cursor", in: "query", required: false,
        schema: { type: "string" },
        description: "Opaque deterministic cursor; offset pagination is unsupported.",
      }, {
        name: "limit", in: "query", required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      }] : method === "get" ? pathParameters : [...pathParameters, {
        name: "If-Match", in: "header",
        required: !isCreate,
        schema: { type: "string" },
        description: "ETag-compatible quoted durable workflow version.",
      }, {
        name: "Idempotency-Key", in: "header", required: true,
        schema: { type: "string", minLength: 1, maxLength: 256 },
        description:
          "Scoped to the authenticated user, route, target, and request payload.",
      }],
      ...(isCreate ? {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WorkflowCreateRequest" },
            },
          },
        },
      } : {}),
      responses: operationResponses,
    };
  }
  return paths;
}

export const engineeringPlatformOpenApi = Object.freeze({
  openapi: "3.1.0",
  info: {
    title: "Giro Engineering Platform API",
    version: "1.0.0",
    description:
      "Authenticated API for deterministic autonomous engineering workflows.",
  },
  servers: [{ url: "/" }],
  security: bearer,
  paths: buildPaths(),
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    responses: {
      Error: {
        description: "Production-safe error envelope.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      WorkflowCreateRequest: {
        type: "object",
        required: ["repositoryId", "repositoryRevision", "task"],
        additionalProperties: false,
        properties: {
          repositoryId: { type: "string" },
          repositoryRevision: { type: "string" },
          task: { type: "string", minLength: 1, maxLength: 10_000 },
          executionConfiguration: {
            type: "object",
            additionalProperties: false,
            properties: {
              policy: {
                type: "string", enum: ["review_only", "agent_assisted"],
              },
              maxParallelism: {
                type: "integer", minimum: 1, maximum: 16,
              },
            },
          },
          idempotencyKey: { type: "string" },
        },
      },
      Workflow: {
        type: "object",
        required: [
          "workflowId", "repositoryId", "executionId", "version",
          "lifecycle", "currentStage", "approvalState", "createdAt",
          "updatedAt", "links",
        ],
        properties: {
          workflowId: { type: "string" },
          repositoryId: { type: "string" },
          executionId: { type: "string" },
          version: { type: "integer" },
          lifecycle: { type: "string", enum: [
            "created", "analysing", "planning", "awaiting_approval",
            "executing", "reviewing", "assembling", "preparing_apply",
            "completed", "cancelled", "failed",
          ] },
          currentStage: { type: ["string", "null"], enum: [
            ...WORKFLOW_STAGES, null,
          ] },
          approvalState: {
            type: "string", enum: ["required", "approved", "not_required"],
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          links: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      ResourceResponse: {
        type: "object", required: ["success", "data", "requestId"],
        properties: {
          success: { const: true }, data: {},
          requestId: { type: "string" },
        },
      },
      CollectionResponse: {
        allOf: [{ $ref: "#/components/schemas/ResourceResponse" }],
      },
      ErrorResponse: {
        type: "object", required: ["success", "error", "requestId"],
        properties: {
          success: { const: false },
          error: {
            type: "object", required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
            },
          },
          requestId: { type: "string" },
        },
      },
      CursorPage: {
        type: "object",
        properties: {
          nextCursor: { type: ["string", "null"] },
          limit: { type: "integer" },
        },
      },
    },
  },
});

export function verifyEngineeringPlatformApiContracts() {
  const operationIds = Object.values(engineeringPlatformOpenApi.paths)
    .flatMap((path) => Object.values(path).map((operation) =>
      (operation as { operationId: string }).operationId));
  if (new Set(operationIds).size !== operationIds.length) {
    throw new Error("engineering_api_duplicate_operation_id");
  }
  if (operationIds.length !== workflowPaths.length) {
    throw new Error("engineering_api_route_contract_missing");
  }
  const requiredSchemas = [
    "WorkflowCreateRequest", "Workflow", "ResourceResponse",
    "CollectionResponse", "ErrorResponse", "CursorPage",
  ];
  for (const schema of requiredSchemas) {
    if (!(schema in engineeringPlatformOpenApi.components.schemas)) {
      throw new Error("engineering_api_required_schema_missing");
    }
  }
  const registered = WORKFLOW_ENGINE_REGISTRY.map(({ stage }) => stage);
  if (JSON.stringify(registered) !== JSON.stringify(WORKFLOW_STAGES)) {
    throw new Error("engineering_api_workflow_service_unregistered");
  }
  const routeContracts = workflowPaths.map(([path, method]) => `${method}:${path}`);
  if (new Set(routeContracts).size !== routeContracts.length) {
    throw new Error("engineering_api_duplicate_route_contract");
  }
}
