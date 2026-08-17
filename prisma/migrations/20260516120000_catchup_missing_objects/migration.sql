-- =====================================================================
--  CATCH-UP MIGRATION — objects that exist in production and in
--  schema.prisma but were never created by any migration.
-- =====================================================================
--
--  WHY THIS EXISTS
--  ---------------
--  The production database was originally provisioned with
--  `prisma db push --accept-data-loss`. db push applies the schema
--  directly and writes NOTHING to _prisma_migrations, so the migration
--  chain silently stopped being the source of truth while production
--  kept working.
--
--  Verified 2026-08-17 by applying every migration in order to an empty
--  PostgreSQL 16 database:
--
--      OK    20260510233312_init
--      OK    20260516110854_daily_production_and_simple_orders
--      FAIL  20260723170000_drop_pallets_count
--            line 18: relation "ProductionProducedItem" does not exist
--
--  33 of production's 56 tables were built before the chain aborted.
--  21 models in schema.prisma have no CREATE TABLE anywhere, and two
--  enums (TelegramRole, TelegramStatus) are likewise missing. Meanwhile
--  three tables the chain DOES create were dropped from production by a
--  later db push and no longer appear in schema.prisma.
--
--  This migration closes both gaps so the chain reproduces production.
--
--  WHY IT IS SAFE FOR THE EXISTING PRODUCTION DATABASE
--  ---------------------------------------------------
--  Every statement is idempotent and additive:
--
--    CREATE TYPE      wrapped in a DO block that swallows duplicate_object
--    CREATE TABLE     IF NOT EXISTS
--    CREATE INDEX     IF NOT EXISTS
--    ADD CONSTRAINT   guarded by a pg_constraint existence check
--    DROP TABLE       IF EXISTS, and only for tables production does not have
--    DROP TYPE        IF EXISTS, and only for a type production does not have
--
--  On production every object in sections 1-4 already exists, so those
--  statements do nothing. Every object in section 5 is already absent,
--  so those do nothing either. The migration is a complete no-op there:
--  no table is created, no row is read, written, or deleted, and no
--  column changes type. Its only effect on production is one new row in
--  _prisma_migrations recording that it ran.
--
--  On an empty database it creates exactly the objects the chain was
--  missing, and the chain then completes.
--
--  It is placed at 20260516120000 - after the daily-production migration
--  that needs to precede it, before drop_pallets_count which is where
--  the chain currently fails. On production it therefore applies
--  out-of-order relative to already-recorded migrations; `migrate deploy`
--  applies pending migrations by name and does not object, and because
--  the content is a no-op the ordering has no effect on the result.
--
--  NO EXISTING MIGRATION FILE IS MODIFIED. Editing one would change its
--  checksum and `migrate deploy` would refuse to run against production.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Enums the chain never created
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "TelegramRole" AS ENUM ('ADMIN', 'MANAGER', 'EMPLOYEE', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TelegramStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'DISABLED', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Tables the chain never created (21)
--    Column definitions are taken from the live production schema, so a
--    fresh database is built to match production exactly rather than to
--    someone's recollection of it.
-- ─────────────────────────────────────────────────────────────────────

-- ── Inventory / costing ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PurchaseBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNumber" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" DECIMAL(18,4) NOT NULL,
    "remaining" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "sourceType" TEXT,
    "sourceRefId" TEXT,
    "supplierId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SaleCostAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "saleLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "totalCost" DECIMAL(18,4) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'FIFO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleCostAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4),
    "supplierId" TEXT,
    "invoiceNumber" TEXT,
    "purchaseOrderNumber" TEXT,
    "batchNumber" TEXT,
    "serialNumber" TEXT,
    "productionDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "quantityBefore" DECIMAL(18,4),
    "quantityAfter" DECIMAL(18,4),
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "imageUrl" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "performedById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockTransfer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryCount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryCountLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "expectedQty" DECIMAL(18,4) NOT NULL,
    "actualQty" DECIMAL(18,4),
    "variance" DECIMAL(18,4),
    "notes" TEXT,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),
    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

-- ── Daily production child tables ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ProductionProducedItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dailyProductionId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "cartonsTotal" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" TEXT,
    "notes" TEXT,
    "machineNumber" INTEGER,
    CONSTRAINT "ProductionProducedItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductionCartonUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dailyProductionId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "warehouseId" TEXT,
    CONSTRAINT "ProductionCartonUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductionAluminumUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dailyProductionId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "warehouseId" TEXT,
    CONSTRAINT "ProductionAluminumUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductionMilkUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dailyProductionId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'L',
    "warehouseId" TEXT,
    CONSTRAINT "ProductionMilkUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductionMachine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionMachine_pkey" PRIMARY KEY ("id")
);

