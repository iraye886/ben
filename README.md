# Kola Business Desk

Kola is a full-stack operations desk for Nigerian SMEs. It brings inventory, sales, expenses, financial reports, team access, and activity history into one workspace.

## Run locally, outside Replit

### Requirements

- Node.js 20 or newer
- pnpm 10 or newer
- PostgreSQL 14 or newer (or Docker Desktop for the included compose file)
- A Clerk application with sign-in and sign-up enabled

### 1. Configure the environment

```sh
cp .env.example .env
```

Replace the three Clerk placeholders in `.env` with keys from your own Clerk application. The app uses Clerk for authentication but does not require Replit-specific runtime services. Keep the secret key server-side and do not commit `.env`.

### 2. Start PostgreSQL

The easiest local option is:

```sh
docker compose up -d postgres
```

If you already run PostgreSQL, point `DATABASE_URL` at that database instead.

### 3. Install dependencies and create the schema

```sh
pnpm install
pnpm --filter @workspace/db run push
```

### 4. Start the API and web app

```sh
pnpm run dev
```

This starts the API on `http://localhost:8080` and the Vite web app on `http://localhost:5173`. Vite proxies `/api` requests to the API, so authentication cookies remain same-origin from the browser's point of view. If you use another API port, set `PORT` and `API_URL` to match.

You can also run the processes separately:

```sh
pnpm run dev:api
pnpm run dev:web
```

Open `http://localhost:5173`, create an account, and complete the one-time business setup. The schema is created for the configured database; no Replit database is required.

## Production build

```sh
pnpm run build
pnpm --filter @workspace/sme-management run serve
```

The frontend build is in `artifacts/sme-management/dist/public`. In production, place the API behind the same public origin (or configure an equivalent reverse proxy for `/api`) so Clerk session cookies and API requests share the app domain.

## Workspace map

- `artifacts/sme-management` — React/Vite frontend
- `artifacts/api-server` — Express API and Clerk session middleware
- `lib/db` — PostgreSQL schema and Drizzle database client
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/api-client-react` — generated React Query hooks

## Useful commands

- `pnpm run typecheck` — typecheck libraries and artifacts
- `pnpm run build` — typecheck and build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API contracts and hooks
- `pnpm --filter @workspace/db run push` — apply the current schema to the configured database