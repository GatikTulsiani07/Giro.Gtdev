import { WORKFLOW_ENGINE_REGISTRY, WORKFLOW_STAGES } from "../autonomousWorkflow/index.js";
import { REPOSITORY_GATEWAY_SERVICES } from "../repositoryApiGateway/types.js";
import { REPOSITORY_SESSION_API_ROUTES } from "../repositorySessionApi/contracts.js";
import { REPOSITORY_METADATA_API_ROUTES } from "../repositoryMetadataApi/contracts.js";

export const PUBLIC_API_VERSION = "v1";
export const OPENAPI_VERSION = "3.1.0";
export const PUBLIC_CONTRACT_REVISION = "backend-compatibility-sprint-04";

type HttpMethod = "get" | "post" | "delete";
type Operation = Record<string, unknown>;
type PathItem = Partial<Record<HttpMethod, Operation>>;

const bearer = [{ bearerAuth: [] }];
const json = (schema: string) => ({
  "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
});
const standardError = { $ref: "#/components/responses/StandardError" };
const gatewayError = { $ref: "#/components/responses/GatewayError" };
const sessionError = { $ref: "#/components/responses/SessionError" };
const pathParameter = (name: string, schema: Record<string, unknown> = {
  type: "string", minLength: 1,
}) => ({ name, in: "path", required: true, schema });
const ownerRepoParameters = [
  pathParameter("owner", { type: "string", minLength: 1, maxLength: 39, pattern: "^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$" }),
  pathParameter("repo", { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9._-]+$" }),
];
const paginationParameters = [{
  name: "cursor", in: "query", required: false,
  schema: { type: "string", minLength: 1, maxLength: 2048 },
  description: "Opaque deterministic cursor; offset pagination is unsupported.",
}, {
  name: "limit", in: "query", required: false,
  schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
}];
const ifMatch = {
  name: "If-Match", in: "header", required: true,
  schema: { type: "string", pattern: '^(?:W/)?\"?[1-9][0-9]*\"?$' },
  description: "ETag-compatible quoted durable workflow version.",
};
const idempotencyKey = {
  name: "Idempotency-Key", in: "header", required: true,
  schema: { type: "string", minLength: 1, maxLength: 256 },
  description: "Scoped to the authenticated user, route, target, and payload for 24 hours.",
};
const body = (schema: string, required = true) => ({
  required,
  content: json(schema),
});
const successResponses = (schema: string, status = "200") => ({
  [status]: { description: "Successful response", content: json(schema) },
  "400": standardError, "401": standardError, "403": standardError,
  "404": standardError, "409": standardError, "422": standardError,
  "429": standardError, "500": standardError, "503": standardError,
});

/** Canonical inventory used by startup verification and contract tests. */
export const PUBLIC_API_ROUTE_INVENTORY = Object.freeze([
  ["GET", "/ready"], ["GET", "/health"], ["GET", "/health/live"],
  ["GET", "/health/ready"], ["GET", "/api/v1/openapi.json"],
  ["POST", "/repos/connect"], ["GET", "/repos/indexed"],
  ["GET", "/indexing/jobs/:jobId"],
  ["GET", "/repositories/:repositoryId/summary"],
  ["GET", "/repositories/:repositoryId/indexing/events"],
  ["POST", "/tools/file-tree"], ["POST", "/tools/list-dir"],
  ["POST", "/tools/read-file"], ["POST", "/tools/find-symbol"],
  ["POST", "/tools/grep"],
  ...REPOSITORY_METADATA_API_ROUTES,
  ...REPOSITORY_SESSION_API_ROUTES,
  ["POST", "/api/v1/workflows"], ["GET", "/api/v1/workflows"],
  ["GET", "/api/v1/workflows/:workflowId"],
  ["POST", "/api/v1/workflows/:workflowId/approve"],
  ["POST", "/api/v1/workflows/:workflowId/retry"],
  ["POST", "/api/v1/workflows/:workflowId/resume"],
  ["POST", "/api/v1/workflows/:workflowId/cancel"],
  ["POST", "/api/v1/workflows/:workflowId/replay"],
  ["GET", "/api/v1/workflows/:workflowId/history"],
  ["GET", "/api/v1/workflows/:workflowId/artifacts"],
  ["GET", "/api/v1/workflows/:workflowId/artifacts/:artifactId"],
  ["GET", "/api/v1/workflows/:workflowId/review"],
  ["GET", "/api/v1/workflows/:workflowId/proposal"],
  ["GET", "/api/v1/workflows/:workflowId/apply-plan"],
  ["GET", "/api/v1/repositories/:owner/:repo/knowledge"],
  ["GET", "/api/v1/repositories/:owner/:repo/knowledge/:knowledgeId"],
  ["GET", "/api/v1/repositories/:owner/:repo/memory"],
  ...REPOSITORY_GATEWAY_SERVICES.map((service) => [
    service === "repository-overview" ? "GET" : "POST",
    `/api/v1/repository-gateway/:owner/:repo/${({
      "repository-overview": "overview", "repository-query": "query",
      "repository-insights": "insights", "feature-navigation": "features",
      "semantic-navigation": "semantics", "change-impact": "change-impact",
      "task-planning": "task-plan", "engineering-specification": "specification",
      "execution-coordination": "execution", "repository-evolution": "evolution",
    } as const)[service]}`,
  ] as const),
] as const);

const diagnostic = {
  type: "object", required: ["code", "message", "severity"],
  additionalProperties: false,
  properties: {
    code: { type: "string" }, message: { type: "string" },
    severity: { type: "string", enum: ["info", "warning", "error"] },
    service: { type: "string" }, createdAt: { type: "string", format: "date-time" },
    details: { type: "object", additionalProperties: true },
  },
};
const revision = { type: "string", pattern: "^[0-9a-f]{40}$" };
const dateTime = { type: "string", format: "date-time" };
const nullableString = { type: ["string", "null"] };
const publicPayload = (description: string) => ({
  type: "object", description, additionalProperties: true,
});

const gatewayBaseProperties = {
  requestId: { type: "string" }, repositoryId: { type: "string" }, revision,
  service: { type: "string", enum: [...REPOSITORY_GATEWAY_SERVICES] },
  diagnostics: { type: "array", items: { $ref: "#/components/schemas/NormalizedDiagnostic" } },
  timestamps: {
    type: "object", required: ["receivedAt", "completedAt"], additionalProperties: false,
    properties: { receivedAt: dateTime, completedAt: dateTime },
  },
};
const gatewayEnvelope = (payloadSchema: string, status: "ok" | "partial") => ({
  type: "object",
  required: ["requestId", "repositoryId", "revision", "service", "status", "payload", "diagnostics", "timestamps"],
  additionalProperties: false,
  properties: {
    ...gatewayBaseProperties, status: { const: status },
    payload: { $ref: `#/components/schemas/${payloadSchema}` },
  },
});
const gatewayRequest = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object", required: ["revision", ...required], additionalProperties: false,
  properties: { revision, ...properties },
});

