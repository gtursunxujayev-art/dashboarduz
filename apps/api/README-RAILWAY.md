# Dashboarduz Backend - Railway Deployment Guide

## Prerequisites

1. Railway account (https://railway.app)
2. GitHub repository with this code
3. PostgreSQL database (provided by Railway)
4. Optional: Redis for queue workers

## Environment Variables

### Required Variables
```env
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=your-secure-jwt-secret-here
FRONTEND_URL=https://your-frontend-domain.com
SKIP_ENV_VALIDATION=true  # Set to true for initial deployment
```

### Optional Variables (for queue workers)
```env
REDIS_URL=redis://host:port  # OR
QUEUE_ENABLED=true  # Set to true if you want workers without Redis (limited functionality)
```

### Integration Variables (as needed)
```env
# SendGrid
SENDGRID_API_KEY=your-sendgrid-api-key

# AmoCRM
AMOCRM_CLIENT_ID=your-amocrm-client-id
AMOCRM_CLIENT_SECRET=your-amocrm-client-secret
AMOCRM_REDIRECT_URI=https://your-api-domain.com/api/integrations/amocrm/callback

# Twilio
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
TWILIO_PHONE_NUMBER=+1234567890

# S3 Storage
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name
S3_REGION=your-region
```

## Deployment Steps

### 1. Prepare Repository
```bash
# Remove existing .git folder (if this is a copy from monorepo)
rm -rf .git

# Initialize new git repository
git init
git add .
git commit -m "Prepare for Railway deployment"

# Connect to GitHub
gh repo create dashboarduz-backend --public --push --source .
```

### 2. Railway Setup
1. Create new project on Railway
2. Connect your GitHub repository
3. Add PostgreSQL database
4. Set environment variables (see above)
5. Deploy

### 3. Post-Deployment
1. Run database migrations:
   ```bash
   npm run migrate:deploy
   ```
   Or use Railway CLI:
   ```bash
   railway run npm run migrate:deploy
   ```

2. Once deployed, consider setting `SKIP_ENV_VALIDATION=false` and ensuring all required env vars are set.

## Local Testing Before Deploy

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Test with minimal env vars
DATABASE_URL="postgresql://localhost:5432/dashboarduz" \
JWT_SECRET="test-secret" \
FRONTEND_URL="http://localhost:3000" \
SKIP_ENV_VALIDATION=true \
npm start
```

## Project Structure

- `src/` - Main application source code
- `packages/db/` - Database package with Prisma schema
- `packages/shared/` - Shared types and schemas
- `dist/` - Built JavaScript files (created after `npm run build`)

## Key Changes Made for Railway

1. **Dependencies**: Changed from `workspace:*` to `file:./packages/*` references
2. **TypeScript**: Added `tsconfig.base.json` and fixed extends paths
3. **Prisma**: Added `postinstall` script to generate Prisma client automatically
4. **Workers**: Guarded Redis initialization to prevent crashes when Redis is unavailable
5. **Dockerfile**: Simplified for single-package deployment

## Troubleshooting

### App crashes on startup
- Check `SKIP_ENV_VALIDATION=true` is set
- Verify `DATABASE_URL` is correct
- Check Railway logs for specific errors

### Prisma client not found
- Ensure `postinstall` script ran (check build logs)
- Manually run: `npx prisma generate --schema=packages/db/prisma/schema.prisma`

### Redis connection errors
- Set `QUEUE_ENABLED=false` to disable workers
- Or provide valid `REDIS_URL`

## Monitoring

- Health endpoint: `GET /health`
- Queue metrics: `GET /health/queues` (protected in production)
- Railway provides built-in monitoring and logs

## Support

For issues with this deployment setup, check the Railway documentation or contact support.
```