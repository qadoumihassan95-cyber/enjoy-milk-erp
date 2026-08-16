-- =====================================================================
-- Single-Warehouse Consolidation
-- =====================================================================
-- The factory operates from ONE physical warehouse. The seed historically
-- created FIN / BULK / PKG / QHL alongside MAIN, and the production
-- module wrote consumption/production movements into FIN / BULK / PKG
-- while the inventory receive endpoint wrote into MAIN. As a result:
--
--   • Aluminum receives went into MAIN, but daily production tried to
--     decrement from PKG. If PKG had no StockLevel row (or PKG did not
--     exist at all), the decrement was silently dropped and the ledger
--     showed aluminum stock never moving.
--   • Finished cartons produced by daily production went into FIN, but
--     the inventory dashboard's edit modal computes the total across all
--     warehouses and then writes only MAIN, producing "phantom" drift
--     between screens.
--
-- This migration is DATA-PRESERVING:
--   1. Ensures a MAIN warehouse exists for every tenant.
--   2. For every (tenantId, itemId, batchId) triplet, sums the stock
--      that currently lives across ALL warehouses and consolidates it
--      into the MAIN warehouse's StockLevel row.
--   3. Zeros out the non-MAIN StockLevel rows (rows kept for referential
--      integrity — historical StockMovement rows still reference them).
--   4. Historical StockMovement rows are LEFT UNTOUCHED. Their audit
--      trail (fromWarehouseId / toWarehouseId) still points at the
--      original FIN/BULK/PKG warehouses. Reports that group by
--      warehouseId keep working; totals per item are unaffected because
--      Σ StockLevel per item is preserved.
--
-- The migration is idempotent (safe to re-run) and wraps every mutation
-- in a single transaction.
-- =====================================================================

BEGIN;

-- ─── 1. Ensure MAIN warehouse exists per tenant ─────────────────────
-- Warehouse has only `createdAt`, not `updatedAt` (per init migration).
INSERT INTO "Warehouse" (id, "tenantId", code, name, type, active, "createdAt")
SELECT
  gen_random_uuid()::text,
  t.id,
  'MAIN',
  'المخزن الرئيسي',
  'GENERAL',
  true,
  NOW()
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Warehouse" w
  WHERE w."tenantId" = t.id AND w.code = 'MAIN'
);

-- ─── 2. Consolidate StockLevel into MAIN ────────────────────────────
-- We compute totals per (itemId, batchId) across all warehouses, then
-- upsert one row per triplet into MAIN with the summed quantity. The
-- non-MAIN rows are zeroed afterwards so they retain FK integrity but
-- contribute zero to any "sum stock per item" query.

WITH main_wh AS (
  SELECT id AS main_id, "tenantId" AS tenant_id
  FROM "Warehouse"
  WHERE code = 'MAIN'
),
totals AS (
  SELECT
    sl."tenantId"                                            AS tenant_id,
    sl."itemId"                                              AS item_id,
    sl."batchId"                                             AS batch_id,
    SUM(sl.quantity)                                         AS total_qty,
    (SELECT main_id FROM main_wh mw WHERE mw.tenant_id = sl."tenantId") AS main_id
  FROM "StockLevel" sl
  WHERE sl.quantity <> 0
  GROUP BY sl."tenantId", sl."itemId", sl."batchId"
),
-- Rows that already exist in MAIN — update them to the consolidated total.
existing_main_updates AS (
  UPDATE "StockLevel" sl_main
  SET quantity = t.total_qty
  FROM totals t
  WHERE sl_main."warehouseId" = t.main_id
    AND sl_main."itemId"      = t.item_id
    AND (
      (sl_main."batchId" IS NULL AND t.batch_id IS NULL)
      OR sl_main."batchId" = t.batch_id
    )
    AND t.main_id IS NOT NULL
  RETURNING sl_main."itemId", sl_main."batchId", sl_main."tenantId"
)
-- Rows that don't yet exist in MAIN — insert them.
INSERT INTO "StockLevel" (id, "tenantId", "itemId", "warehouseId", "batchId", quantity, "updatedAt")
SELECT
  gen_random_uuid()::text,
  t.tenant_id,
  t.item_id,
  t.main_id,
  t.batch_id,
  t.total_qty,
  NOW()
FROM totals t
WHERE t.main_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "StockLevel" sl2
    WHERE sl2."warehouseId" = t.main_id
      AND sl2."itemId"      = t.item_id
      AND (
        (sl2."batchId" IS NULL AND t.batch_id IS NULL)
        OR sl2."batchId" = t.batch_id
      )
  );

-- ─── 3. Zero-out non-MAIN StockLevel rows ───────────────────────────
-- Keep rows for FK/history; drive their quantity to 0 so they never
-- contribute to a "sum across warehouses" query but the underlying
-- StockMovement audit trail (which may reference these warehouseIds)
-- stays intact.
UPDATE "StockLevel" sl
SET quantity = 0
FROM "Warehouse" w
WHERE w.id = sl."warehouseId"
  AND w.code <> 'MAIN';

-- ─── 4. Deactivate non-MAIN warehouses per tenant ───────────────────
-- Marks BULK / PKG / FIN / QHL and any other historical warehouse as
-- inactive so /inventory/warehouses lists only MAIN in the UI. We
-- deliberately do NOT delete the rows — historical StockMovement /
-- StockLevel rows continue to reference them.
UPDATE "Warehouse"
SET active = false
WHERE code <> 'MAIN';

COMMIT;
