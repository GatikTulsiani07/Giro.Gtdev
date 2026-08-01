# API Documentation

Giro exposes authenticated JSON APIs. This document is a product-level guide; backend source and OpenAPI contracts remain the source of truth.

## Authentication

Protected routes require a bearer JWT:

```http
Authorization: Bearer <JWT>
```

Frontend login stores the token in browser session storage and validates it by calling the sessions API. Expired or invalid tokens produce a 401 and return the user to login.

## Response Envelopes

Standard successful response:

```json
{
  "success": true,
  "data": {},
  "requestId": "req_..."
}
```

Standard error response:

```json
{
  "success": false,
  "error": {
    "code": "error_code",
    "message": "Human readable message",
    "retryable": true
  },
  "requestId": "req_..."
}
```

Partial responses may use HTTP 207 where supported. The frontend treats partial data as usable and shows diagnostics.

## Sessions

Session APIs support:

- List sessions.
- Create sessions.
- Get session details.
- Delete or archive sessions.
- Ask questions.
- Add messages.

Repository sessions additionally support repository-scoped actions:

- Query
- Generate plan
- Generate specification
- Generate insights
- Check execution readiness
- Attach workflow

## Repository APIs

Repository APIs support:

- List indexed repositories.
- Connect a repository.
- Read repository metadata.
- Read repository summary.
- Read repository workspace data.
- Track indexing job status.
- Stream indexing progress.
- Search repository evidence.

Repository state includes statuses such as queued, indexing, indexed, stale, failed, and disconnected.

## Repository Gateway

The Repository Gateway exposes published repository intelligence for:

- Overview
- Architecture
- Feature navigation
- Semantic navigation
- Repository directory listing
- Repository file reads
- File tree access

Gateway responses power the repository workspace, architecture dashboard, feature explorer, symbol explorer, repository tree, file viewer, evidence panel, command palette, and recent activity.

## Workflows

Workflow APIs are consumed through repository session surfaces. A workflow may expose:

- Attached workflow ID
- Workflow state
- Current stage
- Timeline
- Diagnostics

The frontend only renders workflow fields returned by the backend.

## Errors

Common error categories:

- `401`: missing, expired, or invalid token.
- `404`: repository, session, job, or resource not found.
- `409`: revision mismatch or incompatible repository state.
- `424`: dependency failure, commonly unavailable gateway or prerequisite data.
- `429`: rate limit.
- `5xx`: backend or dependency failure.

Errors should include a request ID when available. Retry buttons should be shown where the frontend can safely refetch or resubmit.
