-- =====================================================================
--  GO-LIVE - ORDERING GATE (no writes)
-- =====================================================================
--  Runs BETWEEN GOLIVE-SET-STRICT-MODE.sql and GOLIVE-RESET-APPLY.sql.
--
--  Purpose: make the ordering enforceable by the database rather than by
--  a human remembering it. If the posting mode is not already
--  STRICT_MODE, this raises, the shell chain stops on the non-zero exit
--  code, and the destructive script is never reached.
--
--  Contains no INSERT/UPDATE/DELETE. Pure ASCII on purpose.
-- =====================================================================

DO $$
DECLARE mode TEXT; n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM "Tenant";
  IF n <> 1 THEN
    RAISE EXCEPTION 'GATE: expected exactly 1 tenant, found %. Refusing to continue.', n;
  END IF;

  SELECT "productionPostingMode" INTO mode
    FROM "TenantSetting" WHERE "tenantId" = 'cmpejojr80000uef0dx69ve2q';

  IF mode IS NULL THEN
    RAISE EXCEPTION 'GATE: no TenantSetting row for the target tenant. Refusing to continue.';
  END IF;

  IF mode <> 'STRICT_MODE' THEN
    RAISE EXCEPTION
      'GATE: posting mode is %, expected STRICT_MODE. Step 1 did not take effect. The reset will NOT run.', mode;
  END IF;

  RAISE NOTICE 'GATE PASSED: posting mode is STRICT_MODE; the reset may proceed.';
END $$;
