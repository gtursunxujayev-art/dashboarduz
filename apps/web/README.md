# Dashboarduz Web (MVP)

Next.js frontend for the multi-tenant CRM integrator MVP.

## Run

```bash
npm run dev --workspace @dashboarduz/web
```

## Build

```bash
npm run build --workspace @dashboarduz/web
```

## Environment

Use [`apps/web/.env.example`](c:/Users/user/Documents/GitHub/dashboarduz/apps/web/.env.example).

Key values:
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SENTRY_DSN` (optional)
- `NEXT_PUBLIC_ENABLE_GOOGLE_SHEETS=false` (MVP default)

## MVP auth/integrations scope

- Login: Phone OTP
- Telegram: account linking/integration after login
- Google Sign-In: removed for MVP
- Google Sheets: disabled/deferred for MVP
