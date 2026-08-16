-- =====================================================================
--  PRE-DEPLOY RECONCILIATION QUERIES
--  =====================================================================
--
--  READ-ONLY. Every statement in this file is a SELECT (no INSERT,
--  UPDATE, DELETE, TRUNCATE, ALTER). Safe to run against production.
--
--  Purpose: prove what each item's balance SHOULD be before we run
--  20260814170000_single_warehouse_consolidation, so we can spot any
--  drift caused by the historical bugs (aluminum silently skipped,
--  weighted-average double-count, silent clamp on over-consumption,
--  sales that never wrote a StockMovement).
--
--  Run each query separately in Render's Postgres console (or via
--  `psql $DATABASE_URL -f ops/pre-deploy-reconciliation.sql` if you
--  prefer). Each query is self-contained; you can copy any block
--  individually.
--
--  All queries scope by tenant automatically via a CTE. If your
--  factory runs on a single tenant this collapses to one row per
--  item; if you have multiple tenants they are broken out.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Q1 — TENANT AWARENESS
--
-- Confirm which tenants exist and how much data lives under each.
-- If more than one row comes back you'll want to filter every
-- subsequent query with `WHERE "tenantId" = 't-XXXX'` for the tenant
-- that matters. Otherwise, all remaining queries are already grouped
-- by tenant.
-- ---------------------------------------------------------------------
SELECT
  t.id           AS tenant_id,
  t.name         AS tenant_name,
  (SELECT COUNT(*) FROM "Item" i         WHERE i."tenantId" = t.id) AS items,
  (SELECT COUNT(*) FROM "StockLevel" sl  WHERE sl."tenantId" = t.id) AS stock_levels,
  (SELECT COUNT(*) FROM "StockMovement" sm WHERE sm."tenantId" = t.id) AS movements,
  (SELECT COUNT(*) FROM "DailyProduction" dp WHERE dp."tenantId" = t.id) AS productions,
  (SELECT COUNT(*) FROM "SimpleOrder" so WHERE so."tenantId" = t.id) AS orders
FROM "Tenant" t
ORDER BY t."createdAt";


-- =====================================================================
-- A) Current inventory snapshot per item + warehouse
-- =====================================================================
-- Shows exactly where stock currently lives. Non-MAIN warehouses with
-- non-zero balances are your consolidation candidates.
-- ---------------------------------------------------------------------
SELECT
  i.id                       AS item_id,
  i.sku,
  i.name,
  i.unit,
  i."bagWeightKg"            AS kg_per_sack,
  w.code                     AS warehouse_code,
  w.name                     AS warehouse_name,
  ROUND(SUM(sl.quantity)::numeric, 3) AS qty_in_warehouse,
  i.active
FROM "Item" i
LEFT JOIN "StockLevel" sl ON sl."itemId" = i.id
LEFT JOIN "Warehouse"   w ON w.id       = sl."warehouseId"
WHERE i.active = TRUE
GROUP BY i.id, i.sku, i.name, i.unit, i."bagWeightKg", w.code, w.name, i.active
HAVING COALESCE(SUM(sl.quantity), 0) <> 0
ORDER BY i.name, w.code;


-- =====================================================================
-- B) Item-total snapshot (aggregated across every warehouse)
-- =====================================================================
-- Every subsequent reconstruction compares against this "expected" col.
-- This is what /inventory shows the user today.
-- ---------------------------------------------------------------------
SELECT
  i.id                        AS item_id,
  i.sku,
  i.name,
  i.unit,
  i."bagWeightKg"             AS kg_per_sack,
  ROUND(COALESCE(SUM(sl.quantity), 0)::numeric, 3) AS total_stock_now,
  i."avgCost",
  i."costPrice"
FROM "Item" i
LEFT JOIN "StockLevel" sl ON sl."itemId" = i.id
WHERE i.active = TRUE
GROUP BY i.id, i.sku, i.name, i.unit, i."bagWeightKg", i."avgCost", i."costPrice"
ORDER BY i.name;


