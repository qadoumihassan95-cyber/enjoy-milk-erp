-- =====================================================================
--  OPENING-STOCK PurchaseBatch backfill
-- =====================================================================
--  After G5 the sale/production paths no longer silently swallow FIFO
--  errors — if an item has StockLevel > 0 but no matching PurchaseBatch
--  the sale WILL throw "الكمية المتاحة أقل من المطلوبة". That's the
--  correct behaviour going forward, but historical seeded openings
--  (5 SKUs in prisma/seed.ts) and any hand-entered stock that never
--  went through /inventory/receive have no batches.
--
--  This script creates ONE PurchaseBatch per affected item with:
--    • quantity  = current Σ StockLevel for that item
--    • remaining = same
--    • unitCost  = item.avgCost (fallback item.costPrice, fallback 0)
--    • sourceType= 'OPENING_BALANCE'
--    • purchaseDate = a fixed reference date so future receipts
--      naturally sort AFTER these openings under FIFO.
--
--  READ-ONLY analysis first. DML section commented out — uncomment
--  only after reviewing the count.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Q-OSB-A) ANALYSIS: items with StockLevel > 0 but Σ PurchaseBatch.remaining < StockLevel
-- ---------------------------------------------------------------------
SELECT
  i.id, i.sku, i.name, i.unit,
  ROUND(COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)::numeric, 3) AS stock_now,
  ROUND(COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)::numeric, 3) AS batches_now,
  ROUND((
    COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
  )::numeric, 3) AS opening_backfill_needed,
  ROUND(COALESCE(i."avgCost", i."costPrice", 0)::numeric, 6) AS unit_cost_would_use
FROM "Item" i
WHERE i.active = TRUE
  AND COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
    > 0.001
ORDER BY opening_backfill_needed DESC;


-- =====================================================================
-- DML SECTION — commented out. Uncomment after review + snapshot.
-- =====================================================================
/*
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
  '2000-01-01'::timestamp,  -- fixed reference date so openings sort first under FIFO
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

-- Sanity check — Σ remaining per item MUST now equal StockLevel per item.
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

-- If the sanity check above returned 0 rows:
COMMIT;
-- Otherwise:
-- ROLLBACK;
*/
