# Dashboarduz Monorepo

## Structure
- apps/web: Next.js frontend (deploy to Vercel)
- apps/api: Express + tRPC backend (deploy to Railway)
- packages/shared: Shared Zod schemas/types
- packages/db: Prisma schema/client and DB scripts

## Install
```bash
npm install
```

## Development
```bash
npm run dev:web
npm run dev:api
npm run dev:worker
```

## Build
```bash
npm run build
```

## Type Check
```bash
npm run type-check
```

## Deploy Mapping
- Vercel project root: `apps/web`
- Railway API service root: `apps/api`
- Railway Worker service root: `apps/api` (worker command)
