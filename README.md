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
- Database: Neon Postgres
- Queue: managed Redis

## Release Path (Canonical)
1. `npm install`
2. `npm run db:migrate:deploy`
3. Roll out API
4. Roll out worker
5. Roll out web

## Required Env Contract

API/worker core:
- `NODE_ENV=production`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `FRONTEND_URL` and/or `CORS_ORIGIN`

Integrations:
- `AMOCRM_CLIENT_ID`
- `AMOCRM_CLIENT_SECRET`
- `AMOCRM_REDIRECT_URI`
- `AMOCRM_WEBHOOK_SECRET`
- `UTEL_API_URL`
- `UTEL_API_TOKEN`
- `TELEGRAM_BOT_TOKEN` (required for Telegram integration and outbound notifications)

Web:
- `NEXT_PUBLIC_API_URL`
