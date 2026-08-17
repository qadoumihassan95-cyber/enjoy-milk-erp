# One-paste execution via Render Shell

No terminal setup, no psql, no files to copy, no connection string to handle —
`DATABASE_URL` already exists inside the container.

**Render Dashboard → `enjoymilk-api` → `Shell` tab** (available on your starter plan).
Paste this once and press Enter:

```sh
npx prisma db execute --url "$DATABASE_URL" --stdin <<'SQL'
INSERT INTO "PurchaseBatch" (
  id, "tenantId", "itemId", "batchNumber", "purchaseDate",
  quantity, remaining, "unitCost", currency,
  "sourceType", "sourceRefId", "createdById", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  'cmpejojr80000uef0dx69ve2q',
  'cmrxe2q6y0004rcaasmpih45d',
  NULL,
  '2000-01-01'::timestamp,
  40000::numeric,
  40000::numeric,
  0.350000::numeric,
  'JOD',
  'OPENING_BALANCE',
  NULL,
  NULL,
  NOW()
WHERE NOT EXISTS (
        SELECT 1 FROM "PurchaseBatch"
        WHERE "itemId" = 'cmrxe2q6y0004rcaasmpih45d'
          AND "sourceType" = 'OPENING_BALANCE')
  AND (SELECT COALESCE(SUM(quantity),0) FROM "StockLevel"
       WHERE "itemId" = 'cmrxe2q6y0004rcaasmpih45d') = 40000;
SQL
```

Then tell me it ran, and I'll verify the result read-only through the Render integration.

---

## Why this is the same approved change

Identical to the reviewed `section2-insert.sql`, with the two guards folded into
the `WHERE` clause so it is a **single atomic statement** — no `BEGIN/COMMIT`,
no temp table, no `DO` blocks, nothing that can half-apply.

| Guard | In the file version | Here |
|---|---|---|
| cost must not be zero | `DO … RAISE EXCEPTION` | not needed — `0.350000` is a literal |
| StockLevel must be 40000 | `DO … RAISE EXCEPTION` | `AND (SELECT … ) = 40000` |
| no duplicate opening batch | `WHERE NOT EXISTS` | `WHERE NOT EXISTS` (identical) |

Difference in behaviour: if a guard fails, this version inserts **0 rows silently**
instead of raising an error. That is why verification is not optional — I check the
actual row afterwards rather than trusting the command's output.

Writes to `PurchaseBatch` only. Reads `StockLevel`. Touches nothing else.

## Expected output

```
Script executed successfully.
```

## What I verify afterwards

FIFO remaining `40000.0000` · unitCost `0.3500` · exactly 1 OPENING_BALANCE batch ·
StockLevel still `40000.0000` in 1 row · StockMovement still `7` · global
PurchaseBatch `14 → 15` · every other global counter unchanged.

## Rollback

```sh
npx prisma db execute --url "$DATABASE_URL" --stdin <<'SQL'
DELETE FROM "PurchaseBatch"
WHERE "itemId" = 'cmrxe2q6y0004rcaasmpih45d'
  AND "sourceType" = 'OPENING_BALANCE';
SQL
```
