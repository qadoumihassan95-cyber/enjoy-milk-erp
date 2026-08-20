# Go-live reset — Phase 1 discovery (READ-ONLY)

**Database:** `enjoymilk` (Render `dpg-d870uk9s16ns73b06sjg-a`, PostgreSQL 18, region frankfurt)
**Date:** 2026-08-17 · **Status:** nothing written, nothing deleted, no APPLY script executed.

---

## STOP — three blockers before any destructive step

### BLOCKER 1 — the seed will rebuild the demo data after the reset

`apps/api/Dockerfile` CMD runs the seed on **every container start**:

```
migrate deploy && node prisma/seed.js || echo 'SEED SKIPPED (non-fatal)' && node apps/api/dist/main.js
```

`prisma/seed.ts:239` gates demo stock on:

```ts
const inventoryIsVirgin = existingStockLevels === 0 && existingMovements === 0;
```

**A successful reset makes both counts 0, which makes the database "virgin" again.**
The guard that protects real data today becomes the mechanism that re-plants demo
stock on the next restart or redeploy. The seed would also recreate:

| Seed action | Effect after reset |
|---|---|
| demo stock (`seed.ts:249+`) | re-plants `RAW-MILK-*` balances **and** paired PurchaseBatches |
| 6 users, `upsert` on email | any deleted user is recreated with the password literal in `seed.ts:26` |
| items, `upsert` on sku | 13 demo items return |
| warehouses, `upsert` on code | MAIN + 4 legacy warehouses return |

Users and items use `update: {}`, so *surviving* rows are never modified — but any row
we delete comes back.

**The seed must be made go-live-safe BEFORE the reset runs**, or the reset is undone
by the next deploy. This is a code change, tests and a commit — not part of the SQL.

### BLOCKER 2 — I cannot distinguish a real admin account from the demo accounts

All **6** users were created by the seed on 2026-05-20 and all use non-deliverable
`@enjoymilk.local` addresses:

| Email | Role | Active | Last login |
|---|---|---|---|
| `owner@enjoymilk.local` | OWNER | yes | 2026-08-15 |
| `admin@enjoymilk.local` | ADMIN | yes | **2026-08-17 (today)** |
| `manager@enjoymilk.local` | MANAGER | yes | never |
| `warehouse@enjoymilk.local` | WAREHOUSE | yes | never |
| `accountant@enjoymilk.local` | ACCOUNTANT | yes | never |
| `operator@enjoymilk.local` | OPERATOR | yes | never |

There is **no separate real customer account**. The two accounts in active use are
seeded ones. Deleting them locks everyone out; keeping them ships a live ERP on
accounts whose password is a literal in the repository.

I will not guess which to keep. See Decision 1.

### BLOCKER 3 — backup status not verifiable from here

`get_postgres` returns no backup or PITR fields, and the MCP integration exposes no
backup listing. Plan is `basic_256mb`. **I could not confirm a recoverable backup
exists.** You must confirm in the Render dashboard (Database → Backups / Recovery)
before APPLY. Per your own rule, this is a stop condition.

---

## Tenant safety — cleared

| Check | Result |
|---|---|
| `Tenant` rows | **1** — `enjoymilk`, "Enjoy Milk Factory" (`cmpejojr80000uef0dx69ve2q`) |
| Distinct `tenantId` across all business tables | **1** |
| Rows whose `tenantId` is not that tenant | **0** |

Single-tenant database. Deletion will still be written tenant-scoped
(`WHERE "tenantId" = '<id>'`) rather than unscoped, per your instruction.

---

## The finding that changes the plan: most master data is REAL, not demo

The seed ran on **2026-05-20**. Every row created after that date was entered by a
human through the UI over the following three months.

| Table | Seeded 2026-05-20 | Entered by hand afterwards | Dates |
|---|---:|---:|---|
| **Item** | 13 | **55** | Jul 13/14/19/23, Aug 2, Aug 15 |
| **Supplier** | 0 | **3** | Jul 13, Jul 23 |
| **Employee** | 4 | **8** | Aug 15 |
| **Customer** | 5 | 2 | Jul 13, Jul 23 |
| **DailyProduction** | 4 | 25 | Jun–Aug |
| Cashbox / Machine / License / ProductionLine | all | 0 | — |

**55 hand-entered items are almost certainly the customer's real product catalogue.**
Deleting them would destroy three months of master-data entry that has nothing to do
with demo data. Same for the 3 suppliers and 8 employees.

Your brief says "remove demo customers/suppliers/employees **if they are demo data**".
By creation date they are not. See Decision 2.

---

## Table classification — all 57 tables

### A. SYSTEM / KEEP — never touched

| Table | Rows | Why |
|---|---:|---|
| `_prisma_migrations` | 8 | Migration history. Deleting it breaks every future deploy. |
| `Tenant` | 1 | The company record. Everything is scoped to it. |
| `TenantSetting` | 1 | Costing method, currency, SS rates, `productionPostingMode`. Required for posting. |
| `User` | 6 | Access. See Decision 1. |

### B. CUSTOMER MASTER DATA — decision required, not auto-deleted

