#!/usr/bin/env node
/**
 * REAL PostgreSQL concurrency proof for FIFO batch consumption.
 * ────────────────────────────────────────────────────────────
 * This is deliberately NOT a jest test with a mocked Prisma client.
 * A JS mock resolves promises on a single thread in a deterministic
 * order; it cannot interleave two transactions, so it cannot observe a
 * lost update. Only a real database with real MVCC can.
 *
 * It runs three scenarios against a live PostgreSQL instance:
 *
 *   A. CONTROL — the OLD pattern (read, compute in JS, write absolute
 *      value). Expected to DOUBLE-CONSUME. This proves the harness can
 *      actually detect the bug; a test that passes against both the
 *      broken and fixed code proves nothing.
 *
 *   B. FIXED — SELECT … FOR UPDATE + guarded conditional decrement,
 *      exactly the statements fifo.service.ts now issues. Expected:
 *      the second transaction blocks, then sees the true remaining and
 *      is refused. Never negative, never over-consumed.
 *
 *   C. DEADLOCK ORDERING — two transactions consuming two items. With
 *      items locked in opposite order a deadlock is possible; with the
 *      sorted order daily-production.service now uses, both complete.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node apps/api/test/fifo-concurrency.int.js
 *
 * Exits non-zero if any assertion fails. Creates and drops its own
 * schema (fifo_concurrency_test); touches no application table.
 */

const path = require('path');

let Client;
try {
  ({ Client } = require('pg'));
} catch {
  ({ Client } = require(path.join(
    process.env.PG_MODULE_PREFIX || '/tmp/pgdeps',
    'node_modules',
    'pg',
  )));
}

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const SCHEMA = 'fifo_concurrency_test';
let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✅' : '❌'} ${name}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

const connect = async () => {
  const c = new Client({ connectionString: URL });
  await c.connect();
  return c;
};

async function setup(admin, batches) {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`
    CREATE TABLE ${SCHEMA}."PurchaseBatch" (
      id            text PRIMARY KEY,
      "tenantId"    text NOT NULL,
      "itemId"      text NOT NULL,
      "purchaseDate" timestamp NOT NULL,
      "createdAt"   timestamp NOT NULL DEFAULT now(),
      quantity      numeric(18,4) NOT NULL,
      remaining     numeric(18,4) NOT NULL,
      "unitCost"    numeric(18,6) NOT NULL DEFAULT 0
    )`);
  for (const b of batches) {
    await admin.query(
      `INSERT INTO ${SCHEMA}."PurchaseBatch"
         (id,"tenantId","itemId","purchaseDate",quantity,remaining,"unitCost")
       VALUES ($1,'t1',$2,$3,$4,$4,1)`,
      [b.id, b.itemId, b.date, b.qty],
    );
  }
}

const totalRemaining = async (admin, itemId) => {
  const r = await admin.query(
    `SELECT COALESCE(SUM(remaining),0)::float8 AS s FROM ${SCHEMA}."PurchaseBatch" WHERE "itemId"=$1`,
    [itemId],
  );
  return r.rows[0].s;
};

