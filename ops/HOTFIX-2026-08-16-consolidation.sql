-- =====================================================================
--  HOTFIX 2026-08-16 — apply the missing single-warehouse consolidation
-- =====================================================================
--  WHY
--  ---
--  Commit c5fea7c is live on Render, but the DATA migration
--  20260814170000_single_warehouse_consolidation never ran against the
--  live database. The container start command uses `prisma db push`,
--  which syncs SCHEMA only — it created the ProductionCostAllocation
--  table (DDL, already present) but executed none of the data steps.
--
--  Live evidence before this script:
--    • No warehouse with code='MAIN' exists.
--    • BULK / FIN / PKG are all still active and hold all the stock
--      (BULK 19 rows, FIN 7 rows, PKG 3 rows).
--    • 7 items have their balance split across 2-3 warehouses.
--
--  The new code calls resolveMainWarehouse(), which falls back to the
--  OLDEST ACTIVE warehouse when MAIN is missing — that is BULK
--  (created 6 ms before PKG). So every write went to BULK while the
--  UI kept summing across all warehouses. That single fact produced
--  all three reported symptoms.
--
--  HOW TO RUN
--  ----------
--  Render Dashboard → enjoymilk-db → Connect → PSQL / Query console.
--  Paste and run SECTION 1 first, keep the output, then SECTION 2,
--  then SECTION 3.
--
--  SECTION 2 is idempotent and data-preserving: it never deletes a
--  StockLevel or StockMovement row, and Σ(quantity) per item is
--  identical before and after.
--
--  TAKE A BACKUP FIRST: Render Dashboard → enjoymilk-db → Recovery →
--  "Download backup" (or note the point-in-time recovery timestamp).
-- =====================================================================


-- =====================================================================
-- SECTION 1 — BEFORE snapshot (READ-ONLY, run and keep the output)
-- =====================================================================

SELECT 'MAIN exists' AS check,
       COALESCE((SELECT code FROM "Warehouse" WHERE code = 'MAIN' LIMIT 1), 'MISSING') AS value
UNION ALL
SELECT 'ProductionCostAllocation',
       COALESCE(to_regclass('public."ProductionCostAllocation"')::text, 'MISSING')
UNION ALL
SELECT 'active warehouses',
       (SELECT string_agg(code, ',' ORDER BY code) FROM "Warehouse" WHERE active)
UNION ALL
SELECT 'non-zero StockLevel rows',
       (SELECT COUNT(*)::text FROM "StockLevel" WHERE quantity <> 0)
UNION ALL
SELECT 'sheets stuck in POSTING',
       (SELECT COUNT(*)::text FROM "DailyProduction" WHERE status = 'POSTING');

-- Per-item totals BEFORE. Re-run the identical query after SECTION 2:
-- every total_qty MUST be unchanged. This is the correctness proof.
SELECT i.sku, i.name, SUM(sl.quantity) AS total_qty
FROM "StockLevel" sl
JOIN "Item" i ON i.id = sl."itemId"
WHERE sl.quantity <> 0
GROUP BY i.sku, i.name
ORDER BY i.sku;


-- =====================================================================
-- SECTION 2 — the consolidation (WRITES — single transaction)
--   Body is 20260814170000_single_warehouse_consolidation verbatim,
--   verified against the live schema on 2026-08-16:
--     · "Warehouse" has createdAt but NO updatedAt        → INSERT matches
--     · "StockLevel".updatedAt is NOT NULL with no default → INSERT supplies NOW()
--     · unique index (itemId, warehouseId, batchId)        → NOT EXISTS guard is correct
-- =====================================================================

BEGIN;

-- 1. Ensure a MAIN warehouse exists per tenant.
INSERT INTO "Warehouse" (id, "tenantId", code, name, type, active, "createdAt")
SELECT gen_random_uuid()::text, t.id, 'MAIN', 'المخزن الرئيسي', 'GENERAL', true, NOW()
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Warehouse" w WHERE w."tenantId" = t.id AND w.code = 'MAIN'
);

-- 2. Consolidate every (tenant, item, batch) balance into MAIN.
WITH main_wh AS (
  SELECT id AS main_id, "tenantId" AS tenant_id FROM "Warehouse" WHERE code = 'MAIN'
),
totals AS (
  SELECT sl."tenantId" AS tenant_id,
         sl."itemId"   AS item_id,
         sl."batchId"  AS batch_id,
         SUM(sl.quantity) AS total_qty,
         (SELECT main_id FROM main_wh mw WHERE mw.tenant_id = sl."tenantId") AS main_id
  FROM "StockLevel" sl
  WHERE sl.quantity <> 0
  GROUP BY sl."tenantId", sl."itemId", sl."batchId"
),
existing_main_updates AS (
  UPDATE "StockLevel" sl_main
  SET quantity = t.total_qty
  FROM totals t
  WHERE sl_main."warehouseId" = t.main_id
    AND sl_main."itemId"      = t.item_id
    AND ((sl_main."batchId" IS NULL AND t.batch_id IS NULL) OR sl_main."batchId" = t.batch_id)
    AND t.main_id IS NOT NULL
  RETURNING sl_main."itemId", sl_main."batchId", sl_main."tenantId"
)
INSERT INTO "StockLevel" (id, "tenantId", "itemId", "warehouseId", "batchId", quantity, "updatedAt")
SELECT gen_random_uuid()::text, t.tenant_id, t.item_id, t.main_id, t.batch_id, t.total_qty, NOW()
FROM totals t
WHERE t.main_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "StockLevel" sl2
    WHERE sl2."warehouseId" = t.main_id
      AND sl2."itemId"      = t.item_id
      AND ((sl2."batchId" IS NULL AND t.batch_id IS NULL) OR sl2."batchId" = t.batch_id)
  );

