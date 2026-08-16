// =============================================================================
// Seed Data — Powder Milk Factory
// =============================================================================

import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding...');

  // ── Tenant ──────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'enjoymilk' },
    update: {},
    create: {
      name: 'Enjoy Milk Factory',
      slug: 'enjoymilk',
      legalName: 'مصنع الدانا لمنتجات الحليب واللبن',
      currency: 'JOD',
    },
  });

  // ── Users ───────────────────────────────────────
  const passwordHash = await bcrypt.hash('Admin@123', 10);

  const users = [
    { email: 'admin@enjoymilk.local', fullName: 'المسؤول العام', role: 'ADMIN' },
    { email: 'owner@enjoymilk.local', fullName: 'المالك', role: 'OWNER' },
    { email: 'manager@enjoymilk.local', fullName: 'مدير الإنتاج', role: 'MANAGER' },
    { email: 'warehouse@enjoymilk.local', fullName: 'أمين المستودع', role: 'WAREHOUSE' },
    { email: 'accountant@enjoymilk.local', fullName: 'المحاسب', role: 'ACCOUNTANT' },
    { email: 'operator@enjoymilk.local', fullName: 'عامل الإنتاج', role: 'OPERATOR' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        tenantId: tenant.id,
        email: u.email,
        fullName: u.fullName,
        passwordHash,
        role: u.role as any,
      },
    });
  }

  // ── Warehouses ──────────────────────────────────
  // SINGLE-WAREHOUSE MODEL: the factory operates from MAIN. The legacy
  // codes are still provisioned (historical StockMovement rows reference
  // them) but INACTIVE — matching the state that
  // 20260814170000_single_warehouse_consolidation leaves on an existing
  // database, so a fresh install and production agree.
  //
  // `update: {}` means an already-provisioned warehouse is NEVER
  // modified. In particular a deactivated legacy warehouse is never
  // resurrected, and MAIN is never renamed.
  const warehouses = [
    { code: 'MAIN', name: 'المخزن الرئيسي', type: 'GENERAL', active: true },
    { code: 'BULK', name: 'مستودع البودرة المستوردة', type: 'POWDER_BULK', active: false },
    { code: 'PKG', name: 'مستودع التغليف', type: 'PACKAGING', active: false },
    { code: 'FIN', name: 'مستودع المنتج النهائي', type: 'FINISHED_GOODS', active: false },
    { code: 'QHL', name: 'حجر صحي', type: 'QUARANTINE', active: false },
  ];

  for (const w of warehouses) {
    await prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: w.code } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: w.code,
        name: w.name,
        type: w.type as any,
        active: w.active,
      },
    });
  }

  const mainWh = await prisma.warehouse.findFirst({ where: { tenantId: tenant.id, code: 'MAIN' } });

  // ── Items ───────────────────────────────────────
  // المخزون الخام: حليب + كرتون + ألمنيوم
  const items = [
    // ─── الحليب الخام ───
    {
      sku: 'RAW-MILK-200',
      name: 'حليب خام عبوة 200ml',
      type: 'POWDER_BULK',
      unit: 'L',
      shelfLifeDays: 5,
      reorderLevel: 500,
      costPrice: 0.50,
    },
    {
      sku: 'RAW-MILK-500',
      name: 'حليب خام عبوة 500ml',
      type: 'POWDER_BULK',
      unit: 'L',
      shelfLifeDays: 5,
      reorderLevel: 500,
      costPrice: 0.50,
    },
    {
      sku: 'RAW-MILK-1L',
      name: 'حليب خام عبوة 1 لتر',
      type: 'POWDER_BULK',
      unit: 'L',
      shelfLifeDays: 5,
      reorderLevel: 500,
      costPrice: 0.50,
    },
    // ─── الكرتون ───
    {
      sku: 'CTN-24',
      name: 'كرتون 24 حبة',
      type: 'PACKAGING',
      unit: 'PCS',
      reorderLevel: 200,
      costPrice: 1.20,
    },
    {
      sku: 'CTN-12',
      name: 'كرتون 12 حبة',
      type: 'PACKAGING',
      unit: 'PCS',
      reorderLevel: 200,
      costPrice: 0.95,
    },
    {
      sku: 'CTN-6',
      name: 'كرتون 6 حبات',
      type: 'PACKAGING',
      unit: 'PCS',
      reorderLevel: 100,
      costPrice: 0.55,
    },
    // ─── الألمنيوم ───
    {
      sku: 'ALU-200',
      name: 'ألمنيوم 200ml',
      type: 'PACKAGING',
      unit: 'ROLL',
      reorderLevel: 5,
      costPrice: 80,
    },
    {
      sku: 'ALU-500',
      name: 'ألمنيوم 500ml',
      type: 'PACKAGING',
      unit: 'ROLL',
      reorderLevel: 5,
      costPrice: 110,
    },
    {
      sku: 'ALU-1L',
      name: 'ألمنيوم 1 لتر',
      type: 'PACKAGING',
      unit: 'ROLL',
      reorderLevel: 5,
      costPrice: 150,
    },
    // ─── المنتجات النهائية ───
    {
      sku: 'PROD-MILK-200',
      name: 'حليب 200ml',
      type: 'POWDER_RETAIL',
      unit: 'PCS',
      packagingFormat: 'SACHET',
      netWeightGrams: 200,
      packsPerCarton: 24,
      shelfLifeDays: 7,
      sellPrice: 0.50,
    },
    {
      sku: 'PROD-MILK-500',
      name: 'حليب 500ml',
      type: 'POWDER_RETAIL',
      unit: 'PCS',
      packagingFormat: 'SACHET',
      netWeightGrams: 500,
      packsPerCarton: 12,
      shelfLifeDays: 7,
      sellPrice: 1.10,
    },
    {
      sku: 'PROD-MILK-1L',
      name: 'حليب 1 لتر',
      type: 'POWDER_RETAIL',
      unit: 'PCS',
      packagingFormat: 'POUCH',
      netWeightGrams: 1000,
      packsPerCarton: 6,
      shelfLifeDays: 7,
      sellPrice: 2.00,
    },
  ];

  for (const i of items) {
    await prisma.item.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: i.sku } },
      update: {},
      create: {
        tenantId: tenant.id,
        sku: i.sku,
        name: i.name,
        type: i.type as any,
        unit: i.unit,
        packagingFormat: i.packagingFormat as any,
        netWeightGrams: i.netWeightGrams,
        packsPerCarton: i.packsPerCarton,
        shelfLifeDays: i.shelfLifeDays,
        reorderLevel: i.reorderLevel ? new Prisma.Decimal(i.reorderLevel) : null,
        costPrice: i.costPrice ? new Prisma.Decimal(i.costPrice) : null,
        sellPrice: i.sellPrice ? new Prisma.Decimal(i.sellPrice) : null,
      },
    });
  }

  // ── Initial Stock (DEMO ONLY — never touches real data) ──────────
  //
  // WHY THIS IS GUARDED (incident 2026-08-16)
  // -----------------------------------------
  // This block used to run `stockLevel.upsert({ update: { quantity: N } })`
  // on every container start. The API's start command runs the seed on
  // EVERY boot, so each deploy silently rewrote five items' balances back
  // to demo constants, destroying real counted stock with no StockMovement
  // and no audit trail.
  //
  // The seed now only plants demo stock when the tenant has NO inventory
  // history whatsoever — no StockLevel rows AND no StockMovement rows.
  // On any database that has ever held real stock this is a no-op, so a
  // restart or redeploy can never change a balance.
  const existingStockLevels = await prisma.stockLevel.count({ where: { tenantId: tenant.id } });
  const existingMovements = await prisma.stockMovement.count({ where: { tenantId: tenant.id } });
  const inventoryIsVirgin = existingStockLevels === 0 && existingMovements === 0;

  if (!inventoryIsVirgin) {
    console.log(
      `[seed] Inventory already exists (${existingStockLevels} stock levels, ` +
      `${existingMovements} movements) — skipping demo stock. Real balances preserved.`,
    );
  } else if (!mainWh) {
    console.log('[seed] MAIN warehouse missing — skipping demo stock.');
  } else {
    const demoStock: Array<{ sku: string; qty: number; unitCost: number }> = [
      { sku: 'RAW-MILK-200', qty: 2000,  unitCost: 1 },
      { sku: 'RAW-MILK-500', qty: 1500,  unitCost: 1 },
      { sku: 'CTN-24',       qty: 10000, unitCost: 1 },
      { sku: 'CTN-12',       qty: 500,   unitCost: 1 },
      { sku: 'ALU-200',      qty: 2000,  unitCost: 1 },
    ];

    for (const d of demoStock) {
      const item = await prisma.item.findFirst({ where: { tenantId: tenant.id, sku: d.sku } });
      if (!item) continue;

      // StockLevel and PurchaseBatch are created TOGETHER. Stock with no
      // backing batch is invisible to FIFO, so production and sales would
      // reject it as "insufficient" even though the balance looks fine.
      await prisma.stockLevel.create({
        data: {
          tenantId: tenant.id,
          itemId: item.id,
          warehouseId: mainWh.id,
          quantity: new Prisma.Decimal(d.qty),
        },
      });

      await prisma.purchaseBatch.create({
        data: {
          tenantId: tenant.id,
          itemId: item.id,
          batchNumber: null,
          purchaseDate: new Date('2020-01-01T00:00:00Z'), // sorts first under FIFO
          quantity: new Prisma.Decimal(d.qty),
          remaining: new Prisma.Decimal(d.qty),
          unitCost: new Prisma.Decimal(item.costPrice ?? d.unitCost),
          sourceType: 'OPENING_BALANCE',
        },
      });
    }
    console.log(`[seed] Empty database — planted ${demoStock.length} demo stock rows in MAIN.`);
  }

  // ── Production Lines & Machines ──────────────────
  const sachetLine = await prisma.productionLine.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'LINE-SACHET' } },
    update: {},
    create: { tenantId: tenant.id, code: 'LINE-SACHET', name: 'خط تعبئة الأظرف' },
  });

  const tinLine = await prisma.productionLine.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'LINE-TIN' } },
    update: {},
    create: { tenantId: tenant.id, code: 'LINE-TIN', name: 'خط تعبئة العلب' },
  });

  const machines = [
    { code: 'SF-01', name: 'ماكينة تعبئة أظرف A', type: 'SACHET_FILLER', capacity: 3000, lineId: sachetLine.id },
    { code: 'SF-02', name: 'ماكينة تعبئة أظرف B', type: 'SACHET_FILLER', capacity: 3000, lineId: sachetLine.id },
    { code: 'CTN-01', name: 'ماكينة تعبئة كرتون', type: 'CARTONING', capacity: 120, lineId: sachetLine.id },
    { code: 'TF-01', name: 'ماكينة تعبئة علب', type: 'TIN_FILLER', capacity: 800, lineId: tinLine.id },
    { code: 'MD-01', name: 'كاشف معادن', type: 'METAL_DETECTOR', capacity: 1000, lineId: tinLine.id },
  ];

  for (const m of machines) {
    await prisma.machine.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: m.code } },
      update: {},
      create: {
        tenantId: tenant.id,
        lineId: m.lineId,
        code: m.code,
        name: m.name,
        type: m.type as any,
        capacityPerHour: new Prisma.Decimal(m.capacity),
      },
    });
  }

  // ── Customers ────────────────────────────────────
  const customers = [
    { code: 'C001', name: 'سوبرماركت الفجر', type: 'WHOLESALE', creditLimit: 500, paymentTerms: 7 },
    { code: 'C002', name: 'بقالة العائلة', type: 'RETAIL', creditLimit: 100, paymentTerms: 0 },
    { code: 'C003', name: 'مطعم الشرق', type: 'INSTITUTION', creditLimit: 1000, paymentTerms: 14 },
    { code: 'C004', name: 'موزع الشمال', type: 'DISTRIBUTOR', creditLimit: 5000, paymentTerms: 30 },
  ];

  for (const c of customers) {
    await prisma.customer.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: c.code,
        name: c.name,
        type: c.type,
        creditLimit: new Prisma.Decimal(c.creditLimit),
        paymentTerms: c.paymentTerms,
      },
    });
  }

  // ── Cashboxes ────────────────────────────────────
  await prisma.cashbox.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MAIN' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'MAIN',
      name: 'الصندوق الرئيسي',
      balance: new Prisma.Decimal(5000),
    },
  });

  await prisma.cashbox.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'PETTY' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'PETTY',
      name: 'صندوق المصاريف الصغيرة',
      balance: new Prisma.Decimal(500),
    },
  });

  // ── Employees ────────────────────────────────────
  const employees = [
    { code: 'E001', fullName: 'أحمد محمود', department: 'الإنتاج', position: 'مشرف خط', baseSalary: 600 },
    { code: 'E002', fullName: 'محمد علي', department: 'الإنتاج', position: 'عامل تعبئة', baseSalary: 400 },
    { code: 'E003', fullName: 'فاطمة أحمد', department: 'الجودة', position: 'فاحص جودة', baseSalary: 550 },
    { code: 'E004', fullName: 'يوسف خالد', department: 'المستودع', position: 'أمين مستودع', baseSalary: 500 },
  ];

  for (const e of employees) {
    await prisma.employee.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: e.code } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: e.code,
        fullName: e.fullName,
        department: e.department,
        position: e.position,
        baseSalary: new Prisma.Decimal(e.baseSalary),
        hireDate: new Date('2024-01-01'),
      },
    });
  }

  // ── Licenses ─────────────────────────────────────
  const licenses = [
    { type: 'السجل التجاري', number: 'CR-2025-001', issueDate: '2024-01-15', expiryDate: '2027-01-14' },
    { type: 'رخصة الزراعة', number: 'AG-2025-042', issueDate: '2024-03-01', expiryDate: '2026-08-15' },
    { type: 'شهادة HACCP', number: 'HACCP-789', issueDate: '2024-06-01', expiryDate: '2026-06-01' },
    { type: 'شهادة حلال', number: 'HALAL-456', issueDate: '2024-04-10', expiryDate: '2026-04-10' },
  ];

  for (const l of licenses) {
    await prisma.license.upsert({
      where: { tenantId_type_number: { tenantId: tenant.id, type: l.type, number: l.number } },
      update: {},
      create: {
        tenantId: tenant.id,
        type: l.type,
        number: l.number,
        issueDate: new Date(l.issueDate),
        expiryDate: new Date(l.expiryDate),
      },
    });
  }

  console.log('✅ Seed complete!');
  console.log('');
  console.log('🔐 Login credentials:');
  console.log('   admin@enjoymilk.local / Admin@123');
  console.log('   owner@enjoymilk.local / Admin@123');
  console.log('   manager@enjoymilk.local / Admin@123');
  console.log('   operator@enjoymilk.local / Admin@123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
