-- =====================================================================
--  GO-LIVE RESET — APPLY  (DESTRUCTIVE)
-- =====================================================================
--  ⚠ DO NOT RUN until ALL of the following are true:
--     1. ops/GOLIVE-RESET-PREVIEW.sql has been run and reviewed
--     2. A recoverable Render backup/snapshot is confirmed to exist
--     3. The seed fix (commit e391c48) is DEPLOYED, with SEED_MODE
--        absent or 'provision' and NODE_ENV=production
--
--  Condition 3 is not optional. Before that commit the seed re-planted
--  demo stock whenever StockLevel and StockMovement were both empty —
--  which is precisely the state this script creates. Running this against
--  the old image means the next restart undoes the reset.
--
--  TARGET TENANT: cmpejojr80000uef0dx69ve2q ('enjoymilk')
--
--  PROPERTIES
--    • ONE transaction — all or nothing
--    • tenant-scoped: every DELETE carries WHERE "tenantId" = <target>
--      (except Session/InvoiceLine/OrderLine/SimpleOrderLine, which have
--      no tenantId and are scoped through their parent)
--    • FK-ordered: children before parents
--    • fail-fast: guards abort before any write if preconditions fail
--    • NO schema changes, NO DROP, NO TRUNCATE, NO migration deletion
--    • idempotent: a second run deletes 0 rows and still commits
--
--  HOW TO RUN
--    Render Dashboard → enjoymilk-api → Shell:
--      npx prisma db execute --url "$DATABASE_URL" --file <this file>
-- =====================================================================

BEGIN;

-- ── Guard 1: exactly one tenant, and it is the expected one ─────────
DO $$
DECLARE n INT; tid TEXT;
BEGIN
  SELECT COUNT(*) INTO n FROM "Tenant";
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 tenant, found %. Refusing to run. Nothing was written.', n;
  END IF;
  SELECT id INTO tid FROM "Tenant";
  IF tid <> 'cmpejojr80000uef0dx69ve2q' THEN
    RAISE EXCEPTION 'Tenant id is %, expected cmpejojr80000uef0dx69ve2q. Wrong database? Nothing was written.', tid;
  END IF;
END $$;

-- ── Guard 2: the accounts we must preserve still exist ──────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM "User"
   WHERE email IN ('owner@enjoymilk.local','admin@enjoymilk.local') AND active;
  IF n <> 2 THEN
    RAISE EXCEPTION
      'Expected 2 active accounts to preserve (owner@, admin@), found %. Refusing to proceed — this could lock everyone out. Nothing was written.', n;
  END IF;
END $$;

-- =====================================================================
--  SECTION A — TRANSACTIONAL DATA (FK order: leaves first)
-- =====================================================================
DELETE FROM "ProductionCostAllocation" WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "SaleCostAllocation"       WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "ProductionStockAudit"     WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- DailyProduction cascades its five usage tables, but they are deleted
-- explicitly first so the row counts are visible and the script does not
-- depend on cascade behaviour staying as it is today.
DELETE FROM "ProductionMilkUsage"      WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "ProductionCartonUsage"    WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "ProductionAluminumUsage"  WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "ProductionProducedItem"   WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "ProductionWaste"          WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "DailyProduction"          WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- Sales. Lines and payments have no tenantId — scoped via their order.
DELETE FROM "SimpleOrderPayment"       WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "SimpleOrderLine" l
 WHERE EXISTS (SELECT 1 FROM "SimpleOrder" o
                WHERE o.id = l."orderId" AND o."tenantId" = 'cmpejojr80000uef0dx69ve2q');
DELETE FROM "SimpleOrder"              WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

DELETE FROM "InvoiceLine" l
 WHERE EXISTS (SELECT 1 FROM "Invoice" i
                WHERE i.id = l."invoiceId" AND i."tenantId" = 'cmpejojr80000uef0dx69ve2q');
DELETE FROM "Invoice"                  WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

DELETE FROM "Payment"                  WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "OrderLine" l
 WHERE EXISTS (SELECT 1 FROM "SalesOrder" o
                WHERE o.id = l."orderId" AND o."tenantId" = 'cmpejojr80000uef0dx69ve2q');
