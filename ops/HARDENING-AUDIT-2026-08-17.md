# Enjoy Milk ERP — verified remediation plan

**Date:** 2026-08-17 · **Base commit:** `c35484a` · **Status:** READ-ONLY audit. No code changed, no production data touched.

Every row below was verified against the current tree and, where it concerns
schema or data, against the live Render database. Nothing is marked fixed
because a comment says it is.

**Scoreboard — 26 findings**

| Verdict | Count |
|---|---:|
| ✅ Fixed already | 6 |
| 🟡 Partially fixed | 8 |
| 🔴 Still broken | 12 |

---

## The table

| # | Issue | Current Status | Evidence | Recommended Action |
|---|---|---|---|---|
| **P0-1a** | `db push --accept-data-loss` in production startup | ✅ **Fixed** | `apps/api/Dockerfile:109` runs `prisma migrate deploy`. Repo-wide grep finds `db push` only inside explanatory comments (`Dockerfile:79-93`). Migration failure aborts boot via `&&`. | None. Add a CI grep guard so it cannot come back. |
| **P0-1b** | Runtime auto-seed | ✅ **Fixed** | No seed call in `main.ts`; `prisma.service.ts:8-11` `onModuleInit` only `$connect()`. Seed runs once in the Dockerfile CMD, non-fatal. | None. |
| **P0-1c** | Seed overwrites production stock | ✅ **Fixed** | `prisma/seed.ts:237-247` gates demo stock on `inventoryIsVirgin = 0 StockLevel && 0 StockMovement`; all upserts use `update: {}`. Enforced by `seed-safety.spec.ts` (5 tests). | None. Minor hygiene: seed still resets demo users to `Admin@123` on every boot (`seed.ts:26-49`). |
| **P0-1d** | Demo/dev seed separated from production provisioning | 🟡 **Partial** | Separation is by virgin-DB check, not by env flag or separate file. Works, but a fresh production DB would still receive demo rows. | Add `SEED_MODE=demo\|provision` env gate. Low priority. |
| **P0-2a** | Migration chain works on a fresh database | 🔴 **Still broken** | Two hard failures. (1) `20260723170000_drop_pallets_count/migration.sql:18` alters `ProductionProducedItem`, a table no migration ever creates — Postgres errors even with `DROP COLUMN IF EXISTS`. (2) `20260816120000_production_cost_allocation/migration.sql:36-39` adds an FK to `PurchaseBatch`, also never created. | Generate a catch-up migration with `prisma migrate diff --from-migrations --to-schema-datamodel`, insert it **before** the two failing migrations, verify `migrate deploy` on scratch Postgres. |
| **P0-2b** | schema.prisma vs migration chain drift | 🔴 **Still broken** | **21 models** in `schema.prisma` have no `CREATE TABLE` anywhere: `PurchaseBatch`, `TenantSetting`, `ProductionProducedItem`, `ProductionMilkUsage`, `SaleCostAllocation`, `StockReceipt`, `StockAdjustment`, `StockTransfer`, `Supplier`, `InventoryCount(+Line)`, `EmployeeAdvance`, `AdvanceInstallment`, `PayrollAdjustment`, `EmployeeDocument`, `ProductionAluminumUsage`, `ProductionCartonUsage`, `ProductionMachine`, `SimpleOrderPayment`, `TelegramAccount`, `TelegramLog`. Conversely 3 tables the chain creates (`MachineProductionEntry`, `ProductionOutput`, `ProductionRawUsage`) are **not in the schema and not in production** — confirmed live: 0 of 3 present. | Same catch-up migration. Then delete the orphan tables in a separate reviewed migration. |
| **P0-2c** | Production migration history clean | ✅ **Fixed** | Live `_prisma_migrations`: all 8 rows `applied`, **zero** `rolled_back_at` tombstones. The earlier `REPAIR-migration-history.sql` worked. | None. |
| **P0-2d** | Migration-chain validation in CI | 🔴 **Still broken** | No `.github/` directory exists. No CI config of any kind. Nothing runs `migrate deploy` against a scratch DB. | Add a CI job: spin up Postgres service, `prisma migrate deploy`, then `migrate diff --exit-code` to prove zero drift. This is what makes P0-2 stay fixed. |
| **P0-3a** | One authoritative stock model | 🟡 **Partial** | `adjustStock`, `receiveStock`, sales, and production raw consumption all write both layers. Two paths still write `StockLevel` with **no** FIFO write: `createMovement` (`inventory.service.ts:320-360`, exposed at `inventory.controller.ts:148`) and `closeCount` (`inventory.service.ts:1419-1489`). | Route both through `syncFifoForAdjustment`. `closeCount` is the higher risk — it is the physical-count reconciliation flow. |
| **P0-3b** | Stock available while FIFO cannot consume | 🔴 **Still broken** | `detectShortages` (`daily-production.service.ts:1246-1263`) aggregates `StockLevel` only; it never reads `purchaseBatch`. The code comment at `:500-502` assumes the layers cannot diverge — §P0-3a proves they can. **This is my own defect from the posting-modes work, reported at the time.** | Make `detectShortages` compute `min(StockLevel, Σ PurchaseBatch.remaining)`. Without this, WARNING_MODE and STRICT_MODE are both bypassed for FIFO-only shortages and the user gets a raw Arabic FIFO error from deep inside the transaction. |
| **P0-3c** | Production wastage reduces FIFO | 🔴 **Still broken** | `daily-production.service.ts:576-602` deducts `StockLevel` via `adjustStock` but wastage rows are never added to `rawRows` (`:493-496`) and never passed to `consumeForProduction`. | Consume wastage through FIFO like raw materials. Until then Σ`remaining` drifts above `StockLevel` on every waste event and later sales can consume stock that was physically thrown away. |
| **P0-3d** | Positive adjustment creates a batch | 🟡 **Partial** | `syncFifoForAdjustment` (`inventory.service.ts:386-446`) does create one, but `unitCost` falls back to `avgCost → costPrice → 0` with no flag. Live data: **every** item has `avgCost = 0` and `costPrice = 0`, so this fallback fires 100% of the time. | Tag zero-cost batches (`sourceType` suffix or a `costEstimated` flag) so they are findable and correctable later. |
| **P0-4a** | FIFO batch consumption is concurrency-safe | 🔴 **Still broken** | `fifo.service.ts:90-97` and `:243-250` select candidates with plain `findMany` — no `FOR UPDATE`, no advisory lock, no isolation override anywhere in the repo. `remaining` is then decremented read-then-write: `update({ where: { id: b.id }, data: { remaining: new Decimal(avail - take) } })` (`:121-124`, `:275-278`) with no `remaining >= take` predicate. Classic lost update under Read Committed. The comment at `:89` claims a lock is taken; it is not. | Replace with atomic `updateMany({ where: { id, remaining: { gte: take } }, data: { remaining: { decrement: take } } })` and retry on `count === 0`, or `SELECT … FOR UPDATE` via `$queryRaw`. |
| **P0-4b** | Double-post of one production sheet | ✅ **Fixed** | G4 atomic claim `updateMany({ where: { id, tenantId, status: 'DRAFT' } })` at `daily-production.service.ts:381-390`, correctly **inside** the `$transaction`. | None. |
| **P0-4c** | PostgreSQL concurrency tests | 🔴 **Still broken** | Zero `*.e2e-spec.ts` files; no testcontainers. `apps/api/jest.config.js` states tests "target plain service methods with mocked Prisma". The one test labelled concurrent (`inventory.calc.spec.ts:664-716`) exercises only the G4 claim against a synchronous JS mock that cannot interleave. | Add a real-Postgres test harness and one test that fires two concurrent consumptions at a single batch. Without it, P0-4a cannot be proven fixed. |
| **P0-5a** | FIFO cost allocation per batch | ✅ **Fixed** | `fifo.service.ts:280-291` writes one `ProductionCostAllocation` per batch touched, inside the posting transaction. | None. |
| **P0-5b** | Finished-goods valuation from actual consumption | 🟡 **Partial** | `daily-production.service.ts:515-517` derives `perCartonCost = rawCostTotal / totalCartons` — but falls back to `item.avgCost/costPrice` when either is 0 (`:550-557`), and applies **one blended cost to every SKU** on a multi-SKU sheet. | Attribute cost per produced SKU from the inputs that SKU actually consumed. Medium effort; defer until P0-3/P0-4 land. |
| **P0-5c** | Waste costing | 🔴 **Still broken** | Waste never consumes FIFO (see P0-3c). It is only estimated after the fact in a report: `wasteCost = wasteQty × (productionCost / producedCartons)` (`daily-production.service.ts:1398-1399`). | Fixed by P0-3c. |
| **P0-5d** | Costing reproducible historically | ✅ **Fixed** | Allocations persist unit cost + batch id at posting time; `getCostAndWasteReport` sums the persisted rows (`:1376-1386`) rather than recomputing from current prices. Cancel restores `remaining` and deletes allocations (`fifo.service.ts:350-385`), and refuses to delete produced batches already partly sold (`:664-671`). | None, subject to P0-5b/P0-5c. |
| **P0-5e** | Hardcoded unit conversions | 🔴 **Still broken** | `apps/api/src/modules/inventory/unit-conversion.ts` is a correct central module whose own docstring says *"Never assume a global 1 sack = 25 kg"* — and it is **never imported by any non-test file**. Meanwhile `apps/web/app/production/[id]/page.tsx:592` computes `quantity: bags * 25`, and that value is consumed verbatim by `post()`. `daily-production.service.ts:926` hardcodes `const BAG_KG = 25` for waste-rate KPIs. | Wire `convertToItemUnit()` into the posting path; read `Item.bagWeightKg`. Any item whose real bag weight ≠ 25 is currently mis-deducting real inventory on every posting. |
| **P1-6** | RBAC deny-by-default | 🔴 **Still broken** | `roles.guard.ts:14-28`: `if (!required \|\| required.length === 0) return true;` — allow-by-default **by design**, documented in `roles.decorator.ts:5-9`. Guard is global (`app.module.ts:52-53`), so the flaw applies everywhere. Unprotected mutating endpoints include `POST /daily-production/:id/post` and `/cancel`, `POST /inventory/adjust`, `POST /finance/transfer`, `POST /orders/:id/pay`, `DELETE /orders/payments/:paymentId`. `finance.controller.ts`, `machines.controller.ts`, `repack.controller.ts` have **zero** `@Roles`. | Invert the guard to deny-by-default with an explicit `@AnyRole()`/`@Public()` opt-out, then annotate every route. Do it in one commit with the annotations, or the app breaks. Add a test per role per sensitive endpoint. |
| **P1-7** | Tenant isolation | 🟡 **Partial** | Most services correctly verify `findFirst({ id, tenantId })` before mutating. Proven holes: `customers.service.ts:186-190` increments **any** `cashboxId` from the request body; `:168-183` updates **any** `orderId`; `employees.service.ts:91-125` (`checkIn`) and `:132-171` (`markAttendance`) never check the employee's tenant; `inventory.service.ts:448-478` trusts `warehouseId` unverified. | Add tenant verification to those five paths and a cross-tenant attack test per module. The customers one is the most severe — it is money, and the endpoint has no `@Roles`. |
| **P1-8a** | JWT secret fallback | 🔴 **Still broken** | `auth.module.ts:13` and `jwt.strategy.ts:26` both: `process.env.JWT_SECRET \|\| 'dev-secret-change-me'`. Signer and verifier share the literal, so a misconfigured deploy silently accepts forged tokens. | Throw at bootstrap if `JWT_SECRET` is unset. One-line, zero-risk, do it first. |
| **P1-8b** | Refresh token storage | 🔴 **Still broken** | `schema.prisma:57-70` stores `refreshToken` as a unique plaintext column; issued raw at `auth.service.ts:121`, looked up by value at `:47-50`. Passwords are bcrypt-hashed; refresh tokens are not. | Store a SHA-256 hash, look up by hash. Needs a migration + a forced re-login. |
| **P1-8c** | Login throttling | 🔴 **Still broken** | No `@nestjs/throttler` dependency, no `ThrottlerModule`, no attempt counter. `auth.service.ts:22-44` has no backoff. | Add `ThrottlerModule` with a strict per-IP limit on `/auth/login`. |
| **P1-8d** | CORS | 🟡 **Partial** | `main.ts:20-34` is not literal `*`, but reflects **any** `https://*.onrender.com` and **any** `localhost:*` with `credentials: true`. `onrender.com` is shared public hosting. | Pin to the two known frontend origins via env. |
| **P1-8e** | Audit logging reliability | 🔴 **Still broken** | `audit.interceptor.ts:40-59` writes after the response via `tap()` and swallows failures with `.catch(() => undefined)`; `audit.service.ts:28-48` catches and only warns. A payroll payout can succeed with no audit row. | Write the audit row inside the same transaction as the mutation for sensitive operations. |
| **P1-8f** | MFA | 🔴 **Still broken** | No TOTP/OTP/2FA code anywhere. Single-factor login. | Out of scope for hardening; note as a roadmap item. |
| **P2-1** | Attendance state machine | 🔴 **Still broken** | No transition table. `markAttendance` (`employees.service.ts:147-158`) blindly overwrites status. `checkIn` (`:91-125`) is a **2-click toggle**, not a status setter. | Define explicit allowed transitions; make both buttons hit one idempotent `setAttendanceStatus` endpoint. |
| **P2-2** | Idempotent same-status submit | 🔴 **Still broken** | This is the reported bug. `checkIn` throws `'تم تسجيل الحضور والانصراف اليوم'` at `:111-113` for **any** existing record that is not in the narrow checked-in-not-out shape — including a record that is merely `ABSENT`. So غياب → حاضر fails with a message about check-out that never happened. | Return idempotent success when the requested state equals the current state. |
| **P2-3** | Duplicate prevention under rapid clicks | 🔴 **Still broken** | `findFirst`-then-`create` with no transaction, at `:95-97` and `:143-145`. Two clicks both read `null`, both `create`, second violates the unique constraint. **The same codebase already fixed this exact race elsewhere** with `upsert` (`daily-production.service.ts:1050-1064`). | Replace with `upsert` on the `(employeeId, date)` unique key. |
| **P2-4** | P2002 handled gracefully | 🔴 **Still broken** | No `try/catch` in either method. Prisma `P2002` is not an `HttpException`, so `all-exceptions.filter.ts:14-42` returns a bare **500 `Internal server error`** — the reported symptom. `invoices.service.ts:159-166` shows the correct pattern already in this codebase. | Catch `P2002` → return the idempotent success (after upsert, this becomes unreachable). |
| **P2-5** | Attendance tenant check | 🔴 **Still broken** | Neither method verifies the employee's tenant; `attendanceRecord.findFirst({ employeeId, date })` has no `tenantId`. Every other method in the file does check. | Add the guard. Same fix as P1-7. |
| **P2-6** | DB uniqueness constraint | ✅ **Fixed** | `schema.prisma:823-839` has `@@unique([employeeId, date])`. Live DB confirms 3 indexes on `AttendanceRecord`, 36 rows. The DB is doing its job — the service layer is what's missing. | Consider widening to `(tenantId, employeeId, date)` alongside P2-5. |
| **P2-7** | Frontend duplicate-submit guard | 🟡 **Partial** | Per-row `loading` exists and `Button` sets `disabled={loading}` (`employees/page.tsx:181-209`, `ui.tsx:17-48`). But `checkIn` and `mark` are **separate** `useMutation`s with independent `isPending`, so حاضر and غياب can fire together; and `disabled` only applies after React re-renders, so a fast native double-click still gets two requests off. | Single mutation keyed by employee id, plus a synchronous ref guard. Backend upsert makes this cosmetic rather than load-bearing. |
| **P2-8** | "حدث خطأ غير متوقع" source | 🟡 **Partial** | Not a toast — it is the Next.js error boundary (`app/error.tsx:44`, `app/global-error.tsx:76`), tripped by an uncaught render-phase exception, most plausibly the `invalidate()` refetch after the failed mutation. The toast path separately shows the raw `"Internal server error"` string. | Fixed downstream by P2-3/P2-4. Add friendly Arabic messages: `"تم تحديث حالة الحضور"`, `"الموظف مسجل حضوراً بالفعل"`, `"يوجد طلب قيد التنفيذ، انتظر لحظة"`. |
| **P3-1** | Reports use FIFO valuation | 🟡 **Partial** | Correct FIFO valuation exists (`fifo.service.ts:405-421`) but the **user-facing** dashboard and CSV/XLSX exports use `StockLevel × avgCost/costPrice` (`inventory.service.ts:609-613`, `:1519-1538`, `:1784-1804`). With P0-3c these two numbers drift apart permanently. | Point the exports at the FIFO valuation. |
| **P3-2** | DRAFT/CANCELLED excluded | 🟡 **Partial** | Correct in `getCostAndWasteReport`, `getCogsProfit`, `getFinancialReport`, `simple-orders.report`. **Missing entirely** in `dailyReport` (`:834-835`), `getDailySummary` (`:899-900`) and `customers.getCustomerStats` (`:209-227`) — a CANCELLED sheet whose stock was fully reversed still inflates today's production and waste totals. | Add the status filters. Cheapest fix in the whole plan. |
| **P3-3** | Pagination | 🟡 **Partial** | Item list is properly paginated. Unbounded `findMany` with no `take`: `fifo.listBatches` (`:479-491`, also eager-loads all allocations), `finance.listCheques` (`:139-147`), `inventory.listItems` (`:76-92`), `simple-orders.report` (`:721-724`), `customers.getCustomerStats` (`:210-226`, plus N+1 aggregate per customer). | Add `take`/`skip` + total count. Export builders may stay unbounded by design. |
| **P3-4** | Currency validated | 🔴 **Still broken** | `SimpleOrder.amountInBase` and `exchangeRate` exist and are written at creation (`simple-orders.service.ts:172-173`) but are **never read by any report**. Every report sums raw `total` across currencies (`finance.service.ts:297-305`, `simple-orders.service.ts:722-727`, `fifo.service.ts:405-421`). Exports hardcode the label `JOD`. | Sum `amountInBase`. Low urgency while the tenant is JOD-only, but it is a silent corruption waiting for the first USD order. |