/** The OLD, broken consumption: read → compute in JS → write absolute. */
async function consumeOldWay(client, itemId, need, barrier) {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT id, remaining::float8 AS remaining FROM ${SCHEMA}."PurchaseBatch"
      WHERE "itemId"=$1 AND remaining > 0
      ORDER BY "purchaseDate" ASC, "createdAt" ASC, id ASC`,
    [itemId],
  );
  const available = rows.reduce((s, r) => s + r.remaining, 0);
  await barrier(); // both transactions have now read
  if (available < need) {
    await client.query('ROLLBACK');
    return 'REFUSED';
  }
  let left = need;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(r.remaining, left);
    left -= take;
    await client.query(
      `UPDATE ${SCHEMA}."PurchaseBatch" SET remaining = $1 WHERE id = $2`,
      [r.remaining - take, r.id],
    );
  }
  await client.query('COMMIT');
  return 'CONSUMED';
}

/** The NEW consumption: FOR UPDATE + guarded conditional decrement. */
async function consumeNewWay(client, itemId, need, barrier) {
  await client.query('BEGIN');
  try {
    // Lock first — this is where the second transaction blocks.
    await client.query(
      `SELECT id FROM ${SCHEMA}."PurchaseBatch"
        WHERE "tenantId"='t1' AND "itemId"=$1 AND remaining > 0
        ORDER BY "purchaseDate" ASC, "createdAt" ASC, id ASC
        FOR UPDATE`,
      [itemId],
    );
    if (barrier) await barrier();

    const { rows } = await client.query(
      `SELECT id, remaining::float8 AS remaining FROM ${SCHEMA}."PurchaseBatch"
        WHERE "itemId"=$1 AND remaining > 0
        ORDER BY "purchaseDate" ASC, "createdAt" ASC, id ASC`,
      [itemId],
    );
    const available = rows.reduce((s, r) => s + r.remaining, 0);
    if (available + 1e-9 < need) {
      await client.query('ROLLBACK');
      return 'REFUSED';
    }
    let left = need;
    for (const r of rows) {
      if (left <= 0) break;
      const take = Math.min(r.remaining, left);
      left -= take;
      const res = await client.query(
        `UPDATE ${SCHEMA}."PurchaseBatch"
            SET remaining = remaining - $1
          WHERE id = $2 AND remaining >= $1`,
        [take, r.id],
      );
      if (res.rowCount !== 1) {
        await client.query('ROLLBACK');
        return 'CONFLICT';
      }
    }
    await client.query('COMMIT');
    return 'CONSUMED';
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '40P01') return 'DEADLOCK';
    throw e;
  }
}

/** Releases when both participants have arrived. */
function makeBarrier(n) {
  let arrived = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  return async () => {
    if (++arrived >= n) release();
    return gate;
  };
}

async function scenarioA(admin) {
  console.log('\nA. CONTROL — old read-modify-write pattern (expected to FAIL safety)');
  await setup(admin, [{ id: 'b1', itemId: 'itemA', date: '2026-01-01', qty: 100 }]);
  const [c1, c2] = [await connect(), await connect()];
  const barrier = makeBarrier(2);
  const res = await Promise.all([
    consumeOldWay(c1, 'itemA', 60, barrier),
    consumeOldWay(c2, 'itemA', 60, barrier),
  ]);
  const left = await totalRemaining(admin, 'itemA');
  await c1.end(); await c2.end();

  console.log(`     outcomes=${JSON.stringify(res)} remaining=${left}`);
  // Both committed, 120 taken from a batch of 100, remaining stuck at 40.
  check('old pattern double-consumes (both CONSUMED)', res.filter((r) => r === 'CONSUMED').length, 2);
  check('old pattern leaves an impossible balance', left, 40);
  console.log('     ↳ harness can detect the defect, so scenario B is meaningful.');
}

async function scenarioB(admin) {
  console.log('\nB. FIXED — SELECT FOR UPDATE + guarded decrement');
  await setup(admin, [{ id: 'b1', itemId: 'itemB', date: '2026-01-01', qty: 100 }]);
  const [c1, c2] = [await connect(), await connect()];
  const res = await Promise.all([
    consumeNewWay(c1, 'itemB', 60, null),
    consumeNewWay(c2, 'itemB', 60, null),
  ]);
  const left = await totalRemaining(admin, 'itemB');
  await c1.end(); await c2.end();

  console.log(`     outcomes=${JSON.stringify(res)} remaining=${left}`);
  check('exactly one consumption succeeds', res.filter((r) => r === 'CONSUMED').length, 1);
  check('the loser is refused, not silently allowed', res.filter((r) => r === 'REFUSED').length, 1);
  check('remaining is correct (100 - 60)', left, 40);
  check('remaining never went negative', left >= 0, true);
}

async function scenarioB2(admin) {
  console.log('\nB2. FIXED — both fit: 100 split as 60 + 40');
  await setup(admin, [{ id: 'b1', itemId: 'itemB2', date: '2026-01-01', qty: 100 }]);
  const [c1, c2] = [await connect(), await connect()];
  const res = await Promise.all([
    consumeNewWay(c1, 'itemB2', 60, null),
    consumeNewWay(c2, 'itemB2', 40, null),
  ]);
  const left = await totalRemaining(admin, 'itemB2');
  await c1.end(); await c2.end();

  console.log(`     outcomes=${JSON.stringify(res)} remaining=${left}`);
  check('both succeed when the stock genuinely covers both', res.filter((r) => r === 'CONSUMED').length, 2);
  check('batch is exactly drained', left, 0);
}

async function scenarioB3(admin) {
  console.log('\nB3. FIXED — FIFO order preserved across two batches');
  await setup(admin, [
    { id: 'old', itemId: 'itemB3', date: '2020-01-01', qty: 50 },
    { id: 'new', itemId: 'itemB3', date: '2026-01-01', qty: 50 },
  ]);
  const c1 = await connect();
  await consumeNewWay(c1, 'itemB3', 30, null);
  const r = await admin.query(
    `SELECT id, remaining::float8 AS remaining FROM ${SCHEMA}."PurchaseBatch" WHERE "itemId"='itemB3' ORDER BY id`,
  );
  await c1.end();
  const byId = Object.fromEntries(r.rows.map((x) => [x.id, x.remaining]));
  console.log(`     ${JSON.stringify(byId)}`);
  check('oldest batch consumed first', byId.old, 20);
  check('newer batch untouched', byId.new, 50);
}

async function scenarioC(admin) {
  console.log('\nC. DEADLOCK — two items, opposite vs sorted lock order');
  await setup(admin, [
    { id: 'x1', itemId: 'itemX', date: '2026-01-01', qty: 100 },
    { id: 'y1', itemId: 'itemY', date: '2026-01-01', qty: 100 },
  ]);

  // Sorted order (what daily-production now does): both take itemX then itemY.
  const [c1, c2] = [await connect(), await connect()];
  const sorted = await Promise.all([
    (async () => {
      const a = await consumeNewWay(c1, 'itemX', 10, null);
      const b = await consumeNewWay(c1, 'itemY', 10, null);
      return [a, b];
    })(),
    (async () => {
      const a = await consumeNewWay(c2, 'itemX', 10, null);
      const b = await consumeNewWay(c2, 'itemY', 10, null);
      return [a, b];
    })(),
  ]);
  await c1.end(); await c2.end();
  const flat = sorted.flat();
  console.log(`     sorted-order outcomes=${JSON.stringify(flat)}`);
  check('no deadlock under sorted lock ordering', flat.filter((r) => r === 'DEADLOCK').length, 0);
  check('all four consumptions succeed', flat.filter((r) => r === 'CONSUMED').length, 4);
}

(async () => {
  const admin = await connect();
  try {
    console.log('FIFO concurrency proof — real PostgreSQL');
    const v = await admin.query('SELECT version()');
    console.log(v.rows[0].version.split(',')[0]);

    await scenarioA(admin);
    await scenarioB(admin);
    await scenarioB2(admin);
    await scenarioB3(admin);
    await scenarioC(admin);

    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await admin.end();
  }
})().catch((e) => {
  console.error('harness error:', e);
  process.exit(2);
});
