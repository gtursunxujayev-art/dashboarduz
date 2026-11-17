# Dashboarduz Monorepo

## Structure
- `apps/web`: Next.js dashboard (Vercel)
- `apps/api`: Express + tRPC API and worker entrypoints (Railway)
- `packages/shared`: shared types and Zod schemas
- `packages/db`: Prisma schema, client, and migrations

## MVP Scope
- Auth: `phone OTP` + `login/password`
- Telegram: link/integration only (not primary login)
- Integrations enabled: `amocrm`, `telegram`, `voip_utel`
- AmoCRM is token-only (long-lived token)
- Google auth: removed from active runtime
- Google Sheets: deferred/disabled in MVP

## Local Commands
```bash
npm install
npm run db:generate
npm run type-check
npm run build
```

Run services:
```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

## Deploy Topology
- Web: Vercel project root `apps/web`
- API: Railway service root `apps/api` with start command `npm run start --workspace @dashboarduz/api`
- Worker: Railway service root `apps/api` with start command `npm run start:worker --workspace @dashboarduz/api`
- The API is not deployed on Vercel (there is no `apps/api/vercel.json`); a Vercel project pointing at `apps/api` is obsolete.
- Database: Neon Postgres
- Queue: managed Redis

## Release Path (Canonical)
1. `npm install`
2. `npm run db:migrate:deploy` against the production database. This is a deliberate, manual release step:
   CI does not apply migrations to any real database (it only migrates a throwaway Postgres container for tests).
   Run it from a trusted machine with `DATABASE_URL` set to the target database, and check
   `npm run migrate:status --workspace @dashboarduz/db` first.
3. Roll out API
4. Roll out worker
5. Roll out web

## Checks (what CI runs)
- `npm run type-check`
- `npm run lint`: `apps/api` keeps its strict rules; problems that already existed are recorded in
  `apps/api/.eslint-baseline.json` and only new ones fail (`npm run lint:strict --workspace @dashboarduz/api`
  shows all of them, `npm run lint:baseline:update --workspace @dashboarduz/api` tightens the baseline after a cleanup).
- `npm run audit:tenant-filter`: fails on router queries without a `tenantId` filter that are not in
  `scripts/audit-tenant-filter.baseline.json`.
- `npm run test:coverage --workspaces --if-present` with coverage thresholds at the measured level.
- API integration tests (`apps/api/src/__tests__/integration`) run real tRPC procedures against Postgres. They are
  skipped unless `TEST_DATABASE_URL` points at a throwaway, already-migrated database whose name contains `test`:
  ```bash
  createdb dashboarduz_test
  DATABASE_URL=postgresql://postgres@localhost:5432/dashboarduz_test npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
  TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dashboarduz_test npm test --workspace @dashboarduz/api
  ```

## Required Env Contract

API/worker core:
- `NODE_ENV=production`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `FRONTEND_URL` and/or `CORS_ORIGIN`

Integrations:
- `AMOCRM_LONG_LIVED_TOKEN` (optional default token)
- `AMOCRM_WEBHOOK_SECRET`
- `UTEL_WEBHOOK_SECRET` (optional, recommended in production)
- `TELEGRAM_BOT_TOKEN` (required for Telegram integration and outbound notifications)

Web:
- `NEXT_PUBLIC_API_URL`
