-- Store Meta Ads money and ratio metrics as exact decimals instead of
-- DOUBLE PRECISION, so sums of spend do not pick up float rounding.
--   spend, cpc, cpm: NUMERIC(18,4)  (Meta reports at most 2-4 decimals)
--   ctr:             NUMERIC(12,6)  (percentage with up to 6 decimals)
--
-- Existing data: values are converted with ROUND to the column scale; no row
-- is added or removed. Locking: changing a column type REWRITES the table
-- under an ACCESS EXCLUSIVE lock. meta_ad_insights holds one row per ad per
-- day, so this is expected to take seconds; run it outside the Meta sync
-- window if the table is large (check: SELECT count(*) FROM meta_ad_insights).

ALTER TABLE "meta_ad_insights"
  ALTER COLUMN "spend" DROP DEFAULT,
  ALTER COLUMN "ctr" DROP DEFAULT,
  ALTER COLUMN "cpc" DROP DEFAULT,
  ALTER COLUMN "cpm" DROP DEFAULT;

ALTER TABLE "meta_ad_insights"
  ALTER COLUMN "spend" TYPE DECIMAL(18,4) USING ROUND("spend"::numeric, 4),
  ALTER COLUMN "ctr" TYPE DECIMAL(12,6) USING ROUND("ctr"::numeric, 6),
  ALTER COLUMN "cpc" TYPE DECIMAL(18,4) USING ROUND("cpc"::numeric, 4),
  ALTER COLUMN "cpm" TYPE DECIMAL(18,4) USING ROUND("cpm"::numeric, 4);

ALTER TABLE "meta_ad_insights"
  ALTER COLUMN "spend" SET DEFAULT 0,
  ALTER COLUMN "ctr" SET DEFAULT 0,
  ALTER COLUMN "cpc" SET DEFAULT 0,
  ALTER COLUMN "cpm" SET DEFAULT 0;