const sessionProperties = {
  sessionId: { type: "string", maxLength: 128 }, repositoryId: { type: "string" },
  repositoryOwner: { type: "string" }, repositoryName: { type: "string" }, revision,
  workflowId: nullableString, attachedWorkflowId: nullableString,
  workflowState: { type: ["string", "null"], enum: ["created", "analysing", "planning", "awaiting_approval", "executing", "reviewing", "assembling", "preparing_apply", "completed", "cancelled", "failed", null] },
  workflowStage: { type: ["string", "null"], enum: [...WORKFLOW_STAGES, null] },
  attachedAt: { type: ["string", "null"], format: "date-time" },
  lifecycle: { type: "string", enum: ["active", "interrupted", "stale", "recovered", "archived"] },
  createdAt: dateTime, updatedAt: dateTime, expiresAt: dateTime,
  archivedAt: { type: ["string", "null"], format: "date-time" },
};

const gatewayOperations = [
  ["overview", "get", "getRepositoryOverview", "RepositoryOverviewResponse", null],
  ["query", "post", "queryRepository", "RepositoryQueryResponse", "RepositoryQueryRequest"],
  ["insights", "post", "getRepositoryInsights", "InsightResponse", "InsightRequest"],
  ["features", "post", "navigateFeature", "FeatureNavigationResponse", "FeatureNavigationRequest"],
  ["semantics", "post", "navigateSemanticCode", "SemanticNavigationResponse", "SemanticNavigationRequest"],
  ["change-impact", "post", "analyzeChangeImpact", "ChangeImpactResponse", "ChangeImpactRequest"],
  ["task-plan", "post", "planRepositoryTask", "TaskPlanResponse", "TaskPlanRequest"],
  ["specification", "post", "createEngineeringSpecification", "SpecificationResponse", "SpecificationRequest"],
  ["execution", "post", "coordinateExecution", "ExecutionResponse", "ExecutionRequest"],
  ["evolution", "post", "compareRepositoryEvolution", "EvolutionResponse", "EvolutionRequest"],
] as const;

function addGatewayPaths(paths: Record<string, PathItem>) {
  for (const [suffix, method, operationId, payloadSchema, requestSchema] of gatewayOperations) {
    const path = `/api/v1/repository-gateway/{owner}/{repo}/${suffix}`;
    const successSchema = `${payloadSchema}GatewaySuccess`;
    const partialSchema = `${payloadSchema}GatewayPartial`;
    paths[path] = { [method]: {
      operationId, tags: ["Repository Gateway"], security: bearer,
      description: "Revision-fenced gateway operation. Payload and normalized diagnostics may coexist. Requests are safe to retry; successful results may be served from the gateway cache.",
      parameters: method === "get" ? [...ownerRepoParameters, {
        name: "revision", in: "query", required: true, schema: revision,
      }] : ownerRepoParameters,
      ...(requestSchema ? { requestBody: body(requestSchema) } : {}),
      responses: {
        "200": { description: "Complete gateway result", content: json(successSchema) },
        "207": { description: "Usable partial payload with diagnostics", content: json(partialSchema) },
        "400": gatewayError, "401": gatewayError, "403": gatewayError,
        "409": gatewayError, "424": gatewayError, "429": gatewayError,
        "503": gatewayError,
      },
      "x-idempotency": "Deterministic read-style operation; no Idempotency-Key is required.",
      "x-revision-fencing": "revision must equal the repository publishedRevision.",
    } } as PathItem;
  }
}

