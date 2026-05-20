'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, FileBadge2, AlertTriangle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Stat, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export default function LicensesPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: licenses } = useQuery({
    queryKey: ['licenses'],
    queryFn: () => api.get('/licenses').then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['licenses', 'stats'],
    queryFn: () => api.get('/licenses/stats').then((r) => r.data),
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">الرخص</h1>
            <p className="text-sm text-zinc-500 mt-0.5">{licenses?.length ?? 0} رخصة</p>
          </div>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            رخصة جديدة
          </Button>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="الإجمالي" value={stats?.total ?? 0} />
          <Stat label="سارية" value={stats?.valid ?? 0} state="good" />
          <Stat
            label="قاربت على الانتهاء"
            value={stats?.expiring ?? 0}
            state={(stats?.expiring ?? 0) > 0 ? 'warning' : 'good'}
          />
          <Stat
            label="منتهية"
            value={stats?.expired ?? 0}
            state={(stats?.expired ?? 0) > 0 ? 'danger' : 'good'}
          />
        </section>

        {showNew && (
          <NewLicenseForm
            onClose={() => setShowNew(false)}
            onSaved={() => qc.invalidateQueries({ queryKey: ['licenses'] })}
          />
        )}

        <Card>
          <CardContent className="p-0">
            {!licenses || licenses.length === 0 ? (
              <p className="p-12 text-center text-zinc-500">لا توجد رخص</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        النوع
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الرقم
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        تاريخ الإصدار
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        تاريخ الانتهاء
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        المتبقي
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الحالة
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {licenses.map((l: any) => (
                      <tr key={l.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="p-3 font-medium">
                          <span className="flex items-center gap-2">
                            <FileBadge2 className="h-4 w-4 text-zinc-400" />
                            {l.type}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-xs">{l.number}</td>
                        <td className="p-3 text-zinc-600">{formatDate(l.issueDate)}</td>
                        <td className="p-3 text-zinc-600">{formatDate(l.expiryDate)}</td>
                        <td
                          className={`p-3 font-bold ${
                            l.daysRemaining < 0
                              ? 'text-red-600'
                              : l.daysRemaining <= 30
                              ? 'text-amber-600'
                              : 'text-zinc-700'
                          }`}
                          data-numeric
                        >
                          {l.daysRemaining < 0 ? `منتهية (${-l.daysRemaining}ي)` : `${l.daysRemaining} يوم`}
                        </td>
                        <td className="p-3">
                          {l.status === 'EXPIRED' ? (
                            <Badge variant="danger" dot>
                              منتهية
                            </Badge>
                          ) : l.status === 'EXPIRING_SOON' ? (
                            <Badge variant="warning" dot>
                              قاربت
                            </Badge>
                          ) : (
                            <Badge variant="success" dot>
                              سارية
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function NewLicenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    type: '',
    number: '',
    issueDate: '',
    expiryDate: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/licenses', form);
      onSaved();
      onClose();
    } catch {
      alert('فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>رخصة جديدة</CardTitle>
          <button onClick={onClose}>
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="النوع *"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            placeholder="مثل: السجل التجاري"
            required
          />
          <Input
            label="الرقم *"
            value={form.number}
            onChange={(e) => setForm({ ...form, number: e.target.value })}
            required
          />
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="تاريخ الإصدار *"
              type="date"
              value={form.issueDate}
              onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
              required
            />
            <Input
              label="تاريخ الانتهاء *"
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
              required
            />
          </div>
          <Input
            label="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
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