-- ── Sales ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SimpleOrderPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountInBase" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    CONSTRAINT "SimpleOrderPayment_pkey" PRIMARY KEY ("id")
);

-- ── HR / payroll ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmployeeAdvance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "installmentAmount" DECIMAL(18,3) NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "paidAmount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "startMonth" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeAdvance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdvanceInstallment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdvanceInstallment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "bonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overrideNet" DECIMAL(18,2),
    "notes" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "cashboxId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "employeeSSOverride" DECIMAL(18,3),
    "extraDeductions" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "overrideReason" TEXT,
    "overtimeAmount" DECIMAL(18,3),
    "transportOverride" DECIMAL(18,3),
    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileData" TEXT,
    "fileUrl" TEXT,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- ── Tenant settings ──────────────────────────────────────────────────
-- NOTE: productionPostingMode is intentionally NOT created here. The
-- later migration 20260817090000_production_posting_modes adds it with
-- ADD COLUMN IF NOT EXISTS and then pins existing tenants to
-- STRICT_MODE. Creating it here would be harmless on a fresh database
-- but would change nothing on production, so it is left where it
-- belongs - with the migration that owns that behaviour.
CREATE TABLE IF NOT EXISTS "TenantSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "costingMethod" TEXT NOT NULL DEFAULT 'FIFO',
    "costingCurrency" TEXT NOT NULL DEFAULT 'JOD',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "baseCurrency" TEXT NOT NULL DEFAULT 'JOD',
    "companySSRate" DECIMAL(6,4) NOT NULL DEFAULT 0.1425,
    "employeeSSRate" DECIMAL(6,4) NOT NULL DEFAULT 0.075,
    "socialSecurityBasis" TEXT NOT NULL DEFAULT 'BASIC',
    CONSTRAINT "TenantSetting_pkey" PRIMARY KEY ("id")
);

-- ── Telegram integration ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TelegramAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "chatId" TEXT,
    "username" TEXT,
    "botUsername" TEXT,
    "phone" TEXT,
    "accountType" TEXT NOT NULL DEFAULT 'BOT',
    "role" "TelegramRole" NOT NULL DEFAULT 'VIEWER',
    "status" "TelegramStatus" NOT NULL DEFAULT 'PENDING',
    "webhookSecret" TEXT NOT NULL,
    "webhookSet" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastActivityAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TelegramLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT,
    "direction" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT,
    "chatId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramLog_pkey" PRIMARY KEY ("id")
);


-- ─────────────────────────────────────────────────────────────────────
-- 3. Indexes and unique constraints
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "PurchaseBatch_tenantId_itemId_purchaseDate_idx" ON "PurchaseBatch"("tenantId", "itemId", "purchaseDate");
CREATE INDEX IF NOT EXISTS "PurchaseBatch_itemId_remaining_idx" ON "PurchaseBatch"("itemId", "remaining");
CREATE INDEX IF NOT EXISTS "PurchaseBatch_sourceType_sourceRefId_idx" ON "PurchaseBatch"("sourceType", "sourceRefId");

CREATE INDEX IF NOT EXISTS "SaleCostAllocation_tenantId_saleOrderId_idx" ON "SaleCostAllocation"("tenantId", "saleOrderId");
CREATE INDEX IF NOT EXISTS "SaleCostAllocation_saleOrderId_idx" ON "SaleCostAllocation"("saleOrderId");
CREATE INDEX IF NOT EXISTS "SaleCostAllocation_saleLineId_idx" ON "SaleCostAllocation"("saleLineId");
CREATE INDEX IF NOT EXISTS "SaleCostAllocation_itemId_idx" ON "SaleCostAllocation"("itemId");
CREATE INDEX IF NOT EXISTS "SaleCostAllocation_batchId_idx" ON "SaleCostAllocation"("batchId");

CREATE INDEX IF NOT EXISTS "Supplier_tenantId_active_idx" ON "Supplier"("tenantId", "active");

CREATE INDEX IF NOT EXISTS "StockReceipt_tenantId_createdAt_idx" ON "StockReceipt"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockReceipt_itemId_createdAt_idx" ON "StockReceipt"("itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockReceipt_supplierId_idx" ON "StockReceipt"("supplierId");

