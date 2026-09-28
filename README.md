# LMS

Multi-tenant platform for private teachers. Specification: [docs/requirements.md](docs/requirements.md), [docs/architecture.md](docs/architecture.md).

## Local development

Requirements: Node 24+, pnpm (`corepack enable pnpm`), Docker.

```bash
docker compose up -d                          # Postgres, S3-compatible storage, Mailpit
cp apps/api/.env.example apps/api/.env
pnpm install
pnpm build:shared                             # shared package used by the API and web
pnpm --filter @lms/api db:dev-setup           # migrations + local database users
pnpm --filter @lms/api dev                    # API on http://localhost:3001/api/health (runs job workers inline)
pnpm --filter @lms/web dev                    # Web on http://localhost:3000
```

Local and demo environments only ever hold synthetic data. The API refuses to start otherwise (REQ-OPS-005).

## Demo data

`pnpm --filter @lms/api db:seed` loads synthetic Arabic demo accounts (local, demo and staging only) and prints their logins. The free cloud demo is described in [docs/deploy-demo.md](docs/deploy-demo.md).

## Tests

`pnpm test` runs unit tests and integration tests. Integration tests start their own PostgreSQL container, so Docker must be running.

## Browser tests

```bash
pnpm build
pnpm --filter @lms/web exec playwright install chromium   # once
pnpm --filter @lms/web test:e2e
```

They start the built API (against the local Docker database, with the development `file` OTP sender) and the built web app. Then they check the RTL layout and walk through registration, phone confirmation, two-step verification, and signing out, in Arabic.

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
```