-- =====================================================================
-- C) Reconstructed balance from StockMovement ledger
-- =====================================================================
-- Sums every IN (+) / OUT (−) / WASTE (−) / TRANSFER (net-zero per item)
-- for the item across all time. In a healthy system this equals the
-- total_stock_now from query B. Any divergence means either:
--   • a StockMovement was written but the StockLevel update was silently
--     clamped (the aluminum bug), or
--   • a StockLevel was mutated without a corresponding movement
--     (unlikely — no such path exists in the code, but worth checking).
-- ---------------------------------------------------------------------
WITH reconstructed AS (
  SELECT
    sm."itemId",
    SUM(
      CASE
        WHEN sm.type IN ('IN', 'RETURN') THEN sm.quantity
        WHEN sm.type IN ('OUT', 'WASTE') THEN -sm.quantity
        WHEN sm.type = 'ADJUSTMENT'      THEN
          CASE
            WHEN sm."toWarehouseId"   IS NOT NULL THEN  sm.quantity
            WHEN sm."fromWarehouseId" IS NOT NULL THEN -sm.quantity
            ELSE 0
          END
        WHEN sm.type = 'TRANSFER' THEN 0  -- net-zero per item
        ELSE 0
      END
    ) AS reconstructed_qty
  FROM "StockMovement" sm
  GROUP BY sm."itemId"
),
current_stock AS (
  SELECT "itemId", COALESCE(SUM(quantity), 0) AS total FROM "StockLevel" GROUP BY "itemId"
)
SELECT
  i.name                                                             AS item_name,
  i.sku,
  i.unit,
  ROUND(COALESCE(cs.total, 0)::numeric, 3)               AS system_now,
  ROUND(COALESCE(r.reconstructed_qty, 0)::numeric, 3)    AS reconstructed_from_movements,
  ROUND(
    (COALESCE(cs.total, 0) - COALESCE(r.reconstructed_qty, 0))::numeric,
    3
  ) AS drift_qty,
  CASE
    WHEN ABS(COALESCE(cs.total, 0) - COALESCE(r.reconstructed_qty, 0)) < 0.001 THEN 'OK'
    WHEN COALESCE(cs.total, 0) > COALESCE(r.reconstructed_qty, 0)              THEN 'SYSTEM_HIGH — likely receipt with no movement'
    ELSE                                                                            'SYSTEM_LOW  — likely silent clamp on OUT'
  END AS diagnosis
FROM "Item" i
LEFT JOIN current_stock cs ON cs."itemId" = i.id
LEFT JOIN reconstructed r  ON r."itemId"  = i.id
WHERE i.active = TRUE
ORDER BY ABS(COALESCE(cs.total, 0) - COALESCE(r.reconstructed_qty, 0)) DESC;


-- =====================================================================
-- D) Aluminum-specific reconciliation (headline customer complaint)
-- =====================================================================
-- For every DailyProduction that recorded aluminum consumption, show:
--   • how much aluminum was consumed on the sheet
--   • whether a corresponding StockMovement exists
--   • whether the StockLevel actually dropped
--
-- The `stock_movement_qty` column is what the ledger recorded. The
-- `sheet_qty` column is what the operator entered. Any row where
-- `stock_movement_qty IS NULL` means the aluminum consumption never
-- reached inventory — the aluminum drift.
-- ---------------------------------------------------------------------
WITH aluminum_rows AS (
  SELECT
    dp.id                    AS production_id,
    dp."productionDate"      AS production_date,
    dp.status                AS production_status,
    au.id                    AS aluminum_row_id,
    au."itemId"              AS aluminum_item_id,
    au."itemName"            AS aluminum_item_name,
    au."warehouseId"         AS row_warehouse_id,
    au.quantity              AS sheet_qty,
    dp."tenantId"            AS tenant_id
  FROM "DailyProduction" dp
  JOIN "ProductionAluminumUsage" au ON au."dailyProductionId" = dp.id
),
matched_movements AS (
  SELECT
    sm."refId"     AS production_id,
    sm."itemId"    AS aluminum_item_id,
    SUM(sm.quantity) AS stock_movement_qty
  FROM "StockMovement" sm
  WHERE sm."refType" = 'DailyProduction'
    AND sm."reasonCode" = 'PROD_ALUMINUM'
    AND sm.type = 'OUT'
  GROUP BY sm."refId", sm."itemId"
)
SELECT
  ar.production_date,
  ar.production_status,
  ar.aluminum_item_name,
  ar.aluminum_item_id,
  ROUND(ar.sheet_qty::numeric, 3)                             AS entered_on_sheet,
  ROUND(COALESCE(mm.stock_movement_qty, 0)::numeric, 3)       AS actually_deducted,
  ROUND(
    (COALESCE(ar.sheet_qty, 0) - COALESCE(mm.stock_movement_qty, 0))::numeric,
    3
  ) AS missing_deduction,
  CASE
    WHEN mm.stock_movement_qty IS NULL AND ar.production_status = 'POSTED'
      THEN 'POSTED_BUT_NEVER_DEDUCTED'
    WHEN mm.stock_movement_qty IS NULL
      THEN 'DRAFT_NOT_YET_POSTED (expected — safe to ignore)'
    WHEN ABS(ar.sheet_qty - mm.stock_movement_qty) < 0.001
      THEN 'OK'
    ELSE 'PARTIAL_DEDUCTION'
  END AS diagnosis
