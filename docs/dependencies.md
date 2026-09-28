# Dependencies

CLAUDE.md requires a written justification for every new dependency. Add a row whenever a package is added, and say which task added it. Versions are recorded in `pnpm-lock.yaml`.

## Tooling (root)

| Package | Why | Added in |
|---|---|---|
| pnpm (via corepack, pinned in `packageManager`) | Workspace package manager for the monorepo (architecture §9) | Phase 1, task 1 |
| typescript **6.x** | Strict typing everywhere. **Pinned to 6.x on purpose**: TypeScript 7 (the native compiler) has no stable JS API yet, and typescript-eslint and dependency-cruiser refuse to run with it. Revisit when they support 7. | Phase 1, task 1 |
| eslint, @eslint/js, typescript-eslint, globals | Linting with type-aware rules | Phase 1, task 1 |
| prettier | Consistent formatting | Phase 1, task 1 |
| dependency-cruiser | Enforces module boundaries (a module is used only through its `index.ts`), web/API separation and no cycles (architecture §2) | Phase 1, task 1 |

## API (`apps/api`)

| Package | Why | Added in |
|---|---|---|
| @nestjs/core, @nestjs/common | The API framework chosen in architecture §9 | Phase 1, task 1 |
| @nestjs/platform-fastify | Fastify HTTP adapter. Lower per-request overhead than Express, which matters for exam-start and autosave spikes (review SCALE-02, PERF-03) | Phase 1, task 1 |
| reflect-metadata, rxjs | Required peers of NestJS | Phase 1, task 1 |
| @nestjs/cli (dev) | `nest start --watch` for local development | Phase 1, task 1 |
| @nestjs/testing (dev) | Test modules for NestJS | Phase 1, task 1 |
| vitest (dev) | Test runner (architecture §9) | Phase 1, task 1 |
| unplugin-swc, @swc/core (dev) | Vitest's default transform (esbuild) doesn't emit decorator metadata, which NestJS dependency injection needs. SWC does | Phase 1, task 1 |
| @types/node (dev) | Node type definitions | Phase 1, task 1 |

## Web (`apps/web`)

| Package | Why | Added in |
|---|---|---|
| next, react, react-dom | The web client chosen in architecture §9 | Phase 1, task 1 |
| @types/react, @types/react-dom, @types/node (dev) | Type definitions | Phase 1, task 1 |
| vitest (dev) | Unit tests for web utilities | Phase 1, task 1 |
