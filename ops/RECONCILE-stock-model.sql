-- =====================================================================
--  Stock model reconciliation — READ-ONLY
-- =====================================================================
--  SQL twin of GET /api/inventory/reconciliation. Same seven checks,
--  usable when the API is unreachable or you want the raw rows.
--
--  ⚠ SAFETY: every statement below is a SELECT. There is no INSERT,
--  UPDATE, DELETE or DDL anywhere in this file. It is safe to run against
--  production at any time, including during a shift.
--
--  It reports problems. It does NOT fix them — deciding which layer is
--  authoritative (the balance or the cost layer) is a business call.
--
--  WHY THIS MATTERS
--  ----------------
--  Two structures describe the same stock:
--    StockLevel     the balance shown on screen
--    PurchaseBatch  the cost layer — what production and sales actually
--                   consume via FIFO
--  When they diverge you get symptoms that look unrelated: "there is
--  stock but ترحيل fails", zero COGS, negative balances. Raw milk carried
--  StockLevel 40,000 against FIFO remaining 0 for exactly this reason.
--
--  HOW TO RUN
--  ----------
--  Render Dashboard → enjoymilk-api → Shell:
--    npx prisma db execute --url "$DATABASE_URL" --file <this file>
--  or paste individual sections into any SQL client.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 0. Headline — one row, the shape of the problem
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM "Item" WHERE active)                                   AS active_items,
  (SELECT COALESCE(SUM(quantity),0) FROM "StockLevel")                         AS stocklevel_sum,
  (SELECT COALESCE(SUM(remaining),0) FROM "PurchaseBatch")                     AS fifo_remaining_sum,
  (SELECT ROUND(COALESCE(SUM(remaining*"unitCost"),0)::numeric,2)
     FROM "PurchaseBatch")                                                     AS fifo_value,
  (SELECT COUNT(*) FROM "StockLevel" WHERE quantity < 0)                       AS negative_rows;


-- ─────────────────────────────────────────────────────────────────────
-- 1. CRITICAL — balance with no FIFO batch behind it
--    Screen shows stock; production and sales will refuse to consume.
-- ─────────────────────────────────────────────────────────────────────
WITH layers AS (
  SELECT i.id, i.sku, i.name, i.unit, i.active,
    COALESCE((SELECT SUM(sl.quantity)  FROM "StockLevel"    sl WHERE sl."itemId"=i.id),0) AS stock,
    COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) AS fifo
  FROM "Item" i
)
SELECT 'STOCK_WITHOUT_BATCHES' AS check, sku, name, unit, active,
       ROUND(stock,4) AS stocklevel, ROUND(fifo,4) AS fifo_remaining,
       ROUND(stock-fifo,4) AS uncovered
FROM layers
WHERE stock > 0.001 AND fifo <= 0.001
ORDER BY stock DESC;


-- ─────────────────────────────────────────────────────────────────────
-- 2. CRITICAL — open batches with no balance
--    FIFO can consume stock the balance says is gone.
-- ─────────────────────────────────────────────────────────────────────
WITH layers AS (
  SELECT i.id, i.sku, i.name, i.unit, i.active,
    COALESCE((SELECT SUM(sl.quantity)  FROM "StockLevel"    sl WHERE sl."itemId"=i.id),0) AS stock,
    COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) AS fifo
  FROM "Item" i
)
SELECT 'BATCHES_WITHOUT_STOCK' AS check, sku, name, unit, active,
       ROUND(stock,4) AS stocklevel, ROUND(fifo,4) AS fifo_remaining
FROM layers
WHERE fifo > 0.001 AND stock <= 0.001
ORDER BY fifo DESC;


-- ─────────────────────────────────────────────────────────────────────
-- 3. WARNING — both layers present but disagreeing
-- ─────────────────────────────────────────────────────────────────────
WITH layers AS (
  SELECT i.id, i.sku, i.name, i.unit, i.active,
    COALESCE((SELECT SUM(sl.quantity)  FROM "StockLevel"    sl WHERE sl."itemId"=i.id),0) AS stock,
    COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) AS fifo
  FROM "Item" i
)
SELECT 'LAYER_DRIFT' AS check, sku, name, unit, active,
       ROUND(stock,4) AS stocklevel, ROUND(fifo,4) AS fifo_remaining,
       ROUND(stock-fifo,4) AS drift,
       CASE WHEN stock > fifo THEN 'رصيد غير قابل للاستهلاك'
            ELSE 'تغطية تكلفة بلا رصيد' END AS interpretation
