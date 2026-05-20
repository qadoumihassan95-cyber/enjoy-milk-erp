'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Phone, Mail, X } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function CustomersPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers').then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['customers', 'stats'],
    queryFn: () => api.get('/customers/stats').then((r) => r.data),
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">العملاء</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {customers?.length ?? 0} عميل
            </p>
          </div>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            عميل جديد
          </Button>
        </header>

        {showNew && <NewCustomerForm onClose={() => setShowNew(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['customers'] })} />}

        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-zinc-500">جاري التحميل...</div>
          ) : !customers || customers.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">لا يوجد عملاء</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الكود
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الاسم
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      النوع
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الهاتف
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      حد الائتمان
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      المتبقي
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c: any) => {
                    const stat = stats?.find((s: any) => s.customer.id === c.id);
                    const outstanding = stat?.outstanding ?? 0;
                    return (
                      <tr key={c.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="p-3 font-mono text-xs">{c.code}</td>
                        <td className="p-3 font-medium">{c.name}</td>
                        <td className="p-3">
                          <Badge>{translateCustomerType(c.type)}</Badge>
                        </td>
                        <td className="p-3 text-zinc-600">{c.phone || '-'}</td>
                        <td className="p-3" data-numeric>
                          {formatNumber(+c.creditLimit, 2)} د.أ
                        </td>
                        <td
                          className={`p-3 font-bold ${
                            outstanding > 0 ? 'text-amber-600' : 'text-zinc-500'
                          }`}
                          data-numeric
                        >
                          {formatNumber(outstanding, 2)} د.أ
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function translateCustomerType(type: string): string {
  const map: Record<string, string> = {
    RETAIL: 'تجزئة',
    WHOLESALE: 'جملة',
    DISTRIBUTOR: 'موزع',
    INSTITUTION: 'مؤسسة',
  };
  return map[type] ?? type;
}

function NewCustomerForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: '',
    type: 'RETAIL',
    phone: '',
    email: '',
    address: '',
    creditLimit: '',
    paymentTerms: '0',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/customers', {
        ...form,
        creditLimit: +form.creditLimit || 0,
        paymentTerms: +form.paymentTerms || 0,
      });
      onSaved();
      onClose();
    } catch (e) {
      alert('فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>عميل جديد</CardTitle>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="الاسم *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 block">النوع</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-lg border border-zinc-200 bg-white h-10 px-3 text-sm"
              >
                <option value="RETAIL">تجزئة</option>
                <option value="WHOLESALE">جملة</option>
                <option value="DISTRIBUTOR">موزع</option>
                <option value="INSTITUTION">مؤسسة</option>
              </select>
            </div>
            <Input
              label="الهاتف"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <Input
            label="البريد"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label="العنوان"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="حد الائتمان (د.أ)"
              type="number"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            />
            <Input
              label="مهلة السداد (يوم)"
              type="number"
              value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={saving}>
              حفظ
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
