-- =====================================================================
--  GO-LIVE RESET — PREVIEW / DRY-RUN  (READ-ONLY)
-- =====================================================================
--  Run this FIRST. It writes NOTHING. Every statement is a SELECT.
--  It shows exactly what GOLIVE-RESET-APPLY.sql would delete and keep.
--
--  TARGET TENANT: cmpejojr80000uef0dx69ve2q  (slug 'enjoymilk')
--  The database contains exactly ONE tenant. Deletion is still written
--  tenant-scoped rather than unscoped.
--
--  APPROVED SCOPE
--  --------------
--   • ALL transactional data cleared (inventory, production, sales,
--     finance, HR history, FIFO layers and allocations)
--   • Seeded demo master data deleted, identified by EXPLICIT identifier
--     lists — not by date. Two rows created on seed day by hand are
--     therefore KEPT (see section 6).
--   • Hand-entered master data KEPT: 55 items, 3 suppliers, 8 employees,
--     2 customers
--   • Users: keep owner@ and admin@; delete the four never-used accounts
--   • Session cleared (forces re-login); AuditLog KEPT
-- =====================================================================

\echo '=== 0. TARGET TENANT ==='
SELECT id, slug, name, active FROM "Tenant";

\echo '=== 1. TRANSACTIONAL TABLES TO BE EMPTIED (tenant-scoped) ==='
SELECT 'ProductionCostAllocation' AS tbl, COUNT(*) AS rows_to_delete FROM "ProductionCostAllocation" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'SaleCostAllocation',   COUNT(*) FROM "SaleCostAllocation"   WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'ProductionStockAudit', COUNT(*) FROM "ProductionStockAudit" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'ProductionMilkUsage',  COUNT(*) FROM "ProductionMilkUsage"  WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'ProductionCartonUsage',COUNT(*) FROM "ProductionCartonUsage"WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'ProductionAluminumUsage',COUNT(*) FROM "ProductionAluminumUsage" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'ProductionProducedItem',COUNT(*) FROM "ProductionProducedItem" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'ProductionWaste',      COUNT(*) FROM "ProductionWaste"      WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'DailyProduction',      COUNT(*) FROM "DailyProduction"      WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'SimpleOrderPayment',   COUNT(*) FROM "SimpleOrderPayment"   WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'SimpleOrderLine',      COUNT(*) FROM "SimpleOrderLine" l WHERE EXISTS (SELECT 1 FROM "SimpleOrder" o WHERE o.id=l."orderId" AND o."tenantId"='cmpejojr80000uef0dx69ve2q')
UNION ALL SELECT 'SimpleOrder',          COUNT(*) FROM "SimpleOrder"          WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'InvoiceLine',          COUNT(*) FROM "InvoiceLine" l WHERE EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id=l."invoiceId" AND i."tenantId"='cmpejojr80000uef0dx69ve2q')
UNION ALL SELECT 'Invoice',              COUNT(*) FROM "Invoice"              WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'Payment',              COUNT(*) FROM "Payment"              WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'OrderLine',            COUNT(*) FROM "OrderLine" l WHERE EXISTS (SELECT 1 FROM "SalesOrder" o WHERE o.id=l."orderId" AND o."tenantId"='cmpejojr80000uef0dx69ve2q')
UNION ALL SELECT 'SalesOrder',           COUNT(*) FROM "SalesOrder"           WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'StockAdjustment',      COUNT(*) FROM "StockAdjustment"      WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'StockReceipt',         COUNT(*) FROM "StockReceipt"         WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'StockTransfer',        COUNT(*) FROM "StockTransfer"        WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'InventoryCountLine',   COUNT(*) FROM "InventoryCountLine"   WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'InventoryCount',       COUNT(*) FROM "InventoryCount"       WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'StockMovement',        COUNT(*) FROM "StockMovement"        WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'StockLevel',           COUNT(*) FROM "StockLevel"           WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'PurchaseBatch',        COUNT(*) FROM "PurchaseBatch"        WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'Batch',                COUNT(*) FROM "Batch"                WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'AttendanceRecord',     COUNT(*) FROM "AttendanceRecord"     WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'PayrollAdjustment',    COUNT(*) FROM "PayrollAdjustment"    WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'AdvanceInstallment',   COUNT(*) FROM "AdvanceInstallment"   WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'EmployeeAdvance',      COUNT(*) FROM "EmployeeAdvance"      WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'EmployeeDocument',     COUNT(*) FROM "EmployeeDocument"     WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'CashMovement',         COUNT(*) FROM "CashMovement"         WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'Expense',              COUNT(*) FROM "Expense"              WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'Cheque',               COUNT(*) FROM "Cheque"               WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'RepackRun',            COUNT(*) FROM "RepackRun"            WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'RepackOrder',          COUNT(*) FROM "RepackOrder"          WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'AiRequestLog',         COUNT(*) FROM "AiRequestLog"         WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'TelegramLog',          COUNT(*) FROM "TelegramLog"          WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'Session (forces re-login)', COUNT(*) FROM "Session"
ORDER BY 2 DESC, 1;

\echo '=== 2. SEEDED DEMO MASTER DATA TO BE DELETED (explicit identifiers) ==='
SELECT 'Item (12 seed SKUs)' AS tbl, sku AS identifier, name, active::text
FROM "Item"
WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
  AND sku IN ('RAW-MILK-200','RAW-MILK-500','RAW-MILK-1L','CTN-24','CTN-12','CTN-6',
              'ALU-200','ALU-500','ALU-1L','PROD-MILK-200','PROD-MILK-500','PROD-MILK-1L')
