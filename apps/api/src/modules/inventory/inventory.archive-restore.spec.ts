/**
 * Regression cover for the archived-items usability defect.
 *
 * THE PROBLEM
 * -----------
 * "Deleting" an item set active=false. It vanished from every list, but its
 * SKU stayed reserved, so re-creating it failed with a bare "SKU مكرر" and
 * the user had no way to see, rename or restore the offending row. In this
 * production tenant 58 of 60 items were archived and invisible.
 *
 * The contracts locked in here:
 *   · active listings never leak archived items, and vice-versa
 *   · archived items are searchable by name and SKU
 *   · a name/SKU edit preserves the Item ID (history points at the ID)
 *   · editing an archived item does NOT silently reactivate it
 *   · restore flips false → true on the SAME row
 *   · a duplicate SKU says whether the clash is archived, and identifies it
 *   · tenant isolation holds on every path
 */

import { InventoryService, activeFilter, auditSnapshot } from './inventory.service';

function makeDb() {
  const state = {
    items: [
      { id: 'i-active',  tenantId: 't1', sku: 'ACT-1',  name: 'حليب نشط',     active: true,  type: 'CONSUMABLE', unit: 'PCS', stockLevels: [] },
      { id: 'i-arch',    tenantId: 't1', sku: 'ARCH-1', name: 'كرتون مؤرشف',  active: false, type: 'PACKAGING',  unit: 'PCS', stockLevels: [] },
      { id: 'i-other',   tenantId: 't2', sku: 'ACT-1',  name: 'مستأجر آخر',   active: true,  type: 'CONSUMABLE', unit: 'PCS', stockLevels: [] },
    ] as any[],
  };
  const match = (i: any, where: any): boolean => {
    if (where.tenantId && i.tenantId !== where.tenantId) return false;
    if (where.id && i.id !== where.id) return false;
    if (where.NOT?.id && i.id === where.NOT.id) return false;
    if (where.sku && i.sku !== where.sku) return false;
    if (where.active !== undefined && i.active !== where.active) return false;
    if (where.OR) {
      const hit = where.OR.some((c: any) => {
        if (c.name?.contains) return String(i.name).toLowerCase().includes(String(c.name.contains).toLowerCase());
        if (c.sku?.contains)  return String(i.sku).toLowerCase().includes(String(c.sku.contains).toLowerCase());
        if (c.barcode !== undefined) return i.barcode === c.barcode;
        if (c.name) return i.name === c.name;
        if (c.sku) return i.sku === c.sku;
        return false;
      });
      if (!hit) return false;
    }
    return true;
  };
  const client: any = {
    item: {
      findFirst: async ({ where }: any) => state.items.find((i) => match(i, where)) ?? null,
      findMany:  async ({ where }: any) => state.items.filter((i) => match(i, where)).map((i) => ({ ...i, stockLevels: [] })),
      count:     async ({ where }: any) => state.items.filter((i) => match(i, where)).length,
      update: async ({ where, data }: any) => {
        const it = state.items.find((i) => i.id === where.id);
        for (const [k, v] of Object.entries(data)) if (v !== undefined) (it as any)[k] = v;
        return it;
      },
      create: async ({ data }: any) => { const it = { id: 'i-new', stockLevels: [], ...data }; state.items.push(it); return it; },
    },
  };
  const audits: any[] = [];
  const audit: any = { log: async (e: any) => { audits.push(e); } };
  return { state, audits, svc: new InventoryService(client, audit) as any };
}

describe('activeFilter', () => {
  it('maps the three selectors', () => {
    expect(activeFilter('active')).toEqual({ active: true });
    expect(activeFilter('archived')).toEqual({ active: false });
    expect(activeFilter('all')).toEqual({});
    expect(activeFilter()).toEqual({ active: true }); // default unchanged
  });
});

describe('item listings', () => {
  it('active list excludes archived items', async () => {
    const { svc } = makeDb();
    const rows = await svc.listItems('t1');
    expect(rows.map((r: any) => r.id)).toEqual(['i-active']);
  });

  it('archived list returns only active=false items', async () => {
    const { svc } = makeDb();
    const rows = await svc.listItems('t1', { status: 'archived' });
    expect(rows.map((r: any) => r.id)).toEqual(['i-arch']);
  });

  it('status=all returns both', async () => {
    const { svc } = makeDb();
    const rows = await svc.listItems('t1', { status: 'all' });
    expect(rows).toHaveLength(2);
  });

  it('paginated archived list is scoped and counted correctly', async () => {
    const { svc } = makeDb();
    const page = await svc.listItemsPaginated('t1', { status: 'archived' });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('i-arch');
  });

  it('searches archived items by name', async () => {
    const { svc } = makeDb();
    const rows = await svc.listItems('t1', { status: 'archived', search: 'مؤرشف' });
    expect(rows.map((r: any) => r.id)).toEqual(['i-arch']);
  });

  it('searches archived items by SKU', async () => {
    const { svc } = makeDb();
    const rows = await svc.listItems('t1', { status: 'archived', search: 'ARCH' });
    expect(rows.map((r: any) => r.id)).toEqual(['i-arch']);
  });

  it('does not leak another tenant', async () => {
    const { svc } = makeDb();
    const rows = await svc.listItems('t1', { status: 'all' });
    expect(rows.some((r: any) => r.tenantId !== 't1')).toBe(false);
  });
});