| Table | Rows | Seeded | Hand-entered |
|---|---:|---:|---:|
| `Item` | 68 | 13 | **55** |
| `Customer` | 7 | 5 | 2 |
| `Supplier` | 3 | 0 | **3** |
| `Employee` | 12 | 4 | **8** |
| `Warehouse` | 5 | 5 | 0 (MAIN active, 4 legacy inactive) |
| `Cashbox` | 2 | 2 | 0 |
| `Machine` | 5 | 5 | 0 |
| `ProductionMachine` | 3 | 3 | 0 |
| `ProductionLine` | 2 | 2 | 0 |
| `License` | 5 | 5 | 0 |

### C. TRANSACTIONAL — clear (this is the uncontroversial part)

| Table | Rows | | Table | Rows |
|---|---:|---|---|---:|
| `StockMovement` | 144 | | `ProductionCartonUsage` | 17 |
| `StockAdjustment` | 62 | | `ProductionAluminumUsage` | 14 |
| `DailyProduction` | 29 | | `ProductionWaste` | 13 |
| `CashMovement` | 22 | | `ProductionMilkUsage` | 12 |
| `StockLevel` | 22 | | `SimpleOrder` | 9 |
| `Expense` | 18 | | `SimpleOrderLine` | 9 |
| `ProductionProducedItem` | 18 | | `ProductionCostAllocation` | 6 |
| `PurchaseBatch` | 17 | | `ProductionStockAudit` | 6 |
| `StockReceipt` | 14 | | `SimpleOrderPayment` | 5 |
| `AttendanceRecord` | 36 | | `PayrollAdjustment` | 4 |
| `EmployeeDocument` | 2 | | `Invoice` / `InvoiceLine` | 1 / 1 |

Already empty (12): `AdvanceInstallment`, `AiRequestLog`, `Batch`, `Cheque`,
`EmployeeAdvance`, `InventoryCount`, `InventoryCountLine`, `OrderLine`,
`PackagingFormula(+Item)`, `Payment`, `RepackOrder`, `RepackRun`,
`SaleCostAllocation`, `SalesOrder`, `StockTransfer`, `TelegramAccount`, `TelegramLog`.

### D. AUDIT / HISTORY — decision required

| Table | Rows | Range | Note |
|---|---:|---|---|
| `AuditLog` | 511 | 2026-05-20 .. 2026-08-17 | Forensic trail of who did what. No FK to anything. |
| `Session` | 391 | — | Refresh-token sessions. Clearing forces re-login — arguably desirable at go-live. |

### E. CONFIGURATION — reviewed, keep

`TenantSetting` (posting mode currently `WARNING_MODE`), the MAIN warehouse, and the
4 inactive legacy warehouses (historical `StockMovement.fromWarehouseId` references
them; once movements are cleared they could be removed, but they are harmless and
`seed.ts` recreates them anyway).

---

## Foreign-key dependency order (43 FKs mapped)

`RESTRICT` parents that force ordering — children must be deleted first:

```
Item        <- StockLevel, StockMovement, StockAdjustment, StockReceipt, Batch,
               PackagingFormula(Item)
PurchaseBatch <- ProductionCostAllocation, SaleCostAllocation
Employee    <- AttendanceRecord            (CASCADE: EmployeeAdvance, EmployeeDocument)
Customer    <- SalesOrder, Payment
Cashbox     <- CashMovement
Warehouse   <- StockLevel
Tenant      <- User
```

`CASCADE` children that delete themselves with the parent:
`DailyProduction` → all 5 production usage tables · `SimpleOrder` → lines + payments ·
`Invoice` → lines · `EmployeeAdvance` → installments · `InventoryCount` → lines ·
`User` → Session.

Safe deletion order (leaves first):

```
1  ProductionCostAllocation, SaleCostAllocation, ProductionStockAudit
2  DailyProduction            (cascades the 5 usage tables)
3  SimpleOrderPayment, SimpleOrderLine, SimpleOrder, InvoiceLine, Invoice
4  Payment, OrderLine, SalesOrder
5  StockAdjustment, StockReceipt, StockTransfer, InventoryCountLine, InventoryCount
6  StockMovement, StockLevel
7  PurchaseBatch
8  AttendanceRecord, PayrollAdjustment, AdvanceInstallment, EmployeeAdvance, EmployeeDocument
9  CashMovement, Expense, Cheque
10 (optional, by decision) Employee, Customer, Supplier, Item
```

---

## Current data state worth knowing before you decide

- `DailyProduction`: 22 DRAFT, 5 POSTED, 1 CANCELLED, **1 stuck in POSTING**
- `PurchaseBatch`: 14 MANUAL, 2 PRODUCTION, 1 OPENING_BALANCE (the raw-milk backfill)
- The known ×100 quantity anomaly and the 15 drifting items are all in data that a
  full transactional reset would remove — the reset resolves them by construction.

---

## Expected post-reset state (once decisions are made)

Inventory 0 · Production 0 · Orders 0 · Invoices 0 · FIFO 0 batches, 0 allocations ·
Attendance 0 · Payroll 0 · Finance movements 0 · reconciliation reporting zero drift
because both layers are empty · Tenant, TenantSetting, MAIN warehouse and the agreed
user account(s) intact.

**No opening stock will be invented.** When the customer enters their first real
counts, the flow must create `StockLevel` + `StockMovement` + `PurchaseBatch` together
— `POST /inventory/receive` already does exactly that.
