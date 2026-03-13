# Dashboarduz API (MVP)

Express + tRPC backend for multi-tenant CRM integration.

## Run

```bash
npm run dev --workspace @dashboarduz/api
```

Run worker separately:

```bash
npm run dev:worker --workspace @dashboarduz/api
```

## Build

```bash
npm run build --workspace @dashboarduz/api
```

## Environment

Use [`apps/api/.env.example`](c:/Users/user/Documents/GitHub/dashboarduz/apps/api/.env.example).

Required for MVP:
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `FRONTEND_URL` and/or `CORS_ORIGIN`
- `AMOCRM_CLIENT_ID`, `AMOCRM_CLIENT_SECRET`, `AMOCRM_REDIRECT_URI`
- `AMOCRM_WEBHOOK_SECRET`

Optional:
- Twilio OTP vars (if using Twilio provider)
- Telegram/UTeL vars
- Sentry vars

## MVP scope

- Auth: Phone OTP primary
- Google Sign-In: removed
- Google Sheets: deferred/disabled
- Integrations: AmoCRM, Telegram, VoIP (UTeL)
- Queue workers: webhook/notification/export/sync jobs via Redis + BullMQ
