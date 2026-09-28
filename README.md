# LMS

Multi-tenant platform for private teachers. Specification: [docs/requirements.md](docs/requirements.md), [docs/architecture.md](docs/architecture.md).

## Local development

Requirements: Node 24+, pnpm (`corepack enable pnpm`), Docker.

```bash
docker compose up -d                          # Postgres, S3-compatible storage, Mailpit
cp apps/api/.env.example apps/api/.env
pnpm install
pnpm --filter @lms/api dev                    # API on http://localhost:3001/api/health
pnpm --filter @lms/web dev                    # Web on http://localhost:3000
```

Local and demo environments only ever hold synthetic data. The API refuses to start otherwise (REQ-OPS-005).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
```
