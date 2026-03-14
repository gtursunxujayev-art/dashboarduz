-- Initial schema for Dashboarduz MVP
-- This migration allows fresh environments to use prisma migrate deploy
-- without relying on `prisma db push`.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "tenants" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "subdomain" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "name" TEXT,
    "roles" TEXT[] NOT NULL DEFAULT ARRAY['Agent']::TEXT[],
    "authProvider" TEXT NOT NULL,
    "providerId" TEXT,
    "telegramId" TEXT,
    "googleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "user_auth_links" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_auth_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_auth_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "integrations" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "config" JSONB,
    "tokensEncrypted" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "contacts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "externalIds" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "leads" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "amocrmId" TEXT,
    "title" TEXT NOT NULL,
    "contactId" TEXT,
    "status" TEXT,
    "pipelineId" TEXT,
    "responsibleUserId" TEXT,
    "metadata" JSONB,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "calls" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "callIdExternal" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "duration" INTEGER,
    "status" TEXT NOT NULL,
    "recordingUrl" TEXT,
    "recordingId" TEXT,
    "metadata" JSONB,
    "leadId" TEXT,
    "contactId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "calls_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "notifications" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "webhook_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "rawPayload" JSONB NOT NULL,
    "signature" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT FALSE,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_subdomain_key" ON "tenants"("subdomain");
CREATE INDEX IF NOT EXISTS "tenants_subdomain_idx" ON "tenants"("subdomain");

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegramId_key" ON "users"("telegramId");
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_email_key" ON "users"("tenantId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_phone_key" ON "users"("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "users_tenantId_idx" ON "users"("tenantId");
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users"("username");
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_phone_idx" ON "users"("phone");
CREATE INDEX IF NOT EXISTS "users_telegramId_idx" ON "users"("telegramId");
CREATE INDEX IF NOT EXISTS "users_googleId_idx" ON "users"("googleId");

CREATE UNIQUE INDEX IF NOT EXISTS "user_auth_links_provider_providerId_key" ON "user_auth_links"("provider", "providerId");
CREATE INDEX IF NOT EXISTS "user_auth_links_userId_idx" ON "user_auth_links"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "integrations_tenantId_type_key" ON "integrations"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "integrations_tenantId_idx" ON "integrations"("tenantId");
CREATE INDEX IF NOT EXISTS "integrations_type_status_idx" ON "integrations"("type", "status");

CREATE INDEX IF NOT EXISTS "contacts_tenantId_idx" ON "contacts"("tenantId");
CREATE INDEX IF NOT EXISTS "contacts_tenantId_phone_idx" ON "contacts"("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "contacts_tenantId_email_idx" ON "contacts"("tenantId", "email");
CREATE INDEX IF NOT EXISTS "contacts_phone_idx" ON "contacts"("phone");
CREATE INDEX IF NOT EXISTS "contacts_email_idx" ON "contacts"("email");

CREATE UNIQUE INDEX IF NOT EXISTS "leads_tenantId_amocrmId_key" ON "leads"("tenantId", "amocrmId");
CREATE INDEX IF NOT EXISTS "leads_tenantId_idx" ON "leads"("tenantId");
CREATE INDEX IF NOT EXISTS "leads_amocrmId_idx" ON "leads"("amocrmId");
CREATE INDEX IF NOT EXISTS "leads_contactId_idx" ON "leads"("contactId");
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads"("status");
CREATE INDEX IF NOT EXISTS "leads_createdAt_idx" ON "leads"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "calls_tenantId_callIdExternal_key" ON "calls"("tenantId", "callIdExternal");
CREATE INDEX IF NOT EXISTS "calls_tenantId_idx" ON "calls"("tenantId");
CREATE INDEX IF NOT EXISTS "calls_callIdExternal_idx" ON "calls"("callIdExternal");
CREATE INDEX IF NOT EXISTS "calls_from_idx" ON "calls"("from");
CREATE INDEX IF NOT EXISTS "calls_to_idx" ON "calls"("to");
CREATE INDEX IF NOT EXISTS "calls_leadId_idx" ON "calls"("leadId");
CREATE INDEX IF NOT EXISTS "calls_contactId_idx" ON "calls"("contactId");
CREATE INDEX IF NOT EXISTS "calls_startedAt_idx" ON "calls"("startedAt");

CREATE INDEX IF NOT EXISTS "notifications_tenantId_status_idx" ON "notifications"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "notifications_status_nextRetryAt_idx" ON "notifications"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "notifications_createdAt_idx" ON "notifications"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_tenantId_source_idempotencyKey_key" ON "webhook_events"("tenantId", "source", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "webhook_events_tenantId_idx" ON "webhook_events"("tenantId");
CREATE INDEX IF NOT EXISTS "webhook_events_source_processed_idx" ON "webhook_events"("source", "processed");
CREATE INDEX IF NOT EXISTS "webhook_events_source_idempotencyKey_idx" ON "webhook_events"("source", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "webhook_events_createdAt_idx" ON "webhook_events"("createdAt");

CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
