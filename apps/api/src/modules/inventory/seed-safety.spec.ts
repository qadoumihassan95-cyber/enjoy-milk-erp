/**
 * Guards the seed against reintroducing the "deploy resets stock" bug.
 *
 * INCIDENT 2026-08-16
 * -------------------
 * The API's container start command runs prisma/seed.js on EVERY boot.
 * The seed used to call
 *     stockLevel.upsert({ ..., update: { quantity: <constant> } })
 * for five items, so every deploy or restart silently rewrote those
 * balances back to demo constants — destroying real counted stock with no
 * StockMovement and no audit trail.
 *
 * The seed must now only plant demo stock into a database with no
 * inventory history at all. These tests read the seed source and assert
 * that property structurally, because the seed is a standalone script
 * rather than an injectable module.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const seedSource = readFileSync(
  join(__dirname, '..', '..', '..', '..', '..', 'prisma', 'seed.ts'),
  'utf8',
);

/**
 * Comments are stripped before the structural assertions below. The seed
 * documents the old bug verbatim (`update: { quantity: N }`) in a warning
 * comment, and that prose must not be mistaken for live code.
 */
const seedCode = seedSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('prisma seed — never overwrites existing stock', () => {
  it('does not force a StockLevel quantity in any upsert update branch', () => {
    // The exact shape of the old bug: `update: { quantity: ... }`.
    const forcedQuantityUpdate = /update:\s*\{[^}]*\bquantity\b/;
    expect(forcedQuantityUpdate.test(seedCode)).toBe(false);
  });

  it('guards demo stock behind an emptiness check on StockLevel AND StockMovement', () => {
    expect(seedCode).toMatch(/stockLevel\.count\(/);
    expect(seedCode).toMatch(/stockMovement\.count\(/);
    expect(seedCode).toMatch(/inventoryIsVirgin/);
  });

  it('only creates demo stock when the inventory is virgin', () => {
    // The create calls must sit inside the `inventoryIsVirgin` else-branch,
    // i.e. the guard is declared before any stockLevel.create.
    const guardAt = seedCode.indexOf('inventoryIsVirgin');
    const createAt = seedCode.indexOf('stockLevel.create');
    expect(guardAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(guardAt);
  });

  it('pairs every demo StockLevel with a PurchaseBatch so demo stock is FIFO-consumable', () => {
    expect(seedCode).toMatch(/purchaseBatch\.create/);
    expect(seedCode).toMatch(/OPENING_BALANCE/);
  });

  it('never reactivates or renames an existing warehouse', () => {
    // Warehouse upserts must keep an empty update branch.
    expect(seedCode).toMatch(/warehouse\.upsert\(\{[\s\S]{0,200}?update:\s*\{\}/);
  });
});
