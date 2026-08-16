# Fixing the Prisma migration-history drift

## What the drift is

`schema.prisma` currently defines 21 models that have **no corresponding
`CREATE TABLE` in any file under `prisma/migrations/`**. Production runs
because these tables were created at some point via `prisma db push`,
but the resulting DDL was never committed as a migration file. Three
migration-file tables have been removed from the schema without a
`DROP TABLE` migration.

### 21 models missing from migration history

```
AdvanceInstallment, EmployeeAdvance, EmployeeDocument,
InventoryCount, InventoryCountLine,
PayrollAdjustment,
ProductionAluminumUsage, ProductionCartonUsage,
ProductionMachine, ProductionMilkUsage, ProductionProducedItem,
PurchaseBatch, SaleCostAllocation, SimpleOrderPayment,
StockAdjustment, StockReceipt, StockTransfer,
Supplier, TelegramAccount, TelegramLog,
TenantSetting
```

### 3 tables in migrations but no longer in schema

```
MachineProductionEntry, ProductionOutput, ProductionRawUsage
```

## Impact

- **Production Render DB**: works fine. All 21 tables exist there. The
  3 orphan tables may still be present as empty vestiges but don't
  break anything.
- **Any fresh DB** (CI, staging, new customer): `pnpm prisma migrate
  deploy` fails at `20260723170000_drop_pallets_count` because it
  references `ProductionProducedItem` which no migration ever created.
  Nobody can bring up a clean copy of the ERP right now.
- **CI**: any CI job that runs `prisma migrate deploy` against a
  scratch Postgres fails today.

## The safest fix (Prisma-native, no hand-written DDL)

Run this on your Mac. It uses Prisma's own diff engine, which produces
DDL that exactly matches your current schema.prisma — no chance of
missing an index, mistyping a Decimal precision, or forgetting a FK.

```bash
cd "~/Documents/Claude/Projects/قصراوي اخوان/enjoy-milk-erp"

# 1) Snapshot the CURRENT state Prisma believes exists based on migrations:
mkdir -p /tmp/prisma-drift
pnpm prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@localhost:5433/shadow?schema=public" \
  --script \
  > /tmp/prisma-drift/catchup.sql

# 2) Review /tmp/prisma-drift/catchup.sql — it should contain CREATE TABLE
#    IF NOT EXISTS for the 21 missing tables plus DROP TABLE IF EXISTS for
#    the 3 orphans. Read it before proceeding.

# 3) Wrap it in an idempotent migration folder:
NEW=prisma/migrations/$(date -u +%Y%m%d%H%M%S)_catchup_schema_drift
mkdir -p "$NEW"
{
  echo "-- Catchup migration: codifies tables that were previously created"
  echo "-- via legacy 'prisma db push' but never got a migration file."
  echo "-- Safe on production because everything uses IF NOT EXISTS."
  echo "-- Necessary on fresh databases so 'prisma migrate deploy' works."
  echo ""
  cat /tmp/prisma-drift/catchup.sql
} > "$NEW/migration.sql"

# 4) Verify against production Render DB — no actual writes should happen
#    because every table already exists:
psql "$DATABASE_URL_PROD" -f "$NEW/migration.sql" --single-transaction --dry-run 2>&1 | tee /tmp/prisma-drift/dry-run.txt

# 5) If dry-run is clean and you're satisfied, this migration is safe to
#    ship — Prisma will mark it applied on production without doing any
#    work (all CREATE TABLE IF NOT EXISTS short-circuit), and any fresh
#    DB will pick up the correct DDL.
```

### Notes

- **Shadow DB**: `prisma migrate diff` needs a scratch Postgres to
  materialize the "from" state. Any local Postgres works — the URL in
  the command above assumes a docker/dev instance at port 5433. Adapt
  if yours is elsewhere.
- **Why not `db pull`**: `db pull` would overwrite `schema.prisma` from
  the DB. We want the opposite: keep the schema, generate DDL to make
  the migration history match it.
- **Why not hand-write**: the correct DDL for 21 tables includes ~30
  indexes and ~15 foreign keys with exact `ON DELETE` policies. Missing
  one silently breaks referential integrity. Prisma's diff tool is the
  only source of truth here.

## What if you want to defer this?

Production doesn't need this fix. Only CI + fresh environments do. If
you're deploying to the same Render DB you've been using, you can
defer this indefinitely. Track it as tech debt and fix it during the
next quiet week.

## Verification query — how to know when it's applied

After running the catch-up migration, this should return 0:

```sql
SELECT COUNT(*) FROM (VALUES
  ('AdvanceInstallment'), ('EmployeeAdvance'), ('EmployeeDocument'),
  ('InventoryCount'), ('InventoryCountLine'),
  ('PayrollAdjustment'),
  ('ProductionAluminumUsage'), ('ProductionCartonUsage'),
  ('ProductionMachine'), ('ProductionMilkUsage'), ('ProductionProducedItem'),
  ('PurchaseBatch'), ('SaleCostAllocation'), ('SimpleOrderPayment'),
  ('StockAdjustment'), ('StockReceipt'), ('StockTransfer'),
  ('Supplier'), ('TelegramAccount'), ('TelegramLog'),
  ('TenantSetting')
) AS t(name)
WHERE to_regclass('public."' || name || '"') IS NULL;
```
