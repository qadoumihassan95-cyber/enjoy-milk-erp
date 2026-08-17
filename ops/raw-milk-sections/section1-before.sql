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
-- SECTION 1 — BEFORE (READ-ONLY). Keep this output.
-- =====================================================================
SELECT
  i.id AS item_id, i.sku, i.name, i.unit,
  COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0)   AS stocklevel_total,
  (SELECT COUNT(*) FROM "StockLevel"    sl WHERE sl."itemId"=i.id)                    AS stocklevel_rows,
  COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) AS fifo_remaining,
  (SELECT COUNT(*) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id)                    AS batches,
  (SELECT COUNT(*) FROM "StockMovement" sm WHERE sm."itemId"=i.id)                    AS movements
FROM "Item" i
WHERE i.id = 'cmrxe2q6y0004rcaasmpih45d';
-- Expect: 40000.0000 | 1 | 0 | 0 | 7

-- Global counters, to prove later that nothing else moved.
SELECT 'StockLevel rows'    AS metric, COUNT(*)::text AS value FROM "StockLevel"
UNION ALL SELECT 'StockLevel sum',     COALESCE(SUM(quantity),0)::text FROM "StockLevel"
UNION ALL SELECT 'StockMovement rows', (SELECT COUNT(*)::text FROM "StockMovement")
UNION ALL SELECT 'PurchaseBatch rows', (SELECT COUNT(*)::text FROM "PurchaseBatch");
-- Expect: 22 | 7383058.2000 | 136 | 14