FROM aluminum_rows ar
LEFT JOIN matched_movements mm
  ON mm.production_id     = ar.production_id
 AND mm.aluminum_item_id  = ar.aluminum_item_id
ORDER BY ar.production_date;


-- =====================================================================
-- E) Aluminum grand-total per item (single number to book, if any)
-- =====================================================================
-- The historical missing deduction PER item, summed across every
-- POSTED daily production. This is the delta you'd book as an
-- explicit StockAdjustment DEDUCT with reason PRE_SINGLE_WAREHOUSE_RECONCILIATION.
-- Do NOT execute anything here — this is the reconciliation candidate list.
-- ---------------------------------------------------------------------
WITH aluminum_rows AS (
  SELECT dp.id AS production_id, dp.status, au."itemId" AS item_id, au.quantity AS sheet_qty
  FROM "DailyProduction" dp
  JOIN "ProductionAluminumUsage" au ON au."dailyProductionId" = dp.id
  WHERE dp.status = 'POSTED'
),
matched AS (
  SELECT sm."refId" AS production_id, sm."itemId" AS item_id, SUM(sm.quantity) AS actually
  FROM "StockMovement" sm
  WHERE sm."refType" = 'DailyProduction' AND sm."reasonCode" = 'PROD_ALUMINUM' AND sm.type = 'OUT'
  GROUP BY sm."refId", sm."itemId"
)
SELECT
  i.name                                                                   AS aluminum_item_name,
  i.id                                                                     AS item_id,
  i.unit,
  ROUND(SUM(ar.sheet_qty)::numeric, 3)                                     AS total_should_have_deducted,
  ROUND(SUM(COALESCE(m.actually, 0))::numeric, 3)                          AS total_actually_deducted,
  ROUND(SUM((ar.sheet_qty - COALESCE(m.actually, 0)))::numeric, 3)         AS proposed_deduct_delta
FROM aluminum_rows ar
JOIN "Item" i ON i.id = ar.item_id
LEFT JOIN matched m ON m.production_id = ar.production_id AND m.item_id = ar.item_id
GROUP BY i.name, i.id, i.unit
HAVING SUM((ar.sheet_qty - COALESCE(m.actually, 0))) > 0.001
ORDER BY proposed_deduct_delta DESC;


