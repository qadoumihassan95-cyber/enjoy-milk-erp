-- =====================================================================
--  PRE-DELIVERY TEST/DEMO CLEANUP
-- =====================================================================
--  READ THIS BEFORE RUNNING.
--
--  This script removes CONFIRMED test/demo residue from the live
--  Enjoy Milk database. It runs inside a single transaction and
--  preserves audit trail through explicit `refType='TEST_DATA_CLEANUP'`
--  CashMovement rows and updated SimpleOrder notes.
--
--  What it changes:
--   1. Cashbox reconciliation
--      - MAIN  (الصندوق الرئيسي)     : cached 10,073.88 → 5,074.38
--      - PETTY (صندوق المصاريف الصغيرة): cached  -300.00 →  -800.00
--      Removes 5,000 JOD test opening on MAIN + 500 JOD test opening
--      on PETTY. Both are documented via paired IN+OUT CashMovement
--      rows with refType='TEST_DATA_CLEANUP'.
--
--   2. Deletes 5 [QA-TEST] CashMovement rows + 1 [QA-TEST] Expense
--      row (total 0.50 JOD, tagged '[QA-TEST]' by the regression
--      harness on 2026-06-13).
--
--   3. Deletes 1 MTX_Cust_* Customer + 2 MTX_Sup_* Supplier rows
--      (matrix regression test residue, verified 0 downstream refs).
--
--   4. Cancels 6 CONFIRMED-TEST orders (ORD-2026-0002, -0004, -0005,
--      -0007, -0008, -0009). Status → 'CANCELLED', paid → 0, note
--      appended. Any `SimpleOrderPayment` rows attached to these
--      orders are deleted (evidence showed all six have 0 payment
--      rows currently — the DELETE is defensive).
--      StockMovements referencing these orders are preserved
--      (historical fact of demo stock movements — kept for audit).
--
--  What it does NOT touch:
--   - ORD-2026-0001 (ahmad), 0003 (اسماعيل), 0006 (laith) —
--     classified POSSIBLE TEST. These stay in place. Owner review
--     required before any cleanup.
--   - StockMovement history (audit trail preserved).
--   - Any employee, item, warehouse, or production data.
--
--  How to run:
--   psql "$DATABASE_URL_PROD" -f ops/test-data-cleanup.sql
--  or paste into Render's Postgres console.
--
--  Rollback: transaction wraps the whole script. If anything fails,
--  everything rolls back. If you want to undo AFTER commit, restore
--  from your pre-cleanup backup. Take one first:
--   pg_dump "$DATABASE_URL_PROD" > /tmp/enjoymilk-pre-cleanup.sql
-- =====================================================================

BEGIN;

-- Assert we are in the correct DB (Enjoy Milk single tenant, Postgres).
-- If either fails, everything rolls back with no changes.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Tenant") <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Tenant row. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Cashbox" WHERE id = 'cmpejokze001juef0mvr3g3r6') THEN
    RAISE EXCEPTION 'MAIN cashbox not found at expected id. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Cashbox" WHERE id = 'cmpejokzk001kuef0o7e3otaf') THEN
    RAISE EXCEPTION 'PETTY cashbox not found at expected id. Aborting.';
  END IF;
END $$;

-- =====================================================================
-- STEP 1. Delete [QA-TEST] artifacts (must run BEFORE cashbox
--         reconciliation so post-delete reconstruction is stable).
-- =====================================================================

-- 1a. Delete 5 QA-TEST CashMovement rows:
--     MAIN  : OUT 0.50 (linked to QA expense) + TRANSFER 0.25 out + TRANSFER 0.25 in (rollback)
--     PETTY : TRANSFER 0.25 in + TRANSFER 0.25 out (rollback)
DELETE FROM "CashMovement" WHERE description ILIKE '%[QA-TEST]%';

-- 1b. Delete the QA-TEST Expense header (0.50 JOD).
DELETE FROM "Expense" WHERE description = '[QA-TEST] auto-verify';

-- Post-delete reconstruction (corrected TRANSFER formula):
--   MAIN reconstruction  = 5,074.38 JOD  (up by 0.50 from removing MAIN OUT 0.50)
--   PETTY reconstruction =  -800.00 JOD  (unchanged; QA pair was net-zero on PETTY)

-- =====================================================================
-- STEP 2. Cashbox reconciliation via paired IN+OUT audit trail.
-- =====================================================================
-- The 5,000 JOD (MAIN) and 500 JOD (PETTY) drifts are confirmed
-- test/demo opening balances. To reconcile Cashbox.balance to the
-- legitimate CashMovement ledger we:
--   1) Insert a paired IN+OUT of the drift amount on each box. The
--      pair nets to zero in the ledger reconstruction but leaves a
--      clear audit trail.
--   2) Directly UPDATE Cashbox.balance to match the (unchanged)
--      reconstruction. Every UPDATE is preceded by the audit trail
--      in the same transaction.

