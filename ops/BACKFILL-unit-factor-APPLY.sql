-- =====================================================================
--  Unit factor backfill — APPLY (WRITES)
-- =====================================================================
--  ⚠ Run ops/BACKFILL-unit-factor-PREVIEW.sql FIRST and read its output.
--
--  WHAT THIS WRITES
--  ----------------
--  Exactly two columns, on ProductionMilkUsage rows only:
--      "unitFactor"   := 25
--      "factorSource" := 'LEGACY_DEFAULT'
--
--  and ONLY on rows where the factor is unambiguous — count > 0,
--  quantity > 0, and quantity / count is exactly 25. That is the factor
--  the old hardcoded browser conversion applied, so stamping it records
--  what actually happened rather than deciding anything new.
--
--  WHAT THIS DOES NOT TOUCH
--  ------------------------
--  No quantity changes. No StockLevel, no StockMovement, no
--  PurchaseBatch, no allocation, no item master data, no other table.
--  Rows whose ratio is not exactly 25, or whose count is 0, are left
--  NULL on purpose — assigning them a factor would be inventing history.
--  They read back as "factor unknown" and are listed by the
--  reconciliation report.
--
--  It is labelled LEGACY_DEFAULT, not ITEM, because that is the truth:
--  no item had bagWeightKg configured when these rows were written. The
--  label is what lets you find them again once the items are configured.
--
--  IDEMPOTENT
--  ----------
--  Guarded by "unitFactor" IS NULL, so a second run updates 0 rows.
--
--  REVERSIBLE
--  ----------
--      UPDATE "ProductionMilkUsage"
--         SET "unitFactor" = NULL, "factorSource" = NULL
--       WHERE "factorSource" = 'LEGACY_DEFAULT';
--  (Safe as long as no NEW postings have happened since — those also
--  carry LEGACY_DEFAULT. Check createdAt on the parent sheet if unsure.)
--
--  HOW TO RUN
--  ----------
--  Render Dashboard → enjoymilk-api → Shell:
--      npx prisma db execute --url "$DATABASE_URL" --file <this file>
-- =====================================================================

BEGIN;

-- Guard 1 — the columns must exist. If this fails, the migration
-- 20260817140000_unit_conversion_snapshot has not been deployed yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ProductionMilkUsage'
      AND column_name = 'unitFactor'
  ) THEN
    RAISE EXCEPTION
      'ProductionMilkUsage."unitFactor" does not exist. Deploy migration 20260817140000_unit_conversion_snapshot first. Nothing was written.';
  END IF;
END $$;

-- Guard 2 — refuse if the shape of the data is not what PREVIEW showed.
-- Protects against running this against the wrong database.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM "ProductionMilkUsage"
  WHERE "count" > 0 AND quantity > 0
    AND ROUND(quantity / "count", 6) = 25
    AND "unitFactor" IS NULL;

  IF n = 0 THEN
    RAISE EXCEPTION
      'No unambiguous rows found to stamp. Either this already ran, or this is not the expected database. Nothing was written.';
  END IF;
  RAISE NOTICE 'Rows to stamp: %', n;
END $$;

-- The write.
UPDATE "ProductionMilkUsage"
   SET "unitFactor"   = 25,
       "factorSource" = 'LEGACY_DEFAULT'
 WHERE "count" > 0
   AND quantity > 0
   AND ROUND(quantity / "count", 6) = 25
   AND "unitFactor" IS NULL;
-- Expect on production 2026-08-17: UPDATE 7

COMMIT;


-- =====================================================================
--  VERIFICATION (read-only) — run after COMMIT
-- =====================================================================
SELECT 'rows with a factor (expect 7)'  AS check,
       COUNT(*)::text AS value FROM "ProductionMilkUsage" WHERE "unitFactor" IS NOT NULL
UNION ALL
SELECT 'all stamped rows say LEGACY_DEFAULT (expect 0 others)',
       (SELECT COUNT(*)::text FROM "ProductionMilkUsage"
         WHERE "unitFactor" IS NOT NULL AND "factorSource" <> 'LEGACY_DEFAULT')
UNION ALL
SELECT 'rows left unknown (expect 5)',
       (SELECT COUNT(*)::text FROM "ProductionMilkUsage" WHERE "unitFactor" IS NULL)
UNION ALL
SELECT 'sum quantity — MUST be unchanged (30835.0000)',
       (SELECT ROUND(SUM(quantity),4)::text FROM "ProductionMilkUsage")
UNION ALL
SELECT 'StockMovement rows — MUST be unchanged',
       (SELECT COUNT(*)::text FROM "StockMovement")
UNION ALL
SELECT 'PurchaseBatch rows — MUST be unchanged',
       (SELECT COUNT(*)::text FROM "PurchaseBatch")
UNION ALL
SELECT 'StockLevel sum — MUST be unchanged',
       (SELECT ROUND(SUM(quantity),4)::text FROM "StockLevel");

-- Every stamped row satisfies quantity = count × unitFactor.
SELECT 'factor consistency (expect 0 bad rows)' AS check,
       COUNT(*)::text AS value
FROM "ProductionMilkUsage"
WHERE "unitFactor" IS NOT NULL
  AND ABS(quantity - ("count" * "unitFactor")) > 0.0001;
