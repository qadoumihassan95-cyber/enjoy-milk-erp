-- =====================================================================
--  PROPOSED RECONCILIATION PLAN — read-only preview
-- =====================================================================
--
--  This file produces the LIST of stock adjustments we WOULD write to
--  the database if you approve. Nothing here writes anything. Every
--  statement is a SELECT.
--
--  After you approve the numbers, we will apply them via a separate
--  INSERT script that:
--     • stamps every row with reason = 'PRE_SINGLE_WAREHOUSE_RECONCILIATION'
--     • wraps every write in one $transaction
--     • pairs each StockAdjustment with a StockMovement so the audit
--       trail stays complete
--     • runs BEFORE the single-warehouse migration
--
--  Nothing in the historical DailyProduction / SimpleOrder / StockReceipt
--  tables is ever modified. Only new StockAdjustment + StockMovement rows
--  get created, so the old history remains reconstructable.
-- =====================================================================


-- ---------------------------------------------------------------------
-- P1 — Aluminum candidates (production consumption that never deducted)
-- ---------------------------------------------------------------------
WITH aluminum_rows AS (
  SELECT dp.id AS production_id, dp.status, dp."tenantId",
         au."itemId" AS item_id, au.quantity AS sheet_qty
  FROM "DailyProduction" dp
  JOIN "ProductionAluminumUsage" au ON au."dailyProductionId" = dp.id
  WHERE dp.status = 'POSTED' AND au."itemId" IS NOT NULL
),
matched AS (
  SELECT sm."refId" AS production_id, sm."itemId" AS item_id, SUM(sm.quantity) AS actually
  FROM "StockMovement" sm
  WHERE sm."refType" = 'DailyProduction'
    AND sm."reasonCode" = 'PROD_ALUMINUM'
    AND sm.type = 'OUT'
  GROUP BY sm."refId", sm."itemId"
)
SELECT
  ar."tenantId"                                                          AS tenant_id,
  i.id                                                                   AS item_id,
  i.name                                                                 AS item_name,
  'ALUMINUM_HISTORICAL'                                                  AS reason_category,
  'DEDUCT'                                                               AS proposed_type,
  ROUND(SUM(ar.sheet_qty - COALESCE(m.actually, 0))::numeric, 3)         AS proposed_qty,
  'Aluminum consumption recorded on production sheets that was silently skipped by legacy PKG-warehouse resolution'
                                                                         AS proposed_reason,
  'PRE_SINGLE_WAREHOUSE_RECONCILIATION'                                  AS proposed_ref_type,
  ('Sheet total = '  || ROUND(SUM(ar.sheet_qty)::numeric, 3)
   || ' — Movement total = ' || ROUND(SUM(COALESCE(m.actually, 0))::numeric, 3))
                                                                         AS proposed_notes
FROM aluminum_rows ar
JOIN "Item" i ON i.id = ar.item_id
LEFT JOIN matched m ON m.production_id = ar.production_id AND m.item_id = ar.item_id
GROUP BY ar."tenantId", i.id, i.name
HAVING SUM(ar.sheet_qty - COALESCE(m.actually, 0)) > 0.001;


