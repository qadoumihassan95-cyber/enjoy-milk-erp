-- =====================================================================
--  GO-LIVE — SET PRODUCTION POSTING MODE TO STRICT_MODE
-- =====================================================================
--  Run this BEFORE ops/GOLIVE-RESET-APPLY.sql.
--
--  WHY
--  ---
--  The reset empties StockLevel and PurchaseBatch. Under WARNING_MODE a
--  ترحيل against an item with no FIFO cover is allowed and posts the
--  balance negative. Under STRICT_MODE it is refused. Until real opening
--  inventory has been entered and verified, refusing is the correct
--  behaviour, so the mode is pinned before the data disappears.
--
--  Production was switched to WARNING_MODE by a deliberate operator
--  action on 2026-08-17 00:51:46Z (POST /api/daily-production/settings/
--  posting-mode, status 201) after the raw-milk opening batch was
--  backfilled. This puts it back.
--
--  WHAT THIS WRITES
--  ----------------
--  Exactly one column on exactly one row:
--      TenantSetting."productionPostingMode" := 'STRICT_MODE'
--
--  Guard 3 proves no other column of that row changed — it compares the
--  whole row as JSON, minus that one key, before and after. "updatedAt"
--  is deliberately NOT touched, so it is covered by that comparison too.
--
--  IDEMPOTENT — guarded by <> 'STRICT_MODE'; a second run writes 0 rows.
--  REVERSIBLE — POST /api/daily-production/settings/posting-mode, or
--               the same UPDATE with 'WARNING_MODE'.
--
--  HOW TO RUN
--    Render Dashboard → enjoymilk-api → Shell:
--      npx prisma db execute --url "$DATABASE_URL" --file <this file>
-- =====================================================================

BEGIN;

-- ── Guard 1: exactly one tenant, and it is the expected one ─────────
DO $$
DECLARE n INT; tid TEXT;
BEGIN
  SELECT COUNT(*) INTO n FROM "Tenant";
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 tenant, found %. Nothing was written.', n;
  END IF;
  SELECT id INTO tid FROM "Tenant";
  IF tid <> 'cmpejojr80000uef0dx69ve2q' THEN
    RAISE EXCEPTION 'Tenant id is %, expected cmpejojr80000uef0dx69ve2q. Wrong database? Nothing was written.', tid;
  END IF;
END $$;

-- ── Guard 2: exactly one TenantSetting row for the target tenant ────
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM "TenantSetting" WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 TenantSetting row, found %. Nothing was written.', n;
  END IF;
END $$;

-- ── The write, plus proof that nothing else on the row moved ────────
DO $$
DECLARE before_row JSONB; after_row JSONB; mode TEXT;
BEGIN
  SELECT to_jsonb(t) - 'productionPostingMode' INTO before_row
    FROM "TenantSetting" t WHERE t."tenantId" = 'cmpejojr80000uef0dx69ve2q';

  UPDATE "TenantSetting"
     SET "productionPostingMode" = 'STRICT_MODE'
   WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q'
     AND "productionPostingMode" <> 'STRICT_MODE';

  SELECT to_jsonb(t) - 'productionPostingMode' INTO after_row
    FROM "TenantSetting" t WHERE t."tenantId" = 'cmpejojr80000uef0dx69ve2q';

  IF before_row IS DISTINCT FROM after_row THEN
    RAISE EXCEPTION
      'A column other than productionPostingMode changed. Rolling back. before=% after=%', before_row, after_row;
  END IF;

  SELECT "productionPostingMode" INTO mode
    FROM "TenantSetting" WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';
  IF mode <> 'STRICT_MODE' THEN
    RAISE EXCEPTION 'Posting mode is % after the update, expected STRICT_MODE. Rolling back.', mode;
  END IF;

  RAISE NOTICE 'productionPostingMode = STRICT_MODE (all other columns unchanged)';
END $$;

COMMIT;
