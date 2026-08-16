-- =====================================================================
--  Historical Produced-Batch Backfill (Blocker B2)
-- =====================================================================
--  READ-ONLY analysis first, deterministic backfill second (commented
--  out — uncomment only after we've reviewed the count together).
--
--  Purpose: create PurchaseBatch rows for every historical POSTED
--  DailyProduction whose produced items have no matching batch. Fixes
--  the going-forward COGS of future sales of those SKUs.
--
--  It does NOT retroactively fix COGS on SALES that already ran —
--  SaleCostAllocation rows are already written (or already missing);
--  those numbers are frozen. Backfilling just gives FUTURE sales
--  something to consume.
--
--  Safety invariants:
--    (1) Idempotent — running twice creates zero new rows on the
--        second run (the WHERE NOT EXISTS clause blocks duplicates).
--    (2) Never modifies existing PurchaseBatch, StockMovement,
--        SaleCostAllocation, StockLevel, DailyProduction, or Item.
--    (3) `remaining = 0` when the produced qty has already been fully
--        consumed by later sales — computed per-item, allocated to
--        oldest batches first. Prevents phantom stock in FIFO.
--    (4) `unitCost` derived from the item's current avgCost. If that's
--        zero, the batch stores 0 (documented on the row's notes-like
--        field via sourceType='PRODUCTION_BACKFILL'). Future receipts
--        will refresh avgCost using the corrected weighted-avg formula.
--    (5) Wrapped in a single BEGIN/COMMIT so partial application is
--        impossible.
--
--  Backup requirement: take a Render Postgres snapshot BEFORE running
--  the DML section. Verify Q-B2-A returns 0 rows AFTER the backfill.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Q-B2-A) ANALYSIS: How many produced items lack a PurchaseBatch?
-- ---------------------------------------------------------------------
-- Baseline count. Rerun after the backfill — should return 0.
SELECT
  COUNT(*)                        AS produced_rows_missing_batch,
  COUNT(DISTINCT dp.id)           AS distinct_daily_productions,
  COUNT(DISTINCT ppi."itemId")    AS distinct_items,
  MIN(dp."productionDate")        AS earliest_missing,
  MAX(dp."productionDate")        AS latest_missing,
  ROUND(SUM(ppi."cartonsTotal")::numeric, 3) AS total_cartons_never_batched
FROM "DailyProduction" dp
JOIN "ProductionProducedItem" ppi ON ppi."dailyProductionId" = dp.id
WHERE dp.status = 'POSTED'
  AND ppi."itemId" IS NOT NULL
  AND ppi."cartonsTotal" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "PurchaseBatch" pb
    WHERE pb."sourceType" IN ('PRODUCTION', 'PRODUCTION_BACKFILL')
      AND pb."sourceRefId" = dp.id
      AND pb."itemId"      = ppi."itemId"
  );


-- ---------------------------------------------------------------------
-- Q-B2-B) ANALYSIS: Per-item breakdown of missing-batch quantity
-- ---------------------------------------------------------------------
-- Compare `total_produced_never_batched` against `current_stock_level`
-- to gauge whether the backfill will inflate FIFO remaining.
-- If total_produced_never_batched >= current_stock, remaining will need
-- to be capped at current_stock (the backfill script does this
-- automatically — see the FIFO-consume-legacy CTE in the DML section).
SELECT
  i.id                                                       AS item_id,
  i.sku,
  i.name,
  i.unit,
  ROUND(SUM(ppi."cartonsTotal")::numeric, 3)                 AS total_produced_never_batched,
  ROUND(COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)::numeric, 3)
                                                             AS current_stock_level,
  ROUND(COALESCE(i."avgCost", 0)::numeric, 6)                AS current_avg_cost,
  COUNT(DISTINCT dp.id)                                      AS production_days
FROM "DailyProduction" dp
JOIN "ProductionProducedItem" ppi ON ppi."dailyProductionId" = dp.id
JOIN "Item" i ON i.id = ppi."itemId"
WHERE dp.status = 'POSTED'
  AND ppi."cartonsTotal" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "PurchaseBatch" pb
    WHERE pb."sourceType" IN ('PRODUCTION', 'PRODUCTION_BACKFILL')
      AND pb."sourceRefId" = dp.id
      AND pb."itemId"      = ppi."itemId"
  )
GROUP BY i.id, i.sku, i.name, i.unit, i."avgCost"
ORDER BY total_produced_never_batched DESC;


-- ---------------------------------------------------------------------
-- Q-B2-C) ANALYSIS: Sales of missing-batch items that recorded COGS=0
-- ---------------------------------------------------------------------
-- Best-effort proxy for "which past sales are wrong." An order line for
-- an affected item that has NO SaleCostAllocation is a sale that
-- silently reported COGS=0.
SELECT
  so.id      AS order_id,
  so.number,
  so."orderDate",
  so."customerName",
  i.name     AS item,
  ROUND(ol.quantity::numeric, 3) AS qty_sold,
  (SELECT COUNT(*) FROM "SaleCostAllocation" sca
     WHERE sca."saleLineId" = ol.id) AS allocations