-- ---------------------------------------------------------------------
-- P2 — Sales candidates (order lines whose OUT never happened)
-- ---------------------------------------------------------------------
WITH lines AS (
  SELECT so.id AS order_id, so."tenantId", so.number, ol."itemId", ol.quantity
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
  l."tenantId"                                                           AS tenant_id,
  i.id                                                                   AS item_id,
  i.name                                                                 AS item_name,
  'SALES_HISTORICAL'                                                     AS reason_category,
  'DEDUCT'                                                               AS proposed_type,
  ROUND(SUM(l.quantity - COALESCE(m.moved, 0))::numeric, 3)              AS proposed_qty,
  'Order lines whose inventory OUT movement was never written by the legacy FIN-warehouse resolution'
                                                                         AS proposed_reason,
  'PRE_SINGLE_WAREHOUSE_RECONCILIATION'                                  AS proposed_ref_type,
  ('Affected orders = ' || COUNT(DISTINCT l.order_id))                   AS proposed_notes
FROM lines l
JOIN "Item" i ON i.id = l."itemId"
LEFT JOIN moves m ON m.order_id = l.order_id AND m."itemId" = l."itemId"
GROUP BY l."tenantId", i.id, i.name
HAVING SUM(l.quantity - COALESCE(m.moved, 0)) > 0.001;


-- ---------------------------------------------------------------------
-- P3 — Non-MAIN warehouse residuals (informational)
-- ---------------------------------------------------------------------
-- These will be automatically folded into MAIN by the consolidation
-- migration. NO adjustment needed if the totals are already correct.
-- Listed here so you can eyeball them before the migration runs.
-- ---------------------------------------------------------------------
SELECT
  sl."tenantId"                                              AS tenant_id,
  i.id                                                       AS item_id,
  i.name                                                     AS item_name,
  w.code                                                     AS legacy_warehouse,
  ROUND(SUM(sl.quantity)::numeric, 3)                        AS qty_to_migrate,
  'Will be added to MAIN by 20260814170000_single_warehouse_consolidation. No adjustment needed unless drift confirmed.'
                                                             AS note
FROM "StockLevel" sl
JOIN "Item" i      ON i.id = sl."itemId"
JOIN "Warehouse" w ON w.id = sl."warehouseId"
WHERE w.code <> 'MAIN' AND sl.quantity <> 0
GROUP BY sl."tenantId", i.id, i.name, w.code
ORDER BY i.name, w.code;


-- ---------------------------------------------------------------------
-- P4 — Union preview of every proposed adjustment
-- ---------------------------------------------------------------------
-- Export this result to CSV. Review row-by-row. Approve the whole set,
-- edit specific rows, or reject. We will build the INSERT script only
-- after approval.
-- ---------------------------------------------------------------------
WITH aluminum_props AS (
  WITH aluminum_rows AS (
    SELECT dp.id AS production_id, dp.status, dp."tenantId",
           au."itemId" AS item_id, au.quantity AS sheet_qty
    FROM "DailyProduction" dp
    JOIN "ProductionAluminumUsage" au ON au."dailyProductionId" = dp.id
    WHERE dp.status = 'POSTED' AND au."itemId" IS NOT NULL
  ),
  matched AS (
    SELECT sm."refId" AS production_id, sm."itemId" AS item_id, SUM(sm.quantity) AS actually
    FROM "StockMovement" sm
    WHERE sm."refType" = 'DailyProduction' AND sm."reasonCode" = 'PROD_ALUMINUM' AND sm.type = 'OUT'
    GROUP BY sm."refId", sm."itemId"
  )
  SELECT ar."tenantId", i.id AS item_id, i.name AS item_name,
         'ALUMINUM_HISTORICAL' AS category,
         SUM(ar.sheet_qty - COALESCE(m.actually, 0)) AS delta
  FROM aluminum_rows ar
  JOIN "Item" i ON i.id = ar.item_id
  LEFT JOIN matched m ON m.production_id = ar.production_id AND m.item_id = ar.item_id
  GROUP BY ar."tenantId", i.id, i.name
  HAVING SUM(ar.sheet_qty - COALESCE(m.actually, 0)) > 0.001
),
sales_props AS (
  WITH lines AS (
    SELECT so.id AS order_id, so."tenantId", ol."itemId", ol.quantity
    FROM "SimpleOrder" so JOIN "SimpleOrderLine" ol ON ol."orderId" = so.id
    WHERE ol."itemId" IS NOT NULL AND so.status <> 'CANCELLED'
  ),
  moves AS (
    SELECT sm."refId" AS order_id, sm."itemId", SUM(sm.quantity) AS moved
    FROM "StockMovement" sm WHERE sm."refType" = 'SimpleOrder' AND sm.type = 'OUT'
    GROUP BY sm."refId", sm."itemId"
  )
  SELECT l."tenantId", i.id AS item_id, i.name AS item_name,
         'SALES_HISTORICAL' AS category,
         SUM(l.quantity - COALESCE(m.moved, 0)) AS delta
  FROM lines l JOIN "Item" i ON i.id = l."itemId"
  LEFT JOIN moves m ON m.order_id = l.order_id AND m."itemId" = l."itemId"
  GROUP BY l."tenantId", i.id, i.name
  HAVING SUM(l.quantity - COALESCE(m.moved, 0)) > 0.001
)
SELECT
  ROW_NUMBER() OVER (ORDER BY item_name, category)                AS proposal_no,
  "tenantId"                                                       AS tenant_id,
  item_id,
  item_name,
  category,
  'DEDUCT'                                                         AS type,
  ROUND(delta::numeric, 3)                                         AS qty,
  'PRE_SINGLE_WAREHOUSE_RECONCILIATION'                            AS ref_type
FROM (
  SELECT * FROM aluminum_props
  UNION ALL
  SELECT * FROM sales_props
) x
ORDER BY item_name, category;
