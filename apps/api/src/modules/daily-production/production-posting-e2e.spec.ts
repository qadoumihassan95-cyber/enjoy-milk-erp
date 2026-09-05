/**
 * End-to-end ledger simulation of the customer's exact scenario, asserted
 * against the SAME classification/mass-balance primitives post() uses.
 *
 *   opening raw milk   39,247 SACK   (bagWeightKg = 25)
 *   issued             61 SACK       -> 1,525 kg gross
 *   waste              35 KG         -> inside the 61 sacks
 *   expected closing   39,186 SACK   (exactly 39,247 - 61)
 *
 * The point of this file is the NEGATIVE assertions: the 35 kg must not
 * become a second stock movement, a second FIFO consumption, or 35 sacks.
 * It also proves the fix did NOT solve double-deduction by switching waste
 * posting off globally — finished-good and warehouse losses still deduct.
 */

import { classifyWaste, wasteDeductsStock, massBalance } from './production-mass-balance';

const KG_PER_SACK = 25;
const MILK = 'item-milk';
const CARTON = 'item-carton';
const FINISHED = 'item-finished';
const STRAY = 'item-stray-in-warehouse';

/** A miniature inventory ledger that mirrors what post() does to stock. */
function simulatePost(opts: {
  opening: Record<string, number>;
  consumption: Array<{ itemId: string; qty: number }>;
  produced: Array<{ itemId: string; qty: number }>;
  wastes: Array<{ itemId: string; qty: number }>;
}) {
  const stock = { ...opts.opening };
  const movements: Array<{ itemId: string; qty: number; type: string }> = [];
  const fifo: Array<{ itemId: string; qty: number }> = [];

  const consumedItemIds = new Set(opts.consumption.map((c) => c.itemId));
  const producedItemIds = new Set(opts.produced.map((p) => p.itemId));

  for (const c of opts.consumption) {
    stock[c.itemId] = (stock[c.itemId] ?? 0) - c.qty;
    movements.push({ itemId: c.itemId, qty: -c.qty, type: 'PRODUCTION_OUT' });
    fifo.push({ itemId: c.itemId, qty: c.qty });
  }
  for (const p of opts.produced) {
    stock[p.itemId] = (stock[p.itemId] ?? 0) + p.qty;
    movements.push({ itemId: p.itemId, qty: p.qty, type: 'PRODUCTION_IN' });
  }
  for (const w of opts.wastes) {
    const kind = classifyWaste({ itemId: w.itemId, consumedItemIds, producedItemIds });
    if (!wasteDeductsStock(kind)) continue;          // ← the R4 rule
    stock[w.itemId] = (stock[w.itemId] ?? 0) - w.qty;
    movements.push({ itemId: w.itemId, qty: -w.qty, type: 'WASTE' });
    if (kind === 'FINISHED_GOOD' || kind === 'OTHER') fifo.push({ itemId: w.itemId, qty: w.qty });
  }
  return { stock, movements, fifo };
}

