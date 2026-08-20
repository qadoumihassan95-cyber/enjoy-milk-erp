-- =====================================================================
--  GO-LIVE RESET - POST-COMMIT ASSERTIONS (no writes)
-- =====================================================================
--  Runs AFTER GOLIVE-RESET-APPLY.sql has committed. Independent of that
--  script's own pre-commit guards: this re-reads the committed state and
--  raises on anything that does not match the approved preview, so the
--  shell exits non-zero and the failure is impossible to miss.
--
--  Contains no INSERT/UPDATE/DELETE. Pure ASCII on purpose.
-- =====================================================================

DO $$
DECLARE n INT; m TEXT; bad TEXT := '';
BEGIN
  -- transactional tables must be empty
  SELECT COUNT(*) INTO n FROM "StockLevel";       IF n <> 0 THEN bad := bad || format('StockLevel=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "StockMovement";    IF n <> 0 THEN bad := bad || format('StockMovement=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "PurchaseBatch";    IF n <> 0 THEN bad := bad || format('PurchaseBatch=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "DailyProduction";  IF n <> 0 THEN bad := bad || format('DailyProduction=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "SimpleOrder";      IF n <> 0 THEN bad := bad || format('SimpleOrder=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Invoice";          IF n <> 0 THEN bad := bad || format('Invoice=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "CashMovement";     IF n <> 0 THEN bad := bad || format('CashMovement=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "AttendanceRecord"; IF n <> 0 THEN bad := bad || format('AttendanceRecord=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Expense";          IF n <> 0 THEN bad := bad || format('Expense=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Session";          IF n <> 0 THEN bad := bad || format('Session=%s ', n); END IF;

  -- demo master data must be gone
  SELECT COUNT(*) INTO n FROM "Item" WHERE sku IN
    ('RAW-MILK-200','RAW-MILK-500','RAW-MILK-1L','CTN-24','CTN-12','CTN-6',
     'ALU-200','ALU-500','ALU-1L','PROD-MILK-200','PROD-MILK-500','PROD-MILK-1L');
  IF n <> 0 THEN bad := bad || format('demoItems=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Customer" WHERE code IN ('C001','C002','C003','C004');
  IF n <> 0 THEN bad := bad || format('demoCustomers=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Employee" WHERE code IN ('E001','E002','E003','E004');
  IF n <> 0 THEN bad := bad || format('demoEmployees=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "User" WHERE email IN
    ('manager@enjoymilk.local','warehouse@enjoymilk.local','accountant@enjoymilk.local','operator@enjoymilk.local');
  IF n <> 0 THEN bad := bad || format('demoUsers=%s ', n); END IF;

  -- preserved data must match the approved preview exactly
  SELECT COUNT(*) INTO n FROM "Item";     IF n <> 56 THEN bad := bad || format('Item=%s(want 56) ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Customer"; IF n <> 3  THEN bad := bad || format('Customer=%s(want 3) ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Employee"; IF n <> 8  THEN bad := bad || format('Employee=%s(want 8) ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Supplier"; IF n <> 3  THEN bad := bad || format('Supplier=%s(want 3) ', n); END IF;
  SELECT COUNT(*) INTO n FROM "AuditLog"; IF n <> 511 THEN bad := bad || format('AuditLog=%s(want 511) ', n); END IF;

  -- access must survive
  SELECT COUNT(*) INTO n FROM "User"
   WHERE email IN ('owner@enjoymilk.local','admin@enjoymilk.local') AND active;
  IF n <> 2 THEN bad := bad || format('preservedAccounts=%s(want 2) ', n); END IF;

  -- the two ambiguous rows kept by decision
  SELECT COUNT(*) INTO n FROM "Item" WHERE sku = 'rts';
  IF n <> 1 THEN bad := bad || 'ambiguousItem_rts_MISSING '; END IF;
  SELECT COUNT(*) INTO n FROM "Customer" WHERE code = 'C-MPEL2IMH';
  IF n <> 1 THEN bad := bad || 'ambiguousCustomer_MISSING '; END IF;

  -- configuration and balances
  SELECT COUNT(*) INTO n FROM "Cashbox" WHERE balance <> 0;
  IF n <> 0 THEN bad := bad || format('nonZeroCashbox=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Cashbox"; IF n <> 2 THEN bad := bad || format('Cashbox=%s(want 2) ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Warehouse" WHERE code = 'MAIN' AND active;
  IF n <> 1 THEN bad := bad || 'MAIN_warehouse_missing '; END IF;
  SELECT COUNT(*) INTO n FROM "Tenant";        IF n <> 1 THEN bad := bad || format('Tenant=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "TenantSetting"; IF n <> 1 THEN bad := bad || format('TenantSetting=%s ', n); END IF;
  SELECT COUNT(*) INTO n FROM "Machine";       IF n <> 5 THEN bad := bad || format('Machine=%s(want 5) ', n); END IF;
  SELECT COUNT(*) INTO n FROM "License";       IF n <> 5 THEN bad := bad || format('License=%s(want 5) ', n); END IF;

  -- migration history and posting mode
  SELECT COUNT(*) INTO n FROM "_prisma_migrations"
   WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF n < 11 THEN bad := bad || format('migrationsApplied=%s(want >=11) ', n); END IF;
  SELECT COUNT(*) INTO n FROM "_prisma_migrations"
   WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL;
  IF n <> 0 THEN bad := bad || format('migrationsBroken=%s ', n); END IF;
  SELECT "productionPostingMode" INTO m FROM "TenantSetting";
  IF m <> 'STRICT_MODE' THEN bad := bad || format('postingMode=%s ', m); END IF;

  IF bad <> '' THEN
    RAISE EXCEPTION 'POST-RESET ASSERTIONS FAILED: %', bad;
  END IF;

  RAISE NOTICE 'POST-RESET ASSERTIONS PASSED: database is clean and every preserved object is present.';
END $$;
