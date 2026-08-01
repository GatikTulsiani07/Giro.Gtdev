# Contributing to Giro

Thanks for your interest in Giro. This project is preparing for its first public open-source release, so contribution process and issue labels may evolve.

## Branch Strategy

- `main` is the stable integration branch.
- Use short-lived feature branches.
- Name branches with a descriptive prefix, for example:
  - `docs/oss-readiness`
  - `frontend/workspace-polish`
  - `backend/retrieval-fix`

## Commit Conventions

Use concise, imperative commit messages:

```text
docs: add API guide
frontend: improve repository empty state
backend: fix session ownership check
test: cover gateway partial response
```

Keep commits focused. Avoid mixing unrelated frontend, backend, documentation, and configuration changes.

## Pull Request Flow

1. Open an issue for substantial changes.
2. Keep the PR scoped to one behavior or documentation area.
3. Include screenshots for frontend UI changes.
4. Include tests for behavior changes.
5. Run the relevant validation commands before requesting review.
6. Document API or contract changes clearly.

## Issue Reporting

Please include:

- What you expected to happen.
- What happened instead.
- Steps to reproduce.
- Relevant logs or request IDs.
- Environment details.
- Whether the issue affects frontend, backend, indexing, retrieval, sessions, or documentation.

## Development Expectations

- Do not invent backend fields in frontend code.
- Preserve published API contracts unless the change explicitly updates contracts.
- Prefer deterministic repository intelligence over mock data.
- Keep secrets out of frontend configuration.
- Use existing project patterns before adding new abstractions.
- Update documentation when behavior changes.

## Validation

Frontend:

```bash
cd backend/frontend
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Backend:

```bash
cd backend
pnpm typecheck
pnpm test
pnpm build
```