DELETE FROM "SalesOrder"               WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- Repack (already empty today, included so the script is complete).
DELETE FROM "RepackRun"                WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "RepackOrder"              WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- Inventory documents.
DELETE FROM "InventoryCountLine"       WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "InventoryCount"           WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "StockAdjustment"          WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "StockReceipt"             WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "StockTransfer"            WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- Balances, ledger and FIFO cost layers. Allocations were removed above,
-- so PurchaseBatch has no RESTRICT children left.
DELETE FROM "StockMovement"            WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "StockLevel"               WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "PurchaseBatch"            WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "Batch"                    WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- HR history. AttendanceRecord is RESTRICT on Employee, so it must go
-- before any employee row is removed in Section B.
DELETE FROM "AttendanceRecord"         WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "PayrollAdjustment"        WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "AdvanceInstallment"       WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "EmployeeAdvance"          WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "EmployeeDocument"         WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- Finance history. CashMovement is RESTRICT on Cashbox; cashboxes are
-- KEPT, so only their movements go and the balance is reset in Section C.
DELETE FROM "CashMovement"             WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "Expense"                  WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "Cheque"                   WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- Logs that carry demo operational context.
DELETE FROM "AiRequestLog"             WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
DELETE FROM "TelegramLog"              WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

-- Login sessions — forces everyone to re-authenticate at go-live and
-- invalidates any refresh token issued during the demo period.
-- Session has no tenantId; it is scoped through User.
DELETE FROM "Session" s
 WHERE EXISTS (SELECT 1 FROM "User" u
                WHERE u.id = s."userId" AND u."tenantId" = 'cmpejojr80000uef0dx69ve2q');

-- =====================================================================
--  SECTION B — SEEDED DEMO MASTER DATA
--  Identified by EXPLICIT identifier lists taken from prisma/seed.ts,
--  never by creation date. Two rows created on seed day by a human
--  ('rts' item, 'C-MPEL2IMH' customer) are therefore KEPT.
-- =====================================================================
DELETE FROM "Item"
 WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q'
   AND sku IN ('RAW-MILK-200','RAW-MILK-500','RAW-MILK-1L',
               'CTN-24','CTN-12','CTN-6',
               'ALU-200','ALU-500','ALU-1L',
               'PROD-MILK-200','PROD-MILK-500','PROD-MILK-1L');

DELETE FROM "Customer"
 WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q' AND code IN ('C001','C002','C003','C004');

DELETE FROM "Employee"
 WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q' AND code IN ('E001','E002','E003','E004');

-- Demo accounts that have never been used. owner@ and admin@ are NOT in
-- this list and Guard 2 has already proven both exist and are active.
DELETE FROM "User"
 WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q'
   AND email IN ('manager@enjoymilk.local','warehouse@enjoymilk.local',
                 'accountant@enjoymilk.local','operator@enjoymilk.local');

-- =====================================================================
--  SECTION C — DERIVED BALANCES
--  Cashboxes are kept as configuration, but their balances were produced
--  by demo CashMovement rows that no longer exist. Left as-is they would
--  show money the ledger cannot explain.
-- =====================================================================
UPDATE "Cashbox" SET balance = 0
 WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q' AND balance <> 0;

-- =====================================================================
--  Guard 3 — post-conditions, checked BEFORE commit.
--  Any failure here rolls the whole thing back.
-- =====================================================================
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM "User" WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q' AND active;
  IF n < 1 THEN RAISE EXCEPTION 'No active user would remain. Rolling back.'; END IF;

  SELECT COUNT(*) INTO n FROM "Warehouse"
   WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q' AND code = 'MAIN' AND active;
  IF n < 1 THEN RAISE EXCEPTION 'MAIN warehouse missing or inactive. Rolling back.'; END IF;

  SELECT COUNT(*) INTO n FROM "TenantSetting" WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
  IF n < 1 THEN RAISE EXCEPTION 'TenantSetting missing. Rolling back.'; END IF;

  SELECT COUNT(*) INTO n FROM "StockLevel"    WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
  IF n <> 0 THEN RAISE EXCEPTION 'StockLevel not empty (% rows). Rolling back.', n; END IF;

  SELECT COUNT(*) INTO n FROM "PurchaseBatch" WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
  IF n <> 0 THEN RAISE EXCEPTION 'PurchaseBatch not empty (% rows). Rolling back.', n; END IF;

  SELECT COUNT(*) INTO n FROM "_prisma_migrations";
  IF n < 8 THEN RAISE EXCEPTION 'Migration history damaged (% rows). Rolling back.', n; END IF;
END $$;

COMMIT;
