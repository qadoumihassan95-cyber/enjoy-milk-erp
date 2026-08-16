-- =====================================================================
--  ROLLBACK for HOTFIX-2026-08-16-consolidation.sql
-- =====================================================================
--  Captured from the LIVE enjoymilk database on 2026-08-16 immediately
--  before the hotfix, via read-only queries.
--
--  Baseline it restores:
--    StockLevel rows ............ 35
--    Σ StockLevel.quantity ...... 44468.2000
--    Warehouse rows ............. 4  (BULK, PKG, FIN, QHL — all active=true)
--    StockMovement rows ......... 134  (hotfix never touches these)
--    DailyProduction in POSTING . cmsvrcm590014z0puc21wmt28
--
--  This restores every value the hotfix changes. It does NOT delete the
--  MAIN warehouse row the hotfix creates — MAIN with all-zero StockLevel
--  rows is inert, and deleting it would break any StockLevel row that
--  already points at it. Section 3 below removes MAIN's zeroed rows and
--  deactivates it, which is enough to return the system to its prior
--  behaviour exactly.
--
--  Run in Render Dashboard → enjoymilk-db → query console.
-- =====================================================================

BEGIN;

-- ─── 1. Restore every StockLevel quantity ───────────────────────────
UPDATE "StockLevel" SET quantity = 2349.0000 WHERE id = 'cmsubifgb009eklw0s7kg1kjv';
UPDATE "StockLevel" SET quantity = 1333.0000 WHERE id = 'cmrjb5ka8000p9d6d1v8edwh0';
UPDATE "StockLevel" SET quantity = 10000.0000 WHERE id = 'cmrkl4r3p0004iib6drk8qhd4';
UPDATE "StockLevel" SET quantity = 0.0000 WHERE id = 'cmrjatrjr00069d6dnm7lkbwk';
UPDATE "StockLevel" SET quantity = 1100.0000 WHERE id = 'cmrrp8nqs000ba1hb5awccbz0';
UPDATE "StockLevel" SET quantity = 1.0000 WHERE id = 'cmrxmxgdn0027quc94ywbo8dx';
UPDATE "StockLevel" SET quantity = 2565.0000 WHERE id = 'cmrrnwki0001f1wfwrta6azm1';
UPDATE "StockLevel" SET quantity = 460.0000 WHERE id = 'cmrro02f100231wfwo3t4gdzl';
UPDATE "StockLevel" SET quantity = 1575.0000 WHERE id = 'cmrrnsc72000t1wfwp69o4zvp';
UPDATE "StockLevel" SET quantity = 2975.6000 WHERE id = 'cmrrnr4tl000i1wfwh6hj2g5d';
UPDATE "StockLevel" SET quantity = 4027.0000 WHERE id = 'cmrrnpfxn00071wfwpiiwkiir';
UPDATE "StockLevel" SET quantity = 0.0000 WHERE id = 'cmsbhsb6p006qdtbevus4p33t';
UPDATE "StockLevel" SET quantity = 0.0000 WHERE id = 'cmrxepca500049co90a2s75hb';
UPDATE "StockLevel" SET quantity = 499.0000 WHERE id = 'cmsubwil600biklw0zd7zzkdw';
UPDATE "StockLevel" SET quantity = 34.0000 WHERE id = 'cmsbhsb64006idtbex340krzp';
UPDATE "StockLevel" SET quantity = 271.0000 WHERE id = 'cmsbhsb6i006mdtbe68pcalbj';
UPDATE "StockLevel" SET quantity = 90.0000 WHERE id = 'cmsbhsb6v006udtbewxkgyc7d';
UPDATE "StockLevel" SET quantity = 902.0000 WHERE id = 'cmsbhnnsr0062dtbenq46lywt';
UPDATE "StockLevel" SET quantity = 0.0000 WHERE id = 'cmsbhnnsf005udtbeqq6z0b30';
UPDATE "StockLevel" SET quantity = 0.0000 WHERE id = 'cmsbhnnsm005ydtbev12ralko';
UPDATE "StockLevel" SET quantity = 2.0000 WHERE id = 'cmsbhsb7v0076dtbeuph7jtou';
UPDATE "StockLevel" SET quantity = 2.0000 WHERE id = 'cmsbhsb8g007adtbe1rcbn0ck';
UPDATE "StockLevel" SET quantity = 1.0000 WHERE id = 'cmsbhsbb6007edtbe14d381s8';
UPDATE "StockLevel" SET quantity = 1.0000 WHERE id = 'cmsbhsbbg007idtbe7ork5dxh';
UPDATE "StockLevel" SET quantity = 1.0000 WHERE id = 'cmsbhsbdz007mdtbe974fkf0e';
UPDATE "StockLevel" SET quantity = 733.0000 WHERE id = 'cmsbgtmkt004gdtbetwedw9vw';
UPDATE "StockLevel" SET quantity = 1589.0000 WHERE id = 'cmsbgmayy0034dtbeuzjbbzhx';
UPDATE "StockLevel" SET quantity = 2021.0000 WHERE id = 'cmrrp9m38000ma1hbvnmauhw3';
UPDATE "StockLevel" SET quantity = 1618.0000 WHERE id = 'cmrro392r002p1wfw8yszk4go';
UPDATE "StockLevel" SET quantity = 605.0000 WHERE id = 'cmsbgt5ge0046dtbekpwr9ust';
UPDATE "StockLevel" SET quantity = 0.0000 WHERE id = 'cmrrny0je001s1wfwxdy8yv0x';
UPDATE "StockLevel" SET quantity = 4257.0000 WHERE id = 'cmsbgrtnj003mdtbe9ys9gb1t';
UPDATE "StockLevel" SET quantity = 3041.6000 WHERE id = 'cmsbgsf9v003wdtbe4vwbdngw';
UPDATE "StockLevel" SET quantity = 1355.0000 WHERE id = 'cmrro0pfg002e1wfwie3vat7m';
UPDATE "StockLevel" SET quantity = 1060.0000 WHERE id = 'cmrrnu4qj00141wfwem1upeq3';

