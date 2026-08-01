# Giro Architecture

This document explains how Giro turns a GitHub repository into an AI-ready engineering workspace.

## High-Level Architecture

```text
Frontend (Next.js)
  -> Authenticated API requests
  -> Backend API (Hono)
  -> Repository services, session services, gateway services
  -> PostgreSQL/Supabase persistence
  -> Indexing worker and repository intelligence pipeline
  -> Retrieval, feature, semantic, insight, and workflow services
```

Giro separates deterministic repository intelligence from AI-facing interaction. The indexing and repository services build structured facts first. The frontend then consumes published API contracts to render repository state, evidence, sessions, and engineering outputs.

## Backend Services

The backend lives in `backend/src`.

Important areas:

- `routes/`: HTTP routes and route groups.
- `middleware/`: authentication, request handling, rate limiting, and operational boundaries.
- `services/repository*`: repository metadata, workspace, intelligence, graph, artifacts, planning, review, proposals, sandboxing, execution, and cleanup domains.
- `services/retrieval/`: retrieval, ranking, confidence, stitching, query expansion, and cache services.
- `services/featureIntelligence/`: feature-level repository intelligence.
- `services/semanticCodeIntelligence/`: semantic code relationships such as definitions, callers, callees, inheritance, references, and implementations.
- `services/repositorySession*`: repository-scoped engineering session APIs and session lifecycle behavior.
- `services/autonomousWorkflow/`: workflow orchestration surfaces.
- `services/indexing/`: indexing jobs, worker coordination, snapshots, and progress events.
- `supabase/migrations/`: durable database schema and RPC contract.

## Frontend Architecture

The frontend lives in `backend/frontend`.

Important areas:

- `app/`: Next.js routes.
- `components/ui/`: shared design primitives.
- `components/layout/`: authenticated application shell.
- `features/repositories/`: dashboard, connection, search, workspace, onboarding, repository overview.
- `features/repositories/workspace/`: three-pane repository workspace, session UX, architecture dashboard, feature explorer, symbol explorer, file viewer, evidence panel, command palette.
- `features/chat/`: Ask Giro conversation surface.
- `hooks/`: TanStack Query hooks for repository, session, indexing, and workspace APIs.
- `services/api/`: typed frontend API clients.
- `store/`: Zustand UI state.
- `tests/`: Vitest and Testing Library coverage.

The frontend does not create intelligence. It renders existing backend data and preserves URL state for view, session, file, feature, symbol, workflow, and evidence selection.

## Repository Intelligence Pipeline

The indexing pipeline is responsible for preparing repository context before any AI interaction.

1. A user connects a GitHub repository.
2. The backend records durable repository and indexing-job state.
3. The indexing worker claims work from the database.
4. The repository is cloned or updated inside controlled storage.
5. The backend scans repository structure and source files.
6. Services derive architecture, feature, semantic, dependency, artifact, and retrieval data.
7. Results are persisted and published through repository APIs.
8. The frontend renders repository status, indexing progress, workspace views, and evidence.

## Session Lifecycle

Repository sessions are persistent engineering contexts tied to a repository and revision.

1. The user opens a repository.
2. The frontend creates or reopens a repository session through the session API.
3. The backend stores session context, events, diagnostics, workflow state, and outputs.
4. The user asks questions or requests plans, specifications, insights, or execution readiness.
5. The frontend renders the backend response and exposes evidence, request IDs, diagnostics, and metadata.
6. Archived sessions remain available in session history.

## Query Flow

```text
Question or action
  -> Frontend session action
  -> Repository session API
  -> Repository query/retrieval/intelligence services
  -> Response envelope with data, diagnostics, confidence, request ID
  -> Frontend conversation and evidence panels
```

The frontend treats HTTP 207 as usable partial data where supported. Errors remain visible and retryable when the backend marks them retryable or when the route offers a refetch action.

## Workflow Orchestration

Workflow support is exposed through existing backend workflow/session endpoints. A session may have an attached workflow ID, workflow state, current stage, timeline events, and diagnostics. The frontend displays that state but does not invent workflow stages or execution capabilities.

## Operational Boundaries

- Authentication uses bearer JWTs.
- Repository operations must authorize against durable repository ownership.
- Repository storage paths are server-derived and not trusted from user input.
- Frontend tokens remain in browser session storage.
- Backend secrets must never be exposed through frontend environment variables.
