'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { splitItemsBySection } from '@/lib/production-sections';
import { formatDate, cn, formatNumber } from '@/lib/utils';
import { extractApiMessage } from '@/lib/api-errors';
import { sanitizeNumericInput, blurOnWheel } from '@/lib/numeric';
import { milkMassBalance } from '@/lib/mass-balance';

type Row = Record<string, any>;

export default function ProductionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const id = params.id as string;

  /** Invalidate every query that depends on today's production. Called after
   *  save-all, post, and cancel so the Dashboard "الإنتاج اليوم" card,
   *  the /production list, and any daily-summary widgets pick up the new
   *  totals within the same click. Without this, the Dashboard keeps
   *  showing the STALE value even after a successful save. */
  const invalidateProductionDependents = () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['dashboard', 'executive'] });
    qc.invalidateQueries({ queryKey: ['daily-production'] });
    qc.invalidateQueries({ queryKey: ['daily-production', id] });
    qc.invalidateQueries({ queryKey: ['production-summary'] });
  };

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
    notes: '',
  });
  const [cartonUsage, setCartonUsage] = useState<Row[]>([]);
  const [aluminumUsage, setAluminumUsage] = useState<Row[]>([]);
  const [milkUsage, setMilkUsage] = useState<Row[]>([]);
  const [produced, setProduced] = useState<Row[]>([]);
  const [wastages, setWastages] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  /** نقص المخزون المُعاد من الخادم — وجوده يفتح حوار التأكيد. */
  const [shortages, setShortages] = useState<
    | Array<{
        item: string;
        section?: string;
        requiredQuantity: number;
        availableQuantity: number;
        shortageQuantity: number;
      }>
    | null
  >(null);

  // Load data into local state
  useEffect(() => {
    if (!data) return;
    setHeader({
      shift: data.shift ?? '',
      operatorName: data.operatorName ?? '',
      notes: data.notes ?? '',
    });
    setCartonUsage(data.cartonUsage ?? []);
    setAluminumUsage(data.aluminumUsage ?? []);
    setMilkUsage(data.milkUsage ?? []);
    setProduced(data.produced ?? []);
    setWastages(data.wastages ?? []);
  }, [data?.id, data?.updatedAt]);

  // ملاحظة: لا تضع أي early-return قبل بقية الـ hooks — كانت هذه سبب
  // انهيار الواجهة (Rendered more hooks than during the previous render).
  // كل القيم المحسوبة أدناه آمنة عند غياب data (optional chaining + ?? []).
  const posted = data?.status === 'POSTED';
  const cancelled = data?.status === 'CANCELLED';
  const disabled = posted || cancelled;

  // Categorize items by SCHEMA fields (type / unit / category), NOT
  // hardcoded SKU prefixes or Arabic name substrings. See
  // apps/web/lib/production-sections.ts for the full decision table.
  // Any inventory item created via /inventory now automatically shows
  // up in the correct production dropdown as long as its type/unit is
  // set (POWDER_BULK → raw milk, PACKAGING+CTN → carton, PACKAGING+ROLL
  // → aluminum, POWDER_RETAIL → finished). Legacy items still work via
  // a name/SKU keyword fallback.
  const { raw_milk: milkItems, carton: cartonItems, aluminum: aluminumItems, finished: productItems } =
    splitItemsBySection(items ?? []);

  // Per-item sack weight for the on-screen preview. The literal 25 that used
  // to live here applied to every item regardless of its configuration and
  // was the only conversion touching real inventory. It is now a display
  // fallback only: the server converts authoritatively at save time using
  // Item.bagWeightKg and records which factor it used on the row.
  const LEGACY_BAG_KG = 25;
  const bagWeightFor = (itemId?: string) => {
    const it: any = (items ?? []).find((x: any) => x.id === itemId);
    const w = Number(it?.bagWeightKg ?? 0);
    return w > 0 ? w : LEGACY_BAG_KG;
  };
  const anyMilkItemUnconfigured = milkUsage.some(
    (r: any) => r.itemId && !(Number((items ?? []).find((x: any) => x.id === r.itemId)?.bagWeightKg ?? 0) > 0),
  );

  // إعادة جلب «أفضل جهد» — لا تؤثر على رسالة نجاح/فشل العملية
  const safeRefetch = async () => {
    try {
      await refetch();
    } catch {
      /* تجاهل — البيانات حُفظت، فقط تعذّر التحديث الفوري */
    }
  };

  const saveAll = async () => {
    // Guard: every row with quantity > 0 MUST have a linked inventory
    // item — otherwise the ledger cannot decrement/increment stock and
    // the printed sheet drifts from the actual balance. This mirrors
    // the strict server-side check in DailyProductionService.post.
    const missing: string[] = [];
    const checkRows = (rows: Row[], section: string, qtyKey: string) => {
      rows.forEach((r, i) => {
        const q = Number(r[qtyKey] ?? 0);
        if (q > 0 && !r.itemId) {
          missing.push(`${section} — السطر ${i + 1} (${r.itemName || 'بدون اسم'})`);
        }
      });
    };
    checkRows(cartonUsage, 'الكرتون', 'quantity');
    checkRows(aluminumUsage, 'الألمنيوم', 'quantity');
    checkRows(milkUsage, 'الحليب', 'quantity');
    checkRows(produced, 'الإنتاج', 'cartonsTotal');
    checkRows(wastages, 'التوالف', 'quantity');
    if (missing.length) {
      toast.error(
        `الرجاء اختيار الصنف من قائمة المخزون في:\n${missing.slice(0, 5).join('\n')}${missing.length > 5 ? `\n… و${missing.length - 5} سطراً آخر` : ''}`,
      );
      return;
    }

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
      toast.error(extractApiMessage(e) || 'تعذّر الحفظ — تحقق من الاتصال');
      return;
    }
    await safeRefetch();
    invalidateProductionDependents();
    setSaving(false);
    toast.success('تم حفظ المسودة — لم يتم تعديل المخزون.');
  };

  /**
   * ترحيل للمخزون
   *
   * الخادم لم يعد يرمي خطأ عند نقص المخزون. أول نداء يعيد
   * { success:false, requiresConfirmation:true, warnings:[...] } دون أي
   * كتابة، فنعرض حوار التأكيد. عند الموافقة نعيد الإرسال مع
   * allowShortage=true فيُرحَّل الإنتاج ويُسجَّل العجز.
   */
  const runPost = async (allowShortage: boolean) => {
    setPosting(true);
    try {
      const res = await api.post(`/daily-production/${id}/post`, { allowShortage });
      const data = res?.data ?? {};

      if (data.requiresConfirmation) {
        setShortages(data.warnings ?? []);
        return;
      }

      setShortages(null);
      await safeRefetch();
      invalidateProductionDependents();

      if (data.warnings?.length) {
        toast.success(`تم الترحيل مع تسجيل عجز في ${data.warnings.length} صنف`);
      } else {
        toast.success('تم ترحيل الإنتاج إلى المخزون بنجاح.');
      }
    } catch (e: any) {
      // STRICT_MODE، أو صلاحيات غير كافية في OVERRIDE_MODE، أو أي خطأ آخر:
      // رسالة واضحة بدل صفحة الخطأ العامة.
      setShortages(null);
      toast.error(extractApiMessage(e) || 'تعذّر الترحيل');
    } finally {
      setPosting(false);
    }
  };

  const doPost = async () => {
    if (!confirm(
      'سيتم ترحيل الإنتاج إلى المخزون.\n\n' +
      '• خصم مواد الإنتاج\n' +
      '• خصم مواد التغليف\n' +
      '• إضافة المنتجات النهائية\n' +
      '• تسجيل حركات المخزون\n' +
      '• تطبيق FIFO\n\n' +
      'هل تريد المتابعة؟'
    )) return;
    await runPost(false);
  };

  const doCancel = async () => {
    if (!confirm('إرجاع كل الكميات للمخزون؟')) return;
    try {
      await api.post(`/daily-production/${id}/cancel`);
    } catch (e: any) {
      toast.error(extractApiMessage(e) || 'تعذّر الإلغاء');
      return;
    }
    await safeRefetch();
    invalidateProductionDependents();
    toast.success('تم إلغاء الترحيل وإرجاع الكميات');
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

  // الآن — بعد تشغيل كل الـ hooks — يمكن العرض المشروط بأمان
  if (!data) {
    return (
      <AppShell>
        <div className="max-w-6xl mx-auto p-8 text-center text-zinc-500">
          جاري التحميل...
        </div>
      </AppShell>
    );
  }

  // ─── Computed totals (مجموع الإنتاج اليومي) ──────────
  const producedTotals = produced.reduce(
    (acc: any, p: any) => {
      const key = p.itemName || '(بدون اسم)';
      acc.byItem[key] = (acc.byItem[key] || 0) + Number(p.cartonsTotal || 0);
      acc.totalCartons += Number(p.cartonsTotal || 0);
      return acc;
    },
    { byItem: {}, totalCartons: 0 },
  );

  const milkTotal = milkUsage.reduce((s, m) => s + Number(m.quantity || 0), 0);
  const aluminumTotal = aluminumUsage.reduce((s, a) => s + Number(a.quantity || 0), 0);
  const cartonTotal = cartonUsage.reduce((s, c) => s + Number(c.quantity || 0), 0);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4 pb-24 md:pb-6">
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
        {/* ─── حوار تأكيد نقص المخزون ───────────────────────────
            يحل محل صفحة الخطأ العامة. لا شيء يُكتب في المخزون قبل
            ضغط "تسجيل مع تحذير". */}
        {shortages && shortages.length > 0 && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortage-title"
          >
            <Card className="w-full max-w-lg p-5 space-y-4 bg-white">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h3 id="shortage-title" className="font-bold text-zinc-800">
                    نقص في مخزون المواد
                  </h3>
                  <p className="text-sm text-zinc-600 mt-1">
                    يوجد نقص في مخزون بعض المواد. هل تريد تسجيل الإنتاج مع إنشاء
                    عجز بالمخزون؟
                  </p>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-zinc-500 text-xs">
                    <tr>
                      <th className="p-2 text-right">الصنف</th>
                      <th className="p-2 text-center">المطلوب</th>
                      <th className="p-2 text-center">المتاح</th>
                      <th className="p-2 text-center">العجز</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortages.map((w, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{w.item}</td>
                        <td className="p-2 text-center">{w.requiredQuantity}</td>
                        <td className="p-2 text-center">{w.availableQuantity}</td>
                        <td className="p-2 text-center font-bold text-amber-600">
                          {w.shortageQuantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-zinc-500">
                سيُسجَّل العجز في سجل تدقيق المخزون باسم المستخدم الحالي، ويمكن
                تصحيحه لاحقاً عبر تعديل المخزون.
              </p>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShortages(null)}
                  disabled={posting}
                >
                  إلغاء
                </Button>
                <Button onClick={() => runPost(true)} loading={posting}>
                  تسجيل مع تحذير
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* ─── STATUS BANNER ───────────────────────────────────────────
            The customer saved this sheet three times and never posted it,
            then reported "production does not update inventory". Saving is
            a draft operation and moves nothing; only ترحيل does. That must
            be impossible to miss. */}
        {!cancelled && (
          posted ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-black text-emerald-900">مرحّل للمخزون</div>
                <div className="text-xs text-emerald-800">
                  تم ترحيل هذه الورقة — الكميات مطبَّقة على المخزون وحركات المخزون مسجَّلة.
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-black text-amber-900">مسودة</div>
                <div className="text-xs text-amber-900">
                  تم حفظ البيانات كمسودة فقط — لم يتم ترحيل الكميات إلى المخزون.
                  اضغط <b>«ترحيل للمخزون»</b> لتطبيقها.
                </div>
              </div>
            </div>
          )
        )}

        <Card className="p-4 flex items-center justify-between flex-wrap gap-3 bg-zinc-50">
          <div className="flex gap-2 flex-wrap">
            {!disabled && (
              <>
                {/* ترحيل is the action that actually moves inventory, so it
                    is the PRIMARY button. Saving is a draft operation and is
                    now visually and verbally secondary — the customer read
                    "حفظ كل البيانات" as "production recorded" and never
                    posted, so inventory never moved. */}
                <Button variant="outline" onClick={saveAll} loading={saving} title="Ctrl+S">
                  <Save className="h-4 w-4" /> حفظ كمسودة
                </Button>
                <Button
                  onClick={doPost}
                  loading={posting}
                  className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
                >
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
          <div className="grid md:grid-cols-2 gap-4">
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
                        type="text"
                  inputMode="decimal"
                  dir="ltr"
                        placeholder="الكمية"
                        value={r.quantity}
                        onChange={(e) => {
                          const v = [...cartonUsage];
                          v[i] = { ...v[i], quantity: +sanitizeNumericInput(e.target.value, { allowDecimal: true }) };
                          setCartonUsage(v);
                        }} disabled={disabled}
                      onWheel={blurOnWheel}
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

          {/* الألمنيوم — بالكيلوغرام */}
          <section className="mb-6">
            <SectionHeader
              icon={<Layers className="h-4 w-4" />}
              title="الألمنيوم (كغ)"
              onAdd={() => setAluminumUsage([...aluminumUsage, { itemName: '', quantity: 0, unit: 'KG' }])}
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
                      <div className="relative">
                        <Input
                          type="text"
                  inputMode="decimal"
                  dir="ltr"
                          placeholder="الكمية بالكيلو"
                          value={r.quantity}
                          onChange={(e) => {
                            const v = [...aluminumUsage];
                            v[i] = { ...v[i], quantity: +sanitizeNumericInput(e.target.value, { allowDecimal: true }), unit: 'KG' };
                            setAluminumUsage(v);
                          }} disabled={disabled}
                        onWheel={blurOnWheel}
                />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">كغ</span>
                      </div>
                    </div>
                    <div className="md:col-span-1">
                      {!disabled && <RemoveBtn onClick={() => setAluminumUsage(aluminumUsage.filter((_, idx) => idx !== i))} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* الحليب — بالكيلوغرام (وزن الكيس من إعداد الصنف) */}
          <section>
            <SectionHeader
              icon={<Droplet className="h-4 w-4" />}
              title="الحليب (كغ)"
              onAdd={() => setMilkUsage([...milkUsage, { itemName: '', count: 0, quantity: 0, unit: 'KG' }])}
              disabled={disabled}
            />
            <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded p-2 mb-2">
              💡 عدد الأكياس × وزن الكيس المُعرَّف على الصنف = الكمية الإجمالية.
              الحساب النهائي يتم على الخادم وتُحفظ قيمة المعامل مع السطر.
              {anyMilkItemUnconfigured && (
                <span className="block mt-1 text-amber-800">
                  ⚠ بعض الأصناف المختارة بلا «وزن الكيس» — يُستخدم {LEGACY_BAG_KG} كغ مؤقتاً.
                  عرّف الوزن على الصنف ليصبح الحساب دقيقاً.
                </span>
              )}
            </p>
            {milkUsage.length === 0 ? (
              <Empty text="لا يوجد حليب مسحوب" />
            ) : (
              <div className="space-y-2">
                <div className="grid md:grid-cols-12 gap-2 text-xs font-bold text-zinc-500 uppercase">
                  <div className="md:col-span-5">الصنف</div>
                  <div className="md:col-span-3">عدد الأكياس</div>
                  <div className="md:col-span-3">الكمية (كغ)</div>
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
                        type="text"
                  inputMode="decimal"
                  dir="ltr"
                        placeholder="عدد الأكياس"
                        value={r.count}
                        onChange={(e) => {
                          const bags = +sanitizeNumericInput(e.target.value, { allowDecimal: true });
                          const v = [...milkUsage];
                          // Preview only. The SERVER recomputes this from the
                          // item's own bagWeightKg and records the factor it
                          // used — this value is not what gets deducted.
                          v[i] = {
                            ...v[i],
                            count: bags,
                            quantity: bags * bagWeightFor(r.itemId),
                            unit: 'KG',
                          };
                          setMilkUsage(v);
                        }} disabled={disabled}
                      onWheel={blurOnWheel}
                />
                    </div>
                    <div className="md:col-span-3">
                      <div className="relative">
                        <Input
                          type="text"
                  inputMode="decimal"
                  dir="ltr"
                          placeholder="الكمية بالكغ"
                          value={r.quantity}
                          onChange={(e) => {
                            const v = [...milkUsage];
                            v[i] = { ...v[i], quantity: +sanitizeNumericInput(e.target.value, { allowDecimal: true }), unit: 'KG' };
                            setMilkUsage(v);
                          }} disabled={disabled}
                        onWheel={blurOnWheel}
                />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">كغ</span>
                      </div>
                    </div>
                    <div className="md:col-span-1">
                      {!disabled && <RemoveBtn onClick={() => setMilkUsage(milkUsage.filter((_, idx) => idx !== i))} />}
                    </div>
                  </div>
                ))}
                {(() => {
                  // Raw-milk mass balance. Inventory is kept in SACKS; the
                  // factory thinks in KG, so both are shown side by side and
                  // the waste box below is entered in KG.
                  const mb = milkMassBalance(milkUsage, wastages, bagWeightFor);
                  if (!mb.hasMilk) return null;
                  return (
                    <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
                        <div>
                          <div className="text-[10px] text-zinc-500">عدد الشوالات المستخدمة</div>
                          <div className="text-sm font-black">{formatNumber(mb.sacks, 2)} <span className="text-[10px] font-normal">شوال</span></div>
                        </div>
                        <div>
                          <div className="text-[10px] text-zinc-500">وزن الشوال</div>
                          <div className="text-sm font-black">{formatNumber(mb.kgPerSack, 0)} <span className="text-[10px] font-normal">كغم</span></div>
                        </div>
                        <div>
                          <div className="text-[10px] text-zinc-500">إجمالي الحليب الخام</div>
                          <div className="text-sm font-black text-emerald-800">{formatNumber(mb.grossKg, 2)} <span className="text-[10px] font-normal">كغم</span></div>
                        </div>
                        <div>
                          <div className="text-[10px] text-zinc-500">التوالف</div>
                          <div className="text-sm font-black text-amber-700">{formatNumber(mb.wasteKg, 2)} <span className="text-[10px] font-normal">كغم</span></div>
                        </div>
                        <div>
                          <div className="text-[10px] text-zinc-500">الصافي بعد التوالف</div>
                          <div className="text-sm font-black">{formatNumber(mb.netKg, 2)} <span className="text-[10px] font-normal">كغم</span></div>
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-zinc-600 text-center">
                        نسبة التوالف: <b>{formatNumber(mb.wastePercent, 2)}%</b>
                        <span className="mx-1">·</span>
                        التوالف تُسجَّل بالكيلوغرام وهي ضمن الكمية المصروفة — لا تُخصم من المخزون مرة ثانية.
                      </div>
                    </div>
                  );
                })()}
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
                { itemName: '', cartonsTotal: 0 },
              ])
            }
            disabled={disabled}
          />
          {produced.length === 0 ? (
            <Empty text="لا يوجد إنتاج مسجّل" />
          ) : (
            <div className="space-y-2">
              <div className="grid md:grid-cols-12 gap-2 text-xs font-bold text-zinc-500 uppercase">
                <div className="md:col-span-8">الصنف</div>
                <div className="md:col-span-3">عدد الكراتين</div>
                <div className="md:col-span-1"></div>
              </div>
              {produced.map((r, i) => (
                <div key={i} className="grid md:grid-cols-12 gap-2 items-center">
                  <div className="md:col-span-8">
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
                  <div className="md:col-span-3">
                    <Input
                      type="text"
                  inputMode="decimal"
                  dir="ltr"
                      placeholder="الكراتين"
                      value={r.cartonsTotal}
                      onChange={(e) => {
                        const v = [...produced];
                        v[i] = { ...v[i], cartonsTotal: +sanitizeNumericInput(e.target.value, { allowDecimal: true }) };
                        setProduced(v);
                      }} disabled={disabled}
                      className="font-bold"
                    onWheel={blurOnWheel}
                />
                  </div>
                  <div className="md:col-span-1">
                    {!disabled && <RemoveBtn onClick={() => setProduced(produced.filter((_, idx) => idx !== i))} />}
                  </div>
                </div>
              ))}
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
                      type="text"
                  inputMode="decimal"
                  dir="ltr"
                      value={r.quantity}
                      onChange={(e) => {
                        const v = [...wastages];
                        v[i] = { ...v[i], quantity: +sanitizeNumericInput(e.target.value, { allowDecimal: true }) };
                        setWastages(v);
                      }} disabled={disabled}
                    onWheel={blurOnWheel}
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
                      title="الكرتون=قطعة · الحليب=كغ · الألمنيوم=كغ (أو غم)"
                    >
                      <option value="PCS">قطعة (كرتون)</option>
                      <option value="KG">كغ (حليب/ألمنيوم)</option>
                      <option value="G">غم</option>
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
              <div className="text-[10px] text-zinc-400">كغ</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الألمنيوم</div>
              <div className="text-2xl font-black mt-1" data-numeric>{aluminumTotal.toLocaleString('en-US')}</div>
              <div className="text-[10px] text-zinc-400">كغ</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الكرتون</div>
              <div className="text-2xl font-black mt-1" data-numeric>{cartonTotal.toLocaleString('en-US')}</div>
              <div className="text-[10px] text-zinc-400">قطعة</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="bg-white border border-zinc-200 rounded-lg p-3">
              <div className="text-xs text-zinc-500">إجمالي الكراتين المنتجة</div>
              <div className="text-2xl font-black mt-1" data-numeric>{producedTotals.totalCartons.toLocaleString('en-US')}</div>
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