-- =====================================================================
-- F) Sales that failed to write a StockMovement
-- =====================================================================
-- Any SimpleOrder line with an itemId that has NO matching StockMovement
-- OUT is a "silent sale" — the order was booked (customer charged) but
-- inventory never moved. Same silent-warehouse-skip bug fixed in the
-- code now; here we quantify how many historical orders were affected.
-- ---------------------------------------------------------------------
WITH order_lines AS (
  SELECT
    so.id           AS order_id,
    so.number,
    so."customerName",
    so."orderDate",
    so.status,
    ol.id           AS line_id,
    ol."itemId",
    ol.quantity
  FROM "SimpleOrder" so
  JOIN "SimpleOrderLine" ol ON ol."orderId" = so.id
  WHERE ol."itemId" IS NOT NULL
    AND so.status <> 'CANCELLED'
),
line_movements AS (
  SELECT sm."refId" AS order_id, sm."itemId", SUM(sm.quantity) AS moved
  FROM "StockMovement" sm
  WHERE sm."refType" = 'SimpleOrder' AND sm.type IN ('OUT', 'IN')
  GROUP BY sm."refId", sm."itemId"
)
SELECT
  ol.order_id,
  ol.number,
  ol."customerName",
  ol."orderDate",
  ol.status,
  i.name                                                              AS item_name,
  ROUND(ol.quantity::numeric, 3)                                      AS sold_qty,
  ROUND(COALESCE(lm.moved, 0)::numeric, 3)                            AS moved_qty,
  ROUND((ol.quantity - COALESCE(lm.moved, 0))::numeric, 3)            AS missing_out,
  CASE
    WHEN lm.moved IS NULL           THEN 'NEVER_MOVED'
    WHEN ABS(ol.quantity - lm.moved) < 0.001 THEN 'OK'
    ELSE                                    'PARTIAL'
  END AS diagnosis
FROM order_lines ol
JOIN "Item" i ON i.id = ol."itemId"
LEFT JOIN line_movements lm
  ON lm.order_id = ol.order_id AND lm."itemId" = ol."itemId"
ORDER BY ol."orderDate";


-- =====================================================================
-- G) Sales grand-total per item (reconciliation candidate)
-- =====================================================================
-- Sums the missing OUT per item across every non-cancelled order.
-- ---------------------------------------------------------------------
WITH lines AS (
  SELECT so.id AS order_id, ol."itemId", ol.quantity
  FROM "SimpleOrder" so
  JOIN "SimpleOrderLine" ol ON ol."orderId" = so.id
  WHERE ol."itemId" IS NOT NULL AND so.status <> 'CANCELLED'
),
moves AS (
  SELECT sm."refId" AS order_id, sm."itemId", SUM(sm.quantity) AS moved
  FROM "StockMovement" sm
  WHERE sm."refType" = 'SimpleOrder' AND sm.type = 'OUT'
  GROUP BY sm."refId", sm."itemId"
)
SELECT
  i.name                                                        AS item_name,
  i.id                                                          AS item_id,
  i.unit,
  ROUND(SUM(l.quantity)::numeric, 3)                            AS total_sold,
  ROUND(SUM(COALESCE(m.moved, 0))::numeric, 3)                  AS total_moved,
  ROUND(SUM(l.quantity - COALESCE(m.moved, 0))::numeric, 3)     AS proposed_deduct_delta
FROM lines l
JOIN "Item" i ON i.id = l."itemId"
LEFT JOIN moves m ON m.order_id = l.order_id AND m."itemId" = l."itemId"
GROUP BY i.name, i.id, i.unit
HAVING SUM(l.quantity - COALESCE(m.moved, 0)) > 0.001
ORDER BY proposed_deduct_delta DESC;


-- =====================================================================
-- H) BAG-unit configuration check
-- =====================================================================
-- Items marked as BAG (شوال) with no kg-per-sack configured. The FE
-- create modal previously hardcoded 25; the new modal exposes the
-- field explicitly. Anything here means an item is stocked in sacks
-- but the system has no way to convert to kilograms — production
-- consumption that arrives in KG cannot be applied.
-- ---------------------------------------------------------------------
SELECT
  i.id, i.sku, i.name, i.unit,
  i."bagWeightKg",
  CASE
    WHEN i."bagWeightKg" IS NULL    THEN 'NULL — awaiting customer confirmation'
    WHEN i."bagWeightKg" <= 0        THEN 'ZERO/NEGATIVE — invalid'
    WHEN i."bagWeightKg" = 25        THEN 'DEFAULT 25 — verify explicitly with customer'
    ELSE                                 'OK — explicit'
  END AS diagnosis
