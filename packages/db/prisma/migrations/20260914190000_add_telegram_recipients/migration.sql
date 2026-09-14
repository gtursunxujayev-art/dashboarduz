CREATE TABLE "telegram_recipients" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "displayName" TEXT NOT NULL,
  "started" BOOLEAN NOT NULL DEFAULT false,
  "selectedForReports" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "lastUpdateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_recipients_integrationId_chatId_key"
  ON "telegram_recipients"("integrationId", "chatId");
CREATE INDEX "telegram_recipients_tenantId_idx" ON "telegram_recipients"("tenantId");
CREATE INDEX "telegram_recipients_tenantId_started_idx" ON "telegram_recipients"("tenantId", "started");
CREATE INDEX "telegram_recipients_tenantId_selectedForReports_idx"
  ON "telegram_recipients"("tenantId", "selectedForReports");

ALTER TABLE "telegram_recipients"
  ADD CONSTRAINT "telegram_recipients_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_recipients"
  ADD CONSTRAINT "telegram_recipients_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "telegram_recipients" (
  "id", "tenantId", "integrationId", "chatId", "username", "firstName", "lastName",
  "displayName", "started", "selectedForReports", "startedAt", "lastSeenAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  integration."tenantId",
  integration."id",
  recipient.item->>'chatId',
  NULLIF(BTRIM(recipient.item->>'username'), ''),
  NULLIF(BTRIM(recipient.item->>'firstName'), ''),
  NULLIF(BTRIM(recipient.item->>'lastName'), ''),
  COALESCE(
    NULLIF(BTRIM(recipient.item->>'displayName'), ''),
    NULLIF(BTRIM(CONCAT_WS(' ', recipient.item->>'firstName', recipient.item->>'lastName')), ''),
    CASE WHEN NULLIF(BTRIM(recipient.item->>'username'), '') IS NOT NULL
      THEN '@' || BTRIM(recipient.item->>'username')
      ELSE recipient.item->>'chatId'
    END
  ),
  COALESCE((recipient.item->>'started')::boolean, true),
  COALESCE((recipient.item->>'selectedForReports')::boolean, false),
  CASE WHEN recipient.item->>'startedAt' ~ '^\d{4}-\d{2}-\d{2}T'
    THEN (recipient.item->>'startedAt')::timestamptz ELSE NULL END,
  CASE WHEN recipient.item->>'lastSeenAt' ~ '^\d{4}-\d{2}-\d{2}T'
    THEN (recipient.item->>'lastSeenAt')::timestamptz ELSE NULL END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "integrations" integration
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(integration."config"::jsonb->'telegramReportRecipients') = 'array'
      THEN integration."config"::jsonb->'telegramReportRecipients'
    ELSE '[]'::jsonb
  END
) AS recipient(item)
WHERE integration."type" = 'telegram'
  AND NULLIF(BTRIM(recipient.item->>'chatId'), '') IS NOT NULL
ON CONFLICT ("integrationId", "chatId") DO NOTHING;

ALTER TABLE "telegram_recipients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY telegram_recipients_isolation_policy ON "telegram_recipients"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
