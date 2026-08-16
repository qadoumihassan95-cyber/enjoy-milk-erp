-- =====================================================================
--  ProductionCostAllocation
-- =====================================================================
--  New table for FIFO cost tracking of raw materials consumed during
--  Daily Production. Mirrors SaleCostAllocation exactly but keyed on
--  the DailyProduction record instead of a SimpleOrder.
--
--  Adds nothing to existing tables. Safe to run against production.
--  Additive migration only — no data touched, no columns removed.
-- =====================================================================

CREATE TABLE "ProductionCostAllocation" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "dailyProductionId" TEXT NOT NULL,
    "rawItemId"         TEXT NOT NULL,
    "batchId"           TEXT NOT NULL,
    "quantity"          DECIMAL(18,4) NOT NULL,
    "unitCost"          DECIMAL(18,4) NOT NULL,
    "totalCost"         DECIMAL(18,4) NOT NULL,
    "method"            TEXT NOT NULL DEFAULT 'FIFO',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionCostAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionCostAllocation_tenantId_dailyProductionId_idx"
  ON "ProductionCostAllocation"("tenantId", "dailyProductionId");
CREATE INDEX "ProductionCostAllocation_dailyProductionId_idx"
  ON "ProductionCostAllocation"("dailyProductionId");
CREATE INDEX "ProductionCostAllocation_batchId_idx"
  ON "ProductionCostAllocation"("batchId");
CREATE INDEX "ProductionCostAllocation_rawItemId_idx"
  ON "ProductionCostAllocation"("rawItemId");

ALTER TABLE "ProductionCostAllocation"
  ADD CONSTRAINT "ProductionCostAllocation_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