FROM "Item" i
WHERE i.unit = 'BAG' AND i.active = TRUE
ORDER BY i.name;


-- =====================================================================
-- I) Weighted-average cost re-computation from PurchaseBatch ledger
-- =====================================================================
-- The "correct" weighted-average today is Σ(remaining × unitCost) / Σ(remaining)
-- across active PurchaseBatch rows for the item. This is the number the
-- fixed code will converge on for FUTURE receipts. It also gives us the
-- current per-item inventory valuation independent of the drifted avgCost.
-- ---------------------------------------------------------------------
SELECT
  i.id, i.sku, i.name, i.unit,
  ROUND(SUM(pb.remaining)::numeric, 3)                                    AS batches_qty_remaining,
  ROUND(SUM(pb.remaining * pb."unitCost")::numeric, 4)                    AS batches_value,
  ROUND((
    CASE WHEN SUM(pb.remaining) > 0
      THEN SUM(pb.remaining * pb."unitCost") / SUM(pb.remaining)
      ELSE 0
    END
  )::numeric, 6)                                                          AS reconstructed_avg_cost,
  ROUND(i."avgCost"::numeric, 6)                                          AS stored_avg_cost,
  ROUND((
    COALESCE(i."avgCost", 0)::numeric -
    CASE WHEN SUM(pb.remaining) > 0
      THEN SUM(pb.remaining * pb."unitCost") / SUM(pb.remaining)
      ELSE 0
    END
  )::numeric, 6)                                                          AS avg_cost_drift
FROM "Item" i
LEFT JOIN "PurchaseBatch" pb ON pb."itemId" = i.id AND pb.remaining > 0
WHERE i.active = TRUE
GROUP BY i.id, i.sku, i.name, i.unit, i."avgCost"
ORDER BY ABS(
  COALESCE(i."avgCost", 0) -
  CASE WHEN SUM(pb.remaining) > 0
    THEN SUM(pb.remaining * pb."unitCost") / SUM(pb.remaining)
    ELSE 0
  END
) DESC;


-- =====================================================================
-- J) Single-warehouse migration simulation (BEFORE / AFTER)
-- =====================================================================
-- Shows exactly what the MAIN balance for each item would become if we
-- ran 20260814170000_single_warehouse_consolidation right now. Cross-
-- check the "proposed_main_after" number against your reconstructed
-- expected balance (from queries C, E, G) before running the migration.
-- ---------------------------------------------------------------------
SELECT
  i.name                                                                       AS item_name,
  i.sku,
  i.unit,
  ROUND(COALESCE(SUM(CASE WHEN w.code = 'MAIN' THEN sl.quantity END), 0)::numeric, 3) AS main_now,
  ROUND(COALESCE(SUM(CASE WHEN w.code = 'BULK' THEN sl.quantity END), 0)::numeric, 3) AS bulk_now,
  ROUND(COALESCE(SUM(CASE WHEN w.code = 'PKG'  THEN sl.quantity END), 0)::numeric, 3) AS pkg_now,
  ROUND(COALESCE(SUM(CASE WHEN w.code = 'FIN'  THEN sl.quantity END), 0)::numeric, 3) AS fin_now,
  ROUND(COALESCE(SUM(CASE WHEN w.code NOT IN ('MAIN','BULK','PKG','FIN') THEN sl.quantity END), 0)::numeric, 3) AS other_now,
  ROUND(COALESCE(SUM(sl.quantity), 0)::numeric, 3)                             AS proposed_main_after
FROM "Item" i
LEFT JOIN "StockLevel" sl ON sl."itemId" = i.id
LEFT JOIN "Warehouse" w   ON w.id       = sl."warehouseId"
WHERE i.active = TRUE
GROUP BY i.name, i.sku, i.unit
HAVING COALESCE(SUM(sl.quantity), 0) <> 0
ORDER BY i.name;