describe('editing', () => {
  it('renames an active item and preserves the Item ID', async () => {
    const { svc } = makeDb();
    const out = await svc.updateItem('t1', 'i-active', { name: 'اسم جديد' });
    expect(out.id).toBe('i-active');
    expect(out.name).toBe('اسم جديد');
  });

  it('renames an ARCHIVED item without reactivating it', async () => {
    const { svc } = makeDb();
    const out = await svc.updateItem('t1', 'i-arch', { name: 'اسم مؤرشف جديد' });
    expect(out.id).toBe('i-arch');
    expect(out.name).toBe('اسم مؤرشف جديد');
    expect(out.active).toBe(false); // still archived
  });

  it('ignores an attempt to flip active via the edit payload', async () => {
    const { svc } = makeDb();
    const out = await svc.updateItem('t1', 'i-arch', { name: 'x', active: true });
    expect(out.active).toBe(false); // restore is a separate action
  });

  it('rejects a blank name', async () => {
    const { svc } = makeDb();
    await expect(svc.updateItem('t1', 'i-active', { name: '   ' })).rejects.toThrow();
  });

  it('rejects a SKU that collides with an archived item, and says so', async () => {
    const { svc } = makeDb();
    let err: any;
    try { await svc.updateItem('t1', 'i-active', { sku: 'ARCH-1' }); } catch (e) { err = e; }
    const r = err.getResponse();
    expect(r.code).toBe('DUPLICATE_ARCHIVED');
    expect(r.conflict.id).toBe('i-arch');
  });

  it('allows keeping the same SKU unchanged', async () => {
    const { svc } = makeDb();
    const out = await svc.updateItem('t1', 'i-active', { sku: 'ACT-1', name: 'ok' });
    expect(out.sku).toBe('ACT-1');
  });

  it('writes an ITEM_UPDATED audit entry with before/after', async () => {
    const { svc, audits } = makeDb();
    await svc.updateItem('t1', 'i-active', { name: 'محدّث' }, 'user-1');
    const e = audits.find((a) => a.action === 'ITEM_UPDATED');
    expect(e.actorUserId).toBe('user-1');
    expect(e.resourceId).toBe('i-active');
    expect(e.before.name).toBe('حليب نشط');
    expect(e.after.name).toBe('محدّث');
  });

  it('refuses to edit an item belonging to another tenant', async () => {
    const { svc } = makeDb();
    await expect(svc.updateItem('t1', 'i-other', { name: 'nope' })).rejects.toThrow();
  });
});

describe('archive / restore', () => {
  it('archive flips active true → false and keeps the ID', async () => {
    const { svc } = makeDb();
    const out = await svc.archiveItem('t1', 'i-active', 'user-1');
    expect(out.item.id).toBe('i-active');
    expect(out.item.active).toBe(false);
  });

  it('archive is idempotent', async () => {
    const { svc } = makeDb();
    const out = await svc.archiveItem('t1', 'i-arch');
    expect(out.alreadyArchived).toBe(true);
  });

  it('DELETE endpoint still archives (back-compat)', async () => {
    const { svc } = makeDb();
    const out = await svc.deleteItem('t1', 'i-active');
    expect(out.item.active).toBe(false);
  });

  it('restore flips false → true on the SAME row', async () => {
    const { svc, state } = makeDb();
    const out = await svc.restoreItem('t1', 'i-arch', 'user-1');
    expect(out.item.id).toBe('i-arch');
    expect(out.item.active).toBe(true);
    expect(state.items.filter((i) => i.sku === 'ARCH-1')).toHaveLength(1); // no duplicate created
  });

  it('restore is idempotent', async () => {
    const { svc } = makeDb();
    const out = await svc.restoreItem('t1', 'i-active');
    expect(out.alreadyActive).toBe(true);
  });

  it('writes ITEM_ARCHIVED and ITEM_RESTORED audit entries', async () => {
    const { svc, audits } = makeDb();
    await svc.archiveItem('t1', 'i-active', 'u');
    await svc.restoreItem('t1', 'i-arch', 'u');
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['ITEM_ARCHIVED', 'ITEM_RESTORED']),
    );
  });

  it('cannot archive or restore across tenants', async () => {
    const { svc } = makeDb();
    await expect(svc.archiveItem('t1', 'i-other')).rejects.toThrow();
    await expect(svc.restoreItem('t1', 'i-other')).rejects.toThrow();
  });
});

describe('duplicate SKU on create', () => {
  it('an ARCHIVED clash returns DUPLICATE_ARCHIVED and identifies the item', async () => {
    const { svc } = makeDb();
    let err: any;
    try { await svc.createItem('t1', { name: 'جديد', sku: 'ARCH-1' }); } catch (e) { err = e; }
    const r = err.getResponse();
    expect(r.code).toBe('DUPLICATE_ARCHIVED');
    expect(r.field).toBe('sku');
    expect(r.conflict).toMatchObject({ id: 'i-arch', archived: true });
    expect(typeof r.message).toBe('string');
    expect(r.message).toContain('المؤرشفة');
  });

  it('an ACTIVE clash returns DUPLICATE_ACTIVE', async () => {
    const { svc } = makeDb();
    let err: any;
    try { await svc.createItem('t1', { name: 'جديد', sku: 'ACT-1' }); } catch (e) { err = e; }
    const r = err.getResponse();
    expect(r.code).toBe('DUPLICATE_ACTIVE');
    expect(r.conflict).toMatchObject({ id: 'i-active', archived: false });
  });

  it("another tenant's SKU is not a clash", async () => {
    const { svc } = makeDb();
    const out = await svc.createItem('t3', { name: 'حر', sku: 'ACT-1' });
    expect(out.sku).toBe('ACT-1');
  });
});

describe('auditSnapshot', () => {
  it('captures master-data fields and stringifies Decimals', () => {
    const snap = auditSnapshot({ name: 'x', sku: 'S', active: true, minStock: { toString: () => '12.5' } });
    expect(snap.name).toBe('x');
    expect(snap.minStock).toBe('12.5');
    expect(snap).toHaveProperty('costPrice', null);
  });
});
