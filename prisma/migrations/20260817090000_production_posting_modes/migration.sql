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
-- WARNING_MODE is the product default for a NEW tenant: a factory that
-- starts on this build has clean opening balances and wants the
-- forgiving behaviour.
ALTER TABLE "TenantSetting"
  ADD COLUMN IF NOT EXISTS "productionPostingMode" TEXT NOT NULL DEFAULT 'WARNING_MODE';

-- ─── 1b. EXISTING tenants stay STRICT until balances are verified ────
-- The column DEFAULT would otherwise apply to rows that already exist,
-- silently flipping a live factory from "block on shortage" to "allow
-- negative stock" the moment this deploy lands. That is a behaviour
-- change nobody asked for at deploy time.
--
-- On enjoymilk today 19 items carry StockLevel with no FIFO batch cover
-- (the opening-stock backfill has not run), so WARNING_MODE would let
-- those post straight into negative balances on the first ترحيل.
--
-- Existing tenants are therefore pinned to STRICT_MODE — identical to
-- today's behaviour — and switch over explicitly via
-- POST /daily-production/settings/posting-mode when opening inventory
-- has been verified.
--
-- No-op on a fresh database: migrations run before the seed, so
-- TenantSetting is still empty here.
UPDATE "TenantSetting"
SET "productionPostingMode" = 'STRICT_MODE'
WHERE "productionPostingMode" = 'WARNING_MODE';

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
