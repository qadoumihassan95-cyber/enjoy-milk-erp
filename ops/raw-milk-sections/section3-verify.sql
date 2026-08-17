-- =====================================================================
--  SCOPED opening-stock backfill — حليب خام ONLY
-- =====================================================================
--  Creates exactly ONE PurchaseBatch, for one item, so that daily
--  production sheet cmsw2910y0004u37ykqdooolr can post. Every other item
--  is deliberately left alone pending the costing recovery exercise
--  (see ops/COSTING-RECOVERY-REPORT-2026-08-17.md).
--
--  TARGET — verified live 2026-08-17
--  --------------------------------
--    itemId        cmrxe2q6y0004rcaasmpih45d
--    tenantId      cmpejojr80000uef0dx69ve2q
--    sku           ITM-MRXE2Q6X
--    name          حليب خام
--    unit          KG
--    active        true
--    StockLevel    40,000.0000  (1 row)
--    FIFO remaining 0           (0 existing batches, 0 OPENING_BALANCE)
--    StockMovements 7
--
--  Exactly one item is named حليب خام, so the target is unambiguous. The
--  script still pins the itemId literally rather than matching on name.
--
--  WHAT IT WRITES
--  --------------
--  One row in "PurchaseBatch": quantity = remaining = 40000, unit KG,
--  sourceType 'OPENING_BALANCE', purchaseDate 2000-01-01 so it sorts
--  FIRST under FIFO and is consumed before any real receipt.
--
--  It writes to NO other table. No StockLevel, no StockMovement, no
--  allocation, no item master data. StockLevel is already 40,000 — this
--  only gives that existing balance a cost basis so FIFO can consume it.
--
--  ⚠ YOU MUST SET THE UNIT COST — SECTION 2, ONE LINE
--  The script ABORTS if the placeholder is left at 0, so it cannot
--  silently create another zero-cost batch. Cost is per KG, in JOD.
--
--  No reliable cost exists in the database for this item (avgCost 0,
--  costPrice 0, no priced receipts). The only related legacy record is
--  "حليب خام عبوة 1 لتر" at 0.50 per LITRE — a different unit, so treat
--  it as a sanity anchor, not an answer.
--
--  REVERSAL
--  --------
--  Safe to undo while nothing has consumed it:
--    DELETE FROM "PurchaseBatch"
--    WHERE "itemId" = 'cmrxe2q6y0004rcaasmpih45d'
--      AND "sourceType" = 'OPENING_BALANCE';
--  (Refuses if a ProductionCostAllocation references it — by design.)
--
--  HOW TO RUN
--  ----------
--  Render Dashboard → enjoymilk-db → Query Console.
--  Section 1, keep the output → edit the cost in Section 2 → run
--  Section 2 → run Section 3.
-- =====================================================================

-- =====================================================================
-- SECTION 3 — AFTER verification (READ-ONLY). All must pass.
-- =====================================================================

-- 3a. FIFO coverage for حليب خام
SELECT
  'FIFO remaining (expect 40000.0000)' AS check,
  COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb
            WHERE pb."itemId"='cmrxe2q6y0004rcaasmpih45d'),0)::text AS value
UNION ALL
SELECT 'StockLevel total (must still be 40000.0000)',
  COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl
            WHERE sl."itemId"='cmrxe2q6y0004rcaasmpih45d'),0)::text
UNION ALL
SELECT 'StockLevel rows for item (must still be 1)',
  (SELECT COUNT(*)::text FROM "StockLevel" WHERE "itemId"='cmrxe2q6y0004rcaasmpih45d')
UNION ALL
SELECT 'StockMovements for item (must still be 7)',
  (SELECT COUNT(*)::text FROM "StockMovement" WHERE "itemId"='cmrxe2q6y0004rcaasmpih45d')
UNION ALL
SELECT 'OPENING_BALANCE batches for item (expect exactly 1)',
  (SELECT COUNT(*)::text FROM "PurchaseBatch"
   WHERE "itemId"='cmrxe2q6y0004rcaasmpih45d' AND "sourceType"='OPENING_BALANCE')
UNION ALL
SELECT 'total batches for item (expect 1)',
  (SELECT COUNT(*)::text FROM "PurchaseBatch" WHERE "itemId"='cmrxe2q6y0004rcaasmpih45d')
UNION ALL
SELECT 'batch unitCost (must NOT be 0)',
  (SELECT COALESCE(MAX("unitCost"),0)::text FROM "PurchaseBatch"
   WHERE "itemId"='cmrxe2q6y0004rcaasmpih45d' AND "sourceType"='OPENING_BALANCE');

-- 3b. Nothing else in the database moved.
SELECT 'StockLevel rows (must be 22)'          AS metric, COUNT(*)::text AS value FROM "StockLevel"
UNION ALL SELECT 'StockLevel sum (must be 7383058.2000)', COALESCE(SUM(quantity),0)::text FROM "StockLevel"
UNION ALL SELECT 'StockMovement rows (must be 136)',      (SELECT COUNT(*)::text FROM "StockMovement")
UNION ALL SELECT 'PurchaseBatch rows (14 -> expect 15)',  (SELECT COUNT(*)::text FROM "PurchaseBatch")
UNION ALL SELECT 'ProductionCostAllocation (must be 0)',  (SELECT COUNT(*)::text FROM "ProductionCostAllocation")
UNION ALL SELECT 'negative StockLevel rows (expect 0)',   (SELECT COUNT(*)::text FROM "StockLevel" WHERE quantity < 0);

-- 3c. No other item gained a batch — OPENING_BALANCE must exist for
--     exactly one item, حليب خام, and nothing else.
SELECT i.name, COUNT(*) AS opening_batches
FROM "PurchaseBatch" pb JOIN "Item" i ON i.id = pb."itemId"
WHERE pb."sourceType" = 'OPENING_BALANCE'
GROUP BY i.name;
-- Expect exactly one row: حليب خام | 1

-- 3d. The sheet this unblocks needs 500 KG.
SELECT
  (SELECT SUM(m.quantity) FROM "ProductionMilkUsage" m
   WHERE m."dailyProductionId" = 'cmsw2910y0004u37ykqdooolr')                        AS required,
  COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb
            WHERE pb."itemId"='cmrxe2q6y0004rcaasmpih45d'),0)                        AS fifo_available,
  CASE WHEN COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb
                      WHERE pb."itemId"='cmrxe2q6y0004rcaasmpih45d'),0)
            >= COALESCE((SELECT SUM(m.quantity) FROM "ProductionMilkUsage" m
                         WHERE m."dailyProductionId"='cmsw2910y0004u37ykqdooolr'),0)
       THEN 'COVERED — sheet can post with no shortage'
       ELSE 'STILL SHORT' END                                                         AS verdict;
-- Expect: 500 | 40000 | COVERED
