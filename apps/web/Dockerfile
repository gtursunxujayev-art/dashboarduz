# ============================================
# NEXT.JS FRONTEND DOCKERFILE
# Production-optimized build with security best practices
# ============================================

FROM node:20-alpine AS base

# Security: Update packages
RUN apk update && apk upgrade && \
    rm -rf /var/cache/apk/*

# Install pnpm with specific version
RUN npm install -g pnpm@8.15.0

# Dependencies stage
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Builder stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages

COPY . .

# Build Next.js app
RUN pnpm --filter web build

# Runner stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--disable-proto=delete"

# Security: Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs --no-create-home nextjs && \
    apk del --purge && \
    rm -rf /var/cache/apk/* /tmp/*

# Copy built application with proper ownership
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Security: Set proper permissions
RUN chown -R nextjs:nodejs /app && \
    chmod -R 755 /app

# Security: Switch to non-root user
USER nextjs

# Security: Add security labels
LABEL maintainer="Dashboarduz Team" \
      org.opencontainers.image.title="Dashboarduz Web" \
      org.opencontainers.image.description="Multi-Tenant CRM Integrator Frontend" \
      org.opencontainers.image.vendor="Dashboarduz" \
      security.scanning.enabled="true" \
      security.non-root="true"

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Security: Use exec form
CMD ["node", "apps/web/server.js"]