function addSessionPaths(paths: Record<string, PathItem>) {
  const sessionId = pathParameter("sessionId", { type: "string", minLength: 1, maxLength: 128 });
  const responses = (schema: string, created = false) => ({
    "200": { description: created ? "Existing active session reused." : "Repository session response", content: json(schema) },
    ...(created ? { "201": { description: "Repository session created.", content: json(schema) } } : {}),
    "400": sessionError, "401": sessionError, "403": sessionError,
    "404": sessionError, "409": sessionError, "422": sessionError,
    "424": sessionError, "429": sessionError, "500": sessionError,
    "503": sessionError,
  });
  paths["/api/v1/sessions"] = {
    post: { operationId: "createRepositorySession", tags: ["Repository Sessions"], security: bearer,
      requestBody: body("SessionCreateRequest"), responses: responses("SessionDetailEnvelope", true),
      description: "Creates or safely reuses the active revision-fenced session." },
    get: { operationId: "listRepositorySessions", tags: ["Repository Sessions"], security: bearer,
      responses: responses("SessionListEnvelope"), description: "Lists the authenticated user's repository sessions; pagination is not currently available." },
  };
  paths["/api/v1/sessions/{sessionId}"] = {
    get: { operationId: "getRepositorySession", tags: ["Repository Sessions"], security: bearer,
      parameters: [sessionId], responses: responses("SessionDetailEnvelope") },
    delete: { operationId: "deleteRepositorySession", tags: ["Repository Sessions"], security: bearer,
      parameters: [sessionId], responses: {
        "204": { description: "Session archived; response body is empty." },
        "400": sessionError, "401": sessionError, "403": sessionError,
        "404": sessionError, "409": sessionError, "429": sessionError,
        "500": sessionError, "503": sessionError,
      },
      description: "Compatibility delete: archives the session; it does not erase its durable record." },
  };
  for (const [suffix, operationId, requestSchema, responseSchema] of [
    ["query", "queryRepositorySession", "SessionQueryRequest", "SessionOperationEnvelope"],
    ["plan", "planRepositorySession", "SessionObjectiveRequest", "SessionOperationEnvelope"],
    ["specification", "specifyRepositorySession", "SessionObjectiveRequest", "SessionOperationEnvelope"],
    ["insights", "getRepositorySessionInsights", "SessionInsightsRequest", "SessionOperationEnvelope"],
    ["execution", "executeRepositorySession", "SessionObjectiveRequest", "SessionOperationEnvelope"],
    ["workflow", "attachRepositorySessionWorkflow", "WorkflowAttachmentRequest", "WorkflowAttachmentEnvelope"],
    ["archive", "archiveRepositorySession", "EmptyRequest", "SessionDetailEnvelope"],
  ] as const) {
    paths[`/api/v1/sessions/{sessionId}/${suffix}`] = { post: {
      operationId, tags: ["Repository Sessions"], security: bearer,
      parameters: [sessionId],
      ...(suffix === "archive" ? {} : {
        requestBody: body(requestSchema, suffix !== "insights"),
      }),
      responses: responses(responseSchema),
      description: suffix === "workflow"
        ? "Attaches an owned workflow for the same repository and exact revision."
        : "Operates on an active session fenced to its immutable repository revision.",
    } };
  }
}

function addWorkflowPaths(paths: Record<string, PathItem>) {
  const workflowId = pathParameter("workflowId");
  paths["/api/v1/workflows"] = {
    post: { operationId: "createWorkflow", tags: ["Workflows"], security: bearer,
      parameters: [idempotencyKey], requestBody: body("WorkflowCreateRequest"),
      responses: successResponses("WorkflowEnvelope", "201"),
      description: "Creates a revision-fenced workflow. The idempotency key is retained for 24 hours." },
    get: { operationId: "listWorkflows", tags: ["Workflows"], security: bearer,
      parameters: paginationParameters, responses: successResponses("WorkflowListEnvelope") },
  };
  paths["/api/v1/workflows/{workflowId}"] = { get: {
    operationId: "getWorkflow", tags: ["Workflows"], security: bearer,
    parameters: [workflowId], responses: successResponses("WorkflowEnvelope"),
  } };
  for (const action of ["approve", "retry", "resume", "cancel", "replay"] as const) {
    paths[`/api/v1/workflows/{workflowId}/${action}`] = { post: {
      operationId: `${action}Workflow`, tags: ["Workflows"], security: bearer,
      parameters: [workflowId, ifMatch, idempotencyKey],
      responses: { ...successResponses("WorkflowEnvelope"), "412": standardError },
      description: "Idempotent workflow transition fenced by the current durable workflow version.",
    } };
  }
  paths["/api/v1/workflows/{workflowId}/history"] = { get: {
    operationId: "getWorkflowHistory", tags: ["Workflows"], security: bearer,
    parameters: [workflowId, ...paginationParameters], responses: successResponses("WorkflowHistoryEnvelope"),
  } };
  paths["/api/v1/workflows/{workflowId}/artifacts"] = { get: {
    operationId: "listWorkflowArtifacts", tags: ["Workflows"], security: bearer,
    parameters: [workflowId, ...paginationParameters], responses: successResponses("WorkflowArtifactsEnvelope"),
  } };
  paths["/api/v1/workflows/{workflowId}/artifacts/{artifactId}"] = { get: {
    operationId: "getWorkflowArtifact", tags: ["Workflows"], security: bearer,
    parameters: [workflowId, pathParameter("artifactId")], responses: successResponses("WorkflowArtifactEnvelope"),
  } };
  for (const [suffix, operationId, schema] of [
    ["review", "getWorkflowReview", "WorkflowReviewEnvelope"],
    ["proposal", "getWorkflowProposal", "WorkflowProposalEnvelope"],
    ["apply-plan", "getWorkflowApplyPlan", "WorkflowApplyPlanEnvelope"],
  ] as const) {
    paths[`/api/v1/workflows/{workflowId}/${suffix}`] = { get: {
      operationId, tags: ["Workflows"], security: bearer,
      parameters: [workflowId], responses: successResponses(schema),
    } };
  }
}

