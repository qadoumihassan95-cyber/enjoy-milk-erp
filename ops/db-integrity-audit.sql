-- =====================================================================
--  DATABASE INTEGRITY AUDIT — READ-ONLY
-- =====================================================================
--  Verifies: duplicate movements, orphan rows, negative stock,
--  negative batches, impossible costs, broken foreign keys.
--
--  Runs safely against production. Every query is a SELECT.
--  Any query that returns zero rows is a PASS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- INT-01: Negative StockLevel quantities
-- ---------------------------------------------------------------------
-- Expected: 0 rows. StockLevel.quantity should never be < 0 after any
-- of our transactions (the fix removed Math.max(0,…) silent clamps and
-- now throws instead).
SELECT sl.id, i.name AS item_name, w.code AS warehouse_code, sl.quantity
FROM "StockLevel" sl
JOIN "Item" i      ON i.id = sl."itemId"
JOIN "Warehouse" w ON w.id = sl."warehouseId"
WHERE sl.quantity < 0;


-- ---------------------------------------------------------------------
-- INT-02: Negative PurchaseBatch.remaining
-- ---------------------------------------------------------------------
-- Expected: 0 rows. FIFO consume should never take more than remaining.
SELECT pb.id, i.name, pb.quantity, pb.remaining, pb."unitCost", pb."sourceType"
FROM "PurchaseBatch" pb
JOIN "Item" i ON i.id = pb."itemId"
WHERE pb.remaining < 0;


-- ---------------------------------------------------------------------
-- INT-03: Batch remaining > original quantity (over-restored on reverse)
-- ---------------------------------------------------------------------
-- Expected: 0 rows. If a reverseForSale over-restored a batch, we'd
-- see remaining exceed the original inbound quantity.
SELECT pb.id, i.name, pb.quantity, pb.remaining
FROM "PurchaseBatch" pb
JOIN "Item" i ON i.id = pb."itemId"
WHERE pb.remaining > pb.quantity + 0.001;


-- ---------------------------------------------------------------------
-- INT-04: Duplicate StockMovement (same ref + same item + same qty)
-- ---------------------------------------------------------------------
-- Expected: 0 rows. A double-submit of the same daily-production post
-- or the same order create would show up here.
SELECT
  sm."refType", sm."refId", sm."itemId", sm.type, sm.quantity,
  COUNT(*) AS dup_count,
  MIN(sm."performedAt") AS first_seen,
  MAX(sm."performedAt") AS last_seen
FROM "StockMovement" sm
WHERE sm."refId" IS NOT NULL
GROUP BY sm."refType", sm."refId", sm."itemId", sm.type, sm.quantity
HAVING COUNT(*) > 1
ORDER BY dup_count DESC;


-- ---------------------------------------------------------------------
-- INT-05: Impossible costs (negative or absurd unit cost / avg cost)
-- ---------------------------------------------------------------------
SELECT 'Item.costPrice' AS field, i.id, i.name, i."costPrice" AS value
FROM "Item" i WHERE i."costPrice" IS NOT NULL AND i."costPrice" < 0
UNION ALL
SELECT 'Item.avgCost', i.id, i.name, i."avgCost"
FROM "Item" i WHERE i."avgCost" IS NOT NULL AND i."avgCost" < 0
UNION ALL
SELECT 'PurchaseBatch.unitCost', pb.id::text, i.name, pb."unitCost"
FROM "PurchaseBatch" pb JOIN "Item" i ON i.id = pb."itemId"
WHERE pb."unitCost" < 0
UNION ALL
SELECT 'StockReceipt.unitCost', sr.id, i.name, sr."unitCost"
FROM "StockReceipt" sr JOIN "Item" i ON i.id = sr."itemId"
WHERE sr."unitCost" IS NOT NULL AND sr."unitCost" < 0;


-- ---------------------------------------------------------------------
-- INT-06: Orphan StockLevel (points at deleted Item or Warehouse)
-- ---------------------------------------------------------------------
-- Should be 0 — the schema has ON DELETE RESTRICT on both FKs.
SELECT sl.id, sl."itemId", sl."warehouseId"
FROM "StockLevel" sl
LEFT JOIN "Item" i      ON i.id = sl."itemId"
LEFT JOIN "Warehouse" w ON w.id = sl."warehouseId"
WHERE i.id IS NULL OR w.id IS NULL;