-- 3. Zero the legacy rows (kept for FK/history integrity).
UPDATE "StockLevel" sl
SET quantity = 0
FROM "Warehouse" w
WHERE w.id = sl."warehouseId" AND w.code <> 'MAIN';

-- 4. Deactivate the legacy warehouses. This also disarms the
--    resolveMainWarehouse() fallback that caused the incident.
UPDATE "Warehouse" SET active = false WHERE code <> 'MAIN';

-- 5. Release the sheet stranded in POSTING by the failed 12:08 post.
--    The post threw AFTER the status claim was already committed, so the
--    row can never be posted again until it is returned to DRAFT.
--    Safe: the transaction that would have moved stock rolled back, so
--    this sheet has zero StockMovement rows.
UPDATE "DailyProduction" dp
SET status = 'DRAFT', "postedAt" = NULL, "postedById" = NULL
WHERE dp.status = 'POSTING'
  AND NOT EXISTS (
    SELECT 1 FROM "StockMovement" sm
    WHERE sm."refType" = 'DailyProduction' AND sm."refId" = dp.id
  );

-- 6. Record both migrations so their state is positively verifiable
--    from now on (this deployment applies schema via `db push`, which
--    writes nothing to _prisma_migrations — that is exactly why this
--    incident was invisible).
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'applied-manually-hotfix-2026-08-16', NOW(), m.name,
       'Applied manually via ops/HOTFIX-2026-08-16-consolidation.sql', NULL, NOW(), 1
FROM (VALUES
  ('20260814170000_single_warehouse_consolidation'),
  ('20260816120000_production_cost_allocation')
) AS m(name)
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" pm WHERE pm.migration_name = m.name
);

COMMIT;


-- =====================================================================
-- SECTION 3 — AFTER verification (READ-ONLY). All five must pass.
-- =====================================================================

SELECT 'MAIN exists (expect MAIN)' AS check,
       COALESCE((SELECT code FROM "Warehouse" WHERE code = 'MAIN' LIMIT 1), 'MISSING') AS value
UNION ALL
SELECT 'active warehouses (expect MAIN)',
       (SELECT string_agg(code, ',' ORDER BY code) FROM "Warehouse" WHERE active)
UNION ALL
SELECT 'non-MAIN rows still holding stock (expect 0)',
       (SELECT COUNT(*)::text FROM "StockLevel" sl JOIN "Warehouse" w ON w.id = sl."warehouseId"
        WHERE w.code <> 'MAIN' AND sl.quantity <> 0)
UNION ALL
SELECT 'negative StockLevel rows (expect 0)',
       (SELECT COUNT(*)::text FROM "StockLevel" WHERE quantity < 0)
UNION ALL
SELECT 'sheets stuck in POSTING (expect 0)',
       (SELECT COUNT(*)::text FROM "DailyProduction" WHERE status = 'POSTING')
UNION ALL
SELECT 'StockMovement rows preserved (expect unchanged)',
       (SELECT COUNT(*)::text FROM "StockMovement");

-- Per-item totals AFTER — must match SECTION 1 row for row.
SELECT i.sku, i.name, SUM(sl.quantity) AS total_qty
FROM "StockLevel" sl
JOIN "Item" i ON i.id = sl."itemId"
WHERE sl.quantity <> 0
GROUP BY i.sku, i.name
ORDER BY i.sku;

-- Expected consolidated balances for the 7 previously-split items:
--   حليب انجوي جاهز 2250 غرام   1635.0000   (was BULK 733    + FIN 902)
--   حليب انجوي جاهز 750 غم      2117.0000   (was BULK 1618   + FIN 499)
--   رولات 1800 غم               1577.0000   (was BULK 1575   + FIN 2)
--   رولات 20 غم                 3042.6000   (was BULK 3041.6 + FIN 1)
--   رولات 2250 غم شكل جديد      1152.0000   (was BULK 1060   + FIN 2   + PKG 90)
--   كرتون 1800 غم                732.0000   (was BULK 460    + FIN 1   + PKG 271)
--   كرتون 20 غم                 4292.0000   (was BULK 4257   + FIN 1   + PKG 34)
