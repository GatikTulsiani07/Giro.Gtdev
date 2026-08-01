# Giro

Giro is an open-source repository intelligence workspace for AI-assisted engineering. It indexes GitHub repositories, builds deterministic architecture and semantic context, and gives engineers a grounded workspace for exploring code, evidence, sessions, plans, specifications, and execution readiness.

Giro is not another chat box over a repo. It is the intelligence layer before the chat box: repository structure, symbols, features, dependencies, retrieval evidence, and sessions are prepared first so AI answers have something concrete to stand on.

## Why Giro Exists

Modern codebases are larger than the context windows developers usually work inside. Engineers need to understand architecture, ownership, dependencies, symbols, and historical context before they can safely ask an AI system to explain or plan a change.

Giro solves that gap by turning a repository into a navigable engineering workspace:

- Repository structure is indexed and normalized.
- Architecture, feature, semantic, and dependency views are exposed through APIs.
- Retrieval produces inspectable evidence with files, line ranges, confidence, and request IDs.
- Engineering sessions preserve repository context across questions and outputs.
- The frontend presents all of this as a production workspace rather than as raw API responses.

## Key Capabilities

- Connect a GitHub repository and track indexing progress.
- Browse repository status, architecture, features, symbols, files, evidence, diagnostics, and metadata.
- Inspect feature relationships, entry points, exit points, related files, symbols, upstream, and downstream dependencies.
- Navigate semantic code intelligence: definitions, references, implementations, callers, callees, inheritance, and dependencies.
- Start persistent engineering sessions tied to a repository revision.
- Ask repository-scoped questions and inspect evidence.
- Generate plans, specifications, insights, and execution readiness summaries through existing backend actions.
- Attach workflows and inspect workflow state.
- Use a keyboard-first workspace with global search, command palette, recent activity, and deep links.

## Architecture Overview

```text
GitHub repository
  -> Backend indexing pipeline
  -> Repository metadata, graph, features, symbols, embeddings, and artifacts
  -> Repository Gateway and Session APIs
  -> Next.js frontend workspace
  -> Developer explores evidence and asks grounded engineering questions
```

The backend is a Hono + TypeScript API with repository intelligence services, indexing workers, PostgreSQL/Supabase persistence, authentication, retrieval, workflow, and session APIs. The frontend is a Next.js application with TanStack Query, Zustand, Tailwind, and React workspace components.

See [docs/architecture.md](docs/architecture.md) for the full system walkthrough.

## Screenshots

Screenshots should be added before the first tagged public release.

- Dashboard and first-run onboarding: `docs/assets/dashboard.png`
- Repository workspace: `docs/assets/repository-workspace.png`
- Engineering session: `docs/assets/engineering-session.png`
- Architecture dashboard: `docs/assets/architecture-dashboard.png`

## Quick Start

Prerequisites:

- Node.js 22 or newer
- pnpm 11
- PostgreSQL with pgvector for full backend validation
- Supabase project or compatible local configuration for repository persistence
- OpenAI API key if using OpenAI-backed embeddings or models

Frontend only:

```bash
cd backend/frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

Backend:

```bash
cd backend
cp .env.example .env
pnpm install
pnpm dev
```

The frontend expects `NEXT_PUBLIC_GIRO_API_URL` to point to the backend, usually `http://localhost:8000`.

For complete setup details, see [docs/developer-guide.md](docs/developer-guide.md).

## Tech Stack

- TypeScript
- Node.js
- Hono
- Next.js
- React
- Tailwind CSS
- TanStack Query
- Zustand
- PostgreSQL / Supabase
- pgvector
- OpenAI APIs
- Vitest

## Project Structure

```text
.
├── backend/                  # Hono API, repository intelligence, workers, tests
│   ├── src/
│   │   ├── routes/           # HTTP routes
│   │   ├── services/         # repository, retrieval, sessions, workflow, semantic intelligence
│   │   ├── middleware/       # auth, rate limit, request handling
│   │   └── config/           # runtime environment validation
│   ├── supabase/migrations/  # database schema and RPC contracts
│   └── frontend/             # Next.js frontend application
├── docs/                     # public OSS documentation
├── .github/                  # CI and community templates
└── README.md
```

## Development Workflow

1. Read the relevant docs and API contracts before changing behavior.
2. Keep backend API contracts stable unless a change is explicitly planned.
3. Build features against real backend responses; do not invent API fields.
4. Add focused tests for changed behavior.
5. Run validation before opening a pull request.

Common commands:

```bash
cd backend/frontend
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../
pnpm typecheck
pnpm test
pnpm build
```

## Roadmap

- Public alpha documentation and onboarding.
- Hosted demo repository walkthrough.
- More complete workflow orchestration UI.
- Deeper repository evolution and insight surfaces.
- Production deployment guide.
- Expanded contributor-friendly issue labels and project board.

## Contributing

Contributions are welcome once the project is public. Start with [CONTRIBUTING.md](CONTRIBUTING.md), then read:

- [docs/developer-guide.md](docs/developer-guide.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/api.md](docs/api.md)
- [docs/product.md](docs/product.md)

Please open an issue before large architectural changes.

## License

Giro is released under the MIT License. See [LICENSE](LICENSE).
