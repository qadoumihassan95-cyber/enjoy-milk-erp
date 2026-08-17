# Runbook — حليب خام opening-balance backfill

**Script:** `ops/SCOPED-backfill-raw-milk-2026-08-17.sql` (208 lines) · commit `c35484a`
**Cost:** 0.350000 JOD/KG · **Quantity:** 40,000 KG · **Batch value:** 14,000.00 JOD
**Scope:** one item — `cmrxe2q6y0004rcaasmpih45d`. No other item, no code, no mode change.

Execution is manual. Render Dashboard → `enjoymilk-db` → **Query Console**.

---

## Pre-flight (verified live, 2026-08-17)

| Check | Value | Required |
|---|---:|---|
| StockLevel (raw milk) | 40,000.0000 | must be exactly 40000 or Guard 2 aborts |
| PurchaseBatch (raw milk) | 0 | 0 or 1; if 1 the INSERT no-ops |
| StockMovement (raw milk) | 7 | baseline |
| PurchaseBatch (global) | 14 | baseline |
| StockLevel sum (global) | 7,383,058.2000 | baseline |
| StockMovement (global) | 136 | baseline |
| Posting mode | WARNING_MODE | unchanged — do not touch |
| Sheet `cmsw2910y0004u37ykqdooolr` | DRAFT, needs 500 KG | target of this fix |

---

## Step 1 — Section 1 (lines 59–78). READ-ONLY.

Paste and run. **Keep the output** — Section 3 compares against it.

Query A expects one row:

```
item_id                   | sku          | name     | unit | stocklevel_total | stocklevel_rows | fifo_remaining | batches | movements
cmrxe2q6y0004rcaasmpih45d | ITM-MRXE2Q6X | حليب خام | KG   | 40000.0000       | 1               | 0              | 0       | 7
```

Query B expects four rows:

```
StockLevel rows     | 22
StockLevel sum      | 7383058.2000
StockMovement rows  | 136
PurchaseBatch rows  | 14
```

**STOP if anything differs.** A different StockLevel means stock moved; re-check before writing.

---

## Step 2 — Section 2 (lines 81–146). WRITES.

Paste the whole block including `BEGIN;` and `COMMIT;`. It runs as one transaction.

Expected: **`INSERT 0 1`**, then `COMMIT`.

Possible aborts — all safe, nothing is written:

| Message | Meaning | Action |
|---|---|---|
| `unitCost placeholder was not replaced (got 0)` | wrong file version pasted | use commit `c35484a` |
| `StockLevel for حليب خام is X, expected 40000` | stock moved since pre-flight | stop, re-assess |
| `INSERT 0 0` | opening batch already exists | idempotency guard fired; skip to Step 3 |

If you see an error other than these, run `ROLLBACK;` and send me the exact text.

---

## Step 3 — Section 3 (lines 149–208). READ-ONLY. All must pass.

**3a — the item.** Seven rows:

```
FIFO remaining (expect 40000.0000)              | 40000.0000
StockLevel total (must still be 40000.0000)     | 40000.0000
StockLevel rows for item (must still be 1)      | 1
StockMovements for item (must still be 7)       | 7
OPENING_BALANCE batches for item (expect 1)     | 1
total batches for item (expect 1)               | 1
batch unitCost (must NOT be 0)                  | 0.3500
```

**3b — nothing else moved.** Six rows:

```
StockLevel rows (must be 22)                | 22
StockLevel sum (must be 7383058.2000)       | 7383058.2000
StockMovement rows (must be 136)            | 136
PurchaseBatch rows (14 -> expect 15)        | 15
ProductionCostAllocation (must be 0)        | 0
negative StockLevel rows (expect 0)         | 0
```

Only `PurchaseBatch rows` changes. Anything else moving means something outside this script wrote to the database.

**3c — no other item gained a batch.** Exactly one row:

```
حليب خام | 1
```

More than one row means the wrong script ran (the 15-item version).

**3d — the sheet is unblocked.**

```
required | fifo_available | verdict
500.0000 | 40000          | COVERED — sheet can post with no shortage
```

---

## Step 4 — post-write application check

Open sheet `cmsw2910y0004u37ykqdooolr` in the ERP and press **ترحيل**.

Expected: posts cleanly, **no shortage warning and no confirmation dialog** — 40,000 KG covers 500 KG with room to spare. Status DRAFT → POSTED.

If a shortage warning still appears, do not force it through. Send me the message text.

---

## Rollback

Valid while `remaining` is untouched and `ProductionCostAllocation` is 0. Refuses if an allocation references the batch — by design.

```sql
DELETE FROM "PurchaseBatch"
WHERE "itemId" = 'cmrxe2q6y0004rcaasmpih45d'
  AND "sourceType" = 'OPENING_BALANCE';
```

Correcting the cost later, without deleting, while nothing has consumed it:

```sql
UPDATE "PurchaseBatch" SET "unitCost" = <new cost>
WHERE "itemId" = 'cmrxe2q6y0004rcaasmpih45d'
  AND "sourceType" = 'OPENING_BALANCE';
```

---

## Explicitly NOT in this runbook

- The other 14 items — blocked on the ×100 quantity reconciliation. See `ops/COSTING-RECOVERY-REPORT-2026-08-17.md`.
- Any application code change.
- Any posting-mode change. Tenant stays WARNING_MODE.
- Stranded sheet `cmsvtvick001oz0pu5n1s94be` (POSTING, 0 movements) — separate guarded UPDATE, not now.