DO $$
DECLARE
  v_tenant text := (SELECT id FROM "Tenant" LIMIT 1);
  v_admin  text := (SELECT id FROM "User" WHERE role = 'ADMIN' LIMIT 1);
  v_main   text := 'cmpejokze001juef0mvr3g3r6';
  v_petty  text := 'cmpejokzk001kuef0o7e3otaf';
BEGIN
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'No ADMIN user found — cleanup requires a performedBy actor. Aborting.';
  END IF;

  -- MAIN: paired documentation of 5,000 JOD test opening removal
  INSERT INTO "CashMovement" (id, "tenantId", "cashboxId", type, amount, description, "refType", "performedById", "performedAt")
  VALUES
    (gen_random_uuid()::text, v_tenant, v_main, 'IN',  5000.00,
     'Recognize pre-delivery test/demo opening balance (for cleanup audit trail)',
     'TEST_DATA_CLEANUP', v_admin, NOW()),
    (gen_random_uuid()::text, v_tenant, v_main, 'OUT', 5000.00,
     'Remove pre-delivery test/demo opening balance',
     'TEST_DATA_CLEANUP', v_admin, NOW() + interval '1 millisecond');

  -- PETTY: paired documentation of 500 JOD test opening removal
  INSERT INTO "CashMovement" (id, "tenantId", "cashboxId", type, amount, description, "refType", "performedById", "performedAt")
  VALUES
    (gen_random_uuid()::text, v_tenant, v_petty, 'IN',  500.00,
     'Recognize pre-delivery test/demo opening balance (for cleanup audit trail)',
     'TEST_DATA_CLEANUP', v_admin, NOW()),
    (gen_random_uuid()::text, v_tenant, v_petty, 'OUT', 500.00,
     'Remove pre-delivery test/demo opening balance',
     'TEST_DATA_CLEANUP', v_admin, NOW() + interval '1 millisecond');

  -- Align cached balances to the legitimate ledger reconstruction.
  UPDATE "Cashbox" SET balance = 5074.38 WHERE id = v_main;
  UPDATE "Cashbox" SET balance = -800.00 WHERE id = v_petty;
END $$;

-- =====================================================================
-- STEP 3. MTX_ regression-test customer + suppliers.
-- =====================================================================
-- Verified zero referencing rows (SimpleOrder, StockReceipt).
DELETE FROM "Customer" WHERE name LIKE 'MTX_%';
DELETE FROM "Supplier" WHERE name LIKE 'MTX_%';

-- =====================================================================
-- STEP 4. Confirmed-test legacy orders → CANCELLED, paid=0.
-- =====================================================================
-- Classification rationale:
--   ORD-2026-0002 احمد سوريا : unit price 4,250 JOD/L raw milk (5,000× realistic)  — owner-confirmed demo 2026-08-16
--   ORD-2026-0004 mo ismaiel  : unit price 1,000 JOD/carton (500× realistic)       — confirmed demo
--   ORD-2026-0005 leo         : test customer name                                   — confirmed demo
--   ORD-2026-0007 احمد سوريا : unit price 40 JOD for 20g milk (100× realistic)     — owner-confirmed demo 2026-08-16
--   ORD-2026-0008 moe         : corrupted line total (0) vs total (50,000)          — confirmed demo
--   ORD-2026-0009 mo          : test customer name                                   — confirmed demo
--
-- 4a. Defensive delete of any SimpleOrderPayment rows on these orders
--     (all six currently have 0 payment rows — this is a belt-and-braces
--     safeguard so future re-runs of the script stay idempotent).
DELETE FROM "SimpleOrderPayment"
WHERE "orderId" IN (
  SELECT id FROM "SimpleOrder"
  WHERE number IN ('ORD-2026-0002','ORD-2026-0004','ORD-2026-0005',
                   'ORD-2026-0007','ORD-2026-0008','ORD-2026-0009')
);

-- 4b. Cancel the six confirmed-test orders. Idempotent: repeat runs
--     do not double-append the note because we detect existing marker.
UPDATE "SimpleOrder"
SET
  status = 'CANCELLED',
  paid = 0,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%PRE_DELIVERY_TEST_DATA_CLEANUP%'
    THEN notes
    ELSE COALESCE(notes, '')
      || E'\n[PRE_DELIVERY_TEST_DATA_CLEANUP ' || to_char(NOW(), 'YYYY-MM-DD')
      || '] Marked cancelled pre-customer-handoff. Confirmed test/demo record.'
  END
WHERE number IN ('ORD-2026-0002','ORD-2026-0004','ORD-2026-0005',
                 'ORD-2026-0007','ORD-2026-0008','ORD-2026-0009');

