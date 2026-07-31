import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.js";
import {
  engineeringPlatformOpenApi,
  OPENAPI_VERSION,
  PUBLIC_API_ROUTE_INVENTORY,
  PUBLIC_API_VERSION,
  PUBLIC_CONTRACT_REVISION,
  verifyEngineeringPlatformApiContracts,
} from "../services/engineeringPlatformApi/openapi.js";
import {
  publicRepositorySessionRecord,
  sanitizeRepositorySessionApiValue,
} from "../services/repositorySessionApi/contracts.js";

const document = engineeringPlatformOpenApi as any;

function allOperations() {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item as object).map(([method, operation]) => ({
      path, method, operation: operation as any,
    })));
}

function collectRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : collectRefs(child));
}

test("canonical OpenAPI generation is deterministic and versioned", () => {
  const first = JSON.stringify(engineeringPlatformOpenApi);
  const second = JSON.stringify(engineeringPlatformOpenApi);
  assert.equal(first, second);
  assert.equal(document.openapi, OPENAPI_VERSION);
  assert.equal(document.info["x-api-version"], PUBLIC_API_VERSION);
  assert.equal(document.info["x-contract-revision"], PUBLIC_CONTRACT_REVISION);
  assert.match(document.info["x-compatibility-policy"], /Additive/);
});

test("every canonical public route is documented and registered", () => {
  const app = createApp();
  assert.doesNotThrow(() => verifyEngineeringPlatformApiContracts(app.routes));
  const registered = new Set(app.routes.map((route) =>
    `${route.method}:${route.path}`));
  for (const [method, path] of PUBLIC_API_ROUTE_INVENTORY) {
    assert.ok(registered.has(`${method}:${path}`), `${method} ${path}`);
  }
});

test("operation IDs are unique, schemas resolve, and security is explicit", () => {
  const operations = allOperations();
  const ids = operations.map(({ operation }) => operation.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const { path, method, operation } of operations) {
    assert.ok(operation.operationId, `${method} ${path} operationId`);
    assert.ok(operation.responses, `${method} ${path} responses`);
    assert.notEqual(operation.security, undefined, `${method} ${path} security`);
  }
  for (const ref of collectRefs(document)) {
    const [, section, name] = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref) ?? [];
    assert.ok(section && name && document.components[section]?.[name], ref);
  }
});

test("gateway operations publish concrete 200/207 payload contracts and gateway errors", () => {
  const gateway = Object.entries(document.paths).filter(([path]) =>
    path.startsWith("/api/v1/repository-gateway/"));
  assert.equal(gateway.length, 10);
  for (const [path, item] of gateway) {
    const operation = Object.values(item as object)[0] as any;
    for (const status of ["200", "207"]) {
      const ref = operation.responses[status].content["application/json"].schema.$ref;
      assert.match(ref, /Gateway(Success|Partial)$/);
      const schema = document.components.schemas[ref.split("/").at(-1)];
      const payloadRef = schema.properties.payload.$ref;
      assert.ok(payloadRef && !payloadRef.endsWith("/Unknown"), `${path} ${status}`);
    }
    for (const status of ["400", "401", "403", "409", "424", "429", "503"]) {
      assert.equal(operation.responses[status].$ref,
        "#/components/responses/GatewayError", `${path} ${status}`);
    }
  }
});

test("session and workflow contracts publish attachment, headers, and runtime limits", () => {
  const attachment = document.paths["/api/v1/sessions/{sessionId}/workflow"].post;
  assert.equal(attachment.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/WorkflowAttachmentRequest");
  assert.ok(document.components.schemas.SessionEvent);
  assert.ok(document.components.schemas.SessionContext);
  assert.ok(document.components.schemas.WorkflowAttachment);

  const create = document.paths["/api/v1/workflows"].post;
  assert.ok(create.parameters.some((item: any) =>
    item.name === "Idempotency-Key" && item.required));
  assert.equal(document.components.schemas.WorkflowCreateRequest
    .properties.task.maxLength, 20_000);
  for (const action of ["approve", "retry", "resume", "cancel", "replay"]) {
    const operation = document.paths[
      `/api/v1/workflows/{workflowId}/${action}`].post;
    assert.ok(operation.parameters.some((item: any) =>
      item.name === "If-Match" && item.required));
    assert.ok(operation.parameters.some((item: any) =>
      item.name === "Idempotency-Key" && item.required));
  }
  assert.equal(document.components.schemas.SessionQueryRequest
    .properties.query.maxLength, 4_000);
  assert.equal(document.components.schemas.SessionObjectiveRequest
    .properties.objective.maxLength, 20_000);
});

test("repository metadata exposes the published revision and exact lifecycle enum", () => {
  const metadata = document.components.schemas.RepositoryMetadata;
  assert.ok(metadata.required.includes("publishedRevision"));
  assert.deepEqual(document.components.schemas.RepositoryLifecycleStatus.enum,
    ["queued", "indexing", "indexed", "stale", "failed"]);
  assert.equal(metadata.properties.publishedRevision.anyOf[0].pattern,
    "^[0-9a-f]{40}$");
});

test("public session DTO sanitization recursively removes service-only fields", () => {
  const sanitized = sanitizeRepositorySessionApiValue({
    visible: "yes",
    tenantId: "hidden",
    nested: { ownerId: "hidden", leaseToken: "hidden", visible: true },
  }) as any;
  assert.deepEqual(sanitized, { visible: "yes", nested: { visible: true } });

  const record = publicRepositorySessionRecord({
    session: {
      sessionId: "session-1", schemaVersion: "internal",
      persistenceVersion: 7, tenantId: "hidden", repositoryId: "acme/widgets",
      repositoryRevision: "a".repeat(40), ownerId: "hidden", userId: "hidden",
      workflowId: null, lifecycle: "active",
      createdAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-02T00:00:00.000Z", archivedAt: null,
    },
    events: [],
    context: {
      sessionId: "session-1", contextVersion: 1, activeFeature: null,
      activeModule: null, activeWorkflow: null, activeArchitecture: null,
      activeChangeAnalysis: null, previousQuestions: [], previousAnswers: [],
      recentFiles: [], recentSymbols: [], recentFeatures: [], viewedInsights: [],
      viewedPlans: [], viewedSpecifications: [], viewedExecutionSummaries: [],
      updatedAt: "2099-01-01T00:00:00.000Z",
    },
    diagnostics: [], reuseCount: 0, recoveryCount: 0,
  });
  assert.equal("tenantId" in record.session, false);
  assert.equal("ownerId" in record.session, false);
  assert.equal("persistenceVersion" in record.session, false);
  assert.equal("schemaVersion" in record.session, false);
});
