# Developer Guide

This guide helps a new contributor run Giro locally and understand where to make changes.

## Local Setup

Prerequisites:

- Node.js 22 or newer
- pnpm 11
- PostgreSQL 16 with pgvector for integration validation
- Supabase project or compatible local Supabase setup
- OpenAI API key for non-mock AI/model workflows

Clone the repository, then install the frontend and backend packages separately.

```bash
cd backend
pnpm install

cd frontend
pnpm install
```

## Running the Frontend

```bash
cd backend/frontend
cp .env.example .env.local
pnpm dev
```

Default frontend URL: `http://localhost:3000`.

`backend/frontend/.env.local` should contain:

```bash
NEXT_PUBLIC_GIRO_API_URL=http://localhost:8000
```

## Running the Backend

```bash
cd backend
cp .env.example .env
pnpm dev
```

Default backend URL: `http://localhost:8000`.

For indexing work, run the worker in a second terminal:

```bash
cd backend
pnpm indexing:worker:dev
```

## Environment Variables

Backend variables are documented in `backend/.env.example`. Important groups:

- API: `PORT`, `CORS_ORIGINS`, `LOG_LEVEL`
- Auth: `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACTIVE_KEY_ID`
- Persistence: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Models: `OPENAI_API_KEY`, `EMBEDDINGS_PROVIDER`, `MODEL_NAME`
- Worker: `INDEXING_WORKER_ID`, `INDEXING_WORKER_ENABLED`, polling and retry settings
- PostgreSQL validation: `GIRO_POSTGRES_TEST_URL`

Frontend variables are documented in `backend/frontend/.env.example`.

Never put backend service-role keys, OpenAI keys, or JWT secrets in frontend environment files.

## Folder Structure

```text
backend/
├── src/
│   ├── config/        # environment validation
│   ├── middleware/    # auth, rate limit, request middleware
│   ├── routes/        # Hono routes
│   ├── services/      # domain services
│   └── tests/         # backend unit and integration tests
├── supabase/          # migrations and database contracts
└── frontend/
    ├── app/           # Next.js routes
    ├── components/    # shared UI and layout components
    ├── features/      # product feature modules
    ├── hooks/         # TanStack Query hooks
    ├── services/api/  # frontend API clients
    └── tests/         # frontend tests
```

## Coding Conventions

- Preserve existing API contracts unless a task explicitly changes them.
- Use typed request/response models from `backend/frontend/types/api.ts` on the frontend.
- Frontend components should consume real backend fields only.
- Keep URL state for repository workspace navigation.
- Prefer deterministic repository intelligence over generated or inferred UI placeholders.
- Add tests close to the behavior being changed.
- Keep comments focused on non-obvious logic.

## Testing

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

PostgreSQL integration validation:

```bash
cd backend
export GIRO_POSTGRES_TEST_URL=postgresql://postgres:postgres@127.0.0.1:5432/giro_test_admin
pnpm test:postgres
pnpm verify:migrations
```

## Debugging

- Login loops usually mean the bearer token is missing, expired, or signed with a different backend JWT secret.
- `Unable to reach the Giro API` means the frontend cannot reach `NEXT_PUBLIC_GIRO_API_URL`.
- Repository connection failures usually point to backend GitHub access, Supabase configuration, or indexing-job persistence.
- Indexing stalls should be checked through the indexing progress screen, worker logs, and durable worker health state.
- Empty architecture, feature, or symbol screens should be treated as missing backend data, not as a frontend mock-data opportunity.
