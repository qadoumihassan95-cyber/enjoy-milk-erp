-- =====================================================================
--  RUNNABLE opening-stock PurchaseBatch backfill — 2026-08-17
-- =====================================================================
--  This is ops/opening-stock-batch-backfill.sql with its DML section
--  uncommented. The logic is UNCHANGED: one PurchaseBatch per affected
--  item, sized to the GAP between StockLevel and existing FIFO coverage.
--
--  WHY IT IS NEEDED
--  ----------------
--  Production consumes PurchaseBatch.remaining, not StockLevel. 15 active
--  items carry a balance with no batch behind it, so ترحيل fails with
--  "دفعات المادة الخام غير كافية" even when the balance screen looks
--  healthy. حليب خام is the live example: StockLevel 40,000, FIFO 0.
--
--  ⚠ COST BASIS — READ THIS
--  ------------------------
--  Verified on production 2026-08-17: ALL 15 items have avgCost = 0 AND
--  costPrice = 0, so every batch below is created with unitCost = 0.
--  Consequence: 7,227,583.3 units enter the costing ledger at zero cost,
--  and every future sale or production that consumes them records
--  COGS = 0, inflating gross profit.
--
--  This is the documented behaviour of the original script ("fallback
--  0"), but it was written expecting that fallback to be rare. It is
--  currently firing for 100% of items.
--
--  Correcting it later is a contained UPDATE, because every row created
--  here is tagged sourceType='OPENING_BALANCE' and nothing has consumed
--  them yet:
--
--      UPDATE "PurchaseBatch" SET "unitCost" = <real cost>
--      WHERE "sourceType" = 'OPENING_BALANCE' AND "itemId" = '<item>';
--
--  If you would rather set real costs FIRST, populate Item.avgCost for
--  the 15 SKUs and re-run section 1 — the same script then picks them up.
--
--  SCOPE
--  -----
--  Creates rows in "PurchaseBatch" ONLY. Touches no StockLevel, no
--  StockMovement, no allocation, no item master data. Idempotent: a
--  second run computes gap = 0 for every item and inserts nothing.
--
--  NOT COVERED: 4 INACTIVE items also carry uncovered stock. The original
--  script filters on i.active = TRUE and this file preserves that. See
--  section 4 if you want them included.
--
--  HOW TO RUN
--  ----------
--  Render Dashboard → enjoymilk-db → Query Console. Run section 1, keep
--  the output, then section 2, then section 3.
-- =====================================================================


-- =====================================================================
-- SECTION 1 — BEFORE (READ-ONLY). Keep this output.
-- =====================================================================
SELECT
  i.sku, i.name, i.unit,
  ROUND(COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)::numeric, 3) AS stock_now,
  ROUND(COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)::numeric, 3) AS batches_now,
  ROUND((
    COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
  )::numeric, 3) AS backfill_needed,
  ROUND(COALESCE(i."avgCost", i."costPrice", 0)::numeric, 6) AS unit_cost_would_use
FROM "Item" i
WHERE i.active = TRUE
  AND COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
    > 0.001
ORDER BY backfill_needed DESC;
-- Expected on 2026-08-17: 15 rows, Σ backfill_needed = 7,227,583.300


-- =====================================================================
-- SECTION 2 — THE BACKFILL (WRITES — single transaction)
-- =====================================================================
BEGIN;

INSERT INTO "PurchaseBatch" (
  id, "tenantId", "itemId", "batchNumber", "purchaseDate",
  quantity, remaining, "unitCost", currency,
  "sourceType", "sourceRefId", "createdById", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  i."tenantId",
  i.id,
  NULL,
  '2000-01-01'::timestamp,  -- fixed reference date so openings sort FIRST under FIFO
  (COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
   - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0))::numeric,
  (COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
   - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0))::numeric,
  COALESCE(i."avgCost", i."costPrice", 0)::numeric,
  'JOD',
  'OPENING_BALANCE',
  NULL,
  NULL,
  NOW()
