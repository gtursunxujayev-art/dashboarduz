-- Make the meta_ad_insights natural key null-safe.
--
-- The unique key (tenantId, date, accountId, campaignId, adSetId, adId) never
-- matched rows where campaignId/adSetId/adId were NULL (NULLs are distinct in
-- Postgres unique indexes), so repeated syncs could insert duplicates.
-- Instead of NULLS NOT DISTINCT (Postgres 15+ only, and not expressible in
-- Prisma 5) the three columns become NOT NULL DEFAULT '', which works on every
-- Postgres version Neon and Railway offer and lets the code upsert on the key.
--
-- Existing data:
--   1. Rows that are duplicates once NULL is treated as '' are removed, keeping
--      the most recently updated row of each group (ties: highest id). The
--      newest row holds the latest metrics Meta returned for that day.
--      Preview: SELECT count(*) - count(DISTINCT ("tenantId", "date", "accountId",
--        COALESCE("campaignId", ''), COALESCE("adSetId", ''), COALESCE("adId", '')))
--        FROM meta_ad_insights;
--   2. Remaining NULLs become ''. Readers map '' back to "not set".
-- Locking: SET NOT NULL scans the table under an exclusive lock (no rewrite);
-- the table holds one row per ad per day, so this is short.

DELETE FROM "meta_ad_insights" m
USING (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "tenantId", "date", "accountId",
                        COALESCE("campaignId", ''), COALESCE("adSetId", ''), COALESCE("adId", '')
           ORDER BY "updatedAt" DESC, "id" DESC
         ) AS rn
  FROM "meta_ad_insights"
) ranked
WHERE m."id" = ranked."id" AND ranked.rn > 1;

UPDATE "meta_ad_insights" SET "campaignId" = '' WHERE "campaignId" IS NULL;
UPDATE "meta_ad_insights" SET "adSetId" = '' WHERE "adSetId" IS NULL;
UPDATE "meta_ad_insights" SET "adId" = '' WHERE "adId" IS NULL;

ALTER TABLE "meta_ad_insights"
  ALTER COLUMN "campaignId" SET DEFAULT '',
  ALTER COLUMN "campaignId" SET NOT NULL,
  ALTER COLUMN "adSetId" SET DEFAULT '',
  ALTER COLUMN "adSetId" SET NOT NULL,
  ALTER COLUMN "adId" SET DEFAULT '',
  ALTER COLUMN "adId" SET NOT NULL;

-- Replace the old key (its generated name was truncated to 63 characters).
DROP INDEX IF EXISTS "meta_ad_insights_tenantId_date_accountId_campaignId_adSetId_adI";
DROP INDEX IF EXISTS "meta_ad_insights_tenantId_date_accountId_campaignId_adSetId_adId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_insights_tenant_date_account_campaign_adset_ad_key"
  ON "meta_ad_insights" ("tenantId", "date", "accountId", "campaignId", "adSetId", "adId");
