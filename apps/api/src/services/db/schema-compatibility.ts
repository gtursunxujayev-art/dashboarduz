import { prisma } from '@dashboarduz/db';
import { log, LogLevel } from '../observability';

let hasRun = false;

const COMPATIBILITY_SQL: string[] = [
  `
  ALTER TABLE "courses"
    ADD COLUMN IF NOT EXISTS "category" TEXT;
  `,
  `
  UPDATE "courses"
  SET "category" = 'offline'
  WHERE "category" IS NULL OR LENGTH(TRIM("category")) = 0;
  `,
  `
  ALTER TABLE "courses"
    ALTER COLUMN "category" SET DEFAULT 'offline';
  `,
  `
  ALTER TABLE "courses"
    ALTER COLUMN "category" SET NOT NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS "courses_category_idx"
    ON "courses" ("category");
  `,
  `
  ALTER TABLE "courses"
    ADD COLUMN IF NOT EXISTS "isHiddenFromIncomeForm" BOOLEAN;
  `,
  `
  UPDATE "courses"
  SET "isHiddenFromIncomeForm" = FALSE
  WHERE "isHiddenFromIncomeForm" IS NULL;
  `,
  `
  ALTER TABLE "courses"
    ALTER COLUMN "isHiddenFromIncomeForm" SET DEFAULT FALSE;
  `,
  `
  ALTER TABLE "courses"
    ALTER COLUMN "isHiddenFromIncomeForm" SET NOT NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS "courses_isHiddenFromIncomeForm_idx"
    ON "courses" ("isHiddenFromIncomeForm");
  `,
  `
  ALTER TABLE "incomes"
    ADD COLUMN IF NOT EXISTS "lifecycleStatus" TEXT;
  `,
  `
  UPDATE "incomes"
  SET "lifecycleStatus" = 'active'
  WHERE "lifecycleStatus" IS NULL OR LENGTH(TRIM("lifecycleStatus")) = 0;
  `,
  `
  ALTER TABLE "incomes"
    ALTER COLUMN "lifecycleStatus" SET DEFAULT 'active';
  `,
  `
  ALTER TABLE "incomes"
    ALTER COLUMN "lifecycleStatus" SET NOT NULL;
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'incomes_lifecycle_status_check'
    ) THEN
      ALTER TABLE "incomes"
        ADD CONSTRAINT "incomes_lifecycle_status_check"
        CHECK ("lifecycleStatus" IN ('active', 'pending_refund', 'refunded'));
    END IF;
  END $$;
  `,
  `
  CREATE INDEX IF NOT EXISTS "incomes_lifecycleStatus_idx"
    ON "incomes" ("lifecycleStatus");
  `,
  `
  CREATE TABLE IF NOT EXISTS "income_adjustment_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "incomeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reason" TEXT,
    "reviewNote" TEXT,
    "requestedAmount" INTEGER,
    "newCourseId" TEXT,
    "newTariffId" TEXT,
    "newAgreementAmount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "income_adjustment_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "income_adjustment_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "income_adjustment_requests_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "incomes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "income_adjustment_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "income_adjustment_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "income_adjustment_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "income_adjustment_requests_newCourseId_fkey" FOREIGN KEY ("newCourseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "income_adjustment_requests_newTariffId_fkey" FOREIGN KEY ("newTariffId") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_tenantId_idx"
    ON "income_adjustment_requests" ("tenantId");
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_status_idx"
    ON "income_adjustment_requests" ("status");
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_type_idx"
    ON "income_adjustment_requests" ("type");
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_incomeId_idx"
    ON "income_adjustment_requests" ("incomeId");
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_customerId_idx"
    ON "income_adjustment_requests" ("customerId");
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_requestedByUserId_idx"
    ON "income_adjustment_requests" ("requestedByUserId");
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_reviewedByUserId_idx"
    ON "income_adjustment_requests" ("reviewedByUserId");
  `,
  `
  CREATE INDEX IF NOT EXISTS "income_adjustment_requests_createdAt_idx"
    ON "income_adjustment_requests" ("createdAt");
  `,
];

export async function ensureSchemaCompatibility(): Promise<void> {
  if (hasRun) {
    return;
  }

  try {
    for (const sql of COMPATIBILITY_SQL) {
      await prisma.$executeRawUnsafe(sql);
    }
    hasRun = true;
    log(LogLevel.INFO, 'Database compatibility bootstrap complete');
  } catch (error: any) {
    log(LogLevel.WARN, 'Database compatibility bootstrap failed', {
      error: error?.message || String(error),
    });
  }
}
