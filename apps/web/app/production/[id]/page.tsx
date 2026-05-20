'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  Trash2,
  Plus,
  RotateCcw,
  AlertTriangle,
  Save,
  Box,
  Layers,
  Droplet,
  Package,
  Archive,
  StickyNote,
  Printer,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button, Input, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

type Row = Record<string, any>;

export default function ProductionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { data, refetch } = useQuery({
    queryKey: ['daily-production', id],
    queryFn: () => api.get(`/daily-production/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: items } = useQuery({
    queryKey: ['items-all'],
    queryFn: () => api.get('/inventory/items').then((r) => r.data),
  });

  // Local state for all sections
  const [header, setHeader] = useState({
    shift: '',
    operatorName: '',
    machineNumber: 0,
    notes: '',
  });
  const [cartonUsage, setCartonUsage] = useState<Row[]>([]);
  const [aluminumUsage, setAluminumUsage] = useState<Row[]>([]);
  const [milkUsage, setMilkUsage] = useState<Row[]>([]);
  const [produced, setProduced] = useState<Row[]>([]);
  const [wastages, setWastages] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  // Load data into local state
  useEffect(() => {
    if (!data) return;
    setHeader({
      shift: data.shift ?? '',
      operatorName: data.operatorName ?? '',
      machineNumber: data.machineNumber ?? 0,
      notes: data.notes ?? '',
    });
    setCartonUsage(data.cartonUsage ?? []);
    setAluminumUsage(data.aluminumUsage ?? []);
    setMilkUsage(data.milkUsage ?? []);
    setProduced(data.produced ?? []);
    setWastages(data.wastages ?? []);
  }, [data?.id, data?.updatedAt]);

  if (!data) return <AppShell><div className="p-8">جاري التحميل...</div></AppShell>;

  const posted = data.status === 'POSTED';
  const cancelled = data.status === 'CANCELLED';
  const disabled = posted || cancelled;

  // Filter items by category for autocomplete
  const cartonItems = (items ?? []).filter((i: any) =>
    i.sku?.startsWith('CTN') || i.name?.includes('كرتون'),
  );
  const aluminumItems = (items ?? []).filter((i: any) =>
    i.sku?.startsWith('ALU') || i.name?.includes('ألمنيوم'),
  );
  const milkItems = (items ?? []).filter((i: any) =>
    i.sku?.startsWith('RAW-MILK') || i.name?.includes('حليب خام'),
  );
  const productItems = (items ?? []).filter((i: any) => i.type === 'POWDER_RETAIL');

  // إعادة جلب «أفضل جهد» — لا تؤثر على رسالة نجاح/فشل العملية
  const safeRefetch = async () => {
    try {
      await refetch();
    } catch {
      /* تجاهل — البيانات حُفظت، فقط تعذّر التحديث الفوري */
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await api.post(`/daily-production/${id}/save-all`, {
        ...header,
        cartonUsage,
        aluminumUsage,
        milkUsage,
        produced,
        wastages,
      });
    } catch (e: any) {
      setSaving(false);
      alert(e?.response?.data?.message || 'تعذّر الحفظ — تحقق من الاتصال');
      return;
    }
    await safeRefetch();
    setSaving(false);
    alert('✓ تم الحفظ');
  };

  const doPost = async () => {
    if (!confirm('ترحيل اليوم وتطبيقه على المخزون؟')) return;
    try {
      await api.post(`/daily-production/${id}/post`);
    } catch (e: any) {
      alert(e?.response?.data?.message || 'تعذّر الترحيل');
      return;
    }
    await safeRefetch();
    alert('✓ تم الترحيل');
  };

  const doCancel = async () => {
    if (!confirm('إرجاع كل الكميات للمخزون؟')) return;
    try {
      await api.post(`/daily-production/${id}/cancel`);
    } catch (e: any) {
      alert(e?.response?.data?.message || 'تعذّر الإلغاء');
      return;
    }
    await safeRefetch();
    alert('✓ تم إلغاء الترحيل');
  };

  // ─── Keyboard shortcuts: Ctrl+S = save, Ctrl+P = print ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!disabled && !saving) saveAll();
      }
      if (ctrl && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.open(`/production/${id}/print`, '_blank', 'noopener');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ─── Computed totals (مجموع الإنتاج اليومي) ──────────
  const producedTotals = produced.reduce(
    (acc: any, p: any) => {
      const key = p.itemName || '(بدون اسم)';
      acc.byItem[key] = (acc.byItem[key] || 0) + Number(p.cartonsTotal || 0);
      acc.totalCartons += Number(p.cartonsTotal || 0);
      acc.totalPallets += Number(p.palletsCount || 0);
      return acc;
    },
    { byItem: {}, totalCartons: 0, totalPallets: 0 },
  );

  const milkTotal = milkUsage.reduce((s, m) => s + Number(m.quantity || 0), 0);
  const aluminumTotal = aluminumUsage.reduce((s, a) => s + Number(a.quantity || 0), 0);
  const cartonTotal = cartonUsage.reduce((s, c) => s + Number(c.quantity || 0), 0);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
        {/* ─── Header ─── */}
        <header>
          <button
            onClick={() => router.push('/production')}
            className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
            العودة للقائمة
          </button>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                إنتاج {formatDate(data.productionDate)}
              </h1>
              <p className="text-sm text-zinc-500 mt-1">
                {header.shift && <span className="ml-3">شيفت: {header.shift}</span>}
                {header.operatorName && <span>المشغّل: {header.operatorName}</span>}
              </p>
            </div>
            <div>
              {posted ? <Badge variant="success" dot>مُرحَّل</Badge> :
               cancelled ? <Badge variant="danger" dot>ملغي</Badge> :
               <Badge variant="warning" dot>مسودة</Badge>}
            </div>
          </div>
        </header>

        {/* ─── Action bar ─── */}
        <Card className="p-4 flex items-center justify-between flex-wrap gap-3 bg-zinc-50">
          <div className="flex gap-2 flex-wrap">
            {!disabled && (
              <>
                <Button onClick={saveAll} loading={saving} title="Ctrl+S">
                  <Save className="h-4 w-4" /> حفظ كل البيانات
                </Button>
                <Button variant="outline" onClick={doPost}>
                  <CheckCircle2 className="h-4 w-4" /> ترحيل للمخزون
                </Button>
              </>
            )}
            {posted && (
              <Button variant="outline" onClick={doCancel}>
                <RotateCcw className="h-4 w-4" /> إلغاء الترحيل
              </Button>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-zinc-400 hidden md:inline">
              Ctrl+S للحفظ · Ctrl+P للطباعة
            </span>
            <Button
              variant="outline"
              title="Ctrl+P"
              onClick={() =>
                window.open(`/production/${id}/print`, '_blank', 'noopener')
              }
            >
              <Printer className="h-4 w-4" /> طباعة تقرير PDF
            </Button>
          </div>
        </Card>

        {/* ─── General info ─── */}
        <Card className="p-5">
          <h3 className="font-bold mb-3">معلومات عامة</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">الشيفت</label>
              <select
                value={header.shift}
                onChange={(e) => setHeader({ ...header, shift: e.target.value })}
                disabled={disabled}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              >
                <option value="">— اختر —</option>
                <option value="صباحي">صباحي</option>
                <option value="مسائي">مسائي</option>
                <option value="ليلي">ليلي</option>
              </select>
            </div>
            <Input
              label="اسم المشغّل"
              value={header.operatorName}
              onChange={(e) => setHeader({ ...header, operatorName: e.target.value })}
              disabled={disabled}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">رقم الماكينة (اختياري)</label>
              <select
                value={header.machineNumber || ''}
                onChange={(e) => setHeader({ ...header, machineNumber: +e.target.value || 0 })}
                disabled={disabled}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              >
                <option value="">— غير محدد —</option>
                <option value="1">ماكينة 1</option>
                <option value="2">ماكينة 2</option>
                <option value="3">ماكينة 3</option>
              </select>
            </div>
          </div>
        </Card>

        {/* ─── المواد المسحوبة من المستودع الخام ─── */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-black text-lg flex items-center gap-2">
              <Archive className="h-5 w-5" />
              المواد المسحوبة من المستودع الخام
            </h2>
          </div>

          {/* الكرتون */}
          <section className="mb-6">
            <SectionHeader
              icon={<Box className="h-4 w-4" />}
              title="الكرتون"
              onAdd={() => setCartonUsage([...cartonUsage, { itemName: '', quantity: 0 }])}
              disabled={disabled}
            />
            {cartonUsage.length === 0 ? (
              <Empty text="لا يوجد كرتون مسحوب" />
            ) : (
              <div className="space-y-2">
                {cartonUsage.map((r, i) => (
                  <div key={i} className="grid md:grid-cols-12 gap-2 items-center">
                    <div className="md:col-span-7">
                      <ItemSelector
                        items={cartonItems}
                        value={r}
                        onChange={(updated: any) => {
                          const v = [...cartonUsage];
                          v[i] = { ...v[i], ...updated };
                          setCartonUsage(v);
                        }}
                        disabled={disabled}
                        placeholder="الصنف (كرتون)"
                      />
                    </div>
                    <div className="md:col-span-4">
                      <Input
                        type="number"
                        placeholder="الكمية"
                        value={r.quantity}
                        onChange={(e) => {
                          const v = [...cartonUsage];
                          v[i] = { ...v[i], quantity: +e.target.value };
                          setCartonUsage(v);
                        }}
                        disabled={disabled}
                      />
                    </div>
                    <div className="md:col-span-1">
                      {!disabled && <RemoveBtn onClick={() => setCartonUsage(cartonUsage.filter((_, idx) => idx !== i))} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* الألمنيوم */}
          <section className="mb-6">
            <SectionHeader
              icon={<Layers className="h-4 w-4" />}
              title="الألمنيوم"
              onAdd={() => setAluminumUsage([...aluminumUsage, { itemName: '', quantity: 0 }])}
              disabled={disabled}
            />
            {aluminumUsage.length === 0 ? (
              <Empty text="لا يوجد ألمنيوم مسحوب" />
            ) : (
              <div className="space-y-2">
                {aluminumUsage.map((r, i) => (
                  <div key={i} className="grid md:grid-cols-12 gap-2 items-center">
                    <div className="md:col-span-7">
                      <ItemSelector
                        items={aluminumItems}
                        value={r}
                        onChange={(updated: any) => {
                          const v = [...aluminumUsage];
                          v[i] = { ...v[i], ...updated };
                          setAluminumUsage(v);
                        }}
                        disabled={disabled}
                        placeholder="الصنف (ألمنيوم)"
                      />
                    </div>
                    <div className="md:col-span-4">
                      <Input
                        type="number"
                        placeholder="الكمية"
                        value={r.quantity}
                        onChange={(e) => {
                          const v = [...aluminumUsage];
                          v[i] = { ...v[i], quantity: +e.target.value };
                          setAluminumUsage(v);
                        }}
                        disabled={disabled}
                      />
                    </div>
                    <div className="md:col-span-1">
                      {!disabled && <RemoveBtn onClick={() => setAluminumUsage(aluminumUsage.filter((_, idx) => idx !== i))} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* الحليب */}
          <section>
            <SectionHeader
              icon={<Droplet className="h-4 w-4" />}
              title="الحليب"
              onAdd={() => setMilkUsage([...milkUsage, { itemName: '', count: 0, quantity: 0, unit: 'L' }])}
              disabled={disabled}
            />
            {milkUsage.length === 0 ? (
              <Empty text="لا يوجد حليب مسحوب" />
            ) : (
              <div className="space-y-2">
                <div className="grid md:grid-cols-12 gap-2 text-xs font-bold text-zinc-500 uppercase">
                  <div className="md:col-span-5">الصنف</div>
                  <div className="md:col-span-3">العدد</div>
                  <div className="md:col-span-3">الكمية</div>
                  <div className="md:col-span-1"></div>
                </div>
                {milkUsage.map((r, i) => (
                  <div key={i} className="grid md:grid-cols-12 gap-2 items-center">
                    <div className="md:col-span-5">
                      <ItemSelector
                        items={milkItems}
                        value={r}
                        onChange={(updated: any) => {
                          const v = [...milkUsage];
                          v[i] = { ...v[i], ...updated };
                          setMilkUsage(v);
                        }}
                        disabled={disabled}
                        placeholder="الصنف (حليب)"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <Input
                        type="number"
                        placeholder="العدد"
                        value={r.count}
                        onChange={(e) => {
                          const v = [...milkUsage];
                          v[i] = { ...v[i], count: +e.target.value };
                          setMilkUsage(v);
                        }}
                        disabled={disabled}
                      />
                    </div>
                    <div className="md:col-span-3">
                      <Input
                        type="number"
                        placeholder="الكمية"
                        value={r.quantity}
                        onChange={(e) => {
                          const v = [...milkUsage];
                          v[i] = { ...v[i], quantity: +e.target.value };
                          setMilkUsage(v);
                        }}
                        disabled={disabled}
                      />
                    </div>
                    <div className="md:col-span-1">
                      {!disabled && <RemoveBtn onClick={() => setMilkUsage(milkUsage.filter((_, idx) => idx !== i))} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </Card>

        {/* ─── المواد المنتجة ─── */}
        <Card className="p-5">
          <SectionHeader
            icon={<Package className="h-5 w-5" />}
            title="المواد المنتجة"
            big
            onAdd={() =>
              setProduced([
                ...produced,
                { itemName: '', palletsCount: 0, cartonsPerPallet: 0, cartonsTotal: 0 },
              ])
            }
            disabled={disabled}
          />
          {produced.length === 0 ? (
            <Empty text="لا يوجد إنتاج مسجّل" />
          ) : (
            <div className="space-y-2">
              <div className="grid md:grid-cols-12 gap-2 text-xs font-bold text-zinc-500 uppercase">
                <div className="md:col-span-5">الصنف</div>
                <div className="md:col-span-2">عدد الطبالي</div>
                <div className="md:col-span-2">كراتين/طبلية</div>
                <div className="md:col-span-2">المجموع <span className="lowercase text-emerald-600 font-normal">(تلقائي)</span></div>
                <div className="md:col-span-1"></div>
              </div>
              {produced.map((r, i) => (
                <div key={i} className="grid md:grid-cols-12 gap-2 items-center">
                  <div className="md:col-span-5">
                    <ItemSelector
                      items={productItems}
                      value={r}
                      onChange={(updated: any) => {
                        const v = [...produced];
                        v[i] = { ...v[i], ...updated };
                        setProduced(v);
                      }}
                      disabled={disabled}
                      placeholder="اختر منتج"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Input
                      type="number"
                      placeholder="الطبالي"
                      value={r.palletsCount}
                      onChange={(e) => {
                        const v = [...produced];
                        const pallets = +e.target.value;
                        const perPallet = +(v[i].cartonsPerPallet ?? 0);
                        v[i] = {
                          ...v[i],
                          palletsCount: pallets,
                          // إعادة الحساب التلقائي عند وجود قيمة كراتين/طبلية
                          cartonsTotal:
                            perPallet > 0 ? pallets * perPallet : v[i].cartonsTotal,
                        };
                        setProduced(v);
                      }}
                      disabled={disabled}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Input
                      type="number"
                      placeholder="كراتين/طبلية"
                      value={r.cartonsPerPallet ?? ''}
                      onChange={(e) => {
                        const v = [...produced];
                        const perPallet = +e.target.value;
                        const pallets = +(v[i].palletsCount ?? 0);
                        v[i] = {
                          ...v[i],
                          cartonsPerPallet: perPallet,
                          cartonsTotal: pallets > 0 ? pallets * perPallet : v[i].cartonsTotal,
                        };
                        setProduced(v);
                      }}
                      disabled={disabled}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Input
                      type="number"
                      placeholder="الكراتين"
                      value={r.cartonsTotal}
                      onChange={(e) => {
                        // يسمح بالتعديل اليدوي إذا أراد المستخدم تجاوز الحساب
                        const v = [...produced];
                        v[i] = { ...v[i], cartonsTotal: +e.target.value };
                        setProduced(v);
                      }}
                      disabled={disabled}
                      className="font-bold"
                    />
                  </div>
                  <div className="md:col-span-1">
                    {!disabled && <RemoveBtn onClick={() => setProduced(produced.filter((_, idx) => idx !== i))} />}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-zinc-400 mt-1">
                💡 أدخل عدد الطبالي + كراتين/طبلية → المجموع يحسب تلقائياً (قابل للتعديل اليدوي)
              </p>
            </div>
          )}
        </Card>

        {/* ─── التوالف ─── */}
        <Card className="p-5">
          <SectionHeader
            icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
            title="التوالف"
            big
            onAdd={() => setWastages([...wastages, { itemName: '', quantity: 0, unit: 'PCS' }])}
            disabled={disabled}
          />
          {wastages.length === 0 ? (
            <Empty text="لا توجد توالف 👍" />
          ) : (
            <div className="space-y-2">
              <div className="grid md:grid-cols-12 gap-2 text-xs font-bold text-zinc-500 uppercase">
                <div className="md:col-span-5">الصنف</div>
                <div className="md:col-span-3">العدد / الوزن</div>
                <div className="md:col-span-2">الوحدة</div>
                <div className="md:col-span-2">السبب</div>
              </div>
              {wastages.map((r, i) => (
                <div key={i} className="grid md:grid-cols-12 gap-2 items-center">
                  <div className="md:col-span-5">
                    <ItemSelector
                      items={items ?? []}
                      value={r}
                      onChange={(updated: any) => {
                        const v = [...wastages];
                        v[i] = { ...v[i], ...updated };
                        setWastages(v);
                      }}
                      disabled={disabled}
                      placeholder="الصنف التالف"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Input
                      type="number"
                      value={r.quantity}
                      onChange={(e) => {
                        const v = [...wastages];
                        v[i] = { ...v[i], quantity: +e.target.value };
                        setWastages(v);
                      }}
                      disabled={disabled}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <select
                      value={r.unit ?? 'PCS'}
                      onChange={(e) => {
                        const v = [...wastages];
                        v[i] = { ...v[i], unit: e.target.value };
                        setWastages(v);
                      }}
                      disabled={disabled}
                      className="w-full h-10 px-2 rounded-lg border border-zinc-200 text-sm"
                    >
                      <option value="PCS">قطعة</option>
                      <option value="KG">كغ</option>
                      <option value="L">لتر</option>
                    </select>
                  </div>
                  <div className="md:col-span-2 flex gap-1">
                    <Input
                      placeholder="السبب"
                      value={r.reason ?? ''}
                      onChange={(e) => {
                        const v = [...wastages];
                        v[i] = { ...v[i], reason: e.target.value };
                        setWastages(v);
                      }}
                      disabled={disabled}
                    />
                    {!disabled && <RemoveBtn onClick={() => setWastages(wastages.filter((_, idx) => idx !== i))} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ─── مجموع الإنتاج اليومي ─── */}
        <Card className="p-5 bg-emerald-50/50 border-emerald-200">
          <h3 className="font-black text-lg mb-3 flex items-center gap-2">
            📊 مجموع الإنتاج اليومي
          </h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الحليب الخام</div>
              <div className="text-2xl font-black mt-1" data-numeric>{milkTotal.toLocaleString('en-US')}</div>
              <div className="text-[10px] text-zinc-400">لتر</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الألمنيوم</div>
              <div className="text-2xl font-black mt-1" data-numeric>{aluminumTotal.toLocaleString('en-US')}</div>
              <div className="text-[10px] text-zinc-400">قطعة/رول</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الكرتون</div>
              <div className="text-2xl font-black mt-1" data-numeric>{cartonTotal.toLocaleString('en-US')}</div>
              <div className="text-[10px] text-zinc-400">قطعة</div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الكراتين المنتجة</div>
              <div className="text-2xl font-black mt-1" data-numeric>{producedTotals.totalCartons.toLocaleString('en-US')}</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الطبالي</div>
              <div className="text-2xl font-black mt-1" data-numeric>{producedTotals.totalPallets.toLocaleString('en-US')}</div>
            </div>
          </div>
          {Object.keys(producedTotals.byItem).length > 0 && (
            <div className="mt-4 pt-4 border-t border-emerald-200">
              <div className="text-xs font-bold text-zinc-700 mb-2">تفصيل حسب الصنف:</div>
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                {Object.entries(producedTotals.byItem).map(([name, total]: any) => (
                  <div key={name} className="flex justify-between bg-white rounded px-3 py-2 border border-zinc-200">
                    <span className="font-medium">{name}</span>
                    <span className="font-black" data-numeric>{Number(total).toLocaleString('en-US')} كرتون</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* ─── رصيد المستودع بعد الإنتاج ─── */}
        <Card className="p-5">
          <h3 className="font-black text-lg mb-3 flex items-center gap-2">
            🏪 رصيد المستودع بعد الإنتاج
          </h3>
          <p className="text-xs text-zinc-500 mb-3">يعتمد على المخزون الحقيقي الحالي. يُحدَّث تلقائياً بعد الترحيل.</p>
          <div className="grid md:grid-cols-3 gap-4">
            <BalanceCard
              title="الحليب الخام"
              icon={<Droplet className="h-4 w-4 text-blue-500" />}
              rows={data.warehouseBalance?.milk ?? []}
            />
            <BalanceCard
              title="الكرتون"
              icon={<Box className="h-4 w-4 text-amber-600" />}
              rows={data.warehouseBalance?.carton ?? []}
            />
            <BalanceCard
              title="الألمنيوم"
              icon={<Layers className="h-4 w-4 text-zinc-500" />}
              rows={data.warehouseBalance?.aluminum ?? []}
            />
          </div>
        </Card>

        {/* ─── الملاحظات ─── */}
        <Card className="p-5">
          <SectionHeader
            icon={<StickyNote className="h-5 w-5" />}
            title="الملاحظات"
            big
          />
          <textarea
            value={header.notes}
            onChange={(e) => setHeader({ ...header, notes: e.target.value })}
            disabled={disabled}
            placeholder="اكتب أي ملاحظات: مشاكل الإنتاج، أعطال ماكينة، نقص مواد، ملاحظات الجودة، ملاحظات المشغل..."
            className="w-full min-h-32 p-3 rounded-lg border border-zinc-200 text-sm font-sans leading-relaxed resize-y"
          />
        </Card>

        {/* ─── Sticky save bar ─── */}
        {!disabled && (
          <div className="sticky bottom-4 z-30">
            <Card className="p-3 flex items-center justify-between bg-zinc-900 text-white border-zinc-900">
              <span className="text-sm">احفظ كل التعديلات قبل الترحيل</span>
              <Button onClick={saveAll} loading={saving} size="lg" className="bg-white text-zinc-900 hover:bg-zinc-100">
                <Save className="h-4 w-4" /> حفظ كل البيانات
              </Button>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ─── Helper Components ───────────────────────────────

function SectionHeader({ icon, title, onAdd, disabled, big }: any) {
  return (
    <div className={cn('flex items-center justify-between', big ? 'mb-4' : 'mb-3')}>
      <h3 className={cn('font-bold flex items-center gap-2', big && 'text-lg')}>
        {icon}
        {title}
      </h3>
      {onAdd && !disabled && (
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          إضافة
        </Button>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-zinc-400 text-center py-4">{text}</p>;
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-red-500 hover:text-red-700 p-2">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function ItemSelector({ items, value, onChange, disabled, placeholder }: any) {
  return (
    <div className="flex gap-2">
      <select
        value={value.itemId || ''}
        onChange={(e) => {
          const it = items.find((x: any) => x.id === e.target.value);
          onChange({
            itemId: e.target.value || null,
            itemName: it?.name || value.itemName || '',
          });
        }}
        disabled={disabled}
        className="flex-1 h-10 px-2 rounded-lg border border-zinc-200 text-sm bg-white min-w-0"
      >
        <option value="">— صنف من المخزون —</option>
        {items.map((it: any) => (
          <option key={it.id} value={it.id}>{it.name}</option>
        ))}
      </select>
      <Input
        placeholder={placeholder}
        value={value.itemName ?? ''}
        onChange={(e) => onChange({ itemName: e.target.value })}
        disabled={disabled}
        className="flex-1 min-w-0"
      />
    </div>
  );
}

function BalanceCard({ title, icon, rows }: any) {
  return (
    <div className="bg-zinc-50 rounded-lg p-3 border border-zinc-200">
      <div className="flex items-center gap-2 mb-2 font-bold text-sm">
        {icon}
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-400 text-center py-2">لا يوجد</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r: any) => (
            <div key={r.id} className="flex justify-between text-xs bg-white rounded px-2 py-1.5 border border-zinc-200">
              <span className="truncate">{r.name}</span>
              <span className="font-black" data-numeric>{Number(r.balance ?? 0).toLocaleString('en-US')} {r.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
