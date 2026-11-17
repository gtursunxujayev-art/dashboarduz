-- Contacts get a unique amoCRM id per tenant, so the amoCRM webhook can upsert instead of find-then-create.
--
-- Data changes:
--   1. New nullable column contacts."amocrmId", filled from externalIds->>'amocrm_id' (the id the webhook stores).
--   2. Contacts of one tenant that carry the same amoCRM id are merged: the most recently updated row is kept,
--      leads."contactId" and calls."contactId" that point at a duplicate are moved to it, the duplicates are deleted.
--      Duplicate rows hold only copies of the amoCRM contact (name, phone, email, payload); nothing else points at
--      contacts.
--   3. Unique index ("tenantId", "amocrmId"). Contacts without an amoCRM id (NULL) are not affected.
--
-- Locks: the UPDATE/DELETE statements lock the touched contacts/leads/calls rows; CREATE UNIQUE INDEX takes a
-- SHARE lock on contacts (writes to contacts wait, reads continue) for the time it takes to build the index.
-- contacts is a small table (one row per amoCRM contact), so this is seconds. Fails loudly (aborts the migration)
-- if a duplicate remains.

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "amocrmId" TEXT;

UPDATE "contacts"
SET "amocrmId" = NULLIF(btrim("externalIds"->>'amocrm_id'), '')
WHERE "amocrmId" IS NULL
  AND jsonb_typeof("externalIds") = 'object';

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY "tenantId", "amocrmId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id
    ) AS keeper_id
  FROM "contacts"
  WHERE "amocrmId" IS NOT NULL
)
UPDATE "leads" AS l
SET "contactId" = r.keeper_id
FROM ranked AS r
WHERE l."contactId" = r.id
  AND r.id <> r.keeper_id;

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY "tenantId", "amocrmId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id
    ) AS keeper_id
  FROM "contacts"
  WHERE "amocrmId" IS NOT NULL
)
UPDATE "calls" AS c
SET "contactId" = r.keeper_id
FROM ranked AS r
WHERE c."contactId" = r.id
  AND r.id <> r.keeper_id;

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY "tenantId", "amocrmId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id
    ) AS keeper_id
  FROM "contacts"
  WHERE "amocrmId" IS NOT NULL
)
DELETE FROM "contacts" AS ct
USING ranked AS r
WHERE ct.id = r.id
  AND r.id <> r.keeper_id;

CREATE UNIQUE INDEX "contacts_tenantId_amocrmId_key" ON "contacts"("tenantId", "amocrmId");