function buildPaths() {
  const paths: Record<string, PathItem> = {
    "/ready": { get: { operationId: "getLegacyReadiness", tags: ["Health"], security: [], responses: { "200": { description: "Ready", content: json("HealthEnvelope") }, "503": { description: "Not ready", content: json("HealthEnvelope") } } } },
    "/health": { get: { operationId: "getHealth", tags: ["Health"], security: [], responses: { "200": { description: "Healthy", content: json("HealthEnvelope") }, "503": { description: "Unhealthy", content: json("HealthEnvelope") } } } },
    "/health/live": { get: { operationId: "getLiveness", tags: ["Health"], security: [], responses: { "200": { description: "Alive", content: json("StandardSuccessEnvelope") } } } },
    "/health/ready": { get: { operationId: "getReadiness", tags: ["Health"], security: [], responses: { "200": { description: "Ready", content: json("StandardSuccessEnvelope") }, "503": { description: "Not ready", content: json("StandardSuccessEnvelope") } } } },
    "/api/v1/openapi.json": { get: { operationId: "getOpenApiDocument", tags: ["Contract"], security: bearer, responses: successResponses("OpenApiEnvelope") } },
    "/repos/connect": { post: { operationId: "connectRepository", tags: ["Repositories"], security: bearer,
      parameters: [{ ...idempotencyKey, required: false, schema: { type: "string", minLength: 1, maxLength: 200, pattern: "^[!-~]+$" } }],
      requestBody: body("RepositoryConnectRequest"), responses: successResponses("RepositoryConnectionEnvelope"),
      description: "Idempotently connects and queues indexing. Without Idempotency-Key, idempotency is scoped to the request ID." } },
    "/repos/indexed": { get: { operationId: "listIndexedRepositories", tags: ["Repositories"], security: bearer, responses: successResponses("IndexedRepositoryListEnvelope") } },
    "/indexing/jobs/{jobId}": { get: { operationId: "getIndexingJob", tags: ["Indexing"], security: bearer,
      parameters: [pathParameter("jobId", { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9._:-]+$" })], responses: successResponses("IndexingJobEnvelope") } },
    "/repositories/{repositoryId}/summary": { get: { operationId: "getRepositorySummary", tags: ["Indexing"], security: bearer,
      parameters: [pathParameter("repositoryId", { type: "string", pattern: "^[^/]+/[^/]+$" })], responses: successResponses("RepositorySummaryEnvelope") } },
    "/repositories/{repositoryId}/indexing/events": { get: { operationId: "streamRepositoryIndexingEvents", tags: ["Indexing"], security: bearer,
      parameters: [pathParameter("repositoryId", { type: "string", pattern: "^[^/]+/[^/]+$" })], responses: {
        "200": { description: "Server-sent indexing progress events", content: { "text/event-stream": { schema: { type: "string" } } } },
        "400": standardError, "401": standardError, "403": standardError, "404": standardError, "500": standardError,
      } } },
    "/api/v1/repositories": { get: { operationId: "listRepositoryMetadata", tags: ["Repositories"], security: bearer, responses: successResponses("RepositoryMetadataListEnvelope") } },
    "/api/v1/repositories/{owner}/{repo}": { get: { operationId: "getRepositoryMetadata", tags: ["Repositories"], security: bearer,
      parameters: ownerRepoParameters, responses: successResponses("RepositoryMetadataEnvelope") } },
  };
  for (const [suffix, operationId, requestSchema, responseSchema] of [
    ["file-tree", "getRepositoryFileTree", "FileTreeRequest", "FileTreeEnvelope"],
    ["list-dir", "listRepositoryDirectory", "DirectoryListRequest", "DirectoryListEnvelope"],
    ["read-file", "readRepositoryFile", "FileReadRequest", "FileReadEnvelope"],
    ["find-symbol", "lookupRepositorySymbol", "SymbolLookupRequest", "SymbolLookupEnvelope"],
    ["grep", "grepRepository", "GrepRequest", "GrepEnvelope"],
  ] as const) {
    paths[`/tools/${suffix}`] = { post: { operationId, tags: ["Repository Tools"], security: bearer,
      requestBody: body(requestSchema), responses: successResponses(responseSchema),
      description: "Ownership-scoped read-only operation against the published repository checkout." } };
  }
  addGatewayPaths(paths);
  addSessionPaths(paths);
  addWorkflowPaths(paths);
  for (const [suffix, operationId, schema, collection] of [
    ["knowledge", "listRepositoryKnowledge", "KnowledgeListEnvelope", true],
    ["knowledge/{knowledgeId}", "getRepositoryKnowledge", "KnowledgeEnvelope", false],
    ["memory", "listRepositoryMemory", "MemoryListEnvelope", true],
  ] as const) {
    paths[`/api/v1/repositories/{owner}/{repo}/${suffix}`] = { get: {
      operationId, tags: ["Repository Knowledge"], security: bearer,
      parameters: [...ownerRepoParameters,
        ...(suffix.includes("{knowledgeId}") ? [pathParameter("knowledgeId")] : []),
        ...(collection ? paginationParameters : [])],
      responses: successResponses(schema),
    } };
  }
  return paths;
}

const schemas: Record<string, Record<string, unknown>> = {
  StandardSuccessEnvelope: { type: "object", required: ["success", "data", "requestId"], additionalProperties: false,
    properties: { success: { const: true }, data: {}, requestId: { type: "string" } } },
  StandardErrorEnvelope: { type: "object", required: ["success", "error", "requestId"], additionalProperties: false,
    properties: { success: { const: false }, error: { type: "object", required: ["code", "message"], properties: {
      code: { type: "string" }, message: { type: "string" }, details: {},
    } }, requestId: { type: "string" } } },
  NormalizedDiagnostic: diagnostic,
  RepositoryGatewaySuccessEnvelope: gatewayEnvelope("RepositoryOverviewResponse", "ok"),
  RepositoryGatewayPartialEnvelope: gatewayEnvelope("RepositoryOverviewResponse", "partial"),
  RepositoryGatewayErrorEnvelope: { type: "object", required: ["requestId", "repositoryId", "revision", "service", "status", "payload", "diagnostics", "timestamps"], additionalProperties: false,
    properties: { ...gatewayBaseProperties, status: { const: "error" }, payload: { type: "null" } } },
  RepositoryRevision: revision,
  RevisionMetadata: { type: "object", required: ["currentRevision", "indexedRevision", "publishedRevision", "revisionConsistent"], properties: {
    currentRevision: { anyOf: [revision, { type: "null" }] }, indexedRevision: { anyOf: [revision, { type: "null" }] },
    publishedRevision: { anyOf: [revision, { type: "null" }] }, revisionConsistent: { type: "boolean" },
  } },
  RepositoryLifecycleStatus: { type: "string", enum: ["queued", "indexing", "indexed", "stale", "failed"] },
  RepositoryMetadata: { type: "object", required: ["repositoryId", "owner", "repo", "repository", "displayName", "status", "currentRevision", "indexedRevision", "publishedRevision", "revisionConsistent", "gatewayCompatible", "isStale", "lastIndexedAt", "lastAccessedAt", "createdAt", "updatedAt"], additionalProperties: false,
    properties: { repositoryId: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, repository: { type: "string" }, displayName: { type: "string" }, status: { $ref: "#/components/schemas/RepositoryLifecycleStatus" }, currentRevision: { anyOf: [revision, { type: "null" }] }, indexedRevision: { anyOf: [revision, { type: "null" }] }, publishedRevision: { anyOf: [revision, { type: "null" }] }, revisionConsistent: { type: "boolean" }, gatewayCompatible: { type: "boolean" }, isStale: { type: "boolean" }, lastIndexedAt: { type: ["string", "null"], format: "date-time" }, lastAccessedAt: { type: ["string", "null"], format: "date-time" }, createdAt: dateTime, updatedAt: dateTime } },
  SessionResource: { type: "object", required: Object.keys(sessionProperties), additionalProperties: false,
    properties: sessionProperties },
  SessionSummary: { type: "object", required: [...Object.keys(sessionProperties), "eventCount", "lastEventKind", "activeFeature", "activeModule"], additionalProperties: false,
    properties: { ...sessionProperties, eventCount: { type: "integer", minimum: 0 }, lastEventKind: nullableString, activeFeature: nullableString, activeModule: nullableString } },
  SessionEvent: { type: "object", required: ["eventId", "sequence", "kind", "referenceId", "summary", "attributes", "createdAt"], additionalProperties: false,
    properties: { eventId: { type: "string" }, sequence: { type: "integer", minimum: 1 }, kind: { type: "string", enum: ["query", "answer", "feature", "symbol", "file", "insight", "plan", "specification", "execution_summary"] }, referenceId: { type: "string" }, summary: { type: "string" }, attributes: { type: "object", additionalProperties: true }, createdAt: dateTime } },
  SessionContext: { type: "object", required: ["contextVersion", "activeFeature", "activeModule", "activeWorkflow", "activeArchitecture", "activeChangeAnalysis", "previousQuestions", "previousAnswers", "recentFiles", "recentSymbols", "recentFeatures", "viewedInsights", "viewedPlans", "viewedSpecifications", "viewedExecutionSummaries", "updatedAt"], additionalProperties: false,
    properties: { contextVersion: { type: "integer" }, activeFeature: nullableString, activeModule: nullableString, activeWorkflow: nullableString, activeArchitecture: nullableString, activeChangeAnalysis: nullableString, previousQuestions: { type: "array", items: { type: "string" } }, previousAnswers: { type: "array", items: { type: "string" } }, recentFiles: { type: "array", items: { type: "string" } }, recentSymbols: { type: "array", items: { type: "string" } }, recentFeatures: { type: "array", items: { type: "string" } }, viewedInsights: { type: "array", items: { type: "string" } }, viewedPlans: { type: "array", items: { type: "string" } }, viewedSpecifications: { type: "array", items: { type: "string" } }, viewedExecutionSummaries: { type: "array", items: { type: "string" } }, updatedAt: dateTime } },
  SessionDetail: { type: "object", required: ["session", "events", "context", "diagnostics"], additionalProperties: false,
    properties: { session: { $ref: "#/components/schemas/SessionResource" }, events: { type: "array", items: { $ref: "#/components/schemas/SessionEvent" } }, context: { $ref: "#/components/schemas/SessionContext" }, diagnostics: { type: "array", items: { $ref: "#/components/schemas/NormalizedDiagnostic" } } } },
  WorkflowAttachment: { type: "object", required: ["sessionId", "workflowId", "attachedWorkflowId", "workflowState", "workflowStage", "attachedAt"], properties: { sessionId: { type: "string" }, workflowId: nullableString, attachedWorkflowId: nullableString, workflowState: nullableString, workflowStage: nullableString, attachedAt: { type: ["string", "null"], format: "date-time" } } },
  Workflow: { type: "object", required: ["workflowId", "repositoryId", "executionId", "version", "lifecycle", "currentStage", "attachedSessionId", "approvalState", "createdAt", "updatedAt", "links"], additionalProperties: false,
    properties: { workflowId: { type: "string" }, repositoryId: { type: "string" }, executionId: { type: "string" }, version: { type: "integer", minimum: 1 }, lifecycle: { type: "string", enum: ["created", "analysing", "planning", "awaiting_approval", "executing", "reviewing", "assembling", "preparing_apply", "completed", "cancelled", "failed"] }, currentStage: { type: ["string", "null"], enum: [...WORKFLOW_STAGES, null] }, attachedSessionId: nullableString, approvalState: { type: "string", enum: ["required", "approved", "not_required"] }, createdAt: dateTime, updatedAt: dateTime, links: { type: "object", additionalProperties: { type: "string" } } } },
  WorkflowSummary: { $ref: "#/components/schemas/Workflow" },
  WorkflowDetail: { $ref: "#/components/schemas/Workflow" },
  WorkflowCreateRequest: { type: "object", required: ["repositoryId", "repositoryRevision", "task"], additionalProperties: false, properties: { repositoryId: { type: "string", minLength: 1, maxLength: 512 }, repositoryRevision: { type: "string", minLength: 1, maxLength: 256 }, task: { type: "string", minLength: 1, maxLength: 20000 }, executionConfiguration: { type: "object", additionalProperties: false, properties: { policy: { type: "string", enum: ["review_only", "agent_assisted"] }, maxParallelism: { type: "integer", minimum: 1, maximum: 16 } } }, idempotencyKey: { type: "string", minLength: 1, maxLength: 256 } } },
  RepositoryQueryRequest: gatewayRequest({ query: { type: "string", minLength: 1, maxLength: 20000 }, workflowId: { type: "string", maxLength: 256 }, sessionId: { type: "string", maxLength: 256 } }, ["query"]),
  RepositoryQueryResponse: publicPayload("Published repository query result."),
  InsightRequest: gatewayRequest({ filters: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 500 }, featureId: { type: "string", maxLength: 256 }, module: { type: "string", maxLength: 1024 }, file: { type: "string", maxLength: 4096 }, category: { type: "string", enum: ["architectural hotspots", "duplicated logic", "dependency issues", "documentation issues"] } } } }, []),
  InsightResponse: publicPayload("Published repository insight result."),
  FeatureNavigationRequest: gatewayRequest({ operation: { type: "string", enum: ["feature", "entry-points", "exit-points", "files", "symbols", "dependencies", "upstream", "downstream"] }, name: { type: "string", minLength: 1, maxLength: 1024 } }, ["operation", "name"]),
  FeatureNavigationResponse: publicPayload("Published feature navigation result."),
  SemanticNavigationRequest: gatewayRequest({ operation: { type: "string", enum: ["definition", "references", "implementations", "callers", "callees", "inheritance", "dependencies"] }, query: { type: "string", minLength: 1, maxLength: 1024 } }, ["operation", "query"]),
  SemanticNavigationResponse: publicPayload("Published semantic navigation result."),
  ChangeImpactRequest: gatewayRequest({ workflowId: { type: "string", minLength: 1, maxLength: 256 }, target: { type: "object", required: ["kind", "value"], additionalProperties: false, properties: { kind: { type: "string", enum: ["feature", "module", "file", "symbol", "api_endpoint", "route", "service", "repository_component"] }, value: { type: "string", minLength: 1, maxLength: 4096 } } }, changeType: { type: "string", enum: ["add", "modify", "remove", "refactor", "fix", "migrate"] }, rationale: { type: "string", minLength: 1, maxLength: 20000 } }, ["workflowId", "target", "changeType", "rationale"]),
  ChangeImpactResponse: publicPayload("Published change-impact result."),
  TaskPlanRequest: gatewayRequest({ objective: { type: "string", minLength: 1, maxLength: 20000 }, workflowId: { type: "string", maxLength: 256 } }, ["objective"]),
  TaskPlanResponse: publicPayload("Published task plan."),
  SpecificationRequest: gatewayRequest({ objective: { type: "string", minLength: 1, maxLength: 20000 }, taskId: { type: "string", maxLength: 256 }, workflowId: { type: "string", maxLength: 256 } }, ["objective"]),
  SpecificationResponse: publicPayload("Published engineering specification."),
  ExecutionRequest: gatewayRequest({ objective: { type: "string", minLength: 1, maxLength: 20000 }, workflowId: { type: "string", minLength: 1, maxLength: 256 } }, ["objective", "workflowId"]),
  ExecutionResponse: publicPayload("Published execution coordination result."),
  EvolutionRequest: gatewayRequest({ baseRevision: revision }, ["baseRevision"]),
  EvolutionResponse: publicPayload("Published repository evolution result."),
  RepositoryOverviewResponse: publicPayload("Published repository overview."),
  FileTreeRequest: { type: "object", required: ["repositoryId"], additionalProperties: true, properties: { repositoryId: { type: "string", pattern: "^[^/]+/[^/]+$" } } },
  FileTreeNode: { type: "object", required: ["name", "type"], properties: { name: { type: "string" }, type: { type: "string", enum: ["file", "directory"] }, children: { type: "array", items: { $ref: "#/components/schemas/FileTreeNode" } } } },
  FileTreeResponse: { $ref: "#/components/schemas/FileTreeNode" },
  DirectoryListRequest: { type: "object", required: ["repositoryId"], additionalProperties: true, properties: { repositoryId: { type: "string" }, relativePath: { type: "string" } } },
  DirectoryListResponse: { type: "array", items: publicPayload("Directory entry.") },
  FileReadRequest: { type: "object", required: ["repositoryId", "relativePath"], additionalProperties: true, properties: { repositoryId: { type: "string" }, relativePath: { type: "string", minLength: 1 } } },
  FileReadResponse: { type: "object", required: ["filePath", "content", "lineCount", "language", "sizeBytes"], properties: { filePath: { type: "string" }, content: { type: "string", maxLength: 524288 }, lineCount: { type: "integer" }, language: { type: "string" }, sizeBytes: { type: "integer", maximum: 524288 } } },
  SymbolLookupRequest: { type: "object", required: ["repositoryId", "symbol"], additionalProperties: true, properties: { repositoryId: { type: "string" }, symbol: { type: "string", minLength: 1 } } },
  SymbolLookupResponse: { type: "array", items: { type: "object", required: ["symbol", "filePath", "lineNumber", "matchedLine"], properties: { symbol: { type: "string" }, filePath: { type: "string" }, lineNumber: { type: "integer" }, matchedLine: { type: "string" } } } },
  GrepRequest: { type: "object", required: ["repositoryId", "query"], additionalProperties: true, properties: { repositoryId: { type: "string" }, query: { type: "string", minLength: 1 } } },
  GrepResponse: { type: "object", required: ["query", "totalMatches", "truncated", "matches"], properties: { query: { type: "string" }, totalMatches: { type: "integer" }, truncated: { type: "boolean" }, matches: { type: "array", items: { type: "object", required: ["filePath", "lineNumber", "matchedLine"], properties: { filePath: { type: "string" }, lineNumber: { type: "integer" }, matchedLine: { type: "string" } } } } } },
  SessionCreateRequest: { type: "object", required: ["owner", "repo", "revision"], additionalProperties: false, properties: { owner: { type: "string", minLength: 1, maxLength: 39, pattern: "^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$" }, repo: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9._-]+$" }, revision: { type: "string", pattern: "^[0-9a-fA-F]{40}$", description: "Accepted case-insensitively and normalized to lowercase." }, workflowId: { type: "string", minLength: 1, maxLength: 256, pattern: "^[a-zA-Z0-9._:-]+$" } } },
  SessionQueryRequest: { type: "object", required: ["query"], additionalProperties: false, properties: { query: { type: "string", minLength: 1, maxLength: 4000 } } },
  SessionObjectiveRequest: { type: "object", required: ["objective"], additionalProperties: false, properties: { objective: { type: "string", minLength: 1, maxLength: 20000 } } },
  SessionInsightsRequest: { type: "object", additionalProperties: false }, EmptyRequest: { type: "object", additionalProperties: false },
  WorkflowAttachmentRequest: { type: "object", required: ["workflowId"], additionalProperties: false, properties: { workflowId: { type: "string", minLength: 1, maxLength: 256, pattern: "^[a-zA-Z0-9._:-]+$" } } },
  RepositoryConnectRequest: { type: "object", required: ["repoUrl"], additionalProperties: true, properties: { repoUrl: { type: "string" }, cloneOptions: { type: "object", additionalProperties: true, properties: { branch: { type: "string", minLength: 1, maxLength: 255 } } } } },
  IndexingJob: publicPayload("Public indexing lifecycle, progress, stage, attempts, and safe failure."),
  HealthEnvelope: publicPayload("Health or readiness contract."), OpenApiEnvelope: publicPayload("Standard envelope containing this OpenAPI document."),
  RepositoryConnectionResponse: publicPayload("Repository connection and queued indexing job identity."), IndexedRepositoryList: publicPayload("Owned indexed repositories and count."),
  RepositorySummary: publicPayload("Published repository summary."), IndexingEvent: publicPayload("Server-sent indexing lifecycle event."),
  WorkflowHistory: publicPayload("Workflow history page."), WorkflowArtifact: publicPayload("Sanitized workflow artifact."),
  WorkflowReview: publicPayload("Sanitized workflow review."), WorkflowProposal: publicPayload("Sanitized workflow proposal."), WorkflowApplyPlan: publicPayload("Sanitized workflow apply plan."),
  Knowledge: publicPayload("Sanitized repository knowledge."), Memory: publicPayload("Sanitized repository memory."),
};

const standardEnvelope = (dataSchema: string) => ({
  type: "object", required: ["success", "data", "requestId"], additionalProperties: false,
  properties: { success: { const: true }, data: { $ref: `#/components/schemas/${dataSchema}` }, requestId: { type: "string" } },
});
const sessionEnvelope = (dataSchema: string) => ({
  type: "object", required: ["success", "requestId", "status", "code", "message", "retryable", "diagnostics", "data"], additionalProperties: false,
  properties: { success: { const: true }, requestId: { type: "string" }, status: { type: "integer", enum: [200, 201] }, code: { type: "string" }, message: { type: "string" }, retryable: { const: false }, diagnostics: { type: "array", items: { $ref: "#/components/schemas/NormalizedDiagnostic" } }, data: { $ref: `#/components/schemas/${dataSchema}` } },
});
Object.assign(schemas, {
  RepositoryMetadataEnvelope: standardEnvelope("RepositoryMetadataResult"), RepositoryMetadataListEnvelope: standardEnvelope("RepositoryMetadataList"),
  RepositoryConnectionEnvelope: standardEnvelope("RepositoryConnectionResponse"), IndexedRepositoryListEnvelope: standardEnvelope("IndexedRepositoryList"),
  IndexingJobEnvelope: standardEnvelope("IndexingJob"), RepositorySummaryEnvelope: standardEnvelope("RepositorySummary"),
  FileTreeEnvelope: standardEnvelope("FileTreeResponse"), DirectoryListEnvelope: standardEnvelope("DirectoryListResponse"), FileReadEnvelope: standardEnvelope("FileReadResponse"), SymbolLookupEnvelope: standardEnvelope("SymbolLookupResponse"), GrepEnvelope: standardEnvelope("GrepResponse"),
  WorkflowEnvelope: standardEnvelope("Workflow"), WorkflowListEnvelope: standardEnvelope("WorkflowPage"), WorkflowHistoryEnvelope: standardEnvelope("WorkflowHistory"), WorkflowArtifactsEnvelope: standardEnvelope("WorkflowArtifactPage"), WorkflowArtifactEnvelope: standardEnvelope("WorkflowArtifact"), WorkflowReviewEnvelope: standardEnvelope("WorkflowReview"), WorkflowProposalEnvelope: standardEnvelope("WorkflowProposal"), WorkflowApplyPlanEnvelope: standardEnvelope("WorkflowApplyPlan"),
  KnowledgeListEnvelope: standardEnvelope("KnowledgePage"), KnowledgeEnvelope: standardEnvelope("Knowledge"), MemoryListEnvelope: standardEnvelope("MemoryPage"),
  SessionDetailEnvelope: sessionEnvelope("SessionDetail"), SessionListEnvelope: sessionEnvelope("SessionSummaryList"), SessionOperationEnvelope: sessionEnvelope("SessionOperationResult"), WorkflowAttachmentEnvelope: sessionEnvelope("WorkflowAttachment"),
  RepositoryMetadataResult: { type: "object", required: ["repository"], properties: { repository: { $ref: "#/components/schemas/RepositoryMetadata" } } },
  RepositoryMetadataList: { type: "object", required: ["repositories", "count"], properties: { repositories: { type: "array", items: { $ref: "#/components/schemas/RepositoryMetadata" } }, count: { type: "integer" } } },
  WorkflowPage: publicPayload("Cursor page of workflow summaries."), WorkflowArtifactPage: publicPayload("Cursor page of artifacts."), KnowledgePage: publicPayload("Cursor page of knowledge."), MemoryPage: publicPayload("Cursor page of memory."),
  SessionSummaryList: { type: "object", required: ["sessions", "count"], additionalProperties: false, properties: { sessions: { type: "array", items: { $ref: "#/components/schemas/SessionSummary" } }, count: { type: "integer", minimum: 0 } } }, SessionOperationResult: publicPayload("Sanitized session operation result."),
  RepositorySessionErrorEnvelope: { type: "object", required: ["success", "requestId", "status", "code", "message", "retryable", "diagnostics", "data"], additionalProperties: false, properties: { success: { const: false }, requestId: { type: "string" }, status: { type: "integer", enum: [400, 401, 403, 404, 409, 422, 424, 429, 500, 503] }, code: { type: "string" }, message: { type: "string" }, retryable: { type: "boolean" }, diagnostics: { type: "array", items: { $ref: "#/components/schemas/NormalizedDiagnostic" } }, data: { type: "null" } } },
});
for (const [, , , payloadSchema] of gatewayOperations) {
  schemas[`${payloadSchema}GatewaySuccess`] = gatewayEnvelope(payloadSchema, "ok");
  schemas[`${payloadSchema}GatewayPartial`] = gatewayEnvelope(payloadSchema, "partial");
}

export const engineeringPlatformOpenApi = Object.freeze({
  openapi: OPENAPI_VERSION,
  info: {
    title: "Giro Public Backend API", version: "1.0.0",
    description: "Canonical frontend-facing contract for Giro's existing public backend surfaces.",
    "x-api-version": PUBLIC_API_VERSION,
    "x-contract-revision": PUBLIC_CONTRACT_REVISION,
    "x-compatibility-policy": "Additive fields and operations are backward compatible. Removing or changing required fields, status semantics, validation limits, or enum values requires a new API version.",
  },
  servers: [{ url: "/" }], security: bearer,
  paths: buildPaths(),
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    responses: {
      StandardError: { description: "Production-safe standard error envelope.", content: json("StandardErrorEnvelope") },
      GatewayError: { description: "Repository Gateway error envelope.", content: json("RepositoryGatewayErrorEnvelope") },
      SessionError: { description: "Repository Session API error envelope.", content: json("RepositorySessionErrorEnvelope") },
    },
    schemas,
  },
});

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refs(child));
}

