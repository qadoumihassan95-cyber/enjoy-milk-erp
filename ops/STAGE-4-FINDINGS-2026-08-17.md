# Stage 4 — Inventory Model Completion: findings before implementation

**Date:** 2026-08-17 · **Base:** `a6ee87c` · **Status:** READ-ONLY investigation. No code written, no production data touched.

Three of the four Stage 4 items can be implemented from evidence alone. **Two require a
business decision I should not make unilaterally** — they change how inventory is valued
and how much material a posting deducts. Those are at the end, with options.

---

## 4.1 — Inventory mutation paths vs the four layers

Every path that changes an inventory quantity, audited against:
**A** `StockLevel` · **B** `StockMovement` · **C** `PurchaseBatch` (FIFO) · **D** cost allocations.

### Paths that are already correct

| Path | A | B | C | D |
|---|:-:|:-:|:-:|:-:|
| `POST /inventory/adjust` → `adjustStock` | ✅ | ✅ | ✅ | — |
| `POST /inventory/receive` → `receiveStock` | ✅ | ✅ | ✅ | — |
| `daily-production.post` — carton / aluminum / milk | ✅ | ✅ | ✅ | ✅ |
| `daily-production.post` — produced goods | ✅ | ✅ | ✅ | — |
| `daily-production.cancel` | ✅ | ✅ | ✅ | ✅ |
| `simple-orders` create / update / delete | ✅ | ✅ | ✅ | ✅ |

### Paths that are NOT

| # | Path | file:line | Gap | Risk |
|---|---|---|---|---|
| 1 | **`closeCount`** — physical stock count | `inventory.service.ts:1419-1489` | A + B, **no C** | **Highest.** This is the reconciliation flow. Every count that finds a variance silently widens the StockLevel↔FIFO gap. |
| 2 | **`createMovement`** — `POST /inventory/movements` | `inventory.service.ts:320-360` | A + B, **no C** | High. All movement types. Reachable by any authenticated user (no `@Roles`). |
| 3 | **production wastage** | `daily-production.service.ts:583-610` | A + B, **no C** | High — see 4.3, this is an accounting decision. |
| 4 | `simple-orders.deductStock` | `simple-orders.service.ts:783-803` | B + C + D full qty, **A clamped** | `Math.max(0, newQty)` at `:797` and a silent no-op at `:800`. A sale can bill and consume FIFO for more than it removes from the balance. |
| 5 | `simple-orders.adjustStock` | `simple-orders.service.ts:805-832` | mirror of #4 | `else if (delta > 0)` at `:822` silently drops negative deltas when the row is missing. |
| 6 | `prisma/seed.ts` demo stock | `seed.ts:264, 273` | A + C, **no B** | Low — virgin-DB guarded. A fresh tenant's ledger cannot explain its own opening balances. |
| 7 | `repack` module | `repack.service.ts:28, 147` | **writes nothing** | Accepts produced quantities and has zero inventory effect. Either dead or a silent hole. |
| 8 | `fifo.createPurchaseBatch` | `fifo.service.ts:168` | C only, **zero call sites** | Dead but live-callable. Would create a cost layer with no balance and no ledger row. |

**Correctly excluded:** `approveTransfer` (`inventory.service.ts:1236`) writes A+B but not C — and should not.
`PurchaseBatch` has no `warehouseId` (`schema.prisma:1263-1285`), so batches are `(tenantId, itemId)`-scoped
and a transfer is net-zero on Σ StockLevel. **Consequence worth recording:** FIFO consumption is
warehouse-blind, so a sale from MAIN can draw cost layers backing stock physically in another
warehouse. Masked today because the code forces a single MAIN warehouse — but
`POST /inventory/warehouses` still lets a user create more.

### Two defects inside `syncFifoForAdjustment` itself

`inventory.service.ts:386-446` — the helper the fixed paths rely on:

1. **It has the lost-update bug Stage 2 fixed everywhere else.** The negative branch (`:424-438`)
   does read-then-write on `remaining` with no `FOR UPDATE` and no guarded decrement — the exact
   pattern `fifo.service.ts:29-63` now defends against. Two concurrent `POST /inventory/adjust`
   deductions on one item can both read 100 and both write 40.
2. **Its tie-break ordering differs from FIFO's** — `purchaseDate, createdAt` (`:426`) vs
   `purchaseDate, createdAt, id` (`fifo.service.ts:112`). Same-timestamp batches are consumed in
   nondeterministic order depending on which code path runs.

Also: `opts.reason` is destructured and never used, so an `ADJUSTMENT` batch carries no
`sourceRefId` back to its `StockAdjustment` row — unlike `receiveStock:1033`.

