-- =====================================================================
--  Database-level integrity constraints for the stock and costing model
-- =====================================================================
--
--  WHY AT THE DATABASE LEVEL
--  -------------------------
--  Stage 2 fixed the FIFO lost-update race in application code. That is
--  the right place for the fix, but it is not the last line of defence:
--  a future code path, a direct SQL session, or a partially-deployed
--  build can still write a state the business considers impossible.
--  A CHECK constraint cannot be bypassed by any of those.
--
--  These constraints encode invariants the code already believes are
--  true. Each was verified against live production before being added -
--  the counts below are real, taken 2026-08-17.
--
--  WHY CHECK CONSTRAINTS SPECIFICALLY
--  ----------------------------------
--  Prisma does not model CHECK constraints, so they are invisible to
--  `prisma migrate diff` and cannot make the CI drift check fail.
--  Foreign keys and indexes ARE modelled by Prisma, so adding those
--  outside schema.prisma would report as drift - see the notes at the
--  bottom for the two proposals deliberately NOT implemented here.
--
--  ADD CONSTRAINT validates every existing row. A constraint that any
--  live row violates would abort the deploy, so every one below was
--  counted first.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. PurchaseBatch — the FIFO cost layer
--
--    Production check, 2026-08-17:
--      remaining < 0            0 rows
--      remaining > quantity     0 rows
--      quantity <= 0            0 rows
--      unitCost < 0             0 rows
-- ─────────────────────────────────────────────────────────────────────

-- remaining >= 0
-- The invariant Stage 2's guarded decrement enforces in code. With this
-- in place, even a raw UPDATE cannot over-consume a batch.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseBatch_remaining_non_negative') THEN
    ALTER TABLE "PurchaseBatch"
      ADD CONSTRAINT "PurchaseBatch_remaining_non_negative" CHECK ("remaining" >= 0);
  END IF;
END $$;

-- remaining <= quantity
-- You cannot have more of a batch left than was ever received. This also
-- catches a double-cancel: reverseForProduction increments `remaining`
-- when a posting is cancelled, and running that twice for the same
-- allocation would manufacture stock. The database now refuses.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseBatch_remaining_within_quantity') THEN
    ALTER TABLE "PurchaseBatch"
      ADD CONSTRAINT "PurchaseBatch_remaining_within_quantity" CHECK ("remaining" <= "quantity");
  END IF;
END $$;

-- quantity > 0 — a batch of nothing is not a batch.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseBatch_quantity_positive') THEN
    ALTER TABLE "PurchaseBatch"
      ADD CONSTRAINT "PurchaseBatch_quantity_positive" CHECK ("quantity" > 0);
  END IF;
END $$;

-- unitCost >= 0 — zero is permitted (uncosted opening balances exist and
-- are flagged by the reconciliation report); negative is not.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseBatch_unitcost_non_negative') THEN
    ALTER TABLE "PurchaseBatch"
      ADD CONSTRAINT "PurchaseBatch_unitcost_non_negative" CHECK ("unitCost" >= 0);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Cost allocations — the permanent record of what a posting consumed
--
--    Production check: 0 violations for both.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductionCostAllocation_quantity_positive') THEN
    ALTER TABLE "ProductionCostAllocation"
      ADD CONSTRAINT "ProductionCostAllocation_quantity_positive" CHECK ("quantity" > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductionCostAllocation_totalcost_non_negative') THEN
    ALTER TABLE "ProductionCostAllocation"
      ADD CONSTRAINT "ProductionCostAllocation_totalcost_non_negative" CHECK ("totalCost" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SaleCostAllocation_quantity_positive') THEN
    ALTER TABLE "SaleCostAllocation"
      ADD CONSTRAINT "SaleCostAllocation_quantity_positive" CHECK ("quantity" > 0);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 3. Invalid states blocked
--
--    Production check: 0 rows outside these value sets.
-- ─────────────────────────────────────────────────────────────────────

-- DailyProduction.status is a free TEXT column. POSTING is included: it
-- is the transient state the atomic claim in post() uses.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyProduction_status_valid') THEN
    ALTER TABLE "DailyProduction"
      ADD CONSTRAINT "DailyProduction_status_valid"
      CHECK ("status" IN ('DRAFT', 'POSTING', 'POSTED', 'CANCELLED'));
  END IF;
END $$;

-- productionPostingMode drives whether a shortage blocks, warns, or is
-- overridable. A typo here would silently change posting behaviour for
-- the whole tenant.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TenantSetting_posting_mode_valid') THEN
    ALTER TABLE "TenantSetting"
      ADD CONSTRAINT "TenantSetting_posting_mode_valid"
      CHECK ("productionPostingMode" IN ('STRICT_MODE', 'WARNING_MODE', 'OVERRIDE_MODE'));
  END IF;
END $$;

-- A tenant without a usable slug cannot be addressed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tenant_slug_not_blank') THEN
    ALTER TABLE "Tenant"
      ADD CONSTRAINT "Tenant_slug_not_blank" CHECK (btrim("slug") <> '');
  END IF;
END $$;


-- =====================================================================
--  DELIBERATELY NOT ADDED — and why
-- =====================================================================
--
--  StockLevel.quantity >= 0
--  ------------------------
--  Zero violating rows today, so it WOULD apply cleanly. It is still
--  wrong to add: WARNING_MODE and OVERRIDE_MODE exist precisely to let a
--  posting drive stock negative when material was physically consumed
--  before the paperwork caught up. That behaviour was built deliberately
--  and signed off. This constraint would break it at the database level,
--  turning an intended warning into a failed transaction.
--
--  If negative stock should be impossible, that is a decision to make in
--  the posting-mode configuration, not by quietly adding a CHECK.
--
--  StockMovement.quantity > 0
--  --------------------------
--  Would FAIL on production today: 12 existing rows have quantity = 0.
--    8 x ADJUSTMENT  2026-08-15 06:14 - 11:46
--    2 x IN          2026-05-21 13:49 - 13:52
--    2 x OUT         2026-05-21 13:49 - 13:52
--  All are exactly zero, none negative - they look like no-op movements
--  written by an early adjustment path. Adding the constraint requires
--  deciding whether to delete them or leave them, which is a data
--  decision and needs a backfill plan. Not taken unilaterally.
--
--  Foreign keys on tenantId
--  ------------------------
--  Only User has an FK to Tenant today. Adding tenantId FKs to
--  StockLevel, PurchaseBatch, StockMovement, DailyProduction and the
--  allocation tables would be sound - all eight were checked and have
--  zero orphan rows, and all eight columns are already NOT NULL, so
--  tenant ownership is required at the column level already.
--
--  They are not added here because Prisma DOES model foreign keys.
--  Constraints that exist in the database but not in schema.prisma would
--  be reported by `prisma migrate diff --exit-code` and fail the CI drift
--  check added in Stage 1. Doing this properly means adding the relation
--  fields to schema.prisma first, which changes the generated client and
--  every create() call that currently passes a bare tenantId string.
--  That is a real change, not a constraint tweak, and belongs in its own
--  commit with its own test run.
--
--  Partial unique index on opening balances
--  ----------------------------------------
--  UNIQUE ("tenantId", "itemId") WHERE "sourceType" = 'OPENING_BALANCE'
--  would prevent the duplicate opening coverage the reconciliation report
--  looks for (currently 0 occurrences). Same reasoning as above: Prisma
--  models indexes, cannot express a partial one, and the drift check
--  would flag it. Left as a recommendation.
-- =====================================================================