-- =====================================================================
-- K) Weighted-average cost drift caused by the double-count bug
-- =====================================================================
-- For each item that has ever received supplier stock, compare the
-- stored avgCost against a from-scratch replay of the CORRECT formula
-- over its receipt history. This is DIAGNOSTIC ONLY — do not adjust
-- avgCost blindly; the customer should confirm before overwriting.
-- ---------------------------------------------------------------------
-- NOTE: the top-level `WITH RECURSIVE` keyword is required because
-- `replay` self-references. Postgres will otherwise error with
-- `ERROR: relation "replay" does not exist` even though only one of
-- the three CTEs is actually recursive. `RECURSIVE` on the outer WITH
-- flips the parser mode for the whole statement; non-recursive CTEs
-- keep working normally.
WITH RECURSIVE ordered_receipts AS (
  SELECT
    sr."itemId",
    sr."createdAt"                                    AS received_at,
    sr.quantity                                       AS qty,
    COALESCE(sr."unitCost", 0)                        AS unit_cost,
    ROW_NUMBER() OVER (PARTITION BY sr."itemId" ORDER BY sr."createdAt") AS rn
  FROM "StockReceipt" sr
  WHERE sr.source = 'SUPPLIER'
    AND sr."unitCost" IS NOT NULL
    AND sr."unitCost" > 0
),
-- Recursive replay of the CORRECT weighted-average formula over the
-- receipt history, one item at a time.
-- IMPORTANT: both branches must return IDENTICAL column types. The
-- schema stores quantity/unit_cost as numeric(18,4); addition and
-- division produce unbounded `numeric`, which is a different type from
-- numeric(18,4). Postgres rejects the UNION ALL with
--   "column N has type numeric(18,4) in non-recursive term but type
--    numeric overall".
-- Fix: cast BOTH branches to unqualified `numeric` so the types match.
replay AS (
  SELECT
    r."itemId",
    r.rn,
    r.qty::numeric              AS running_qty,
    r.unit_cost::numeric        AS running_avg
  FROM ordered_receipts r
  WHERE r.rn = 1

  UNION ALL

  SELECT
    r."itemId",
    r.rn,
    (p.running_qty + r.qty)::numeric,
    ((p.running_qty * p.running_avg + r.qty * r.unit_cost)
      / NULLIF(p.running_qty + r.qty, 0))::numeric
  FROM ordered_receipts r
  JOIN replay p ON p."itemId" = r."itemId" AND r.rn = p.rn + 1
),
final_replay AS (
  SELECT DISTINCT ON ("itemId") "itemId", running_qty, running_avg
  FROM replay
  ORDER BY "itemId", rn DESC
)
SELECT
  i.name,
  i.sku,
  i.unit,
  ROUND(fr.running_qty::numeric, 3)                        AS replayed_qty_from_receipts,
  ROUND(fr.running_avg::numeric, 6)                        AS replayed_correct_avg,
  ROUND(COALESCE(i."avgCost", 0)::numeric, 6)              AS stored_avg,
  ROUND(
    (COALESCE(i."avgCost", 0) - fr.running_avg)::numeric, 6
  ) AS drift,
  CASE
    WHEN ABS(COALESCE(i."avgCost", 0) - fr.running_avg) < 0.001 THEN 'OK'
    WHEN COALESCE(i."avgCost", 0) > fr.running_avg              THEN 'STORED_HIGH — inflated by double-count'
    ELSE                                                             'STORED_LOW  — investigate'
  END AS diagnosis
FROM final_replay fr
JOIN "Item" i ON i.id = fr."itemId"
WHERE i.active = TRUE
ORDER BY ABS(COALESCE(i."avgCost", 0) - fr.running_avg) DESC;