export function verifyEngineeringPlatformApiContracts(
  registeredRoutes?: ReadonlyArray<{ method: string; path: string }>,
) {
  const operations = Object.entries(engineeringPlatformOpenApi.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({ path, method, operation })));
  const operationIds = operations.map(({ operation }) => String(operation.operationId));
  if (new Set(operationIds).size !== operationIds.length) throw new Error("public_api_duplicate_operation_id");
  const documented = new Set(operations.map(({ path, method }) => `${method.toUpperCase()}:${path.replaceAll(/\{([^}]+)\}/g, ":$1")}`));
  for (const [method, path] of PUBLIC_API_ROUTE_INVENTORY) {
    if (!documented.has(`${method}:${path}`)) throw new Error(`public_api_route_contract_missing:${method}:${path}`);
  }
  if (registeredRoutes) {
    const registered = new Set(registeredRoutes.map(({ method, path }) =>
      `${method.toUpperCase()}:${path}`));
    for (const [method, path] of PUBLIC_API_ROUTE_INVENTORY) {
      if (!registered.has(`${method}:${path}`)) {
        throw new Error(`public_api_documented_route_unregistered:${method}:${path}`);
      }
    }
  }
  for (const { path, method, operation } of operations) {
    if (!operation.operationId || !operation.responses) throw new Error(`public_api_operation_schema_missing:${method}:${path}`);
    if (operation.security === undefined) throw new Error(`public_api_security_missing:${method}:${path}`);
    const statuses = Object.keys(operation.responses as object);
    if (!statuses.some((status) => status === "200" || status === "201" || status === "204")) throw new Error(`public_api_success_status_missing:${method}:${path}`);
    if (method === "post" && path.includes("/workflows/") && !path.endsWith("/workflows")) {
      const parameters = operation.parameters as Array<{ name?: string }>;
      if (!parameters?.some((item) => item.name === "If-Match") || !parameters.some((item) => item.name === "Idempotency-Key")) throw new Error(`public_api_workflow_headers_missing:${path}`);
    }
  }
  for (const ref of refs(engineeringPlatformOpenApi)) {
    const match = /^#\/components\/(schemas|responses|securitySchemes)\/([^/]+)$/.exec(ref);
    if (!match || !(match[2]! in engineeringPlatformOpenApi.components[match[1] as "schemas" | "responses" | "securitySchemes"])) throw new Error(`public_api_schema_reference_unresolved:${ref}`);
  }
  for (const blocked of ["tenantId", "ownerId", "leaseToken", "persistenceVersion", "ownershipFingerprint", "schemaVersion"]) {
    if (blocked in schemas) throw new Error(`public_api_internal_schema_exposed:${blocked}`);
  }
  const registeredStages = WORKFLOW_ENGINE_REGISTRY.map(({ stage }) => stage);
  if (JSON.stringify(registeredStages) !== JSON.stringify(WORKFLOW_STAGES)) throw new Error("engineering_api_workflow_service_unregistered");
}
