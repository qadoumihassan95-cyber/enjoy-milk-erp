-- =====================================================================
--  ⚠ SUPERSEDED — DO NOT RUN. Use ops/REPAIR-migration-history.sql.
-- =====================================================================
--  This script assumed it would run BEFORE the first `migrate deploy`.
--  It didn't: 8f863ee reached production first, `migrate deploy` applied
--  and part-failed the three migrations itself, and `prisma migrate
--  resolve` was used to recover. The live history therefore no longer
--  matches this script's preconditions.
--
--  ops/REPAIR-migration-history.sql handles the state that actually
--  exists. Kept here only as a record of what was originally prepared.
-- =====================================================================
--  BASELINE the Prisma migration history — run ONCE, BEFORE deploying
--  the first image that uses `prisma migrate deploy`.
-- =====================================================================
--  CONTEXT
--  -------
--  This database's schema was managed by `prisma db push` from May 2026
--  until 2026-08-16. `db push` writes nothing to _prisma_migrations, so
--  the history only ever recorded the two migrations that were applied
--  properly back in May. Everything since was pushed, not migrated.
--
--  apps/api/Dockerfile now starts the API with `prisma migrate deploy`.
--  Run against the history as it stands, that command would try to
--  RE-APPLY three migrations whose objects already exist and fail on
--  startup. Verified against the live database on 2026-08-16:
--
--    20260723170000_drop_pallets_count
--        → ProductionProducedItem."palletsCount" is ALREADY DROPPED
--          ⇒ would fail: column does not exist
--    20260723180000_invoices
--        → "Invoice" and type "InvoiceStatus" ALREADY EXIST
--          ⇒ would fail: relation already exists
--    20260723190000_ai_request_log
--        → "AiRequestLog" ALREADY EXISTS
--          ⇒ would fail: relation already exists
--
--  This script records them as applied so `migrate deploy` skips them.
--  It changes NO application data and creates/drops NO schema objects.
--
--  CHECKSUMS
--  ---------
--  Prisma verifies that _prisma_migrations.checksum equals the SHA-256
--  of the migration.sql file, and refuses to deploy when they diverge
--  ("migration was modified after it was applied"). The values below are
--  the real SHA-256 digests, computed from the files at commit 8f6703a.
--
--  Confirmed empirically: the two May migrations that Prisma applied
--  itself carry checksums identical to `sha256sum migration.sql`.
--
--  ⚠ These digests are content-addressed. If any migration.sql below is
--    edited after this script runs, `migrate deploy` will start failing.
--    Migration files are append-only — never edit an applied one.
--
--  This script ALSO repairs the two rows inserted by
--  HOTFIX-2026-08-16-consolidation.sql, which used the placeholder
--  checksum 'applied-manually-hotfix-2026-08-16'. Left as-is, those two
--  rows alone would fail the very first `migrate deploy`.
--
--  HOW TO RUN
--  ----------
--  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ops/BASELINE-migration-history.sql
--  or paste into Render Dashboard → enjoymilk-db → query console.
-- =====================================================================


-- ─── BEFORE ─────────────────────────────────────────────────────────
SELECT migration_name, checksum, finished_at
FROM "_prisma_migrations" ORDER BY started_at;


BEGIN;

-- 1. Repair the placeholder checksums written by the hotfix.
UPDATE "_prisma_migrations"
SET checksum = 'c6f80e239a7213366605b912caf684c3005f597624d97120b080460285b23228'
WHERE migration_name = '20260814170000_single_warehouse_consolidation';

UPDATE "_prisma_migrations"
SET checksum = '35348c7cef0da3c4f26a23508fb696cc7c7e630445f8117b8068475f797132a4'
WHERE migration_name = '20260816120000_production_cost_allocation';

-- 2. Record the three migrations that `db push` applied without logging.
--    Guarded by NOT EXISTS, so re-running this script is a no-op.
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, m.sum, NOW(), m.name,
       'Baselined by ops/BASELINE-migration-history.sql — schema objects were already present, applied via db push',
       NULL, NOW(), 1
FROM (VALUES
  ('20260723170000_drop_pallets_count',
   'c4196de5d65911d43a31930b0bfa080f5cef40feb37b6ef60f52cf834ab97c6c'),
  ('20260723180000_invoices',
   '4b47d8d58515a75bc25310a36d780b70cf31299b9e3d8db800f18c3854c51e1b'),
  ('20260723190000_ai_request_log',
   '21ee7b8536535b798a6c4d6f4e03d3de6f7d93156f3cb036a384d98ba3de838e')
) AS m(name, sum)
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" pm WHERE pm.migration_name = m.name
);

-- 3. Release the DailyProduction sheet stranded in POSTING at 13:17 by
--    the still-deployed strand bug (fixed in code by commit 8f6703a,
--    which has not reached production yet).
--    Guarded: only sheets that wrote NO StockMovement rows are touched,
--    so a genuinely half-posted sheet would be left alone for review.
UPDATE "DailyProduction" dp
SET status = 'DRAFT', "postedAt" = NULL, "postedById" = NULL
WHERE dp.status = 'POSTING'
  AND NOT EXISTS (
    SELECT 1 FROM "StockMovement" sm
    WHERE sm."refType" = 'DailyProduction' AND sm."refId" = dp.id
  );

COMMIT;


-- ─── AFTER — all seven present, no placeholder checksums left ────────
SELECT migration_name, checksum,
       CASE WHEN checksum ~ '^[0-9a-f]{64}$' THEN 'ok' ELSE 'INVALID' END AS checksum_form
FROM "_prisma_migrations" ORDER BY migration_name;

SELECT 'migrations recorded (expect 7)' AS check, COUNT(*)::text AS value FROM "_prisma_migrations"
UNION ALL
SELECT 'invalid checksums (expect 0)',
       (SELECT COUNT(*)::text FROM "_prisma_migrations" WHERE checksum !~ '^[0-9a-f]{64}$')
UNION ALL
SELECT 'sheets stuck in POSTING (expect 0)',
       (SELECT COUNT(*)::text FROM "DailyProduction" WHERE status = 'POSTING')
UNION ALL
SELECT 'active warehouses (expect MAIN)',
       (SELECT string_agg(code, ',' ORDER BY code) FROM "Warehouse" WHERE active);
