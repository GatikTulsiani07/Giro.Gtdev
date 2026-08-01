# Giro Frontend Developer Guide

This package is the Next.js frontend for Giro. It consumes the existing Giro backend APIs through `NEXT_PUBLIC_GIRO_API_URL`; it does not define backend routes or intelligence behavior.

## First Run

1. Install dependencies from `backend/frontend` if they are not already present:
   `pnpm install`
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_GIRO_API_URL` to the running backend origin.
4. Start the frontend:
   `pnpm dev`
5. Open the dashboard and follow the first-run checklist:
   Connect Repository, Wait for Index, Open Workspace, Ask First Question, Create First Session, Explore Architecture.

## Environment Variables

`NEXT_PUBLIC_GIRO_API_URL`

The public browser-facing API origin for the Giro backend. Local development defaults to `http://localhost:8000`.

## Connecting the Backend

The frontend expects the backend to expose the published repository, indexing, search, session, repository gateway, semantic, feature, and workflow contracts already used by the app. If the backend is unavailable, the frontend should render retryable error states instead of placeholder data.

## Demo Walkthrough

The dashboard includes a frontend-only sample walkthrough for first-time developers. It shows the expected user path and links to representative repository, indexing, workspace, session, search, architecture, and feature routes.

The demo walkthrough does not mock API responses. If the sample repository is not present in the backend, the existing repository unavailable and empty states are shown.

## Production Audit States

Verify these states before release:

- Empty workspace: no repositories connected, clear Connect repository CTA.
- Loading: repository and session skeletons render without layout jumps.
- Repository status: queued, indexing, ready, stale, failed, and disconnected are visibly distinct.
- Indexing progress: indexing route is reachable from onboarding and repository status.
- Gateway unavailable: retry action remains visible.
- Empty repository: architecture, feature, symbol, evidence, workflow, and session empty states explain the next action.
- Expired or missing session: session screens allow creating or reopening a session.
- 404: Next.js not-found surface is reachable for unknown routes.

## Validation

Run from `backend/frontend`:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

From the repository root, also run:

```bash
git diff --check -- backend/frontend
```
