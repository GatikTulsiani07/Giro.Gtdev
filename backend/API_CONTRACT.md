# Giro public backend API contract

The canonical machine-readable contract is `GET /api/v1/openapi.json`, generated
from `src/services/engineeringPlatformApi/openapi.ts`. This document explains the
integration rules and inventory; it does not duplicate every schema property.

Contract identity:

- API route version: `v1`
- OpenAPI dialect: `3.1.0`
- contract revision: `backend-compatibility-sprint-04`
- compatibility: additive optional fields, schemas, and operations are compatible;
  removing fields, adding required input, changing validation/status semantics, or
  narrowing an enum is breaking and requires a new API version

## Authentication and shared behavior

Health and readiness routes are unauthenticated. Every repository, indexing,
tool, Gateway, Session, Workflow, knowledge, and OpenAPI route requires
`Authorization: Bearer <JWT>`. JSON requests require `Content-Type:
application/json`. Clients may send `X-Request-ID`; every JSON envelope exposes
the effective `requestId` and the response header repeats it.

The standard envelope is `{ success: true, data, requestId }` or `{ success:
false, error: { code, message, details? }, requestId }`. Session endpoints retain
their established richer envelope with `status`, `code`, `message`, `retryable`,
`diagnostics`, and `data`. Gateway endpoints retain their service envelope.

