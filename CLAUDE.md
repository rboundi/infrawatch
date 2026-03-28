# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
# Dev: start PostgreSQL, then API + web separately
docker compose up postgres -d
npm run build -w packages/scanner        # must build scanner before server
npm run dev -w packages/server           # API on :3001 (needs env vars, see .env)
npm run dev -w packages/web              # Vite on :5173, proxies /api to :3001

# Full stack via Docker (with hot reload)
npm run dev                              # docker-compose.yml + docker-compose.dev.yml

# Production
./setup.sh                               # generates secrets, builds, starts everything

# Build
npm run build -w packages/scanner        # build scanner first (server depends on it)
npm run build -w packages/server         # compile server TypeScript
npm run build -w packages/web            # tsc + vite build

# Tests (scanner package only)
npm test -w packages/scanner             # vitest run (once)
npm run test:watch -w packages/scanner   # vitest watch mode

# Database migrations
npm run db:migrate -w packages/server          # apply pending
npm run db:migrate:create -w packages/server   # create new migration (.cjs)
npm run db:migrate:down -w packages/server     # rollback last
```

## Architecture

Monorepo with three packages connected via npm workspaces:

- **`packages/scanner`** — Agentless scanner library. Exports `createScanner(type)` factory that returns a `Scanner` with a `scan(target): Promise<ScanResult>` method. Seven scanner types: `ssh_linux`, `winrm`, `kubernetes`, `aws`, `vmware`, `docker`, `network_discovery`. This is a pure library with no HTTP or database dependencies.

- **`packages/server`** — Express API + background services. `@infrawatch/scanner` is a workspace dependency. Background services (ScanOrchestrator, VersionChecker, StaleHostChecker, EmailNotifier) run on timers alongside the HTTP server. All state is in PostgreSQL. Credentials are encrypted with AES-256-GCM before storage using `MASTER_KEY`.

- **`packages/web`** — React SPA with Vite, TailwindCSS, React Query, React Router. All API calls go through `src/api/client.ts` (axios wrapper). React Query hooks in `src/api/queries.ts`. In dev, Vite proxies `/api` to the API server. In production, nginx handles the proxy.

**Build order matters**: scanner → server (server imports `@infrawatch/scanner`). Web is independent.

## Key Patterns

- **Database**: PostgreSQL with `pg` Pool. Migrations use `node-pg-migrate` in CommonJS format (`.cjs`). Migrations run automatically on server startup via `runMigrations()` in `src/migrate.ts`.
- **Config**: All env vars centralized in `packages/server/src/config.ts`. DB pool settings (max, timeouts) are in the config object.
- **Encryption**: `packages/server/src/utils/crypto.ts` — AES-256-GCM encrypt/decrypt for connection configs. Key derived from `MASTER_KEY` via SHA-256.
- **Routes**: Each route file exports a `create*Routes(pool, logger)` factory function that returns an Express Router.
- **API auth**: Optional `X-API-Key` header middleware in `src/middleware/api-key.ts`. Skipped when `API_KEY` env is empty. Health endpoint is always public.
- **Scanner interface**: All scanners implement `Scanner { scan(target: ScanTarget): Promise<ScanResult> }`. `ScanResult` contains `hosts: HostInventory[]` with packages, services, and metadata.
- **Frontend API client**: `VITE_API_KEY` env var is baked in at build time. The axios instance in `src/api/client.ts` attaches it as `X-API-Key` header.

## Docker Setup

- **Dev**: `docker-compose.yml` (postgres on :5433) + `docker-compose.dev.yml` (volume mounts + tsx watch)
- **Prod**: `docker-compose.prod.yml` — multi-stage builds, nginx reverse proxy, resource limits, health checks, `infrawatch-net` bridge network
- Server Dockerfile installs nmap (for network discovery scanner) and runs as non-root `infrawatch` user
- Web Dockerfile accepts `VITE_API_KEY` as build arg

## TypeScript Config

Base config in `tsconfig.base.json`: strict mode, ES2022 target, NodeNext module resolution. Server and scanner extend it. Web uses `bundler` module resolution with `react-jsx`.
