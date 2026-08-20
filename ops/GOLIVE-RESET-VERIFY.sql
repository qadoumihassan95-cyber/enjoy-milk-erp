-- =====================================================================
--  GO-LIVE RESET — VERIFY  (READ-ONLY)
-- =====================================================================
--  Run AFTER GOLIVE-RESET-APPLY.sql, and again after the next restart or
--  redeploy to prove the seed did not rebuild anything.
--  Writes nothing.
-- =====================================================================

\echo '=== 1. BUSINESS TABLES — every row_count MUST be 0 ==='
SELECT table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int AS row_count
FROM (
  SELECT table_name,
         query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '') AS xml_count
  FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN (
      'StockLevel','StockMovement','PurchaseBatch','Batch',
      'ProductionCostAllocation','SaleCostAllocation','ProductionStockAudit',
      'DailyProduction','ProductionMilkUsage','ProductionCartonUsage',
      'ProductionAluminumUsage','ProductionProducedItem','ProductionWaste',
      'SimpleOrder','SimpleOrderLine','SimpleOrderPayment',
      'SalesOrder','OrderLine','Payment','Invoice','InvoiceLine',
      'StockAdjustment','StockReceipt','StockTransfer',
      'InventoryCount','InventoryCountLine',
      'AttendanceRecord','PayrollAdjustment','EmployeeAdvance',
      'AdvanceInstallment','EmployeeDocument',
      'CashMovement','Expense','Cheque',
      'RepackOrder','RepackRun','AiRequestLog','TelegramLog','Session'
    )
) t
ORDER BY row_count DESC, table_name;

\echo '=== 2. PRESERVED — each MUST be non-zero ==='
SELECT 'Tenant'             AS what, COUNT(*)::text AS n FROM "Tenant"
UNION ALL SELECT 'TenantSetting',      COUNT(*)::text FROM "TenantSetting"
UNION ALL SELECT '_prisma_migrations', COUNT(*)::text FROM "_prisma_migrations"
UNION ALL SELECT 'Active users',       COUNT(*)::text FROM "User" WHERE active
UNION ALL SELECT 'MAIN warehouse (active)', COUNT(*)::text FROM "Warehouse" WHERE code='MAIN' AND active
UNION ALL SELECT 'Items kept',         COUNT(*)::text FROM "Item"
UNION ALL SELECT 'Suppliers kept',     COUNT(*)::text FROM "Supplier"
UNION ALL SELECT 'Employees kept',     COUNT(*)::text FROM "Employee"
UNION ALL SELECT 'Customers kept',     COUNT(*)::text FROM "Customer"
UNION ALL SELECT 'AuditLog kept',      COUNT(*)::text FROM "AuditLog";

\echo '=== 3. ACCESS — owner@ and admin@ must both be present and active ==='
SELECT email, role::text AS role, active::text FROM "User" ORDER BY role;

\echo '=== 4. DEMO DATA MUST BE GONE — all zeros ==='
SELECT 'demo items (12 seed SKUs)' AS check, COUNT(*)::text AS n FROM "Item"
 WHERE sku IN ('RAW-MILK-200','RAW-MILK-500','RAW-MILK-1L','CTN-24','CTN-12','CTN-6',
               'ALU-200','ALU-500','ALU-1L','PROD-MILK-200','PROD-MILK-500','PROD-MILK-1L')
UNION ALL SELECT 'demo customers C001-C004', COUNT(*)::text FROM "Customer" WHERE code IN ('C001','C002','C003','C004')
UNION ALL SELECT 'demo employees E001-E004', COUNT(*)::text FROM "Employee" WHERE code IN ('E001','E002','E003','E004')
UNION ALL SELECT 'demo users (4 unused)',    COUNT(*)::text FROM "User"
 WHERE email IN ('manager@enjoymilk.local','warehouse@enjoymilk.local','accountant@enjoymilk.local','operator@enjoymilk.local')
UNION ALL SELECT 'non-zero cashbox balances', COUNT(*)::text FROM "Cashbox" WHERE balance <> 0;

\echo '=== 5. FIFO / RECONCILIATION — zero inventory, zero drift ==='
SELECT 'StockLevel sum'          AS metric, COALESCE(SUM(quantity),0)::text AS value FROM "StockLevel"
UNION ALL SELECT 'FIFO remaining sum',     (SELECT COALESCE(SUM(remaining),0)::text FROM "PurchaseBatch")
UNION ALL SELECT 'FIFO inventory value',   (SELECT COALESCE(ROUND(SUM(remaining*"unitCost"),2),0)::text FROM "PurchaseBatch")
UNION ALL SELECT 'negative StockLevel rows',(SELECT COUNT(*)::text FROM "StockLevel" WHERE quantity < 0)
UNION ALL SELECT 'items with stock but no batch (expect 0)',
  (SELECT COUNT(*)::text FROM "Item" i
    WHERE COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0) > 0.001
      AND COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) <= 0.001)
UNION ALL SELECT 'items with batch but no stock (expect 0)',
  (SELECT COUNT(*)::text FROM "Item" i
    WHERE COALESCE((SELECT SUM(pb.remaining) FROM "PurchaseBatch" pb WHERE pb."itemId"=i.id),0) > 0.001
      AND COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0) <= 0.001)
UNION ALL SELECT 'ledger mismatch rows (expect 0)',
  (SELECT COUNT(*)::text FROM "Item" i
    WHERE ABS(
      COALESCE((SELECT SUM(sl.quantity) FROM "StockLevel" sl WHERE sl."itemId"=i.id),0)
      - COALESCE((SELECT SUM(CASE WHEN sm.type IN ('IN','RETURN') THEN sm.quantity ELSE -sm.quantity END)
                    FROM "StockMovement" sm WHERE sm."itemId"=i.id),0)) > 0.001);

\echo '=== 6. INTEGRITY CONSTRAINTS still in place (expect 10) ==='
SELECT COUNT(*)::text AS integrity_constraints
FROM pg_constraint c
JOIN pg_class cl ON cl.oid=c.conrelid
JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname='public' AND c.contype='c'
  AND c.conname IN ('PurchaseBatch_remaining_non_negative','PurchaseBatch_remaining_within_quantity',
                    'PurchaseBatch_quantity_positive','PurchaseBatch_unitcost_non_negative',
                    'ProductionCostAllocation_quantity_positive','ProductionCostAllocation_totalcost_non_negative',
                    'SaleCostAllocation_quantity_positive','DailyProduction_status_valid',
                    'TenantSetting_posting_mode_valid','Tenant_slug_not_blank');

\echo '=== 7. MIGRATION HISTORY intact — 8 applied, 0 rolled back ==='
SELECT COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text AS applied,
       COUNT(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text AS rolled_back
FROM "_prisma_migrations";

\echo '=== 8. POSTING CONFIG — production can operate ==='
SELECT "productionPostingMode", "costingMethod", "baseCurrency" FROM "TenantSetting";