-- ---------------------------------------------------------------------
-- INT-07: Orphan StockMovement (points at deleted Item or Warehouse)
-- ---------------------------------------------------------------------
SELECT sm.id, sm."itemId", sm."fromWarehouseId", sm."toWarehouseId"
FROM "StockMovement" sm
LEFT JOIN "Item" i         ON i.id = sm."itemId"
LEFT JOIN "Warehouse" wf   ON wf.id = sm."fromWarehouseId"
LEFT JOIN "Warehouse" wt   ON wt.id = sm."toWarehouseId"
WHERE i.id IS NULL
   OR (sm."fromWarehouseId" IS NOT NULL AND wf.id IS NULL)
   OR (sm."toWarehouseId"   IS NOT NULL AND wt.id IS NULL);


-- ---------------------------------------------------------------------
-- INT-08: Orphan SaleCostAllocation (points at deleted PurchaseBatch)
-- ---------------------------------------------------------------------
-- Should be 0 — but if simple-orders.update ran before my fix it might
-- have left rows pointing at consumed batches whose remaining was
-- reversed twice.
--
-- Column name is `saleOrderId` (not `orderId`) per schema.prisma.
SELECT sca.id, sca."saleOrderId", sca."batchId", sca.quantity, sca."totalCost"
FROM "SaleCostAllocation" sca
LEFT JOIN "PurchaseBatch" pb ON pb.id = sca."batchId"
WHERE pb.id IS NULL;


-- ---------------------------------------------------------------------
-- INT-09: Duplicate SimpleOrderPayment.number within one order
-- ---------------------------------------------------------------------
-- Should be 0. Concurrent addPayment race would produce duplicates.
SELECT p."orderId", p.number, COUNT(*) AS dup
FROM "SimpleOrderPayment" p
GROUP BY p."orderId", p.number
HAVING COUNT(*) > 1;


-- ---------------------------------------------------------------------
-- INT-10: SimpleOrder cached paid ≠ Σ(SimpleOrderPayment.amount)
-- ---------------------------------------------------------------------
-- The order.paid column is cached from addPayment. Any drift means the
-- cache is stale and reports will show a wrong "collected" number.
SELECT
  so.id, so.number, so."customerName",
  ROUND(so.paid::numeric, 3)                                 AS cached_paid,
  ROUND(COALESCE(SUM(p.amount), 0)::numeric, 3)              AS actual_paid,
  ROUND((so.paid - COALESCE(SUM(p.amount), 0))::numeric, 3)  AS drift
FROM "SimpleOrder" so
LEFT JOIN "SimpleOrderPayment" p ON p."orderId" = so.id
GROUP BY so.id, so.number, so."customerName", so.paid
HAVING ABS(so.paid - COALESCE(SUM(p.amount), 0)) > 0.01;


-- ---------------------------------------------------------------------
-- INT-11: SimpleOrder.total ≠ Σ(SimpleOrderLine.lineTotal) + shippingCost
-- ---------------------------------------------------------------------
SELECT
  so.id, so.number,
  ROUND(so.total::numeric, 3)                                                       AS cached_total,
  ROUND((COALESCE(SUM(l."lineTotal"), 0) + COALESCE(so."shippingCost", 0))::numeric, 3) AS recomputed,
  ROUND((so.total - COALESCE(SUM(l."lineTotal"), 0) - COALESCE(so."shippingCost", 0))::numeric, 3) AS drift
FROM "SimpleOrder" so
LEFT JOIN "SimpleOrderLine" l ON l."orderId" = so.id
WHERE so.status <> 'CANCELLED'
GROUP BY so.id, so.number, so.total, so."shippingCost"
HAVING ABS(so.total - COALESCE(SUM(l."lineTotal"), 0) - COALESCE(so."shippingCost", 0)) > 0.01;