**These are unambiguous bugs with no business tradeoff. Proposed for implementation without asking.**

---

## 4.2 — Unit conversion: the evidence is worse than the audit suggested

### `unit-conversion.ts` has zero production consumers

One importer in the entire repo: `inventory.calc.spec.ts:22` — **a test file**. There is a green
test at `:370` literally named `'BAG → KG uses per-item bagWeightKg (not a global 25)'` asserting
behaviour that no shipping code path exercises.

The module's own header says:

> *"Never assume a global '1 sack = 25 kg'. Every item that stocks in BAG must carry its own `bagWeightKg`."*

The codebase does exactly what that comment forbids, in five places:

| Where | Code | Effect |
|---|---|---|
| `apps/web/app/production/[id]/page.tsx:592` | `quantity: bags * 25` | **The only conversion that touches real inventory.** Runs in the browser, on keystroke. |
| `apps/web/app/production/[id]/page.tsx:557` | `عدد الأكياس × 25 كغ` | Advertises it as fixed policy |
| `daily-production.service.ts:956` | `const BAG_KG = 25` | Report recomputes KG from `count`, **discarding the stored `quantity`** |
| `daily-production.service.ts:1006` | `bagWeightKg: BAG_KG` | Publishes the hardcoded 25 in a field named after the real DB column |
| `apps/web/app/reports/page.tsx:913` | `const BAG_KG = 25` | Third independent constant |

### The decisive production fact

```
Items by unit:  PCS 45 · ROLL 8 · CTN 6 · KG 5 · L 3 · G 1
Items with bagWeightKg set:  0        ← zero, across the entire database
Items with unit = 'BAG' or 'SACK':  0
Items with packsPerCarton:   8 (all PCS)
```

**No item is configured for the conversion the system performs on every production posting.**
The "bag" is a purchasing/handling package with no representation in the data model at all.
Raw milk is a `KG` item; the ×25 converts an operator's bag count into KG using a number that
exists only in JavaScript.

### It is already drifting

```
ProductionMilkUsage, quantity/count ratio:   25.0 × 7 rows · 1.0 × 1 row · (count=0) × 2 rows
ProductionMilkUsage.unit:                    'KG' × 8 · 'L' × 4
```

The `1.0` row is an operator who typed the KG box directly (`page.tsx:604-609`) — legal, and it
desynchronises `count` from `quantity` with nothing reconciling them. The four `'L'` rows come from
the schema default (`schema.prisma:1017 unit String @default("L")`) holding kilogram numbers.

### Nothing records the factor

No table in the write path has a factor or unit column: `ProductionCartonUsage` and
`ProductionAluminumUsage` have **no `unit` column at all** (the UI's `unit:'KG'` on aluminium is
silently discarded on save); `StockMovement`, `StockLevel`, `PurchaseBatch`,
`ProductionCostAllocation`, `ProductionStockAudit` — none carry a unit.

**So:** if the hardcoded 25 is ever edited, every historical sheet retroactively reports a
different KG figure than the one actually deducted, with no version marker to detect it.
`Item.unit` is freely editable, and flipping an item's unit silently reinterprets every historical
movement for it.

Other findings worth recording: `Item.gramsPerUnit` and `Item.netWeightGrams` are **write-only
columns** — read arithmetically by nothing. `packsPerCarton` is read only by the dead helper.
`telegram.service.ts:965` labels KG quantities as **لتر**. Two different item forms write
`bagWeightKg` with opposite policies (`receive/page.tsx:380` hardcodes `'25'`;
`inventory/page.tsx:1370-1376` correctly refuses to guess).

---

## 4.3 — Waste costing: currently wrong in two independent ways

### What happens now

`daily-production.service.ts:583-610` — wastage writes **A + B only**. Waste rows are never added
to `rawRows` (`:493-496`), so `consumeForProduction` never sees them. FIFO does not know waste
happened. `Σ PurchaseBatch.remaining` drifts above `StockLevel` on every waste event, and stock
that was physically thrown away remains available for a later sale to consume.

### And the reported cost is dimensionally wrong

`getCostAndWasteReport` values **all** waste at finished-carton cost:

```
wasteCost = wasteQty × (productionCost / producedCartons)
```

But production waste is not all finished cartons. Live data:

| Wasted item | Item unit | Waste unit | Qty | What it actually is |
|---|---|---|---:|---|
| ألمنيوم 1 لتر | ROLL | **KG** | 12 | raw input |
| رولات 2250 غم | ROLL | **KG** | 2 | raw input |
| كرتون 1800/750/20/2250 غم, كرتون 24 حبة | PCS | PCS | 7 | raw input |
| حليب انجوي 1800غم جاهز | PCS | **KG** | 3 | finished good |
| حليب 1 لتر | PCS | **L** | **300** | finished good |
| رولات 20/1800 غم | KG | KG | 3 | neither |