UNION ALL
SELECT 'Customer (C001-C004)', code, name, active::text FROM "Customer"
WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND code IN ('C001','C002','C003','C004')
UNION ALL
SELECT 'Employee (E001-E004)', code, "fullName", active::text FROM "Employee"
WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND code IN ('E001','E002','E003','E004')
UNION ALL
SELECT 'User (never logged in)', email, "fullName", role::text FROM "User"
WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
  AND email IN ('manager@enjoymilk.local','warehouse@enjoymilk.local',
                'accountant@enjoymilk.local','operator@enjoymilk.local')
ORDER BY 1, 2;

\echo '=== 3. MASTER DATA KEPT (hand-entered by the customer) ==='
SELECT 'Item'     AS tbl, COUNT(*) AS kept FROM "Item"     WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND sku NOT IN ('RAW-MILK-200','RAW-MILK-500','RAW-MILK-1L','CTN-24','CTN-12','CTN-6','ALU-200','ALU-500','ALU-1L','PROD-MILK-200','PROD-MILK-500','PROD-MILK-1L')
UNION ALL SELECT 'Customer', COUNT(*) FROM "Customer" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND code NOT IN ('C001','C002','C003','C004')
UNION ALL SELECT 'Employee', COUNT(*) FROM "Employee" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND code NOT IN ('E001','E002','E003','E004')
UNION ALL SELECT 'Supplier', COUNT(*) FROM "Supplier" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
UNION ALL SELECT 'User',     COUNT(*) FROM "User"     WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND email IN ('owner@enjoymilk.local','admin@enjoymilk.local')
ORDER BY 1;

\echo '=== 4. SYSTEM TABLES — NEVER TOUCHED ==='
SELECT '_prisma_migrations' AS tbl, COUNT(*)::text AS rows FROM "_prisma_migrations"
UNION ALL SELECT 'Tenant',        COUNT(*)::text FROM "Tenant"
UNION ALL SELECT 'TenantSetting', COUNT(*)::text FROM "TenantSetting"
UNION ALL SELECT 'AuditLog (kept by decision)', COUNT(*)::text FROM "AuditLog"
UNION ALL SELECT 'Warehouse',     COUNT(*)::text FROM "Warehouse"
UNION ALL SELECT 'Cashbox',       COUNT(*)::text FROM "Cashbox"
UNION ALL SELECT 'Machine',       COUNT(*)::text FROM "Machine"
UNION ALL SELECT 'ProductionLine',COUNT(*)::text FROM "ProductionLine"
UNION ALL SELECT 'ProductionMachine', COUNT(*)::text FROM "ProductionMachine"
UNION ALL SELECT 'License',       COUNT(*)::text FROM "License";

\echo '=== 5. ACCESS PRESERVED — must be non-empty or DO NOT PROCEED ==='
SELECT email, "fullName", role::text AS role, active::text,
       COALESCE("lastLoginAt"::date::text,'never') AS last_login
FROM "User"
WHERE "tenantId"='cmpejojr80000uef0dx69ve2q'
  AND email IN ('owner@enjoymilk.local','admin@enjoymilk.local')
ORDER BY role;

\echo '=== 6. AMBIGUOUS ROWS — KEPT deliberately, review and tell me if you disagree ==='
-- Created on seed day but NOT part of the seed dataset, so they were
-- typed by a person while exploring. Keeping is reversible; deleting is
-- not, so the scripts keep them.
SELECT 'Item'     AS tbl, sku AS identifier, name, "createdAt"::text AS created, active::text
FROM "Item" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND sku = 'rts'
UNION ALL
SELECT 'Customer', code, name, "createdAt"::text, active::text
FROM "Customer" WHERE "tenantId"='cmpejojr80000uef0dx69ve2q' AND code = 'C-MPEL2IMH';

\echo '=== 7. FK SAFETY — must all be 0 AFTER the transactional delete ==='
-- Any non-zero here means a kept master row would still be referenced and
-- the delete order is wrong. Run again after APPLY as a cross-check.
SELECT 'StockLevel referencing any Item'  AS check, COUNT(*)::text AS value FROM "StockLevel"
UNION ALL SELECT 'StockMovement referencing any Item', COUNT(*)::text FROM "StockMovement"
UNION ALL SELECT 'StockAdjustment referencing any Item', COUNT(*)::text FROM "StockAdjustment"
UNION ALL SELECT 'StockReceipt referencing any Item', COUNT(*)::text FROM "StockReceipt"
UNION ALL SELECT 'AttendanceRecord referencing any Employee', COUNT(*)::text FROM "AttendanceRecord"
UNION ALL SELECT 'SalesOrder/Payment referencing any Customer',
       ((SELECT COUNT(*) FROM "SalesOrder") + (SELECT COUNT(*) FROM "Payment"))::text
UNION ALL SELECT 'CashMovement referencing any Cashbox', COUNT(*)::text FROM "CashMovement"
UNION ALL SELECT 'Allocations referencing any PurchaseBatch',
       ((SELECT COUNT(*) FROM "ProductionCostAllocation") + (SELECT COUNT(*) FROM "SaleCostAllocation"))::text;
