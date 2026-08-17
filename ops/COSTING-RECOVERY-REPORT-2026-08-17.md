# Opening-stock costing recovery — analysis report

**Date:** 2026-08-17 · **Database:** enjoymilk (Render, `dpg-d870uk9s16ns73b06sjg-a`)
**Status:** READ-ONLY analysis. No batches created. No data modified.

---

## Headline

**Do not assign costs yet.** Not because the costs are unavailable — because the
**quantities they would be applied to are provably wrong.**

Reconciling every item's `StockLevel` against the net of its own `StockMovement`
ledger shows the balances were written outside the application. The ledger says
hundreds-to-thousands; the balance says millions.

| Item | Net from movements | StockLevel | Unexplained | Ratio |
|---|---:|---:|---:|---:|
| حليب انجوي جاهز 750 غم | 2,117 | 211,700 | 209,583 | **×100 exactly** |
| حليب جاهز 1800 غم | 2,021 | 202,100 | 200,079 | **×100 exactly** |
| حليب انجوي جاهز 2250 غرام | 1,635 | 163,500 | 161,865 | **×100 exactly** |
| رولات 1800 غم | 1,575 | 157,700 | 156,125 | ×100 + 200 |
| كرتون 2250 غم | 452 | 135,500 | 135,048 | ≈ ×300 |
| كرتون 1800 غم | 460 | 732,000 | 731,540 | ≈ ×1,591 |
| رولات 2250 غم شكل جديد | 1,060 | 1,152,000 | 1,150,940 | ≈ ×1,087 |
| كرتون 20 غم | 4,257 | 4,292,000 | 4,287,743 | ≈ ×1,008 |

Three items are **exactly ×100**. Every stock change made through the application
writes a `StockMovement` — so a delta this size that has *no* corresponding
movement did not come through the UI. It was written directly to `StockLevel`.

This matches the anomaly flagged twice earlier: `StockLevel` rows went 55 → 22 and
Σ quantity 48,468.2 → 7,383,058.2 with only **+1** StockMovement.

### Why this blocks costing

Costing multiplies quantity by unit cost. Correct costs on wrong quantities give a
**confidently wrong** valuation that is far harder to detect later than an obvious
zero.

Worked example — حليب انجوي جاهز 20 غرام, using its legacy cost of 38.00 JOD/CTN:

| | Quantity | × 38.00 | Inventory value |
|---|---:|---:|---:|
| As recorded now | 60,500 | | **2,299,000 JOD** |
| If truly ×100 inflated | 605 | | **22,990 JOD** |

A 100× error, baked into the FIFO ledger and inherited by every future COGS
calculation. Applied across all 15 items the current quantities would book roughly
**7.2 million units** of inventory.

---

## Task 1 & 2 — the 15 uncovered active items

Every automated cost source is empty for all 15. This is not a partial gap.

| # | Item | Unit | Backfill qty | avgCost | costPrice | lastPurchasePrice | Receipts (w/ cost) | Batches (w/ cost) |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 | كرتون 20 غم | PCS | 4,292,000.0 | 0 | 0 | 0 | 0 (0) | 0 (0) |
| 2 | رولات 2250 غم شكل جديد | ROLL | 1,150,306.5 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 3 | كرتون 1800 غم | PCS | 728,995.0 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 4 | حليب انجوي جاهز 750 غم | CTN | 209,169.0 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 5 | حليب جاهز 1800 غم | CTN | 200,387.0 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 6 | حليب انجوي جاهز 2250 غرام | CTN | 163,500.0 | 0 | 0 | 0 | 0 (0) | 0 (0) |
| 7 | رولات 1800 غم | KG | 155,674.0 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 8 | كرتون 2250 غم | PCS | 131,391.0 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 9 | حليب انجوي جاهز 20 غرام | CTN | 60,500.0 | 0 | 0 | 0 | 0 (0) | 0 (0) |
| 10 | حليب خام | KG | 40,000.0 | 0 | 0 | 0 | 0 (0) | 0 (0) |
| 11 | رولات 750 غم | KG | 35,337.2 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 12 | رولات 2250 شكل قديم | KG | 22,990.0 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 13 | كرتون 750 غم | PCS | 18,401.0 | 0 | 0 | 0 | 1 (0) | 1 (0) |
| 14 | حليب جاهز 350 غرام | CTN | 15,890.0 | 0 | 0 | 0 | 0 (0) | 0 (0) |
| 15 | رولات 20 غم | KG | 3,042.6 | 0 | 0 | 0 | 0 (0) | 0 (0) |

**Total: 7,227,583.3 units.**

Database-wide cost signal:

| Source | Result |
|---|---|
| `PurchaseBatch` with `unitCost > 0` | **1** row, value `1.0000` |
| `StockReceipt` with `unitCost > 0` | **1** row of 14, value `1.0000` |
| Items with `avgCost > 0` | **0** (entire database) |
| Items with `lastPurchasePrice > 0` | **0** (entire database) |
| `SaleCostAllocation` rows | 0 |
| `ProductionCostAllocation` rows | 0 |
| Current FIFO inventory value | **1.00 JOD** |

There is no purchase history to average. The weighted-average path is unavailable.

---

## Task 3 — recommended source for `unitCost`, by tier

Against the requested priority list:

| Priority | Source | Verdict |
|---|---|---|
| 1 | Latest purchase cost | ❌ Unavailable — 1 of 14 receipts has a cost, and it is a placeholder `1.0000` |
| 2 | Weighted average from purchase history | ❌ Unavailable — no priced history exists |
| 3 | Existing inventory valuation | ❌ Unusable — total valuation is 1.00 JOD |
| 4 | **Manual input** | ✅ **Required** — but see the legacy anchors below |

### The one real find: legacy priced items

13 **inactive** items carry a `costPrice`. They look like the factory's original
product records, superseded when the current items were created. Several are
credible twins of uncovered items.

**Tier A — high confidence** (same product family, plausible cost/sell pair):

| Uncovered item | Legacy twin | SKU | costPrice | sellPrice |
|---|---|---|---:|---:|
| حليب انجوي جاهز 750 غم | حليب انجوي جاهز 750غم | 01 | **46.00** | 49.00 |
| حليب جاهز 350 غرام | حليب انجوي جاهز 350 غم | 02 | **44.00** | 46.00 |
| حليب جاهز 1800 غم | حليب انجوي 1800غم جاهز | 03 | **53.00** | 55.00 |
| حليب انجوي جاهز 20 غرام | حليب انجوي 20غم جاهز | 05 | **38.00** | 40.00 |

⚠ Unit caveat: legacy records are `PCS`, current are `CTN`. Confirm these mean the
same physical unit before adopting the number.

**Tier B — same family, unit mismatch, needs judgement:**

| Uncovered item | Unit | Legacy analogue | Legacy unit | Legacy cost |
|---|---|---|---|---:|
| حليب خام | KG | حليب خام عبوة 1 لتر | L | 0.50 |
| رولات 1800 / 750 / 20 غم, رولات 2250 (both) | KG / ROLL | ألمنيوم 200ml / 500ml / 1L | ROLL | 80 / 110 / 150 |
| كرتون 20 / 750 / 1800 / 2250 غم | PCS | كرتون 6 / 12 / 24 حبة | PCS | 0.55 / 0.95 / 1.20 |

Aluminium moved from per-ROLL to per-KG pricing and cartons are now named by
product size rather than pack count. Neither maps 1:1. **Do not auto-derive these.**

**Tier C — no anchor at all:** حليب انجوي جاهز 2250 غرام (163,500 CTN). The 2250g
size has no legacy record. Manual input only.

---

## Recommended sequence

1. **Reconcile quantities first.** Decide, per item, whether the ledger figure
   (net of movements) or the current `StockLevel` is the true count. The three exact
   ×100 items are the clearest place to start. Until this is settled, any costing is
   built on sand.
2. **Confirm the Tier A mappings** — four finished goods with defensible legacy
   costs, subject to the PCS↔CTN question.
3. **Collect real costs for Tier B and C** from purchase invoices — 11 items.
4. **Then** run the backfill with per-item costs, not a blanket fallback.

If you need production unblocked *before* all of that, the safest interim is to
backfill **حليب خام only** (the single item blocking sheet
`cmsw2910y0004u37ykqdooolr`), at a cost you confirm, and leave the other 14 for the
proper exercise. That is one row, trivially reversible while `remaining` is
untouched.

---

## Worksheet — fill in and return

Once quantities are settled, supply a cost per item and the backfill can run with
correct values instead of zeros.

```
item_name                        | unit | backfill_qty  | agreed_unit_cost | source
---------------------------------|------|---------------|------------------|--------
كرتون 20 غم                      | PCS  |   4,292,000.0 |                  |
رولات 2250 غم شكل جديد           | ROLL |   1,150,306.5 |                  |
كرتون 1800 غم                    | PCS  |     728,995.0 |                  |
حليب انجوي جاهز 750 غم           | CTN  |     209,169.0 |            46.00 | legacy SKU 01
حليب جاهز 1800 غم                | CTN  |     200,387.0 |            53.00 | legacy SKU 03
حليب انجوي جاهز 2250 غرام        | CTN  |     163,500.0 |                  | no anchor
رولات 1800 غم                    | KG   |     155,674.0 |                  |
كرتون 2250 غم                    | PCS  |     131,391.0 |                  |
حليب انجوي جاهز 20 غرام          | CTN  |      60,500.0 |            38.00 | legacy SKU 05
حليب خام                         | KG   |      40,000.0 |                  | legacy 0.50/L
رولات 750 غم                     | KG   |      35,337.2 |                  |
رولات 2250 شكل قديم              | KG   |      22,990.0 |                  |
كرتون 750 غم                     | PCS  |      18,401.0 |                  |
حليب جاهز 350 غرام               | CTN  |      15,890.0 |            44.00 | legacy SKU 02
رولات 20 غم                      | KG   |       3,042.6 |                  |
```

Pre-filled values are the Tier A legacy costs — confirm or overwrite.

---

## Also noted

- **4 inactive items** also hold uncovered stock. Skipped by the backfill's
  `active = TRUE` filter. They block nothing today, but reactivating one would
  reintroduce the failure.
- Production posting mode is currently **WARNING_MODE** (changed 2026-08-17
  00:51:46Z). It is inert for FIFO-only shortages, so it is not currently masking
  anything — but once the backfill lands it becomes live and will permit negative
  balances.
- Sheet `cmsvtvick001oz0pu5n1s94be` is still stranded in `POSTING` from the
  pre-`8f6703a` strand bug, with 0 movements. Needs one guarded UPDATE to release.