-- ---------------------------------------------------------------------
-- INT-12: Cashbox balance ≠ reconstructed Σ(CashMovement)
-- ---------------------------------------------------------------------
-- IMPORTANT: TRANSFER rows must NOT be treated as always outflowing.
-- Every cashbox-to-cashbox transfer writes two rows (one per box) with
-- type='TRANSFER' and the direction encoded in the description prefix
-- ('تحويل صادر' = outgoing, 'تحويل وارد' = incoming). A naïve
-- `WHEN type='IN' THEN +amount ELSE -amount` treats both sides as
-- outflows, double-counting transfers and inflating drift on every
-- cashbox that has ever transferred. The formula below reconstructs
-- the ledger correctly by parsing direction from description.
--
-- Structural improvement (post-delivery, not blocking): add
--   "counterpartCashboxId" text REFERENCES "Cashbox"(id)
--   "transferDirection"    text CHECK IN ('OUT','IN')
-- columns to CashMovement so this check no longer parses Arabic text.
WITH signed AS (
  SELECT cm."cashboxId",
    CASE
      WHEN cm.type = 'IN'  THEN  cm.amount
      WHEN cm.type = 'OUT' THEN -cm.amount
      WHEN cm.type = 'TRANSFER' AND cm.description ILIKE 'تحويل وارد%' THEN  cm.amount
      WHEN cm.type = 'TRANSFER' AND cm.description ILIKE 'تحويل صادر%' THEN -cm.amount
      WHEN cm.type = 'TRANSFER' THEN 0
      ELSE 0
    END AS signed_amt
  FROM "CashMovement" cm
)
SELECT
  cb.id, cb.name,
  ROUND(cb.balance::numeric, 3)                              AS cached_balance,
  ROUND(COALESCE(SUM(s.signed_amt), 0)::numeric, 3)          AS reconstructed,
  ROUND((cb.balance - COALESCE(SUM(s.signed_amt), 0))::numeric, 3) AS drift
FROM "Cashbox" cb
LEFT JOIN signed s ON s."cashboxId" = cb.id
GROUP BY cb.id, cb.name, cb.balance
HAVING ABS(cb.balance - COALESCE(SUM(s.signed_amt), 0)) > 0.01;


-- ---------------------------------------------------------------------
-- INT-13: PayrollAdjustment with paid=true but no cashboxId
-- ---------------------------------------------------------------------
-- The pay flow writes:  Expense + Cashbox.balance decrement +
-- CashMovement, AND sets paid=true + paidAt + cashboxId on the
-- PayrollAdjustment. If paid=true but cashboxId is NULL, the audit
-- trail linking a paid payroll to a specific cashbox is broken — that
-- adjustment cannot be traced to a specific cash movement.
--
-- NOTE: PayrollAdjustment has NO `netAmount` column — net pay is
-- computed at request time from Employee.baseSalary + adjustments in
-- the app layer. The prior version of this check referenced a
-- non-existent column; this version uses only fields that actually
-- exist per schema.prisma.
SELECT pa.id, pa."employeeId", pa.month, pa."paidAt", pa."cashboxId"
FROM "PayrollAdjustment" pa
WHERE pa.paid = TRUE
  AND pa."cashboxId" IS NULL;


-- ---------------------------------------------------------------------
-- INT-14: Item.unit values outside the enumerated whitelist
-- ---------------------------------------------------------------------
SELECT i.id, i.sku, i.name, i.unit
FROM "Item" i
WHERE i.unit NOT IN ('PCS','CTN','KG','G','BAG','ROLL');


-- ---------------------------------------------------------------------
-- INT-15: Item stocked in BAG but bagWeightKg missing / invalid
-- ---------------------------------------------------------------------
SELECT i.id, i.sku, i.name, i."bagWeightKg",
  CASE
    WHEN i."bagWeightKg" IS NULL THEN 'NULL — conversion impossible'
    WHEN i."bagWeightKg" <= 0    THEN 'ZERO/NEGATIVE — invalid'
    ELSE 'OK'
  END AS diagnosis
FROM "Item" i
WHERE i.unit = 'BAG' AND i.active = TRUE
  AND (i."bagWeightKg" IS NULL OR i."bagWeightKg" <= 0);


-- ---------------------------------------------------------------------
-- INT-16: PurchaseBatch remaining ≠ ledger reconciliation
-- ---------------------------------------------------------------------
-- For each batch, `remaining` should equal `quantity − Σ(SaleCostAllocation.qty)`.
-- Drift means either FIFO consume ran without recording an allocation,
-- OR reverse ran without incrementing remaining.
SELECT
  pb.id, i.name AS item, pb.quantity, pb.remaining,
  ROUND(COALESCE(SUM(sca.quantity), 0)::numeric, 3) AS allocated,
  ROUND((pb.quantity - COALESCE(SUM(sca.quantity), 0) - pb.remaining)::numeric, 3) AS drift
