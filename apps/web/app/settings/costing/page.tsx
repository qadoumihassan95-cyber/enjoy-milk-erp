'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Settings, Info } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';

/**
 * Inventory Costing Method — الأسلوب الحسابي للمخزون
 *
 * افتراضي: FIFO. مصمَّم مستقبلياً لدعم Weighted Average و LIFO،
 * لكن FIFO هو الوحيد المفعّل حالياً.
 */
export default function CostingSettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['fifo', 'settings'],
    queryFn: () => api.get('/fifo/settings').then((r) => r.data),
  });

  const [method, setMethod] = useState('FIFO');
  const [currency, setCurrency] = useState('JOD');

  useEffect(() => {
    if (settings) {
      setMethod(settings.costingMethod ?? 'FIFO');
      setCurrency(settings.costingCurrency ?? 'JOD');
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      api.post('/fifo/settings', { costingMethod: method, costingCurrency: currency }).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم حفظ الإعدادات');
      qc.invalidateQueries({ queryKey: ['fifo', 'settings'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحفظ'),
  });

  const AVAILABLE = [
    { value: 'FIFO', label: 'FIFO — الوارد أولاً يُصرَف أولاً', enabled: true, hint: 'الافتراضي' },
    { value: 'AVG',  label: 'Weighted Average — المتوسط المرجّح', enabled: false, hint: 'قريباً' },
    { value: 'LIFO', label: 'LIFO — الوارد أخيراً يُصرَف أولاً', enabled: false, hint: 'قريباً' },
  ];

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header>
          <button onClick={() => router.push('/dashboard')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> رجوع للداشبورد
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">إعدادات المخزون</h1>
              <p className="text-sm text-zinc-500 mt-0.5">Inventory Costing Method</p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>الأسلوب الحسابي المُطبَّق</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900 flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                عند كل عملية بيع، يقوم النظام تلقائياً بحساب تكلفة البضاعة المباعة (COGS)
                باستهلاك أقدم دفعات الشراء أولاً، ويحفظ التوزيع بشكل دائم.
                الأرباح السابقة لن تتغيّر عند إضافة مشتريات جديدة.
              </div>
            </div>

            <div className="space-y-2">
              {AVAILABLE.map((m) => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    method === m.value
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : m.enabled
                        ? 'bg-white text-zinc-900 border-zinc-200 hover:border-zinc-400'
                        : 'bg-zinc-50 text-zinc-400 border-zinc-100 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="radio"
                    name="method"
                    value={m.value}
                    checked={method === m.value}
                    disabled={!m.enabled}
                    onChange={(e) => setMethod(e.target.value)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-bold flex items-center gap-2">
                      {m.label}
                      {!m.enabled && <Badge variant="default">{m.hint}</Badge>}
                      {m.enabled && method === m.value && <Badge variant="success">مفعّل</Badge>}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700">العملة الحسابية</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              >
                <option value="JOD">دينار أردني (JOD)</option>
                <option value="USD">دولار أمريكي (USD)</option>
                <option value="EUR">يورو (EUR)</option>
              </select>
            </div>

            <div className="flex justify-end">
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                حفظ الإعدادات
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
