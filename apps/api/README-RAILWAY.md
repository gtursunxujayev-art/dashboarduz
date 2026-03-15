# Railway Deployment (API + Worker)

## Services
Create two Railway services from this repo:
- API service:
  - Root directory: `apps/api`
  - Start command: `npm run start --workspace @dashboarduz/api`
- Worker service:
  - Root directory: `apps/api`
  - Start command: `npm run start:worker --workspace @dashboarduz/api`

Use the same image/build context and same environment variables for both services.

## Required Environment Variables

Core:
- `NODE_ENV=production`
- `DATABASE_URL` (Neon)
- `REDIS_URL`
- `JWT_SECRET` (32+ chars)
- `ENCRYPTION_KEY` (32+ chars)
- `FRONTEND_URL` (Vercel URL)
- `CORS_ORIGIN` (usually same as `FRONTEND_URL`)
- `PUBLIC_API_URL` (your Railway public API URL)

Integrations:
- `AMOCRM_LONG_LIVED_TOKEN` (optional default token)
- `AMOCRM_WEBHOOK_SECRET`
- `UTEL_API_URL`
- `UTEL_API_TOKEN`
- `TELEGRAM_BOT_TOKEN` (required if Telegram integration/notifications are enabled)

Optional:
- `UTEL_WEBHOOK_SECRET`
- `SENTRY_DSN`
- Twilio OTP variables if you use Twilio provider

## Release Order
1. Run migrations first:
   - locally: `npm run db:migrate:deploy`
   - or in Railway shell: `npm run db:migrate:deploy`
2. Deploy API service
3. Deploy Worker service

## Health Checks
- API liveness: `GET /health`
- API readiness: `GET /health/ready`

Worker readiness is verified via logs and queue processing (webhook/notification jobs).
