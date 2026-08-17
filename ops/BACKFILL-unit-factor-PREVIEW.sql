-- =====================================================================
--  Unit factor backfill — PREVIEW (READ-ONLY)
-- =====================================================================
--  Run this FIRST. It writes nothing. Every statement is a SELECT.
--
--  Purpose: show exactly which historical ProductionMilkUsage rows would
--  be stamped with a conversion factor by BACKFILL-unit-factor-APPLY.sql,
--  and which would deliberately be left alone.
--
--  Only UNAMBIGUOUS rows are candidates — the approved scope. A row
--  qualifies when count > 0 and quantity / count is exactly 25, which is
--  the factor the old hardcoded conversion applied. Anything else is left
--  NULL and reported as legacy, because guessing at it would be inventing
--  history.
--
--  Expected on production, 2026-08-17:
--     7 rows   ratio exactly 25       → will be stamped
--     1 row    ratio 1.0              → left NULL (operator typed KG)
--     2 rows   ratio 0.0              → left NULL (quantity 0)
--     2 rows   count = 0              → left NULL (manual entry)
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Bucket every row. Only the first bucket is touched by APPLY.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  CASE
    WHEN "count" = 0                              THEN 'SKIP — count = 0 (manual entry)'
    WHEN quantity = 0                             THEN 'SKIP — quantity = 0'
    WHEN ROUND(quantity / "count", 6) = 25        THEN 'STAMP — ratio exactly 25'
    ELSE 'SKIP — ratio ' || ROUND(quantity / "count", 6)::text
  END AS bucket,
  COUNT(*)                    AS rows,
  ROUND(SUM(quantity), 3)     AS total_quantity,
  ROUND(SUM("count"), 3)      AS total_bags
FROM "ProductionMilkUsage"
GROUP BY 1
ORDER BY 2 DESC;


-- ─────────────────────────────────────────────────────────────────────
-- 2. The exact rows that WOULD be stamped, with their sheet and date.
--    Check these against the paper record before applying.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  m.id,
  dp."productionDate"::date  AS production_date,
  dp.status,
  m."itemName",
  m."count"                  AS bags,
  m.quantity                 AS quantity_kg,
  ROUND(m.quantity / m."count", 6) AS implied_factor,
  m."unitFactor"             AS current_factor,
  m."factorSource"           AS current_source
FROM "ProductionMilkUsage" m
JOIN "DailyProduction" dp ON dp.id = m."dailyProductionId"
WHERE m."count" > 0
  AND m.quantity > 0
  AND ROUND(m.quantity / m."count", 6) = 25
  AND m."unitFactor" IS NULL
ORDER BY dp."productionDate", m.id;


-- ─────────────────────────────────────────────────────────────────────
-- 3. The rows that will be LEFT ALONE, and why. These stay NULL and are
--    reported as "factor unknown" rather than assigned a guess.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  m.id,
  dp."productionDate"::date AS production_date,
  m."itemName",
  m."count"                 AS bags,
  m.quantity                AS quantity_kg,
  CASE
    WHEN m."count" = 0  THEN 'operator entered the weight directly'
    WHEN m.quantity = 0 THEN 'quantity is zero — nothing to derive from'
    ELSE 'ratio ' || ROUND(m.quantity / m."count", 6)::text || ' does not match any known factor'
  END AS why_skipped
FROM "ProductionMilkUsage" m
JOIN "DailyProduction" dp ON dp.id = m."dailyProductionId"
WHERE m."unitFactor" IS NULL
  AND NOT (m."count" > 0 AND m.quantity > 0 AND ROUND(m.quantity / m."count", 6) = 25)
ORDER BY dp."productionDate", m.id;


-- ─────────────────────────────────────────────────────────────────────
-- 4. Item configuration status — the real fix.
--    Backfilling records what WAS used. Configuring bagWeightKg is what
--    stops the legacy fallback being used again.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  i.sku, i.name, i.unit,
  i."bagWeightKg",
  CASE WHEN COALESCE(i."bagWeightKg", 0) > 0
       THEN 'configured'
       ELSE 'NOT configured — postings will use the 25 kg fallback' END AS status,
  (SELECT COUNT(*) FROM "ProductionMilkUsage" m WHERE m."itemId" = i.id) AS usage_rows
FROM "Item" i
WHERE EXISTS (SELECT 1 FROM "ProductionMilkUsage" m WHERE m."itemId" = i.id)
ORDER BY status, i.name;


-- ─────────────────────────────────────────────────────────────────────
-- 5. Counters to compare against the same query after APPLY.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM "ProductionMilkUsage")                                AS total_rows,
  (SELECT COUNT(*) FROM "ProductionMilkUsage" WHERE "unitFactor" IS NOT NULL) AS rows_with_factor,
  (SELECT COUNT(*) FROM "ProductionMilkUsage" WHERE "factorSource" IS NOT NULL) AS rows_with_source,
  (SELECT ROUND(SUM(quantity), 4) FROM "ProductionMilkUsage")                 AS sum_quantity,
  (SELECT COUNT(*) FROM "StockMovement")                                      AS stock_movements,
  (SELECT COUNT(*) FROM "PurchaseBatch")                                      AS purchase_batches;
-- Expect after APPLY: rows_with_factor 0 -> 7, sum_quantity UNCHANGED,
-- stock_movements UNCHANGED, purchase_batches UNCHANGED.