CREATE INDEX IF NOT EXISTS "StockAdjustment_tenantId_createdAt_idx" ON "StockAdjustment"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockAdjustment_itemId_createdAt_idx" ON "StockAdjustment"("itemId", "createdAt");

CREATE INDEX IF NOT EXISTS "StockTransfer_tenantId_status_idx" ON "StockTransfer"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "StockTransfer_tenantId_createdAt_idx" ON "StockTransfer"("tenantId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_tenantId_number_key" ON "StockTransfer"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "InventoryCount_tenantId_status_idx" ON "InventoryCount"("tenantId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCount_tenantId_number_key" ON "InventoryCount"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "InventoryCountLine_countId_idx" ON "InventoryCountLine"("countId");
CREATE INDEX IF NOT EXISTS "InventoryCountLine_itemId_idx" ON "InventoryCountLine"("itemId");

CREATE INDEX IF NOT EXISTS "ProductionProducedItem_dailyProductionId_idx" ON "ProductionProducedItem"("dailyProductionId");
CREATE INDEX IF NOT EXISTS "ProductionProducedItem_tenantId_itemId_idx" ON "ProductionProducedItem"("tenantId", "itemId");
CREATE INDEX IF NOT EXISTS "ProductionProducedItem_tenantId_machineNumber_idx" ON "ProductionProducedItem"("tenantId", "machineNumber");

CREATE INDEX IF NOT EXISTS "ProductionCartonUsage_dailyProductionId_idx" ON "ProductionCartonUsage"("dailyProductionId");
CREATE INDEX IF NOT EXISTS "ProductionCartonUsage_tenantId_itemId_idx" ON "ProductionCartonUsage"("tenantId", "itemId");

CREATE INDEX IF NOT EXISTS "ProductionAluminumUsage_dailyProductionId_idx" ON "ProductionAluminumUsage"("dailyProductionId");
CREATE INDEX IF NOT EXISTS "ProductionAluminumUsage_tenantId_itemId_idx" ON "ProductionAluminumUsage"("tenantId", "itemId");

CREATE INDEX IF NOT EXISTS "ProductionMilkUsage_dailyProductionId_idx" ON "ProductionMilkUsage"("dailyProductionId");
CREATE INDEX IF NOT EXISTS "ProductionMilkUsage_tenantId_itemId_idx" ON "ProductionMilkUsage"("tenantId", "itemId");

CREATE INDEX IF NOT EXISTS "ProductionMachine_tenantId_active_idx" ON "ProductionMachine"("tenantId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionMachine_tenantId_number_key" ON "ProductionMachine"("tenantId", "number");

CREATE INDEX IF NOT EXISTS "SimpleOrderPayment_orderId_createdAt_idx" ON "SimpleOrderPayment"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "SimpleOrderPayment_tenantId_createdAt_idx" ON "SimpleOrderPayment"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "EmployeeAdvance_tenantId_employeeId_idx" ON "EmployeeAdvance"("tenantId", "employeeId");
CREATE INDEX IF NOT EXISTS "EmployeeAdvance_tenantId_status_idx" ON "EmployeeAdvance"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "AdvanceInstallment_tenantId_month_idx" ON "AdvanceInstallment"("tenantId", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "AdvanceInstallment_advanceId_month_key" ON "AdvanceInstallment"("advanceId", "month");

CREATE INDEX IF NOT EXISTS "PayrollAdjustment_tenantId_month_idx" ON "PayrollAdjustment"("tenantId", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollAdjustment_tenantId_employeeId_month_key" ON "PayrollAdjustment"("tenantId", "employeeId", "month");

CREATE INDEX IF NOT EXISTS "EmployeeDocument_tenantId_employeeId_idx" ON "EmployeeDocument"("tenantId", "employeeId");
CREATE INDEX IF NOT EXISTS "EmployeeDocument_employeeId_docType_idx" ON "EmployeeDocument"("employeeId", "docType");

CREATE UNIQUE INDEX IF NOT EXISTS "TenantSetting_tenantId_key" ON "TenantSetting"("tenantId");

CREATE INDEX IF NOT EXISTS "TelegramAccount_tenantId_active_idx" ON "TelegramAccount"("tenantId", "active");

CREATE INDEX IF NOT EXISTS "TelegramLog_tenantId_createdAt_idx" ON "TelegramLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "TelegramLog_accountId_createdAt_idx" ON "TelegramLog"("accountId", "createdAt");


-- ─────────────────────────────────────────────────────────────────────
-- 4. Foreign keys
--    PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so each is guarded
--    by a catalogue lookup. On production every one already exists and
--    the block does nothing.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('SaleCostAllocation',      'SaleCostAllocation_batchId_fkey',              'FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('StockReceipt',            'StockReceipt_itemId_fkey',                     'FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('StockReceipt',            'StockReceipt_supplierId_fkey',                 'FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON UPDATE CASCADE ON DELETE SET NULL'),
      ('StockAdjustment',         'StockAdjustment_itemId_fkey',                  'FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('InventoryCountLine',      'InventoryCountLine_countId_fkey',              'FOREIGN KEY ("countId") REFERENCES "InventoryCount"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('ProductionProducedItem',  'ProductionProducedItem_dailyProductionId_fkey','FOREIGN KEY ("dailyProductionId") REFERENCES "DailyProduction"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('ProductionCartonUsage',   'ProductionCartonUsage_dailyProductionId_fkey', 'FOREIGN KEY ("dailyProductionId") REFERENCES "DailyProduction"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('ProductionAluminumUsage', 'ProductionAluminumUsage_dailyProductionId_fkey','FOREIGN KEY ("dailyProductionId") REFERENCES "DailyProduction"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('ProductionMilkUsage',     'ProductionMilkUsage_dailyProductionId_fkey',   'FOREIGN KEY ("dailyProductionId") REFERENCES "DailyProduction"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('SimpleOrderPayment',      'SimpleOrderPayment_orderId_fkey',              'FOREIGN KEY ("orderId") REFERENCES "SimpleOrder"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('EmployeeAdvance',         'EmployeeAdvance_employeeId_fkey',              'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('AdvanceInstallment',      'AdvanceInstallment_advanceId_fkey',            'FOREIGN KEY ("advanceId") REFERENCES "EmployeeAdvance"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('EmployeeDocument',        'EmployeeDocument_employeeId_fkey',             'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON UPDATE CASCADE ON DELETE CASCADE'),
      ('TelegramLog',             'TelegramLog_accountId_fkey',                   'FOREIGN KEY ("accountId") REFERENCES "TelegramAccount"("id") ON UPDATE CASCADE ON DELETE SET NULL')
    ) AS v(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tbl, fk.name, fk.def);
    END IF;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 5. Objects the chain creates that production does NOT have
--
--    These three tables were created by
--    20260516110854_daily_production_and_simple_orders and later removed
--    from production by a db push. They are absent from schema.prisma
--    and no code references them. The FatProfile enum and Item.fatProfile
--    column went the same way.
--
--    Dropping them here is what makes a freshly-migrated database match
--    production. On production all five statements are no-ops because
--    the objects are already gone.
--
--    The existing migration that created them is deliberately NOT edited
--    - that would change its checksum and break production deploys.
-- ─────────────────────────────────────────────────────────────────────
-- ProductionWaste.entryId was the FK into MachineProductionEntry. The
-- column is gone from production and from schema.prisma; dropping it
-- also removes the constraint that would otherwise block the DROP TABLE
-- below. Done explicitly rather than with DROP ... CASCADE so the blast
-- radius is written down instead of inferred at runtime.
ALTER TABLE "ProductionWaste" DROP COLUMN IF EXISTS "entryId";

DROP TABLE IF EXISTS "ProductionRawUsage";
DROP TABLE IF EXISTS "ProductionOutput";
DROP TABLE IF EXISTS "MachineProductionEntry";

ALTER TABLE "Item" DROP COLUMN IF EXISTS "fatProfile";
DROP TYPE IF EXISTS "FatProfile";


-- ─────────────────────────────────────────────────────────────────────
-- 6. Columns added to existing tables by db push, never by a migration
--
--    Nine tables the chain DOES create had columns bolted on over time
--    with db push. Item is the worst: the chain builds 17 columns,
--    production has 34.
--
--    Every column production has is listed, not just the missing ones.
--    ADD COLUMN IF NOT EXISTS makes the already-present ones no-ops, and
--    listing them all means this section is a complete, checkable
--    statement of what these tables must look like rather than a diff
--    that only makes sense against one particular starting point.
--
--    On production: all no-ops. On a fresh database the tables are empty,
--    so NOT NULL without a default is safe here.
-- ─────────────────────────────────────────────────────────────────────

-- ── AuditLog ────────────────────────────────────────────────────────
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "after" JSONB;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "before" JSONB;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "path" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "resourceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "status" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

-- ── DailyProduction ─────────────────────────────────────────────────
ALTER TABLE "DailyProduction" ADD COLUMN IF NOT EXISTS "machineNumber" INTEGER;
ALTER TABLE "DailyProduction" ADD COLUMN IF NOT EXISTS "operatorId" TEXT;
ALTER TABLE "DailyProduction" ADD COLUMN IF NOT EXISTS "postedAt" TIMESTAMP(3);
ALTER TABLE "DailyProduction" ADD COLUMN IF NOT EXISTS "postedById" TEXT;

-- ── Employee ────────────────────────────────────────────────────────
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "nationalId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "transportAllowance" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- ── Expense ─────────────────────────────────────────────────────────
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "amountInBase" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'JOD';
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- ── Item ────────────────────────────────────────────────────────────
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "avgCost" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "bagWeightKg" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "costPrice" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "defaultSupplierId" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "gramsPerUnit" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "lastPurchaseAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "lastPurchasePrice" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "lastSaleAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "leadTimeDays" INTEGER;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "maxStock" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "minStock" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "nameEn" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "packsPerCarton" INTEGER;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "productionReorderLevel" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "reorderLevel" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "reorderQty" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "safetyStock" DECIMAL(18,4);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "sellPrice" DECIMAL(18,2);

-- ── License ─────────────────────────────────────────────────────────
ALTER TABLE "License" ADD COLUMN IF NOT EXISTS "attachmentName" TEXT;
ALTER TABLE "License" ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT;
ALTER TABLE "License" ADD COLUMN IF NOT EXISTS "issuingAuthority" TEXT;
ALTER TABLE "License" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "License" ADD COLUMN IF NOT EXISTS "renewalReminderDays" INTEGER;

-- ── ProductionWaste ─────────────────────────────────────────────────
ALTER TABLE "ProductionWaste" ADD COLUMN IF NOT EXISTS "dailyProductionId" TEXT NOT NULL;
ALTER TABLE "ProductionWaste" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

-- ── SimpleOrder ─────────────────────────────────────────────────────
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "amountInBase" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "contractNumber" TEXT;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'JOD';
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "deliveryLocation" TEXT;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "expectedArrivalDate" TIMESTAMP(3);
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "expectedShippingDate" TIMESTAMP(3);
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "orderType" TEXT NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "productsTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "shipmentTrackingNumber" TEXT;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "shippingCost" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "SimpleOrder" ADD COLUMN IF NOT EXISTS "tonPrice" DECIMAL(18,2);

-- ── SimpleOrderLine ─────────────────────────────────────────────────
ALTER TABLE "SimpleOrderLine" ADD COLUMN IF NOT EXISTS "size" TEXT;
ALTER TABLE "SimpleOrderLine" ADD COLUMN IF NOT EXISTS "tonPrice" DECIMAL(18,2);

-- ── Final reconciliation, found by diffing a freshly-migrated database
--    against the live production schema column by column.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE "Item"            ADD COLUMN IF NOT EXISTS "reorderPoint" DECIMAL(18,4);
ALTER TABLE "License"         ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "SimpleOrderLine" ADD COLUMN IF NOT EXISTS "unit" TEXT;

-- ProductionWaste: the chain's version carries `notes` and `wasteType`
-- and lacks `itemName`. Production is the opposite. Neither dropped
-- column appears in schema.prisma or in any query in the codebase.
ALTER TABLE "ProductionWaste" ADD COLUMN IF NOT EXISTS "itemName" TEXT NOT NULL;
ALTER TABLE "ProductionWaste" DROP COLUMN IF EXISTS "notes";
ALTER TABLE "ProductionWaste" DROP COLUMN IF EXISTS "wasteType";

-- ── Indexes on chain-created tables that only db push ever added ─────
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_actorUserId_occurredAt_idx" ON "AuditLog"("tenantId", "actorUserId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ProductionWaste_dailyProductionId_idx" ON "ProductionWaste"("dailyProductionId");
CREATE INDEX IF NOT EXISTS "ProductionWaste_tenantId_itemId_idx" ON "ProductionWaste"("tenantId", "itemId");
CREATE INDEX IF NOT EXISTS "SimpleOrder_tenantId_orderType_idx" ON "SimpleOrder"("tenantId", "orderType");

-- ProductionWaste.dailyProductionId lost its FK when db push replaced
-- the entryId relation. Re-added under the same guard as section 4.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductionWaste_dailyProductionId_fkey') THEN
    ALTER TABLE "ProductionWaste"
      ADD CONSTRAINT "ProductionWaste_dailyProductionId_fkey"
      FOREIGN KEY ("dailyProductionId") REFERENCES "DailyProduction"("id")
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;
