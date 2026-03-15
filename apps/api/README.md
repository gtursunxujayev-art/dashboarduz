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
- `PUBLIC_API_URL` (recommended for integration webhook URL generation)
- `AMOCRM_LONG_LIVED_TOKEN` (optional default token, per-tenant token can be set from UI)
- `AMOCRM_WEBHOOK_SECRET`
- `TELEGRAM_BOT_TOKEN` (required for Telegram integration and outbound notifications)

Optional:
- Twilio OTP vars (if using Twilio provider)
- `UTEL_WEBHOOK_SECRET`
- Sentry vars

## MVP scope

- Auth: Phone OTP + Login/Password
- Google Sign-In: removed
- Google Sheets: deferred/disabled
- Integrations: AmoCRM, Telegram, VoIP (UTeL)
- AmoCRM is token-only (long-lived token)
- Queue workers: webhook/notification/export/sync jobs via Redis + BullMQ