FROM "Item" i
WHERE i.active = TRUE
  AND COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
    > 0.001;
-- Expect: INSERT 0 15

-- Sanity check — MUST return 0 rows. Any row means an item's Σ remaining
-- still disagrees with its StockLevel; ROLLBACK instead of committing.
SELECT i.name,
  (SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id) AS batches,
  (SELECT SUM(sl.quantity)  FROM "StockLevel"   sl WHERE sl."itemId" = i.id) AS stock,
  ((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id)
    - (SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id)) AS drift
FROM "Item" i
WHERE i.active = TRUE AND ABS(
  COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
  - COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
) > 0.001;

COMMIT;
-- If the sanity check returned ANY row, run ROLLBACK; instead.


-- =====================================================================
-- SECTION 3 — AFTER verification (READ-ONLY). All must pass.
-- =====================================================================
SELECT 'active items still uncovered (expect 0)' AS check, COUNT(*)::text AS value
FROM "Item" i WHERE i.active
  AND COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) > 0.001
UNION ALL
SELECT 'OPENING_BALANCE batches (expect 15)',
       (SELECT COUNT(*)::text FROM "PurchaseBatch" WHERE "sourceType"='OPENING_BALANCE')
UNION ALL
SELECT 'duplicate OPENING_BALANCE per item (expect 0)',
       (SELECT COUNT(*)::text FROM (
          SELECT "itemId" FROM "PurchaseBatch" WHERE "sourceType"='OPENING_BALANCE'
          GROUP BY "itemId" HAVING COUNT(*) > 1) d)
UNION ALL
SELECT 'StockLevel rows (must be 22 — unchanged)',
       (SELECT COUNT(*)::text FROM "StockLevel")
UNION ALL
SELECT 'Sum stock (must be 7383058.2000 — unchanged)',
       (SELECT COALESCE(SUM(quantity),0)::text FROM "StockLevel")
UNION ALL
SELECT 'StockMovement rows (must be 136 — unchanged)',
       (SELECT COUNT(*)::text FROM "StockMovement")
UNION ALL
SELECT 'ProductionCostAllocation rows (must be 0 — unchanged)',
       (SELECT COUNT(*)::text FROM "ProductionCostAllocation")
UNION ALL
SELECT 'negative StockLevel rows (expect 0)',
       (SELECT COUNT(*)::text FROM "StockLevel" WHERE quantity < 0)
UNION ALL
SELECT 'FIFO inventory value JOD (expect ~1.00 — costs are 0)',
       (SELECT ROUND(COALESCE(SUM(remaining*"unitCost"),0)::numeric,2)::text FROM "PurchaseBatch");

-- Raw milk specifically — the item blocking sheet cmsw2910y0004u37ykqdooolr.
SELECT i.name,
  (SELECT SUM(sl.quantity)  FROM "StockLevel"   sl WHERE sl."itemId"=i.id) AS stocklevel,
  (SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id) AS fifo_available
FROM "Item" i WHERE i.id = 'cmrxe2q6y0004rcaasmpih45d';
-- Expect stocklevel 40000 and fifo_available 40000 → the 500 needed by
-- the sheet is comfortably covered and the posting proceeds with NO
-- shortage at all.


-- =====================================================================
-- SECTION 4 — OPTIONAL: the 4 INACTIVE items
-- =====================================================================
-- The original script deliberately filters on i.active = TRUE, and this
-- file preserves that. These 4 items hold stock with no FIFO cover; they
-- block nothing today because inactive items are not selectable in the
-- production sheet, but reactivating one would reintroduce the failure.
-- Review first:
--
-- SELECT i.sku, i.name,
--   COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0) AS stock,
--   COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) AS fifo
-- FROM "Item" i WHERE i.active = FALSE
--   AND COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0)
--     - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) > 0.001;
--
-- To include them, re-run SECTION 2 with `i.active = TRUE` changed to
-- `TRUE` in both the INSERT's WHERE and the sanity check.