Eight of thirteen rows are **raw inputs**, valued as if they were finished cartons. Five rows have
a `waste.unit` that disagrees with the item's own unit — and `post()` deducts
`-Number(w.quantity)` (`:602`) with **no conversion**, so a 300 "L" waste row removed 300 units
from a `PCS` item's balance.

### The accounting question

This is where I stop. Three defensible treatments, and they produce different P&L:

**Option A — waste consumes FIFO at its own cost.**
Waste is added to the FIFO consumption set like any other material. A wasted roll is costed at
the roll's actual FIFO cost; a wasted finished carton at the carton's production cost. Waste
becomes a normal inventory issue with an explicit loss reason.
*Correct in dimension. Changes reported waste cost for all future postings. Raw-material waste
would compete with production for the same batches, so a sheet with both could now hit a shortage
it previously did not.*

**Option B — waste consumes FIFO, but is excluded from the produced-goods cost base.**
Same as A, except wasted material is booked to a loss account rather than absorbed into
`perCartonCost`. Finished-goods cost falls; a separate waste-loss line appears.
*This is the textbook treatment (normal spoilage absorbed, abnormal spoilage expensed) but it
changes the unit cost of everything produced from now on.*

**Option C — keep waste out of FIFO; fix only the reporting dimension.**
Waste continues to deduct StockLevel only, but the report stops valuing raw-material waste at
carton cost and values each wasted item at its own FIFO cost instead.
*Smallest change, no effect on posting behaviour. Does NOT fix the StockLevel↔FIFO drift — the
reconciliation report will keep flagging it, correctly.*

---

## 4.4 — Reconciliation extensions

The Stage 2 report already covers: stock-without-batches, batches-without-stock, layer drift,
negatives, duplicate opening coverage, zero-cost layers. Stage 4 asks for two more:

- **Conversion mismatch** — implementable now: flag any `ProductionMilkUsage` where
  `quantity ≠ count × factor`, any usage row whose `unit` disagrees with `Item.unit`, and any item
  whose `unit` requires a conversion factor it does not have. Live data would immediately surface
  the 4 `'L'` rows, the 1.0-ratio row, and 5 waste rows.
- **Movement-ledger mismatch** — already in the SQL twin (`ops/RECONCILE-stock-model.sql` §8);
  should be promoted into the API report so it is visible without database access.

No business decision needed. **Proposed for implementation without asking.**

---

# What I need decided

Everything above can be fixed except two things, both of which change business behaviour.

## Decision 1 — waste costing treatment

Option A, B, or C above. This determines reported production cost and waste cost from the next
posting onward. It does not alter any historical row.

## Decision 2 — the ×25 bag conversion

No item has `bagWeightKg` configured, so switching to per-item configuration has to define what
happens to an unconfigured item. Whichever is chosen, I would additionally **persist the factor
used on each usage row** so historical sheets stop depending on a constant that can change.

- **2a — Require configuration.** `bagWeightKg` becomes mandatory for items entered by bag count;
  posting refuses until it is set. Most correct, and it stops production until someone fills in the
  raw-milk items. *This is what `unit-conversion.ts` was written to do.*
- **2b — Configure with a flagged fallback.** Use `bagWeightKg` when present; fall back to 25,
  record that the fallback was used on the row, and surface it in the reconciliation report.
  Nothing breaks; the gap becomes visible and closable item by item.
- **2c — Make 25 an explicit tenant setting.** One configurable default instead of five hardcoded
  literals, per-item override optional. Least disruptive, still a single global assumption.

A separate sub-question either way: **should existing `ProductionMilkUsage` rows be backfilled**
with the factor implied by `quantity / count`? That is a write to production data, so I will not
do it without explicit approval — and the row with ratio `1.0` and the two with `count = 0` would
need a decision of their own.

---

## What I plan to do while waiting

Nothing that touches these two decisions. Ready to proceed on:

1. `closeCount` and `createMovement` → route through `syncFifoForAdjustment` (4.1 #1, #2)
2. Fix `syncFifoForAdjustment`'s own lost-update race and ordering (4.1)
3. Fix the `simple-orders` clamp and silent-skip holes (4.1 #4, #5)
4. Add `unit` columns where the UI already sends one and the schema drops it
5. Extend the reconciliation report with conversion and ledger checks (4.4)

Items 1–3 are pure correctness fixes with no accounting choice in them. Item 4 is additive.
Item 5 is read-only.
