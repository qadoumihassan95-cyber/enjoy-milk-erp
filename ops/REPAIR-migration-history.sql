-- =====================================================================
--  REPAIR the Prisma migration history  (supersedes BASELINE-migration-history.sql)
-- =====================================================================
--  WHY THIS EXISTS
--  ---------------
--  The 8f863ee deploy switched the API start command to
--  `prisma migrate deploy`, but it went out BEFORE the baseline script
--  ran. `migrate deploy` therefore tried to apply three migrations whose
--  objects already existed:
--
--    14:34  20260723170000_drop_pallets_count  → applied cleanly
--    14:34  20260723180000_invoices            → FAILED
--    14:40  ...resolved (rolled_back + re-marked applied)
--    14:40  20260723190000_ai_request_log      → FAILED
--    14:41  ...resolved (rolled_back + re-marked applied)
--
--  `prisma migrate resolve` was used to recover, which is the correct
--  remedy. It leaves the failed attempt behind as a tombstone row with
--  rolled_back_at set. Prisma ignores those rows, so the deploy works —
--  but the table now has two rows per migration and is hard to read.
--
--  Separately, the two rows written by HOTFIX-2026-08-16-consolidation.sql
--  still carry the placeholder checksum 'applied-manually-hotfix-2026-08-16'
--  instead of the SHA-256 of their migration.sql. Prisma compares the
--  stored checksum against the file and refuses to deploy when they
--  diverge, so these are a live hazard for the next deploy.
--
--  WHAT THIS DOES
--  --------------
--    1. Replaces the two placeholder checksums with the real SHA-256
--       digests (computed from the files at commit 8f863ee).
--    2. Deletes the two rolled-back tombstone rows, leaving exactly one
--       applied row per migration.
--    3. Normalises applied_steps_count to 1 on the resolved rows.
--
--  It touches ONLY the _prisma_migrations bookkeeping table. No
--  application table, no schema object, no business data.
--
--  Idempotent: safe to run more than once.
--
--  HOW TO RUN
--  ----------
--  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ops/REPAIR-migration-history.sql
-- =====================================================================


-- ─── BEFORE ─────────────────────────────────────────────────────────
SELECT migration_name,
       LEFT(checksum, 16) AS checksum_head,
       finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS rolled_back
FROM "_prisma_migrations"
ORDER BY migration_name, started_at;


BEGIN;

-- 1. Real SHA-256 digests in place of the hotfix placeholders.
UPDATE "_prisma_migrations"
SET checksum = 'c6f80e239a7213366605b912caf684c3005f597624d97120b080460285b23228'
WHERE migration_name = '20260814170000_single_warehouse_consolidation'
  AND checksum <> 'c6f80e239a7213366605b912caf684c3005f597624d97120b080460285b23228';

UPDATE "_prisma_migrations"
SET checksum = '35348c7cef0da3c4f26a23508fb696cc7c7e630445f8117b8068475f797132a4'
WHERE migration_name = '20260816120000_production_cost_allocation'
  AND checksum <> '35348c7cef0da3c4f26a23508fb696cc7c7e630445f8117b8068475f797132a4';

-- 2. Drop the failed-attempt tombstones. Only rows that are BOTH rolled
--    back AND superseded by a successful row for the same migration are
--    removed, so a genuinely-failed migration with no successful partner
--    would be left untouched for review.
DELETE FROM "_prisma_migrations" dead
WHERE dead.rolled_back_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "_prisma_migrations" ok
    WHERE ok.migration_name = dead.migration_name
      AND ok.rolled_back_at IS NULL
      AND ok.finished_at IS NOT NULL
  );

-- 3. Tidy the resolved rows so every applied migration reads consistently.
UPDATE "_prisma_migrations"
SET applied_steps_count = 1
WHERE finished_at IS NOT NULL
  AND rolled_back_at IS NULL
  AND applied_steps_count = 0;

COMMIT;


-- ─── AFTER — every check must pass ──────────────────────────────────
SELECT migration_name,
       LEFT(checksum, 16) AS checksum_head,
       applied_steps_count
FROM "_prisma_migrations"
ORDER BY migration_name;

SELECT 'total rows (expect 7)'            AS check, COUNT(*)::text AS value FROM "_prisma_migrations"
UNION ALL
SELECT 'distinct migrations (expect 7)',
       (SELECT COUNT(DISTINCT migration_name)::text FROM "_prisma_migrations")
UNION ALL
SELECT 'rolled-back rows (expect 0)',
       (SELECT COUNT(*)::text FROM "_prisma_migrations" WHERE rolled_back_at IS NOT NULL)
UNION ALL
SELECT 'unfinished rows (expect 0)',
       (SELECT COUNT(*)::text FROM "_prisma_migrations" WHERE finished_at IS NULL)
UNION ALL
SELECT 'non-sha256 checksums (expect 0)',
       (SELECT COUNT(*)::text FROM "_prisma_migrations" WHERE checksum !~ '^[0-9a-f]{64}$');

-- Expected final set, all with 64-hex checksums:
--   20260510233312_init
--   20260516110854_daily_production_and_simple_orders
--   20260723170000_drop_pallets_count
--   20260723180000_invoices
--   20260723190000_ai_request_log
--   20260814170000_single_warehouse_consolidation
--   20260816120000_production_cost_allocation