-- =====================================================================
-- L) SYSTEM_HIGH decomposition — where did the "opening balance" come from?
-- =====================================================================
-- Query C flags any item where `system_now > reconstructed_from_movements`.
-- Because every mutating code path today writes a paired StockMovement,
-- the only way to have SYSTEM_HIGH is that some quantity landed in
-- StockLevel WITHOUT ever going through StockMovement. Grep of the entire
-- repo shows exactly one such place: `prisma/seed.ts:217-285` seeds
-- five opening balances via `stockLevel.upsert` and never creates a
-- matching movement. Any other SYSTEM_HIGH row would indicate direct
-- manual DB manipulation (should never happen).
--
-- This query cross-checks: for each item, `implied_opening_balance` is
-- the exact quantity that would need to have existed on day zero for
-- `Σ StockMovement` to reconcile to the current balance. Rows where
-- `implied_opening_balance = 0` (or |x| < 0.001) are clean. Rows where
-- it is positive are either seeded openings (expected) or historical
-- opening balances the customer entered before the movement-tracking
-- code path existed.
-- ---------------------------------------------------------------------
WITH reconstructed AS (
  SELECT sm."itemId",
    SUM(
      CASE
        WHEN sm.type IN ('IN', 'RETURN') THEN sm.quantity
        WHEN sm.type IN ('OUT', 'WASTE') THEN -sm.quantity
        WHEN sm.type = 'ADJUSTMENT' THEN
          CASE
            WHEN sm."toWarehouseId"   IS NOT NULL THEN  sm.quantity
            WHEN sm."fromWarehouseId" IS NOT NULL THEN -sm.quantity
            ELSE 0
          END
        WHEN sm.type = 'TRANSFER' THEN 0
        ELSE 0
      END
    ) AS movements_net
  FROM "StockMovement" sm
  GROUP BY sm."itemId"
),
current_stock AS (
  SELECT "itemId", COALESCE(SUM(quantity), 0) AS total FROM "StockLevel" GROUP BY "itemId"
),
receipt_seen AS (
  SELECT "itemId", COUNT(*)::int AS receipts, MIN("createdAt") AS first_receipt
  FROM "StockReceipt" GROUP BY "itemId"
)
SELECT
  i.name                                                              AS item_name,
  i.sku,
  i.unit,
  ROUND(COALESCE(cs.total, 0)::numeric, 3)                            AS system_now,
  ROUND(COALESCE(r.movements_net, 0)::numeric, 3)                     AS ledger_net,
  ROUND(
    (COALESCE(cs.total, 0) - COALESCE(r.movements_net, 0))::numeric, 3
  )                                                                   AS implied_opening_balance,
  COALESCE(rs.receipts, 0)                                            AS receipts_recorded,
  rs.first_receipt,
  CASE
    WHEN ABS(COALESCE(cs.total, 0) - COALESCE(r.movements_net, 0)) < 0.001
      THEN 'OK — every unit in stock has a matching StockMovement'
    WHEN i.sku IN ('RAW-MILK-200', 'RAW-MILK-500', 'CTN-24', 'CTN-12', 'ALU-200')
      THEN 'SEED_OPENING — prisma/seed.ts wrote an opening balance without a movement (expected on any seeded env)'
    ELSE
      'UNKNOWN_OPENING — investigate: neither a seed SKU nor a matched ledger. Confirm this was intentional.'
  END                                                                 AS classification
FROM "Item" i
LEFT JOIN current_stock cs ON cs."itemId" = i.id
LEFT JOIN reconstructed r  ON r."itemId"  = i.id
LEFT JOIN receipt_seen rs  ON rs."itemId" = i.id
WHERE ABS(COALESCE(cs.total, 0) - COALESCE(r.movements_net, 0)) > 0.001
ORDER BY implied_opening_balance DESC;


-- =====================================================================
-- M) The five seeded opening balances (documented reference)
-- =====================================================================
-- Exact list of items and quantities that prisma/seed.ts assigns as
-- opening stock. If your SYSTEM_HIGH rows in Query C match this list
-- one-for-one, the "drift" is expected and safe to ignore. If any
-- item flagged SYSTEM_HIGH does NOT appear here, dig deeper.
-- ---------------------------------------------------------------------
SELECT sku, seeded_qty, seeded_warehouse_code FROM (VALUES
  ('RAW-MILK-200', 2000::numeric, 'BULK'),
  ('RAW-MILK-500', 1500::numeric, 'BULK'),
  ('CTN-24',      10000::numeric, 'PKG'),
  ('CTN-12',        500::numeric, 'PKG'),
  ('ALU-200',      2000::numeric, 'PKG')
) AS s(sku, seeded_qty, seeded_warehouse_code);
