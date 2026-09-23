# Kola Business Desk

Kola is a full-stack operations desk for Nigerian SMEs, covering inventory, sales, expenses, financial reports, team access, and activity history.

## Run & operate

- `pnpm install` — install all workspace dependencies
- `pnpm run dev` — run the API and web app together
- `pnpm run typecheck` — typecheck libraries and artifacts
- `pnpm run build` — typecheck and build all packages
- `pnpm --filter @workspace/db run push` — push the current PostgreSQL schema
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI

The API defaults to port `8080`; the Vite app defaults to port `5173` and proxies `/api` to the API. See `README.md` and `.env.example` for a portable local setup.

## Stack

- pnpm workspaces, Node.js, TypeScript
- React/Vite frontend with React Query and Clerk
- Express API
- PostgreSQL + Drizzle ORM
- Zod validation and generated OpenAPI client contracts

## Where things live

- `artifacts/sme-management/src/App.tsx` — application routes, onboarding, workspace shell, pages, and CRUD forms
- `artifacts/sme-management/src/index.css` — shared visual tokens and global styles
- `artifacts/api-server/src/routes/auth.ts` — Clerk-backed profile and onboarding endpoints
- `artifacts/api-server/src/routes/sme.ts` — dashboard and business operations endpoints
- `lib/db/src/schema/sme.ts` — database schema source of truth
- `lib/api-spec/openapi.yaml` — API contract source of truth

## Architecture decisions

- Clerk remains the authentication provider. After Clerk sign-in, each SME user unlocks their role with a separate six-digit passkey; the server stores only a salted hash and signs a short-lived, httpOnly unlock cookie.
- A signed-in Clerk user without a database profile is sent through the business setup screen.
- The browser talks to `/api` on its own origin; local Vite development proxies those requests to the API server.
- The UI uses a shared token-based theme so pages, forms, modals, and responsive navigation can evolve without rewriting the visual language.

## Product

Administrators can create a business profile, manage products and stock thresholds, record sales and expenses, inspect reports, invite teammates, manage roles, and review activity. Managers and cashiers see only the workflows allowed by their role.