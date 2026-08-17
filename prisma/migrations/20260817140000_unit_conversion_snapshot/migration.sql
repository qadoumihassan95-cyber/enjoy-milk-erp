-- =====================================================================
--  Unit conversion snapshot on production usage rows
-- =====================================================================
--
--  WHY
--  ---
--  The bag→KG conversion ran in the browser (`quantity: bags * 25`) and
--  nothing downstream — save, post, StockLevel, StockMovement, FIFO,
--  audit — knew a conversion had happened. No table recorded the factor.
--
--  Consequence: change `Item.bagWeightKg`, or edit the hardcoded 25 that
--  lived in five source files, and every historical sheet retroactively
--  reports a different weight than the one actually deducted, with no
--  version marker to detect it. A posted production sheet was not
--  reproducible.
--
--  These columns make each row self-describing: `quantity` stays the
--  authoritative amount in the item's own unit, and `unitFactor` +
--  `factorSource` record how it was derived.
--
--    factorSource   meaning
--    ------------   ------------------------------------------------
--    ITEM           read from Item.bagWeightKg / packsPerCarton
--    LEGACY_DEFAULT the 25 kg fallback was used — item not configured
--    PHYSICAL       G↔KG, a constant that cannot drift
--    IDENTITY       same unit both sides, factor 1
--    MANUAL         operator typed the target quantity directly
--    UNCONVERTIBLE  units disagree and no conversion exists (flagged)
--
--  ProductionCartonUsage and ProductionAluminumUsage additionally gain a
--  `unit` column. They never had one: the web client sets `unit: 'KG'` on
--  every aluminium row and the API silently dropped it on save.
--
--  SAFETY
--  ------
--  Purely additive. Every column is NULLABLE with no default and no
--  backfill, so existing rows are untouched and read back exactly as
--  before. A NULL factorSource means "recorded before this migration" and
--  is reported as legacy rather than guessed at.
--
--  Historical rows are NOT modified here. Backfill is a separate,
--  reviewed, operator-run script — see
--  ops/BACKFILL-unit-factor-PREVIEW.sql (read-only) and
--  ops/BACKFILL-unit-factor-APPLY.sql.
-- =====================================================================

-- ─── Milk usage — already has `unit`, gains the factor snapshot ──────
ALTER TABLE "ProductionMilkUsage" ADD COLUMN IF NOT EXISTS "unitFactor"   DECIMAL(18,6);
ALTER TABLE "ProductionMilkUsage" ADD COLUMN IF NOT EXISTS "factorSource" TEXT;

-- ─── Waste — already has `unit`, gains the factor snapshot ───────────
ALTER TABLE "ProductionWaste" ADD COLUMN IF NOT EXISTS "unitFactor"   DECIMAL(18,6);
ALTER TABLE "ProductionWaste" ADD COLUMN IF NOT EXISTS "factorSource" TEXT;

-- ─── Carton usage — no `unit` column existed at all ──────────────────
ALTER TABLE "ProductionCartonUsage" ADD COLUMN IF NOT EXISTS "unit"         TEXT;
ALTER TABLE "ProductionCartonUsage" ADD COLUMN IF NOT EXISTS "unitFactor"   DECIMAL(18,6);
ALTER TABLE "ProductionCartonUsage" ADD COLUMN IF NOT EXISTS "factorSource" TEXT;

-- ─── Aluminium usage — the UI's unit was being discarded on save ─────
ALTER TABLE "ProductionAluminumUsage" ADD COLUMN IF NOT EXISTS "unit"         TEXT;
ALTER TABLE "ProductionAluminumUsage" ADD COLUMN IF NOT EXISTS "unitFactor"   DECIMAL(18,6);
ALTER TABLE "ProductionAluminumUsage" ADD COLUMN IF NOT EXISTS "factorSource" TEXT;

-- ─── Guard: factorSource must be one of the known values ─────────────
-- CHECK constraints are invisible to `prisma migrate diff`, so this
-- cannot make the CI drift check fail. NULL is permitted — that is what a
-- pre-migration row looks like.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ProductionMilkUsage','ProductionWaste',
    'ProductionCartonUsage','ProductionAluminumUsage'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = t || '_factorSource_valid'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK ("factorSource" IS NULL OR "factorSource" IN (%L,%L,%L,%L,%L,%L))',
        t, t || '_factorSource_valid',
        'ITEM','LEGACY_DEFAULT','PHYSICAL','IDENTITY','MANUAL','UNCONVERTIBLE'
      );
    END IF;
  END LOOP;
END $$;
