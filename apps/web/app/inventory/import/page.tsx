'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, ArrowRight, FileText, Check, AlertTriangle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';

const SAMPLE = `sku,name,type,unit,barcode,costPrice,sellPrice,minStock,reorderPoint
SKU-001,حليب كامل الدسم 400 جم,POWDER_RETAIL,PCS,6291000000001,2.50,4.00,100,150
SKU-002,علبة كرتون 400 جم,PACKAGING,PCS,,0.15,,500,1000`;

// CSV parser بسيط لكن يدعم قيم ذات فاصلة داخل ""
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const parseLine = (l: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (inQuote && l[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (c === ',' && !inQuote) {
        out.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = (vals[j] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

export default function ImportPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [dryRun, setDryRun] = useState<any>(null);

  const rows = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);

  const preview = useMutation({
    mutationFn: (r: any[]) => api.post('/inventory/items/import', { rows: r, dryRun: true }).then((r) => r.data),
    onSuccess: (res) => { setDryRun(res); toast.success('تم التحقق — راجع النتائج قبل التنفيذ'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّرت المعاينة'),
  });

  const commit = useMutation({
    mutationFn: (r: any[]) => api.post('/inventory/items/import', { rows: r, dryRun: false }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(`تم — ${res.created} جديد + ${res.updated} تحديث${res.skipped ? ` (${res.skipped} متجاوز)` : ''}`);
      qc.invalidateQueries({ queryKey: ['inv-items-paginated'] });
      qc.invalidateQueries({ queryKey: ['inv-dashboard'] });
      setText(''); setDryRun(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الاستيراد'),
  });

  const handleFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setText(String(e.target?.result ?? ''));
    reader.readAsText(f, 'utf-8');
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <button onClick={() => router.push('/inventory')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للمخزون
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">استيراد الأصناف من Excel/CSV</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                الصق البيانات أو ارفع ملف CSV — يتم upsert بالـ SKU (جديد أو تحديث).
              </p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> البيانات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 cursor-pointer hover:bg-zinc-50 text-sm">
                <Upload className="h-4 w-4" /> رفع ملف CSV
                <input type="file" accept=".csv,.tsv,text/csv" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
              <button type="button" onClick={() => setText(SAMPLE)} className="text-xs text-blue-600 underline">
                إدراج مثال جاهز
              </button>
              <button type="button" onClick={() => { setText(''); setDryRun(null); }} className="text-xs text-zinc-500 underline">
                مسح
              </button>
              <div className="text-xs text-zinc-500">
                الحقول المدعومة: <b>sku, name, type</b> (مطلوبة) + unit, barcode, costPrice, sellPrice, reorderLevel, minStock, maxStock, reorderPoint, safetyStock, leadTimeDays
              </div>
            </div>

            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setDryRun(null); }}
              placeholder={`sku,name,type,unit,barcode,costPrice,sellPrice,minStock\nSKU-001,حليب كامل 400 جم,POWDER_RETAIL,PCS,6291000000001,2.5,4.0,100`}
              className="w-full h-64 p-3 rounded-lg border border-zinc-200 text-xs font-mono resize-y"
              dir="ltr"
            />

            <div className="text-xs text-zinc-500">
              {rows.length > 0 && (
                <>سيتم استيراد <b>{rows.length}</b> صف</>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={rows.length === 0} loading={preview.isPending} onClick={() => preview.mutate(rows)}>
                معاينة (Dry-run)
              </Button>
              <Button disabled={rows.length === 0} loading={commit.isPending}
                onClick={() => { if (confirm(`تنفيذ الاستيراد الفعلي لـ ${rows.length} صف؟`)) commit.mutate(rows); }}>
                تنفيذ الاستيراد
              </Button>
            </div>
          </CardContent>
        </Card>

        {dryRun && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" /> نتيجة المعاينة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase">أصناف جديدة</div>
                  <div className="text-2xl font-black text-emerald-700 mt-1" data-numeric>{dryRun.created}</div>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
                  <div className="text-[10px] font-bold text-blue-700 uppercase">تحديث</div>
                  <div className="text-2xl font-black text-blue-700 mt-1" data-numeric>{dryRun.updated}</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                  <div className="text-[10px] font-bold text-amber-700 uppercase">متجاوز</div>
                  <div className="text-2xl font-black text-amber-700 mt-1" data-numeric>{dryRun.skipped}</div>
                </div>
              </div>

              {dryRun.errors && dryRun.errors.length > 0 && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-100 p-3">
                  <div className="flex items-center gap-2 mb-2 text-red-800 text-sm font-bold">
                    <AlertTriangle className="h-4 w-4" /> أخطاء ({dryRun.errors.length})
                  </div>
                  <div className="space-y-1 text-xs max-h-64 overflow-y-auto">
                    {dryRun.errors.map((e: any, i: number) => (
                      <div key={i} className="flex justify-between border-b border-red-100 pb-1">
                        <span className="font-mono">صف {e.row} · {e.sku}</span>
                        <span className="text-red-700">{e.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="bg-blue-50 border-blue-100">
          <CardContent className="text-xs text-blue-900 leading-relaxed">
            <div className="font-bold mb-1">📌 ملاحظات:</div>
            <ul className="list-disc pr-4 space-y-1">
              <li>الـ SKU هو المفتاح — إن وُجد صنف بنفس SKU يتم <b>تحديثه</b>، وإلا يُنشأ صنف جديد.</li>
              <li>قيم النوع المسموحة: <code>POWDER_BULK</code>, <code>PACKAGING</code>, <code>POWDER_RETAIL</code>, <code>CONSUMABLE</code>.</li>
              <li>الحقول العددية الفارغة تصبح <code>null</code>.</li>
              <li>ملف CSV يجب أن يستخدم فاصلة (,) — لا يدعم الحالي فاصلة منقوطة (;).</li>
              <li>من Excel: File → Save As → CSV (UTF-8) لضمان دعم العربية.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