---

## Recommended execution order

Sequenced so that each step is verifiable before the next, and so nothing lands
on top of an unproven foundation.

**Stage 1 — zero-risk, no behaviour change** (1 commit each)

1. `P1-8a` JWT secret: fail fast if unset. One line.
2. `P3-2` Add `status` filters to the three unfiltered reports.
3. `P0-2d` Add CI: Postgres service + `migrate deploy` + `migrate diff --exit-code`. This immediately turns P0-2a/b into a **failing build**, which is the honest signal.

**Stage 2 — correctness of the stock model** (must precede any costing work)

4. `P0-3b` `detectShortages` reads both layers. My defect; smallest fix with the largest user-visible effect.
5. `P0-3a` Wire `syncFifoForAdjustment` into `createMovement` and `closeCount`.
6. `P0-3c` / `P0-5c` Consume FIFO for wastage.
7. `P0-4a` Atomic `updateMany` for `remaining`, with retry.
8. `P0-4c` Real-Postgres concurrency test proving 7. **Step 7 is not done until step 8 passes.**

**Stage 3 — migration chain**

9. `P0-2a/b` Catch-up migration + mark applied on production + drop orphan tables in a separate reviewed migration. CI from step 3 is the acceptance test.

**Stage 4 — security** (behaviour-changing, needs a maintenance window)

