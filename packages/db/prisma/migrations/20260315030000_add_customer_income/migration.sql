-- Add customers/courses/tariffs/incomes domain for finance flow.

CREATE TABLE IF NOT EXISTS "customers" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "telegramUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "courses" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tariffs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "incomes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "managerUserId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "relatedDebtIncomeId" TEXT,
  "courseId" TEXT,
  "tariffId" TEXT,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "deadline" TIMESTAMP(3),
  "coursePriceAmount" INTEGER,
  "debtAmount" INTEGER,
  "paymentAmount" INTEGER NOT NULL,
  "remainingDebtAmount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "incomes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenantId_customerNumber_key"
  ON "customers"("tenantId", "customerNumber");
CREATE INDEX IF NOT EXISTS "customers_tenantId_idx" ON "customers"("tenantId");
CREATE INDEX IF NOT EXISTS "customers_customerNumber_idx" ON "customers"("customerNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "courses_tenantId_name_key"
  ON "courses"("tenantId", "name");
CREATE INDEX IF NOT EXISTS "courses_tenantId_idx" ON "courses"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "tariffs_tenantId_courseId_name_key"
  ON "tariffs"("tenantId", "courseId", "name");
CREATE INDEX IF NOT EXISTS "tariffs_tenantId_idx" ON "tariffs"("tenantId");
CREATE INDEX IF NOT EXISTS "tariffs_courseId_idx" ON "tariffs"("courseId");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_idx" ON "incomes"("tenantId");
CREATE INDEX IF NOT EXISTS "incomes_customerId_idx" ON "incomes"("customerId");
CREATE INDEX IF NOT EXISTS "incomes_managerUserId_idx" ON "incomes"("managerUserId");
CREATE INDEX IF NOT EXISTS "incomes_type_idx" ON "incomes"("type");
CREATE INDEX IF NOT EXISTS "incomes_entryDate_idx" ON "incomes"("entryDate");
CREATE INDEX IF NOT EXISTS "incomes_remainingDebtAmount_idx" ON "incomes"("remainingDebtAmount");
CREATE INDEX IF NOT EXISTS "incomes_relatedDebtIncomeId_idx" ON "incomes"("relatedDebtIncomeId");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tariffs"
  ADD CONSTRAINT "tariffs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tariffs"
  ADD CONSTRAINT "tariffs_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_managerUserId_fkey"
  FOREIGN KEY ("managerUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_tariffId_fkey"
  FOREIGN KEY ("tariffId") REFERENCES "tariffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_relatedDebtIncomeId_fkey"
  FOREIGN KEY ("relatedDebtIncomeId") REFERENCES "incomes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