-- ─── 2. Re-activate the legacy warehouses ───────────────────────────
UPDATE "Warehouse" SET active = true WHERE id = 'cmpejokj9000duef0x8e7quup';  -- BULK
UPDATE "Warehouse" SET active = true WHERE id = 'cmpejoklc000fuef0qkxi04kz';  -- FIN
UPDATE "Warehouse" SET active = true WHERE id = 'cmpejokjg000euef0yq1jejre';  -- PKG
UPDATE "Warehouse" SET active = true WHERE id = 'cmpejoklh000guef0s5azlaok';  -- QHL

-- ─── 3. Neutralise the MAIN warehouse the hotfix created ────────────
-- Remove only the all-zero rows the hotfix inserted for MAIN. Any MAIN
-- row that is non-zero means real activity happened after the hotfix —
-- the DELETE deliberately skips it so nothing real is destroyed.
DELETE FROM "StockLevel"
WHERE "warehouseId" IN (SELECT id FROM "Warehouse" WHERE code = 'MAIN')
  AND quantity = 0;

UPDATE "Warehouse" SET active = false WHERE code = 'MAIN';

-- ─── 4. Re-strand the sheet (only if it is still untouched) ─────────
-- Returns cmsvrcm590014z0puc21wmt28 to POSTING so the rollback is a true
-- point-in-time restore. Skipped automatically if it has since been
-- posted and has real StockMovement rows.
UPDATE "DailyProduction" dp
SET status = 'POSTING'
WHERE dp.id = 'cmsvrcm590014z0puc21wmt28'
  AND dp.status = 'DRAFT'
  AND NOT EXISTS (
    SELECT 1 FROM "StockMovement" sm
    WHERE sm."refType" = 'DailyProduction' AND sm."refId" = dp.id
  );

-- ─── 5. Remove the manual migration markers ─────────────────────────
DELETE FROM "_prisma_migrations"
WHERE checksum = 'applied-manually-hotfix-2026-08-16';

COMMIT;

-- ─── Verify the rollback ────────────────────────────────────────────
SELECT 'StockLevel rows (expect 35)'    AS check, COUNT(*)::text AS value FROM "StockLevel"
UNION ALL
SELECT 'Sum quantity (expect 44468.2000)', COALESCE(SUM(quantity),0)::text FROM "StockLevel"
UNION ALL
SELECT 'StockMovement rows (expect 134)', COUNT(*)::text FROM "StockMovement"
UNION ALL
SELECT 'active warehouses (expect BULK,FIN,PKG,QHL)',
       (SELECT string_agg(code, ',' ORDER BY code) FROM "Warehouse" WHERE active);
