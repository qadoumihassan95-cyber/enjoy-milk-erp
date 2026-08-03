-- Remove the palletsCount column from ProductionProducedItem.
--
-- Rationale: the "pallets" concept has been removed from the business
-- workflow as of 2026-07-23. Users now enter cartons directly. Prior
-- production records had palletsCount populated but that data is no
-- longer used anywhere in the UI, reports, exports, prints, or
-- calculations. The column is safe to drop:
--   - No FK on this column from any other table
--   - Not NULL with default 0 (dropping it does not orphan rows)
--   - The historical carton totals in `cartonsTotal` remain intact
--
-- If for any reason you need to restore the pallet count later, the
-- values are preserved in the daily-production `notes` field on
-- records where the operator originally entered them (see the note
-- template in daily-production.service.ts which used
-- `${itemName} (${palletsCount} طبلية)`).

ALTER TABLE "ProductionProducedItem" DROP COLUMN IF EXISTS "palletsCount";