Rate limits are returned as 429 with `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `Retry-After`. Gateway and Session routes use their
own error envelopes for 429; other routes use the standard error envelope.

## Canonical public inventory

The tables below are the frontend-relevant public surface. Exact field
requirements, limits, formats, DTOs, and all error responses are authoritative in
OpenAPI. There is no offset pagination unless explicitly stated.

| Method and path | Input and success | Fencing, idempotency, pagination |
| --- | --- | --- |
| `GET /ready` | no input; 200/503 health envelope | unauthenticated; safe/idempotent |
| `GET /health` | no input; 200/503 production health | unauthenticated; safe/idempotent |
| `GET /health/live` | no input; 200 standard envelope | unauthenticated; safe/idempotent |
| `GET /health/ready` | no input; 200/503 standard envelope | unauthenticated; safe/idempotent |
| `GET /api/v1/openapi.json` | no input; 200 standard envelope containing this contract | authenticated; safe/idempotent |
| `POST /repos/connect` | `RepositoryConnectRequest`; 200 `RepositoryConnectionEnvelope` | optional `Idempotency-Key` (1–200 visible ASCII); otherwise request-ID scoped; conflicting reuse is 409 |
| `GET /repos/indexed` | 200 owned indexed repository list | safe/idempotent; no pagination |
| `GET /api/v1/repositories` | 200 `RepositoryMetadataListEnvelope` | safe/idempotent; no pagination |
| `GET /api/v1/repositories/{owner}/{repo}` | owner/repo path parameters; 200 `RepositoryMetadataEnvelope` | safe/idempotent; `publishedRevision` is the Gateway revision fence |
| `GET /indexing/jobs/{jobId}` | job ID path parameter; 200 `IndexingJobEnvelope` | safe/idempotent |
| `GET /repositories/{repositoryId}/summary` | URL-encoded `owner/repo`; 200 summary | safe/idempotent |
| `GET /repositories/{repositoryId}/indexing/events` | URL-encoded `owner/repo`; 200 `text/event-stream` | long-lived SSE; no pagination; event IDs are not currently resumable |
| `POST /tools/file-tree` | `FileTreeRequest`; 200 `FileTreeEnvelope` | read-only, published-checkout scoped |
| `POST /tools/list-dir` | `DirectoryListRequest`; 200 directory list | read-only, published-checkout scoped |
| `POST /tools/read-file` | `FileReadRequest`; 200 `FileReadEnvelope` | read-only; 512 KiB runtime limit |
| `POST /tools/find-symbol` | `SymbolLookupRequest`; 200 symbol matches | read-only; no pagination |
| `POST /tools/grep` | `GrepRequest`; 200 `GrepEnvelope` | read-only; truncation is reported in the payload |

All protected routes may return 401, 403, and 429. Validation failures are 400;
missing resources are 404. Standard routes additionally document their existing
409/422/500/503 behavior where applicable.

## Repository API Gateway

Gateway paths are `/api/v1/repository-gateway/{owner}/{repo}/{operation}`.
`overview` is GET with required query parameter `revision`; all others are POST
and include `revision` in their strict JSON body.

| Operation | Service | Request / payload DTO |
| --- | --- | --- |
| `GET overview` | `repository-overview` | query `revision` / `RepositoryOverviewResponse` |
| `POST query` | `repository-query` | `RepositoryQueryRequest` / `RepositoryQueryResponse` |
| `POST insights` | `repository-insights` | `InsightRequest` / `InsightResponse` |
| `POST features` | `feature-navigation` | `FeatureNavigationRequest` / `FeatureNavigationResponse` |
| `POST semantics` | `semantic-navigation` | `SemanticNavigationRequest` / `SemanticNavigationResponse` |
| `POST change-impact` | `change-impact` | `ChangeImpactRequest` / `ChangeImpactResponse` |
| `POST task-plan` | `task-planning` | `TaskPlanRequest` / `TaskPlanResponse` |
| `POST specification` | `engineering-specification` | `SpecificationRequest` / `SpecificationResponse` |
| `POST execution` | `execution-coordination` | `ExecutionRequest` / `ExecutionResponse` |
| `POST evolution` | `repository-evolution` | `EvolutionRequest` / `EvolutionResponse` |

Every response carries `requestId`, `repositoryId`, the exact 40-character
lowercase `revision`, `service`, `status`, `payload`, normalized `diagnostics`,
and received/completed timestamps. A 200 response is complete. A 207 response
contains a usable payload and diagnostics together. Error responses set
`status: "error"` and `payload: null`: 400 validation, 401 authentication, 403
authorization, 409 published-revision conflict, 424 unavailable intelligence,
429 rate limit, and 503 dependency failure. Public cache fields are not currently
exposed. Operations are deterministic read-style calls and need no idempotency
header; the Gateway may transparently reuse a cached result.

## Repository sessions

| Method and path | Request / success | Lifecycle and fencing |
| --- | --- | --- |
| `POST /api/v1/sessions` | `SessionCreateRequest`; 201 created or 200 reused | exact 40-character repository revision; optional workflow attachment |
| `GET /api/v1/sessions` | session summaries and count | no pagination |
| `GET /api/v1/sessions/{sessionId}` | session detail, events, context, diagnostics | ownership scoped |
| `DELETE /api/v1/sessions/{sessionId}` | 204 empty response | compatibility delete archives; it does not erase |
| `POST /api/v1/sessions/{sessionId}/archive` | no body; 200 detail | idempotent archive transition |
| `POST /api/v1/sessions/{sessionId}/query` | `SessionQueryRequest`; 200 operation result | active-session revision fence |
| `POST /api/v1/sessions/{sessionId}/plan` | `SessionObjectiveRequest`; 200 operation result | active-session revision fence |
| `POST /api/v1/sessions/{sessionId}/specification` | `SessionObjectiveRequest`; 200 operation result | active-session revision fence |
| `POST /api/v1/sessions/{sessionId}/insights` | empty object; 200 operation result | active-session revision fence |
| `POST /api/v1/sessions/{sessionId}/execution` | `SessionObjectiveRequest`; 200 operation result | active-session revision fence |
| `POST /api/v1/sessions/{sessionId}/workflow` | `WorkflowAttachmentRequest`; 200 session detail | workflow owner, repository, and revision must match; duplicate attachment is reused |

Session lifecycle values are `active`, `interrupted`, `stale`, `recovered`, and
`archived`. The repository revision is immutable. Public session DTOs expose
workflow state/stage and attachment time, ordered events, bounded context, and
sanitized diagnostics; persistence versions, tenant/owner IDs, tokens, leases,
and other service-only fields are never published.

## Workflows

| Method and path | Input / success | Headers and pagination |
| --- | --- | --- |
| `POST /api/v1/workflows` | `WorkflowCreateRequest`; 201 workflow | required `Idempotency-Key` header or legacy body field; task max 20,000; 24-hour idempotency scope |
| `GET /api/v1/workflows` | cursor page | optional `cursor`, `limit` 1–100 (default 25) |
| `GET /api/v1/workflows/{workflowId}` | workflow detail and ETag | safe/idempotent |
| `POST .../{approve,retry,resume,cancel,replay}` | 200 updated workflow | required `If-Match` workflow version and `Idempotency-Key`; stale fence is 412 |
| `GET .../history` | cursor page of history | optional cursor/limit |
| `GET .../artifacts` | cursor page of artifacts | optional cursor/limit |
| `GET .../artifacts/{artifactId}` | sanitized artifact | safe/idempotent |
| `GET .../review` | sanitized review | safe/idempotent |
| `GET .../proposal` | sanitized proposal | safe/idempotent |
| `GET .../apply-plan` | sanitized apply plan | safe/idempotent |

Workflow lifecycle and approval enums are published in OpenAPI. Mutation
responses return a quoted numeric `ETag`; `If-Match` accepts that value (including
weak ETags). Idempotent replays set `Idempotency-Replayed: true`. The workflow
DTO includes `attachedSessionId`, history is version ordered, and all stage
resources are recursively sanitized.

The related authenticated knowledge/memory endpoints are:
`GET /api/v1/repositories/{owner}/{repo}/knowledge`,
`GET /api/v1/repositories/{owner}/{repo}/knowledge/{knowledgeId}`, and
`GET /api/v1/repositories/{owner}/{repo}/memory`. Collection routes use the same
opaque cursor and 1–100 limit rules as workflows.

## Frontend integration expectations

Use `publishedRevision`, never `currentRevision`, for Gateway requests. Treat 207
as usable data plus warnings rather than failure. Render diagnostic `code` and
`message`, and use `severity` for presentation; do not infer retry behavior when
the Session envelope supplies `retryable`. Preserve ETags and idempotency keys
across retries. Generate frontend types from the named component schemas instead
of copying persistence models. Stable backend TypeScript contracts are also
exported from `services/engineeringPlatformApi/publicContracts.ts` for backend
consumers and future generation tooling.
