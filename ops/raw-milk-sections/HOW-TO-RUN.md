# How to run the raw-milk backfill — psql from your Mac

My earlier runbook said "Render Query Console." **That was my mistake — Render has no in-browser SQL console.** Their docs document psql, the external connection string, the Render CLI, and self-hosted admin apps (pgAdmin / PgHero), but no built-in query editor.

Use the path you already used successfully for `HOTFIX-2026-08-16-consolidation.sql`: **psql from your Mac terminal.**

---

## Get the connection string

Render Dashboard → **enjoymilk-db** → **Connect** (top right) → copy the **External Database URL**, or click **PSQL Command** which gives you a ready-to-paste command.

```bash
export DB='postgresql://USER:PASSWORD@dpg-d870uk9s16ns73b06sjg-a.oregon-postgres.render.com/DATABASE'
```

Do not paste the URL into chat — it contains the password.

---

## Step 1 — Section 1 (read-only)

```bash
psql "$DB" -v ON_ERROR_STOP=1 -f section1-before.sql
```

Expected — **stop if anything differs**:

```
 item_id                   | sku          | name     | unit | stocklevel_total | stocklevel_rows | fifo_remaining | batches | movements
 cmrxe2q6y0004rcaasmpih45d | ITM-MRXE2Q6X | حليب خام | KG   |       40000.0000 |               1 |              0 |       0 |         7

 StockLevel rows    | 22
 StockLevel sum     | 7383058.2000
 StockMovement rows | 136
 PurchaseBatch rows | 14
```

---

## Step 2 — Section 2 (the only write)

```bash
psql "$DB" -v ON_ERROR_STOP=1 -f section2-insert.sql
```

Expected:

```
SELECT 1
DO
DO
INSERT 0 1
COMMIT
```

`ON_ERROR_STOP=1` plus the file's own `BEGIN … COMMIT` means any guard failure aborts the whole transaction and writes nothing.

Safe outcomes:

| Output | Meaning | Action |
|---|---|---|
| `INSERT 0 1` | success | go to Step 3 |
| `INSERT 0 0` | batch already exists | idempotency guard; go to Step 3 |
| `ERROR: unitCost placeholder was not replaced` | wrong file version | re-pull commit `c35484a` |
| `ERROR: StockLevel for حليب خام is X, expected 40000` | stock moved | stop, tell me |

Any other error: nothing was committed. Send me the exact text.

---

## Step 3 — Section 3 (read-only verification)

```bash
psql "$DB" -v ON_ERROR_STOP=1 -f section3-verify.sql
```

Pass criteria: FIFO remaining `40000.0000`, unitCost `0.3500`, StockLevel still `40000.0000` in 1 row, movements still `7`, exactly 1 OPENING_BALANCE batch, global PurchaseBatch `15` with every other global counter unchanged (`22 / 7383058.2000 / 136 / 0 / 0`), 3c returning the single row `حليب خام | 1`, and 3d reading `500 | 40000 | COVERED`.

Paste the output back and I'll check it against the baseline.

---

## If you prefer not to use the terminal

Render documents deploying **pgAdmin** as a web service wired to the database over the private network — that gives you a browser query editor. It is more setup than running three psql commands, and it adds a publicly reachable admin surface to your account, so I'd only do it if the terminal is genuinely unavailable.

---

## Scope

Section 2 references exactly two tables: `PurchaseBatch` (the insert) and `StockLevel` (read-only, inside Guard 2). The only item id in any executable line is `cmrxe2q6y0004rcaasmpih45d`. Sections 1 and 3 contain zero write statements — verified by grep, not by eye.