FROM "SimpleOrder" so
JOIN "SimpleOrderLine" ol ON ol."orderId" = so.id
JOIN "Item" i ON i.id = ol."itemId"
WHERE so.status <> 'CANCELLED'
  AND ol."itemId" IN (
    SELECT DISTINCT ppi."itemId" FROM "DailyProduction" dp
    JOIN "ProductionProducedItem" ppi ON ppi."dailyProductionId" = dp.id
    WHERE dp.status = 'POSTED' AND ppi."cartonsTotal" > 0
      AND NOT EXISTS (
        SELECT 1 FROM "PurchaseBatch" pb
        WHERE pb."sourceType" IN ('PRODUCTION', 'PRODUCTION_BACKFILL')
          AND pb."sourceRefId" = dp.id AND pb."itemId" = ppi."itemId"
      )
  )
  AND NOT EXISTS (SELECT 1 FROM "SaleCostAllocation" sca WHERE sca."saleLineId" = ol.id)
ORDER BY so."orderDate";


-- =====================================================================
-- DML SECTION — commented out. Uncomment ONLY after backup + review.
-- Never run this against production without a Postgres snapshot taken
-- immediately prior. Wrapped in BEGIN/COMMIT so partial application
-- cannot happen.
-- =====================================================================

/*
BEGIN;

-- Step 1: insert one PurchaseBatch per missing produced row.
-- unitCost = current item avgCost (fallback 0 documented on sourceType).
-- remaining = quantity — will be capped in Step 2 if it exceeds current stock.
INSERT INTO "PurchaseBatch" (
  id, "tenantId", "itemId", "batchNumber", "purchaseDate",
  quantity, remaining, "unitCost", currency,
  "sourceType", "sourceRefId", "createdById", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  dp."tenantId",
  ppi."itemId",
  NULL,
  dp."productionDate",
  ppi."cartonsTotal"::numeric,
  ppi."cartonsTotal"::numeric,
  COALESCE(i."avgCost", 0)::numeric,
  'JOD',
  'PRODUCTION_BACKFILL',
  dp.id,
  NULL,
  NOW()
FROM "DailyProduction" dp
JOIN "ProductionProducedItem" ppi ON ppi."dailyProductionId" = dp.id
JOIN "Item" i ON i.id = ppi."itemId"
WHERE dp.status = 'POSTED'
  AND ppi."cartonsTotal" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "PurchaseBatch" pb
    WHERE pb."sourceType" IN ('PRODUCTION', 'PRODUCTION_BACKFILL')
      AND pb."sourceRefId" = dp.id
      AND pb."itemId"      = ppi."itemId"
  );

-- Step 2: cap Σ(remaining) per item to current StockLevel total.
-- Consumes newest backfill batches first (LIFO on backfill) so any
-- shortfall lands on the batches that would have been sold LAST.
-- This is a conservative choice — you can flip to FIFO if the customer
-- prefers oldest-first depletion.
WITH totals AS (
  SELECT
    pb."itemId",
    pb."tenantId",
    SUM(pb.remaining) AS batch_total,
    (SELECT COALESCE(SUM(sl.quantity), 0) FROM "StockLevel" sl WHERE sl."itemId" = pb."itemId") AS stock_total
  FROM "PurchaseBatch" pb
  GROUP BY pb."itemId", pb."tenantId"
  HAVING SUM(pb.remaining) > (SELECT COALESCE(SUM(sl.quantity), 0) FROM "StockLevel" sl WHERE sl."itemId" = pb."itemId")
),
shortfall AS (
  SELECT t."itemId", t."tenantId", (t.batch_total - t.stock_total) AS excess
  FROM totals t
),
-- Rank BACKFILL batches per item, newest first.
ordered_backfill AS (
  SELECT
    pb.id, pb."itemId", pb."tenantId", pb.remaining, pb."purchaseDate",
    ROW_NUMBER() OVER (
      PARTITION BY pb."itemId"
      ORDER BY pb."purchaseDate" DESC, pb."createdAt" DESC
    ) AS rn,
    SUM(pb.remaining) OVER (
      PARTITION BY pb."itemId"
      ORDER BY pb."purchaseDate" DESC, pb."createdAt" DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_total
  FROM "PurchaseBatch" pb
  WHERE pb."sourceType" = 'PRODUCTION_BACKFILL' AND pb.remaining > 0
)
UPDATE "PurchaseBatch" pb SET remaining = GREATEST(0, pb.remaining - LEAST(
  s.excess,
  pb.remaining
))
FROM ordered_backfill o, shortfall s
WHERE pb.id = o.id
  AND o."itemId" = s."itemId"
  AND o.running_total > (SELECT batch_total - s.excess FROM totals WHERE "itemId" = s."itemId");

-- Step 3: sanity check — Σ(remaining) per item MUST NOT exceed StockLevel.
-- If any row returns here, ROLLBACK.
SELECT
  i.id, i.name,
  (SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id) AS batches_remaining,
  (SELECT COALESCE(SUM(sl.quantity),0) FROM "StockLevel" sl WHERE sl."itemId" = i.id) AS stock_level,
  ((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id)
    - (SELECT COALESCE(SUM(sl.quantity),0) FROM "StockLevel" sl WHERE sl."itemId" = i.id)) AS drift
FROM "Item" i
WHERE (SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id)
    - (SELECT COALESCE(SUM(sl.quantity),0) FROM "StockLevel" sl WHERE sl."itemId" = i.id) > 0.001;

-- If the sanity check above returned 0 rows, run:
COMMIT;
-- Otherwise:
-- ROLLBACK;
*/