-- =====================================================================
-- POST-CLEANUP VERIFICATION
-- =====================================================================
-- Executed inside the same transaction — a RAISE NOTICE prints results.

DO $$
DECLARE
  v_main_bal    numeric;
  v_petty_bal   numeric;
  v_main_recon  numeric;
  v_petty_recon numeric;
  v_qa_left     int;
  v_mtx_left    int;
  v_bad_orders  int;
BEGIN
  SELECT balance INTO v_main_bal  FROM "Cashbox" WHERE id = 'cmpejokze001juef0mvr3g3r6';
  SELECT balance INTO v_petty_bal FROM "Cashbox" WHERE id = 'cmpejokzk001kuef0o7e3otaf';

  SELECT COALESCE(SUM(
    CASE
      WHEN type='IN'  THEN amount
      WHEN type='OUT' THEN -amount
      WHEN type='TRANSFER' AND description ILIKE 'تحويل وارد%' THEN  amount
      WHEN type='TRANSFER' AND description ILIKE 'تحويل صادر%' THEN -amount
      ELSE 0 END), 0)
  INTO v_main_recon FROM "CashMovement" WHERE "cashboxId" = 'cmpejokze001juef0mvr3g3r6';

  SELECT COALESCE(SUM(
    CASE
      WHEN type='IN'  THEN amount
      WHEN type='OUT' THEN -amount
      WHEN type='TRANSFER' AND description ILIKE 'تحويل وارد%' THEN  amount
      WHEN type='TRANSFER' AND description ILIKE 'تحويل صادر%' THEN -amount
      ELSE 0 END), 0)
  INTO v_petty_recon FROM "CashMovement" WHERE "cashboxId" = 'cmpejokzk001kuef0o7e3otaf';

  SELECT COUNT(*) INTO v_qa_left  FROM "CashMovement" WHERE description ILIKE '%[QA-TEST]%';
  SELECT COUNT(*) INTO v_mtx_left FROM "Customer" WHERE name LIKE 'MTX_%';

  SELECT COUNT(*) INTO v_bad_orders FROM "SimpleOrder" so
    WHERE ABS(so.paid - COALESCE((SELECT SUM(amount) FROM "SimpleOrderPayment" WHERE "orderId"=so.id),0)) > 0.01
      AND so.status <> 'CANCELLED';

  RAISE NOTICE 'MAIN  cached=%  reconstruction=%  drift=%',
    v_main_bal, v_main_recon, v_main_bal - v_main_recon;
  RAISE NOTICE 'PETTY cached=%  reconstruction=%  drift=%',
    v_petty_bal, v_petty_recon, v_petty_bal - v_petty_recon;
  RAISE NOTICE 'QA-TEST cashmovements remaining: %', v_qa_left;
  RAISE NOTICE 'MTX_ customers remaining: %', v_mtx_left;
  RAISE NOTICE 'Non-cancelled orders with paid-drift remaining: %', v_bad_orders;

  IF ABS(v_main_bal  - v_main_recon)  > 0.01 THEN RAISE EXCEPTION 'MAIN cashbox still drifts. Aborting.';  END IF;
  IF ABS(v_petty_bal - v_petty_recon) > 0.01 THEN RAISE EXCEPTION 'PETTY cashbox still drifts. Aborting.'; END IF;
  IF v_qa_left  > 0 THEN RAISE EXCEPTION 'QA-TEST rows still present. Aborting.'; END IF;
  IF v_mtx_left > 0 THEN RAISE EXCEPTION 'MTX_ customers still present. Aborting.'; END IF;
END $$;

COMMIT;

-- =====================================================================
-- FOLLOW-UP FOR OWNER REVIEW (NOT AUTOMATED)
-- =====================================================================
-- POSSIBLE-TEST orders that were NOT touched by this script.
-- Please classify each and either mark CANCELLED or accept as real:
--   ORD-2026-0001  ahmad          500 JOD  (500 units @ 1 JOD/unit — plausibly retail)
--   ORD-2026-0003  اسماعيل         820 JOD  (82 units @ 10 JOD — plausible retail)
--   ORD-2026-0006  laith           100 JOD  (2 units @ 50 JOD, UNPAID — plausible)
--
-- STRUCTURAL RECOMMENDATION (post-delivery, not blocking):
-- Add explicit direction columns to CashMovement to eliminate the
-- description-parsing needed for TRANSFER classification:
--   ALTER TABLE "CashMovement"
--     ADD COLUMN "counterpartCashboxId" text
--       REFERENCES "Cashbox"(id) ON DELETE RESTRICT,
--     ADD COLUMN "transferDirection" text
--       CHECK ("transferDirection" IN ('OUT','IN') OR "transferDirection" IS NULL);
-- Then rewrite INT-12 to use the columns instead of parsing description.
