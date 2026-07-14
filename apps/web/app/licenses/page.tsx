'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, FileBadge2, Pencil, Trash2, Paperclip, Upload } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Stat, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/**
 * صفحة الرخص — الآن تدعم:
 *  - إضافة رخصة جديدة
 *  - تعديل رخصة موجودة (نفس النموذج، يُحمّل البيانات تلقائياً)
 *  - حذف مع تأكيد
 *  - تحديث فوري لبطاقات الملخص (إجمالي/سارية/قاربت/منتهية)
 *  - حساب المتبقي والحالة تلقائياً من الـ backend عند تغيير expiryDate
 *  - Validation: تاريخ الانتهاء ≥ تاريخ الإصدار + منع الرقم المكرر
 *  - تأكيد قبل مغادرة النموذج عند وجود تغييرات غير محفوظة
 */
export default function LicensesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState<'new' | 'edit' | null>(null);
  const [editing, setEditing] = useState<any>(null);

  const { data: licenses } = useQuery({
    queryKey: ['licenses'],
    queryFn: () => api.get('/licenses').then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['licenses', 'stats'],
    queryFn: () => api.get('/licenses/stats').then((r) => r.data),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['licenses'] });
    qc.invalidateQueries({ queryKey: ['licenses', 'stats'] });
    // بطاقة الرخص في الداشبورد تعتمد على executive summary
    qc.invalidateQueries({ queryKey: ['dashboard', 'executive'] });
  };

  const removeLicense = async (l: any) => {
    if (!confirm(`حذف الرخصة "${l.type} — ${l.number}"؟`)) return;
    try {
      await api.delete(`/licenses/${l.id}`);
      toast.success('تم حذف الرخصة');
      invalidateAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'تعذّر الحذف');
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">الرخص</h1>
            <p className="text-sm text-zinc-500 mt-0.5">{licenses?.length ?? 0} رخصة</p>
          </div>
          <Button onClick={() => { setEditing(null); setShowForm('new'); }}>
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

        {showForm && (
          <LicenseForm
            editing={editing}
            onClose={() => { setShowForm(null); setEditing(null); }}
            onSaved={() => { invalidateAll(); setShowForm(null); setEditing(null); }}
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
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">النوع</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">الرقم</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">الجهة المصدرة</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">تاريخ الإصدار</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">تاريخ الانتهاء</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">المتبقي</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">الحالة</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">المرفق</th>
                      <th className="text-right p-3 text-[10px] font-bold uppercase whitespace-nowrap">إجراء</th>
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
                        <td className="p-3 text-zinc-600 text-xs">{l.issuingAuthority || '—'}</td>
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
                            <Badge variant="danger" dot>منتهية</Badge>
                          ) : l.status === 'EXPIRING_SOON' ? (
                            <Badge variant="warning" dot>قاربت</Badge>
                          ) : (
                            <Badge variant="success" dot>سارية</Badge>
                          )}
                        </td>
                        <td className="p-3">
                          {l.attachmentUrl ? (
                            <a
                              href={l.attachmentUrl}
                              target="_blank"
                              rel="noopener"
                              className="text-xs px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 inline-flex items-center gap-1"
                              title={l.attachmentName ?? 'فتح المرفق'}
                            >
                              <Paperclip className="h-3 w-3" /> فتح
                            </a>
                          ) : (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex gap-1">
                            <button
                              onClick={() => { setEditing(l); setShowForm('edit'); }}
                              className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold inline-flex items-center gap-1"
                              title="تعديل الرخصة"
                            >
                              <Pencil className="h-3 w-3" /> تعديل
                            </button>
                            <button
                              onClick={() => removeLicense(l)}
                              className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50"
                              title="حذف"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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

/* ═════════════════════════════════════════════
   License Form — تستخدم للإنشاء والتعديل معاً
   (نفس النموذج بشكل مطابق كما طلب المستخدم)
════════════════════════════════════════════ */
function LicenseForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!editing;
  const [form, setForm] = useState({
    type: editing?.type ?? '',
    number: editing?.number ?? '',
    issuingAuthority: editing?.issuingAuthority ?? '',
    issueDate: editing?.issueDate ? String(editing.issueDate).slice(0, 10) : '',
    expiryDate: editing?.expiryDate ? String(editing.expiryDate).slice(0, 10) : '',
    renewalReminderDays: editing?.renewalReminderDays ? String(editing.renewalReminderDays) : '30',
    status: editing?.status ?? 'VALID',
    notes: editing?.notes ?? '',
    attachmentUrl: editing?.attachmentUrl ?? '',
    attachmentName: editing?.attachmentName ?? '',
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  // احتساب فوري للمتبقي والحالة (تحديث بصري قبل الحفظ)
  const preview = (() => {
    if (!form.expiryDate) return null;
    const days = Math.ceil((new Date(form.expiryDate).getTime() - Date.now()) / 86400000);
    const reminder = Number(form.renewalReminderDays || 30);
    const status = days < 0 ? 'EXPIRED' : days <= reminder ? 'EXPIRING_SOON' : 'VALID';
    return { days, status };
  })();

  // تأكيد قبل مغادرة الصفحة عند وجود تغييرات
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleClose = () => {
    if (dirty && !confirm('لديك تغييرات غير محفوظة. مغادرة النموذج؟')) return;
    onClose();
  };

  // رفع ملف مرفق كـ data URL (حتى 3MB)
  const handleFile = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) {
      toast.error('الحد الأقصى للمرفق 3 ميغا');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    setForm((p) => ({ ...p, attachmentUrl: dataUrl, attachmentName: file.name }));
    setDirty(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation جانب العميل (الـ backend يتحقق ثانية)
    if (!form.type.trim()) return setError('نوع الرخصة مطلوب');
    if (!form.number.trim()) return setError('رقم الرخصة مطلوب');
    if (!form.issueDate) return setError('تاريخ الإصدار مطلوب');
    if (!form.expiryDate) return setError('تاريخ الانتهاء مطلوب');
    if (new Date(form.expiryDate).getTime() < new Date(form.issueDate).getTime()) {
      return setError('تاريخ الانتهاء لا يمكن أن يسبق تاريخ الإصدار');
    }

    setSaving(true);
    const payload = {
      type: form.type.trim(),
      number: form.number.trim(),
      issuingAuthority: form.issuingAuthority.trim() || null,
      issueDate: form.issueDate,
      expiryDate: form.expiryDate,
      renewalReminderDays: form.renewalReminderDays ? Number(form.renewalReminderDays) : null,
      notes: form.notes.trim() || null,
      attachmentUrl: form.attachmentUrl || null,
      attachmentName: form.attachmentName || null,
    };
    try {
      if (isEdit) {
        await api.patch(`/licenses/${editing.id}`, payload);
        toast.success('تم تعديل الرخصة');
      } else {
        await api.post('/licenses', payload);
        toast.success('تم إضافة الرخصة');
      }
      setDirty(false);
      onSaved();
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'تعذّر الحفظ';
      setError(Array.isArray(msg) ? msg.join(' · ') : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{isEdit ? `تعديل الرخصة: ${editing?.type}` : 'رخصة جديدة'}</CardTitle>
          <button onClick={handleClose}>
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Input
              label="النوع *"
              value={form.type}
              onChange={(e) => setF('type', e.target.value)}
              placeholder="مثل: السجل التجاري"
              required
            />
            <Input
              label="الرقم *"
              value={form.number}
              onChange={(e) => setF('number', e.target.value)}
              required
            />
          </div>

          <Input
            label="الجهة المصدرة"
            value={form.issuingAuthority}
            onChange={(e) => setF('issuingAuthority', e.target.value)}
            placeholder="مثل: وزارة الصناعة"
          />

          <div className="grid md:grid-cols-3 gap-4">
            <Input
              label="تاريخ الإصدار *"
              type="date"
              value={form.issueDate}
              onChange={(e) => setF('issueDate', e.target.value)}
              required
            />
            <Input
              label="تاريخ الانتهاء *"
              type="date"
              value={form.expiryDate}
              onChange={(e) => setF('expiryDate', e.target.value)}
              required
            />
            <Input
              label="أيام التذكير قبل الانتهاء"
              type="number"
              min={0}
              value={form.renewalReminderDays}
              onChange={(e) => setF('renewalReminderDays', e.target.value)}
              hint="افتراضي 30 يوماً"
            />
          </div>

          {preview && (
            <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3 text-sm flex items-center gap-3">
              <span className="text-zinc-500">معاينة:</span>
              <span className="font-bold">
                {preview.days < 0 ? `منتهية منذ ${-preview.days} يوم` : `${preview.days} يوم متبقٍ`}
              </span>
              {preview.status === 'EXPIRED' ? (
                <Badge variant="danger" dot>منتهية</Badge>
              ) : preview.status === 'EXPIRING_SOON' ? (
                <Badge variant="warning" dot>قاربت</Badge>
              ) : (
                <Badge variant="success" dot>سارية</Badge>
              )}
            </div>
          )}

          <Input
            label="ملاحظات"
            value={form.notes}
            onChange={(e) => setF('notes', e.target.value)}
          />

          {/* المرفق */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700">
              مرفق (اختياري — حتى 3 ميغا)
            </label>
            <div className="flex items-center gap-2">
              <label className="flex-1 inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-zinc-200 bg-white cursor-pointer hover:bg-zinc-50 text-sm">
                <Upload className="h-4 w-4 text-zinc-400" />
                <span className="text-zinc-600 truncate">
                  {form.attachmentName || (isEdit && editing?.attachmentName ? editing.attachmentName : 'اختر ملفاً…')}
                </span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </label>
              {form.attachmentUrl && (
                <button
                  type="button"
                  onClick={() => { setForm((p) => ({ ...p, attachmentUrl: '', attachmentName: '' })); setDirty(true); }}
                  className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50"
                >
                  إزالة المرفق
                </button>
              )}
              {form.attachmentUrl && (
                <a
                  href={form.attachmentUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-xs px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200"
                >
                  معاينة
                </a>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={handleClose}>
              إلغاء
            </Button>
            <Button type="submit" loading={saving} disabled={saving}>
              {isEdit ? 'حفظ التعديلات' : 'حفظ'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
