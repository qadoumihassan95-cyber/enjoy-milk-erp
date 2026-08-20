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

// ═════════════════════════════════════════════════════════════════════
//  GO-LIVE 2026-08-17 — the seed must not rebuild demo data after a reset
// ═════════════════════════════════════════════════════════════════════
//
// The `inventoryIsVirgin` guard above protects a database that HAS data.
// A go-live reset empties StockLevel and StockMovement, which makes the
// database virgin again — so that guard would have permitted demo stock
// to be re-planted on the next container start, silently undoing the
// reset. Mode selection closes that hole: on a production database the
// seed stops before any demo business data, virgin or not.

describe('seed mode — provision never creates demo business data', () => {
  it('defaults to provision when NODE_ENV=production', () => {
    expect(seedCode).toMatch(/NODE_ENV === 'production' \? 'provision' : 'demo'/);
  });

  it('stops before items, stock, customers, employees and licences', () => {
    // The early return must appear BEFORE the demo item catalogue, or the
    // stop is decorative.
    const stopIdx = seedCode.indexOf("if (mode === 'provision')");
    const itemsIdx = seedCode.indexOf("sku: 'RAW-MILK-200'");
    expect(stopIdx).toBeGreaterThan(-1);
    expect(itemsIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeLessThan(itemsIdx);
  });

  it('gates the demo user accounts behind demo mode', () => {
    const gateIdx = seedCode.indexOf("if (mode === 'provision')");
    const demoUserIdx = seedCode.indexOf("admin@enjoymilk.local");
    expect(gateIdx).toBeLessThan(demoUserIdx);
  });

  it('still ensures the tenant and warehouses in provision mode', () => {
    // MAIN is resolved on every posting; a database without it cannot
    // operate, so warehouse provisioning must precede the early return.
    const whIdx = seedCode.indexOf("code: 'MAIN'");
    const stopIdx = seedCode.indexOf("console.log('[seed] provision: tenant and warehouses ensured");
    expect(whIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(whIdx);
  });

  it('bootstraps an admin ONLY when no user exists at all', () => {
    expect(seedCode).toMatch(/const existing = await prisma\.user\.count\(\)/);
    expect(seedCode).toMatch(/if \(existing > 0\)/);
    // Reads the password from the environment, never a literal.
    expect(seedCode).toMatch(/process\.env\.BOOTSTRAP_ADMIN_PASSWORD/);
  });

  it('never prints credentials to the deploy log', () => {
    // These were written to Render's log on every container start.
    expect(seedCode).not.toMatch(/Login credentials/);
    expect(seedCode).not.toMatch(/enjoymilk\.local \/ /);
    expect(seedCode).not.toMatch(/console\.log\([^)]*Admin@123/);
  });

  it('does not log the bootstrap password', () => {
    const logsPassword = /console\.(log|warn|error)\([^)]*\bpassword\b[^)]*\)/i;
    const matches = seedCode.match(logsPassword) ?? [];
    // Mentioning the env var NAME in a warning is fine; echoing the value is not.
    for (const m of matches) {
      expect(m).not.toMatch(/\$\{\s*password\s*\}/);
    }
  });
});
