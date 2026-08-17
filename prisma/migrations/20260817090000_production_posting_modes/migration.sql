-- =====================================================================
--  Production posting modes + production stock audit
-- =====================================================================
--  Purely additive. One new column with a default, one new table.
--  No existing row is rewritten and no column is dropped, so this is
--  safe to apply to the live database while the factory is working.
--
--  WHY
--  ---
--  A raw-material shortage used to abort the whole posting with a 400,
--  which in a real factory is the wrong default: the material was
--  physically consumed, and the inventory correction lands later. The
--  posting behaviour is now a tenant setting:
--
--    STRICT_MODE   block the posting (the old behaviour)
--    WARNING_MODE  allow it, drive the balance negative, record a
--                  warning + audit row  (DEFAULT)
--    OVERRIDE_MODE allow it for OWNER / ADMIN / MANAGER only
-- =====================================================================

-- ─── 1. Posting mode on the tenant settings row ─────────────────────
-- DEFAULT applies to existing rows immediately, so every tenant starts
-- in WARNING_MODE without a data migration.
ALTER TABLE "TenantSetting"
  ADD COLUMN IF NOT EXISTS "productionPostingMode" TEXT NOT NULL DEFAULT 'WARNING_MODE';

-- ─── 2. Per-item audit of what a posting did to the balance ─────────
CREATE TABLE IF NOT EXISTS "ProductionStockAudit" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "dailyProductionId" TEXT NOT NULL,
    "itemId"            TEXT NOT NULL,
    "itemName"          TEXT NOT NULL,
    "section"           TEXT NOT NULL,
    "quantityRequested" DECIMAL(18,4) NOT NULL,
    "previousStock"     DECIMAL(18,4) NOT NULL,
    "resultingStock"    DECIMAL(18,4) NOT NULL,
    "shortageQuantity"  DECIMAL(18,4) NOT NULL DEFAULT 0,
    "warningType"       TEXT,
    "postingMode"       TEXT NOT NULL,
    "reason"            TEXT,
    "postedById"        TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionStockAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductionStockAudit_tenantId_dailyProductionId_idx"
  ON "ProductionStockAudit"("tenantId", "dailyProductionId");
CREATE INDEX IF NOT EXISTS "ProductionStockAudit_tenantId_warningType_createdAt_idx"
  ON "ProductionStockAudit"("tenantId", "warningType", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductionStockAudit_itemId_idx"
  ON "ProductionStockAudit"("itemId");
