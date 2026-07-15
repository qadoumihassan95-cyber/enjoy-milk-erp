'use client';

import { useState } from 'react';
import { Settings as SettingsIcon, Lock, User, Check, AlertCircle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Button, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'المالك',
  ADMIN: 'مدير النظام',
  MANAGER: 'مدير',
  ACCOUNTANT: 'محاسب',
  WAREHOUSE: 'أمين مستودع',
  OPERATOR: 'مشغّل',
  HR: 'موارد بشرية',
};

export default function SettingsPage() {
  const { user } = useAuthStore();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (form.newPassword !== form.confirm) {
      setMsg({ type: 'err', text: 'كلمتا المرور غير متطابقتين' });
      return;
    }
    if (form.newPassword.length < 6) {
      setMsg({ type: 'err', text: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setMsg({ type: 'ok', text: 'تم تغيير كلمة المرور بنجاح' });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err: any) {
      setMsg({
        type: 'err',
        text: err?.response?.data?.message || 'تعذّر تغيير كلمة المرور',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
            <SettingsIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">الإعدادات</h1>
            <p className="text-sm text-zinc-500 mt-0.5">الملف الشخصي والأمان</p>
          </div>
        </header>

        {/* Profile */}
        <Card className="p-5">
          <h3 className="font-black text-lg mb-4 flex items-center gap-2">
            <User className="h-4 w-4" /> الملف الشخصي
          </h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase">الاسم</label>
              <div className="font-medium mt-1">{user?.fullName ?? '—'}</div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase">البريد</label>
              <div className="font-medium mt-1 font-mono text-sm">{user?.email ?? '—'}</div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase">الدور</label>
              <div className="mt-1">
                <span className="inline-block px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-700 text-xs font-bold">
                  {ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Change Password */}
        <Card className="p-5">
          <h3 className="font-black text-lg mb-4 flex items-center gap-2">
            <Lock className="h-4 w-4" /> تغيير كلمة المرور
          </h3>
          <form onSubmit={submit} className="space-y-4 max-w-md">
            <Input
              label="كلمة المرور الحالية"
              type="password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required
            />
            <Input
              label="كلمة المرور الجديدة"
              type="password"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              required
            />
            <Input
              label="تأكيد كلمة المرور الجديدة"
              type="password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              required
            />

            {msg && (
              <div
                className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  msg.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {msg.type === 'ok' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                {msg.text}
              </div>
            )}

            <Button type="submit" loading={saving}>
              <Lock className="h-4 w-4" /> تحديث كلمة المرور
            </Button>
            <p className="text-[11px] text-zinc-400">
              بعد التغيير سيتم تسجيل خروجك من الأجهزة الأخرى تلقائياً.
            </p>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