FROM "PurchaseBatch" pb
JOIN "Item" i ON i.id = pb."itemId"
LEFT JOIN "SaleCostAllocation" sca ON sca."batchId" = pb.id
GROUP BY pb.id, i.name, pb.quantity, pb.remaining
HAVING ABS(pb.quantity - COALESCE(SUM(sca.quantity), 0) - pb.remaining) > 0.001;


-- ---------------------------------------------------------------------
-- INT-17: DailyProduction posts with produced items but NO PurchaseBatch
-- ---------------------------------------------------------------------
-- After the new fix, every POSTED DailyProduction with produced rows
-- should have one PurchaseBatch per produced item. Legacy posts made
-- BEFORE the fix will show up here (informational — they never got a
-- batch and sales of that stock will record COGS=0 until reconciled).
SELECT
  dp.id AS production_id, dp."productionDate", dp.status,
  ppi.id AS produced_row_id, ppi."itemId", ppi."itemName", ppi."cartonsTotal",
  (SELECT COUNT(*) FROM "PurchaseBatch" pb
     WHERE pb."sourceType" = 'PRODUCTION' AND pb."sourceRefId" = dp.id
       AND pb."itemId" = ppi."itemId") AS batches_for_this_produced_item
FROM "DailyProduction" dp
JOIN "ProductionProducedItem" ppi ON ppi."dailyProductionId" = dp.id
WHERE dp.status = 'POSTED'
  AND ppi."itemId" IS NOT NULL
  AND ppi."cartonsTotal" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "PurchaseBatch" pb
    WHERE pb."sourceType" = 'PRODUCTION' AND pb."sourceRefId" = dp.id
      AND pb."itemId" = ppi."itemId"
  )
ORDER BY dp."productionDate";


-- ---------------------------------------------------------------------
-- INT-18: DailyProduction that were cancelled twice (should be impossible)
-- ---------------------------------------------------------------------
SELECT dp.id, dp."productionDate",
  (SELECT COUNT(*) FROM "StockMovement" sm
     WHERE sm."refType" = 'DailyProduction-Reversal' AND sm."refId" = dp.id) AS reversal_movements
FROM "DailyProduction" dp
WHERE (SELECT COUNT(*) FROM "StockMovement" sm
         WHERE sm."refType" = 'DailyProduction-Reversal' AND sm."refId" = dp.id)
      > (SELECT COUNT(*) FROM "StockMovement" sm2
           WHERE sm2."refType" = 'DailyProduction' AND sm2."refId" = dp.id);


-- ---------------------------------------------------------------------
-- INT-19: StockLevel Σ per item vs Σ PurchaseBatch.remaining per item
-- ---------------------------------------------------------------------
-- Every unit currently sitting on the shelf should be represented by a
-- PurchaseBatch remaining. This is the master reconciliation check for
-- raw materials post-Blocker-1: any drift here means either FIFO
-- consumption ran without decrementing StockLevel, OR StockLevel was
-- adjusted without a matching batch update.
--
-- Expected: 0 rows on healthy DB (once the produced-batch backfill
-- from ops/produced-batch-backfill.sql has been reviewed & applied).
-- Before that backfill this WILL return rows for every SKU that was
-- ever produced pre-B1 — informational, not a bug.
SELECT
  i.id, i.sku, i.name, i.unit,
  ROUND(COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)::numeric, 3) AS stock_level_total,
  ROUND(COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)::numeric, 3) AS batches_remaining_total,
  ROUND((
    COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
  )::numeric, 3) AS drift
FROM "Item" i
WHERE i.active = TRUE
  AND ABS(
    COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
    - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
  ) > 0.001
ORDER BY ABS(
  COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId" = i.id), 0)
  - COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId" = i.id), 0)
) DESC;


