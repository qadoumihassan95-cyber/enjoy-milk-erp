# Live Smoke Test — Post-Deployment Acceptance

Execute in the exact order below on the deployed environment (staging first if you have one). Every step is a checkbox; a failure at any step means **stop the release and roll back**.

## 0. Sanity
- [ ] Log in as owner.
- [ ] `/api/health` → `{ ok: true }`.
- [ ] `/api/ai/status` → `configured: true` (or documented `false` if key not set).

## 1. Inventory master data
- [ ] `/inventory` → open Add Item modal.
- [ ] Create item **SMOKE-KG**: unit=KG, costPrice=2.0, initialQty=**100**, active=true. Save.
- [ ] Create item **SMOKE-SACK**: unit=BAG (SACK), kgPerSack=**25**, initialQty=**10 sacks**. Save.
- [ ] Verify both appear in `/inventory` list with the entered quantities.

## 2. Receive
- [ ] `/inventory/receive` → item=SMOKE-KG, source=SUPPLIER, qty=**50**, unitCost=**3.0**. Save.
- [ ] Verify SMOKE-KG.totalStock = 150.
- [ ] Verify SMOKE-KG.avgCost = **2.333333** (100×2 + 50×3)/150.

## 3. Edit item — master data only
- [ ] `/inventory` → Edit SMOKE-KG → change name only. Save.
- [ ] Verify totalStock still 150, no adjustment entry created.

## 4. COUNT adjustment
- [ ] `/inventory` → Edit SMOKE-KG → newQty=**140**, reason=`smoke`. Save.
- [ ] Verify totalStock=140.
- [ ] Verify `/inventory/items/:id` history shows one StockAdjustment (type=COUNT, delta=-10).
- [ ] Repeat same edit 3 times without changing qty. Verify totalStock stays 140 (no +1 drift).

## 5. Production — happy path
- [ ] `/production` → New production day.
- [ ] Add milk usage: item=SMOKE-KG, quantity=**60 KG**.
- [ ] Add produced: item=SMOKE-FINISHED (create if needed), cartons=**10**.
- [ ] Save-all, then Post.
- [ ] `/inventory` — SMOKE-KG should now be 80.
- [ ] `/inventory` — SMOKE-FINISHED should now be 10.
- [ ] `/reports/fifo` → PurchaseBatch list. Confirm SMOKE-FINISHED has a `sourceType='PRODUCTION'` batch with `unitCost` derived from raw cost.

## 6. Production — double-post protection
- [ ] Open two browser tabs on the same production day (make a NEW draft first).
- [ ] Click Post in both tabs as fast as possible.
- [ ] Verify exactly one tab succeeds, the other shows `لا يمكن الترحيل — الحالة الحالية: POSTING/POSTED`.
- [ ] Verify inventory only decremented once.

## 7. Production — cancel
- [ ] Cancel the last posted production.
- [ ] Verify raw material (SMOKE-KG) is back to 140.
- [ ] Verify finished (SMOKE-FINISHED) is back to 0.
- [ ] Verify the produced PurchaseBatch is gone from `/reports/fifo`.

## 8. Production — repost blocked
- [ ] Attempt to Post the cancelled sheet again → must show `لا يمكن ترحيل ورقة ملغاة`.

## 9. Sale + FIFO COGS
- [ ] `/orders` → New order for SMOKE-FINISHED, qty=5 (post-cancel we're back to 0 — create a fresh production first).
- [ ] Wait — this needs SMOKE-FINISHED > 0. Create + post a small production first (2 KG milk → 3 cartons), then sell 2 cartons.
- [ ] Verify the sale writes a StockMovement.
- [ ] Verify `/reports/fifo` shows a SaleCostAllocation for that sale with unitCost from the produced batch.
- [ ] Verify `/reports` → Profit report shows revenue > 0 and COGS > 0 for that order date.

## 10. Payment
- [ ] Add a payment on the order. Verify `paid` updates.
- [ ] `/finance` report → `collected` for today includes the payment (payment-date basis).

## 11. FIFO failure surfaces
- [ ] Attempt to sell 999 units of an item you don't have.
- [ ] Must throw `الكمية المتاحة أقل من المطلوبة` — NOT a silent success with COGS=0.

## 12. Reports match source
- [ ] `/reports` → **Inventory Report**: total value ≈ Σ(qty × avgCost) per item.
- [ ] `/reports/fifo` → **Inventory Valuation**: Σ(remaining × unitCost).
- [ ] `/reports` → **Production Cost & Waste** tab now reads real ProductionCostAllocation totals per production.
- [ ] `/reports` → **Sales & Collections**: date filter honours `orderDate`; the sum equals Σ SimpleOrder.total in that window (excl. CANCELLED).
- [ ] `/production/summary` today matches Dashboard "Today's Production" card.
- [ ] `/reports` → **Inventory Movement**: shows all rows for the window (no silent 500-row cap; scroll to confirm > 500 if you have that volume).
- [ ] `/finance` report: `collected` sums SimpleOrderPayment amounts by payment-date, not order-date.

## 13. DB integrity — run after every acceptance test
```
psql "$DATABASE_URL" -f ops/db-integrity-audit.sql
```
- [ ] INT-01…INT-21 all return 0 rows (or documented "SEED_OPENING" only).
- [ ] INT-17 either returns 0 rows OR the count matches the pre-deploy figure (unchanged; the app didn't retroactively backfill).
- [ ] INT-19 returns 0 rows after B2 + OPENING backfill (if you ran them) — non-zero if you deliberately deferred backfill.
- [ ] INT-20 returns 0 rows (batch quantity = remaining + Σ sale + Σ production allocations).
- [ ] INT-21 returns 0 rows.