FROM layers
WHERE stock > 0.001 AND fifo > 0.001 AND ABS(stock-fifo) > 0.001
ORDER BY ABS(stock-fifo) DESC;


-- ─────────────────────────────────────────────────────────────────────
-- 4. CRITICAL — negative balances, per warehouse row
-- ─────────────────────────────────────────────────────────────────────
SELECT 'NEGATIVE_STOCK' AS check, i.sku, i.name, w.code AS warehouse,
       ROUND(sl.quantity,4) AS quantity
FROM "StockLevel" sl
JOIN "Item" i ON i.id = sl."itemId"
LEFT JOIN "Warehouse" w ON w.id = sl."warehouseId"
WHERE sl.quantity < 0
ORDER BY sl.quantity ASC;


-- ─────────────────────────────────────────────────────────────────────
-- 5. CRITICAL — duplicate opening coverage
--    An opening balance should be planted once. A second one
--    double-counts the same physical stock.
-- ─────────────────────────────────────────────────────────────────────
SELECT 'DUPLICATE_OPENING_BATCH' AS check, i.sku, i.name,
       COUNT(*) AS opening_batches,
       ROUND(SUM(pb.quantity),4) AS total_opening_qty
FROM "PurchaseBatch" pb
JOIN "Item" i ON i.id = pb."itemId"
WHERE pb."sourceType" = 'OPENING_BALANCE'
GROUP BY i.sku, i.name
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;


-- ─────────────────────────────────────────────────────────────────────
-- 6. WARNING — cost layer exists but is worthless
--    Every open batch at unitCost 0 → COGS books as zero and gross
--    profit is overstated by the full sale value.
-- ─────────────────────────────────────────────────────────────────────
SELECT 'ZERO_COST_LAYER' AS check, i.sku, i.name, i.unit,
       COUNT(*)                                        AS open_batches,
       COUNT(*) FILTER (WHERE pb."unitCost" <= 0)      AS zero_cost_batches,
       ROUND(SUM(pb.remaining),4)                      AS remaining_qty
FROM "PurchaseBatch" pb
JOIN "Item" i ON i.id = pb."itemId"
WHERE pb.remaining > 0.001
GROUP BY i.sku, i.name, i.unit
HAVING COUNT(*) FILTER (WHERE pb."unitCost" <= 0) > 0
ORDER BY remaining_qty DESC;


-- ─────────────────────────────────────────────────────────────────────
-- 7. INFO — SHORTAGE batches (material posted that never existed)
--    Created by WARNING_MODE / OVERRIDE_MODE postings. remaining is
--    always 0, so they add no availability — they are a paper trail of
--    how much was consumed beyond what the batches could cover.
-- ─────────────────────────────────────────────────────────────────────
SELECT 'SHORTAGE_BATCHES' AS check, i.sku, i.name,
       COUNT(*) AS shortage_batches,
       ROUND(SUM(pb.quantity),4) AS uncovered_qty,
       MIN(pb."createdAt") AS first_seen,
       MAX(pb."createdAt") AS last_seen
FROM "PurchaseBatch" pb
JOIN "Item" i ON i.id = pb."itemId"
WHERE pb."sourceType" = 'SHORTAGE'
GROUP BY i.sku, i.name
ORDER BY uncovered_qty DESC;


-- ─────────────────────────────────────────────────────────────────────
-- 8. Ledger cross-check — StockLevel vs the net of its own movements
--    A large unexplained gap means the balance was written outside the
--    application (direct SQL). This is what surfaced the x100 anomaly.
-- ─────────────────────────────────────────────────────────────────────
SELECT 'LEDGER_MISMATCH' AS check, i.sku, i.name,
  ROUND(COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0),4) AS stocklevel,
  ROUND(COALESCE((SELECT SUM(
      CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END)
    FROM "StockMovement" sm WHERE sm."itemId"=i.id),0),4) AS net_from_movements,
  ROUND(
    COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0)
    - COALESCE((SELECT SUM(
        CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END)
      FROM "StockMovement" sm WHERE sm."itemId"=i.id),0), 4) AS unexplained
FROM "Item" i
WHERE ABS(
    COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0)
    - COALESCE((SELECT SUM(
        CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END)
      FROM "StockMovement" sm WHERE sm."itemId"=i.id),0)) > 0.001
ORDER BY ABS(
    COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0)
    - COALESCE((SELECT SUM(
        CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END)
      FROM "StockMovement" sm WHERE sm."itemId"=i.id),0)) DESC;