-- ---------------------------------------------------------------------
-- INT-20: PurchaseBatch fully reconciled — quantity == remaining +
--         Σ SaleCostAllocation.qty [+ Σ ProductionCostAllocation.qty]
-- ---------------------------------------------------------------------
-- If migration 20260816120000_production_cost_allocation has NOT been
-- applied yet, the ProductionCostAllocation table doesn't exist and
-- the query would ERROR. We use a DO block + to_regclass() to detect
-- and either run the full check or the reduced check, writing the
-- result into a temp table that the following SELECT reads.
-- ---------------------------------------------------------------------
DO $INT20$
BEGIN
  DROP TABLE IF EXISTS pg_temp._int_20;
  IF to_regclass('public."ProductionCostAllocation"') IS NULL THEN
    -- Pre-migration: check only against SaleCostAllocation.
    CREATE TEMP TABLE _int_20 AS
    SELECT
      pb.id, i.name AS item, pb.quantity, pb.remaining,
      ROUND(COALESCE((SELECT SUM(sca.quantity) FROM "SaleCostAllocation" sca WHERE sca."batchId" = pb.id), 0)::numeric, 3) AS sold,
      NULL::numeric AS produced_from,
      ROUND((
        pb.quantity
        - COALESCE((SELECT SUM(sca.quantity) FROM "SaleCostAllocation" sca WHERE sca."batchId" = pb.id), 0)
        - pb.remaining
      )::numeric, 3) AS drift,
      'PRE-MIGRATION: ProductionCostAllocation not present, checked SaleCostAllocation only' AS mode
    FROM "PurchaseBatch" pb
    JOIN "Item" i ON i.id = pb."itemId"
    WHERE ABS(
      pb.quantity
      - COALESCE((SELECT SUM(sca.quantity) FROM "SaleCostAllocation" sca WHERE sca."batchId" = pb.id), 0)
      - pb.remaining
    ) > 0.001;
  ELSE
    -- Post-migration: include ProductionCostAllocation.
    EXECUTE $q$
      CREATE TEMP TABLE _int_20 AS
      SELECT
        pb.id, i.name AS item, pb.quantity, pb.remaining,
        ROUND(COALESCE((SELECT SUM(sca.quantity) FROM "SaleCostAllocation" sca WHERE sca."batchId" = pb.id), 0)::numeric, 3) AS sold,
        ROUND(COALESCE((SELECT SUM(pca.quantity) FROM "ProductionCostAllocation" pca WHERE pca."batchId" = pb.id), 0)::numeric, 3) AS produced_from,
        ROUND((
          pb.quantity
          - COALESCE((SELECT SUM(sca.quantity) FROM "SaleCostAllocation" sca WHERE sca."batchId" = pb.id), 0)
          - COALESCE((SELECT SUM(pca.quantity) FROM "ProductionCostAllocation" pca WHERE pca."batchId" = pb.id), 0)
          - pb.remaining
        )::numeric, 3) AS drift,
        'POST-MIGRATION: full check' AS mode
      FROM "PurchaseBatch" pb
      JOIN "Item" i ON i.id = pb."itemId"
      WHERE ABS(
        pb.quantity
        - COALESCE((SELECT SUM(sca.quantity) FROM "SaleCostAllocation" sca WHERE sca."batchId" = pb.id), 0)
        - COALESCE((SELECT SUM(pca.quantity) FROM "ProductionCostAllocation" pca WHERE pca."batchId" = pb.id), 0)
        - pb.remaining
      ) > 0.001
    $q$;
  END IF;
END
$INT20$;
SELECT * FROM _int_20;


-- ---------------------------------------------------------------------
-- INT-21: Orphan ProductionCostAllocation (points at deleted DailyProduction
-- or deleted PurchaseBatch). Guarded — table only exists post-migration.
-- ---------------------------------------------------------------------
DO $INT21$
BEGIN
  DROP TABLE IF EXISTS pg_temp._int_21;
  IF to_regclass('public."ProductionCostAllocation"') IS NULL THEN
    CREATE TEMP TABLE _int_21 (skip_reason TEXT);
    INSERT INTO _int_21 VALUES ('SKIPPED: ProductionCostAllocation table missing — migration 20260816120000 not yet applied');
  ELSE
    EXECUTE $q$
      CREATE TEMP TABLE _int_21 AS
      SELECT pca.id, pca."dailyProductionId", pca."batchId"
      FROM "ProductionCostAllocation" pca
      LEFT JOIN "DailyProduction" dp ON dp.id = pca."dailyProductionId"
      LEFT JOIN "PurchaseBatch" pb   ON pb.id = pca."batchId"
      WHERE dp.id IS NULL OR pb.id IS NULL
    $q$;
  END IF;
END
$INT21$;
SELECT * FROM _int_21;