10. `P1-7` Five cross-tenant holes + attack tests.
11. `P1-6` RBAC inversion + annotations + per-role tests, in one commit.
12. `P1-8b/c/d/e` Refresh-token hashing (forces re-login), throttling, CORS pinning, transactional audit.

**Stage 5 — attendance (P2)**

13. Backend: `upsert`, idempotent same-status, tenant check, unify the two endpoints. Frontend: single mutation + ref guard + Arabic messages. Tests for all six scenarios you listed.

**Stage 6 — remaining**

14. `P0-5e` unit conversion, `P0-5b` per-SKU costing, `P3-1` FIFO exports, `P3-3` pagination, `P3-4` currency.

---

## Constraints I am holding

- No production data modified. No destructive scripts. No inventory balance changes.
- One fix per commit, each with root cause in the message.
- Tests run before every commit; the current baseline is **74 API + 54 core passing**.
- Nothing in Stage 2 changes FIFO semantics — only whether the layers agree.

---

## Two things worth flagging before you choose

**P0-4a is the most dangerous finding here.** Two concurrent postings can each
consume the same batch quantity and both commit. It is silent — no error, no
alert — and it corrupts COGS. But it cannot be *proven* fixed without step 8,
because the entire test suite runs on a mocked Prisma that cannot interleave.

**P1-6 cannot be split.** Inverting the guard without annotating every route in
the same commit locks every user out of the app. It is the one item here that
needs a deliberate window rather than a quiet deploy.