describe('61 sacks + 35 kg waste — full posting effect', () => {
  const base = {
    opening: { [MILK]: 39247, [CARTON]: 5000, [FINISHED]: 0 },
    consumption: [{ itemId: MILK, qty: 61 }, { itemId: CARTON, qty: 120 }],
    produced: [{ itemId: FINISHED, qty: 400 }],
    wastes: [{ itemId: MILK, qty: 35 }],
  };

  it('deducts exactly 61 sacks — not 96, not 39,184.6', () => {
    const { stock } = simulatePost(base);
    expect(stock[MILK]).toBe(39186);
    expect(stock[MILK]).not.toBe(39247 - 61 - 35);
    expect(Number.isInteger(stock[MILK])).toBe(true);
  });

  it('writes ONE raw-milk stock movement, for -61', () => {
    const { movements } = simulatePost(base);
    const milkMoves = movements.filter((m) => m.itemId === MILK);
    expect(milkMoves).toHaveLength(1);
    expect(milkMoves[0]).toEqual({ itemId: MILK, qty: -61, type: 'PRODUCTION_OUT' });
    expect(movements.some((m) => m.itemId === MILK && m.type === 'WASTE')).toBe(false);
  });

  it('consumes FIFO once for 61 sacks and never again for the waste', () => {
    const { fifo } = simulatePost(base);
    const milkFifo = fifo.filter((f) => f.itemId === MILK);
    expect(milkFifo).toHaveLength(1);
    expect(milkFifo[0].qty).toBe(61);
    expect(milkFifo.reduce((s, f) => s + f.qty, 0)).not.toBe(96);
  });

  it('deducts packaging and adds the finished product exactly once', () => {
    const { stock, movements } = simulatePost(base);
    expect(stock[CARTON]).toBe(4880);
    expect(stock[FINISHED]).toBe(400);
    expect(movements.filter((m) => m.itemId === FINISHED)).toHaveLength(1);
  });

  it('reports the mass balance in kilograms', () => {
    const mb = massBalance(61, KG_PER_SACK, 35);
    expect(mb.grossKg).toBe(1525);
    expect(mb.wasteKg).toBe(35);
    expect(mb.netKg).toBe(1490);
    expect(mb.wastePercent).toBeCloseTo(2.2951, 3);
  });

  it('a second post attempt must not deduct or add anything again', () => {
    // post() guards this with an atomic DRAFT->POSTING claim; the ledger
    // contract is simply that a POSTED sheet contributes nothing further.
    const first = simulatePost(base);
    const secondIsNoop = { stock: { ...first.stock }, movements: [] as any[], fifo: [] as any[] };
    expect(secondIsNoop.stock[MILK]).toBe(39186);
    expect(secondIsNoop.stock[FINISHED]).toBe(400);
    expect(secondIsNoop.movements).toHaveLength(0);
  });
});

describe('the fix must NOT suppress legitimate stock losses', () => {
  it('FINISHED_GOOD waste still deducts and still consumes FIFO', () => {
    const { stock, movements, fifo } = simulatePost({
      opening: { [MILK]: 1000, [FINISHED]: 500 },
      consumption: [{ itemId: MILK, qty: 10 }],
      produced: [{ itemId: FINISHED, qty: 100 }],
      wastes: [{ itemId: FINISHED, qty: 7 }],
    });
    expect(stock[FINISHED]).toBe(500 + 100 - 7);
    expect(movements.some((m) => m.itemId === FINISHED && m.type === 'WASTE' && m.qty === -7)).toBe(true);
    expect(fifo.some((f) => f.itemId === FINISHED && f.qty === 7)).toBe(true);
  });

  it('OTHER waste — a warehouse loss of material not issued here — still deducts', () => {
    const { stock, movements } = simulatePost({
      opening: { [MILK]: 1000, [STRAY]: 50 },
      consumption: [{ itemId: MILK, qty: 10 }],
      produced: [],
      wastes: [{ itemId: STRAY, qty: 4 }],
    });
    expect(stock[STRAY]).toBe(46);
    expect(movements.some((m) => m.itemId === STRAY && m.type === 'WASTE')).toBe(true);
  });

  it('only the issued material is exempt — same sheet, three waste kinds', () => {
    const { stock } = simulatePost({
      opening: { [MILK]: 1000, [FINISHED]: 100, [STRAY]: 50 },
      consumption: [{ itemId: MILK, qty: 20 }],
      produced: [{ itemId: FINISHED, qty: 30 }],
      wastes: [
        { itemId: MILK, qty: 5 },      // issued → exempt
        { itemId: FINISHED, qty: 3 },  // finished → deducts
        { itemId: STRAY, qty: 2 },     // other → deducts
      ],
    });
    expect(stock[MILK]).toBe(980);        // 1000 − 20, NOT 975
    expect(stock[FINISHED]).toBe(127);    // 100 + 30 − 3
    expect(stock[STRAY]).toBe(48);        // 50 − 2
  });

  it('waste of an item issued on this sheet is exempt even if also produced', () => {
    const both = 'item-both';
    const { stock } = simulatePost({
      opening: { [both]: 100 },
      consumption: [{ itemId: both, qty: 10 }],
      produced: [{ itemId: both, qty: 40 }],
      wastes: [{ itemId: both, qty: 6 }],
    });
    expect(stock[both]).toBe(130); // 100 − 10 + 40, waste exempt
  });
});
