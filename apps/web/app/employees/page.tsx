'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, X, UserCheck } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Stat, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees').then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['employees', 'stats'],
    queryFn: () => api.get('/employees/stats').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const checkIn = useMutation({
    mutationFn: (id: string) => api.post(`/employees/${id}/check-in`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employees', 'stats'] });
    },
  });

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">الموظفون</h1>
            <p className="text-sm text-zinc-500 mt-0.5">{employees?.length ?? 0} موظف</p>
          </div>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            موظف جديد
          </Button>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="إجمالي الموظفين" value={stats?.total ?? 0} />
          <Stat label="حضور اليوم" value={stats?.present ?? 0} state="good" />
          <Stat label="تأخير" value={stats?.late ?? 0} state={(stats?.late ?? 0) > 0 ? 'warning' : 'good'} />
          <Stat label="غياب" value={stats?.absent ?? 0} state={(stats?.absent ?? 0) > 0 ? 'warning' : 'good'} />
        </section>

        {showNew && (
          <NewEmployeeForm onClose={() => setShowNew(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['employees'] })} />
        )}

        <Card>
          <CardHeader>
            <CardTitle>قائمة الموظفين</CardTitle>
          </CardHeader>
          <CardContent>
            {!employees || employees.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-4">لا يوجد موظفون</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-b">
                    <tr>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الكود
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الاسم
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        القسم
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        المنصب
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        الراتب
                      </th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase">
                        إجراء
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e: any) => (
                      <tr key={e.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="p-3 font-mono text-xs">{e.code}</td>
                        <td className="p-3 font-medium">{e.fullName}</td>
                        <td className="p-3 text-zinc-600">{e.department || '-'}</td>
                        <td className="p-3 text-zinc-600">{e.position || '-'}</td>
                        <td className="p-3" data-numeric>
                          {e.baseSalary ? `${formatNumber(+e.baseSalary, 0)} د.أ` : '-'}
                        </td>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => checkIn.mutate(e.id)}
                            loading={checkIn.isPending && checkIn.variables === e.id}
                          >
                            <UserCheck className="h-3 w-3" />
                            حضور
                          </Button>
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

function NewEmployeeForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fullName: '',
    nationalId: '',
    phone: '',
    department: '',
    position: '',
    baseSalary: '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/employees', {
        ...form,
        baseSalary: +form.baseSalary || undefined,
      });
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
          <CardTitle>موظف جديد</CardTitle>
          <button onClick={onClose}>
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="الاسم الكامل *"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
          />
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="رقم الهوية"
              value={form.nationalId}
              onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
            />
            <Input
              label="الهاتف"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="القسم"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
            <Input
              label="المنصب"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
          <Input
            label="الراتب الأساسي (د.أ)"
            type="number"
            value={form.baseSalary}
            onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
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
