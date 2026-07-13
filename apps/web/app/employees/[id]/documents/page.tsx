'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, ArrowRight, Upload, Trash2, Printer,
  ShieldAlert, FileSignature, ScrollText, LogOut, X, Eye, Download,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const DOC_TYPES = [
  { value: 'WARNING',    label: 'تنبيه خطي',       Icon: ShieldAlert,   color: 'red' },
  { value: 'CONTRACT',   label: 'عقد عمل غير محدد المدة', Icon: FileSignature, color: 'blue' },
  { value: 'DECLARATION',label: 'إقرار',            Icon: ScrollText,    color: 'amber' },
  { value: 'RESIGNATION',label: 'تقديم استقالة',    Icon: LogOut,        color: 'zinc' },
  { value: 'OTHER',      label: 'ملف آخر',          Icon: FileText,      color: 'zinc' },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((t) => [t.value, t.label]),
);

export default function EmployeeDocumentsPage() {
  const router = useRouter();
  const params = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const id = params.id as string;
  const [showAdd, setShowAdd] = useState<string | null>(null); // docType or null

  const { data: employee } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: docs } = useQuery({
    queryKey: ['employee-docs', id],
    queryFn: () => api.get(`/employees/${id}/documents`).then((r) => r.data),
    enabled: !!id,
  });

  const del = useMutation({
    mutationFn: (docId: string) => api.delete(`/employees/documents/${docId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم حذف الوثيقة');
      qc.invalidateQueries({ queryKey: ['employee-docs', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحذف'),
  });

  const view = async (docId: string) => {
    try {
      const doc = await api.get(`/employees/documents/${docId}`).then((r) => r.data);
      if (doc.fileData && doc.mimeType) {
        // افتح في تبويب جديد
        const win = window.open('', '_blank');
        if (!win) return toast.error('اسمح بفتح النوافذ المنبثقة');
        if (doc.mimeType.startsWith('image/')) {
          win.document.write(`<img src="${doc.fileData}" style="max-width:100%;height:auto">`);
        } else if (doc.mimeType === 'application/pdf') {
          win.document.write(`<iframe src="${doc.fileData}" style="width:100%;height:100vh;border:none"></iframe>`);
        } else {
          // نزّل
          const a = win.document.createElement('a');
          a.href = doc.fileData;
          a.download = doc.fileName || 'document';
          a.click();
        }
      } else if (doc.fileUrl) {
        window.open(doc.fileUrl, '_blank');
      } else {
        toast.error('لا يوجد ملف مرفق');
      }
    } catch (e: any) {
      toast.error('تعذّر الفتح');
    }
  };

  if (!employee) return <AppShell><div className="p-8 text-center text-zinc-500">جاري التحميل...</div></AppShell>;

  // جمّع الوثائق حسب النوع
  const byType: Record<string, any[]> = { WARNING: [], CONTRACT: [], DECLARATION: [], RESIGNATION: [], OTHER: [] };
  for (const d of docs ?? []) {
    (byType[d.docType] || byType.OTHER).push(d);
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <header>
          <button onClick={() => router.push('/employees')} className="text-sm text-zinc-500 mb-2 flex items-center gap-1 hover:text-zinc-900">
            <ArrowRight className="h-4 w-4 rotate-180" /> العودة للموظفين
          </button>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight">وثائق {employee.fullName}</h1>
                <p className="text-sm text-zinc-500 mt-0.5 font-mono">{employee.code}</p>
              </div>
            </div>
          </div>
        </header>

        {/* قوالب جاهزة */}
        <Card>
          <CardHeader>
            <CardTitle>القوالب الجاهزة (طباعة مباشرة)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {DOC_TYPES.filter((t) => t.value !== 'OTHER').map((t) => {
                const Ic = t.Icon;
                return (
                  <a
                    key={t.value}
                    href={`/employees/${id}/documents/template/${t.value}`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-xl border border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 p-4 flex flex-col items-center gap-2 text-center transition-colors"
                  >
                    <Ic className={`h-6 w-6 text-${t.color}-600`} />
                    <div className="font-bold text-sm">{t.label}</div>
                    <div className="text-[10px] text-zinc-500 inline-flex items-center gap-1">
                      <Printer className="h-3 w-3" /> فتح للطباعة
                    </div>
                  </a>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* لكل نوع — قائمة الوثائق + رفع */}
        {DOC_TYPES.map((t) => {
          const Ic = t.Icon;
          const list = byType[t.value] || [];
          return (
            <Card key={t.value}>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Ic className={`h-4 w-4 text-${t.color}-600`} /> {t.label}
                    <Badge variant="default">{list.length}</Badge>
                  </CardTitle>
                  <Button size="sm" onClick={() => setShowAdd(t.value)}>
                    <Upload className="h-3 w-3" /> رفع ملف
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {list.length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-4">لا توجد وثائق</p>
                ) : (
                  <div className="space-y-2">
                    {list.map((d: any) => (
                      <div key={d.id} className="flex items-center justify-between p-2 rounded border border-zinc-100 hover:bg-zinc-50">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{d.title}</div>
                          <div className="text-[11px] text-zinc-500">
                            {d.fileName ?? d.fileUrl ?? '—'} · {formatDate(d.createdAt)}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => view(d.id)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold inline-flex items-center gap-1" title="عرض">
                            <Eye className="h-3 w-3" />
                          </button>
                          <button onClick={() => view(d.id)} className="text-xs px-2 py-1 rounded bg-zinc-100 text-zinc-700 hover:bg-zinc-200 font-bold inline-flex items-center gap-1" title="تنزيل">
                            <Download className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => { if (confirm('حذف هذه الوثيقة؟')) del.mutate(d.id); }}
                            className="text-red-500 hover:text-red-700 p-1"
                            title="حذف"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {showAdd && (
          <UploadDocModal
            employeeId={id}
            docType={showAdd}
            onClose={() => setShowAdd(null)}
            onSaved={() => {
              toast.success('تم رفع الوثيقة');
              setShowAdd(null);
              qc.invalidateQueries({ queryKey: ['employee-docs', id] });
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function UploadDocModal({
  employeeId, docType, onClose, onSaved,
}: {
  employeeId: string; docType: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(TYPE_LABEL[docType] ?? '');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [externalUrl, setExternalUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!title.trim()) return toast.error('العنوان مطلوب');
    if (!file && !externalUrl.trim()) return toast.error('اختر ملفاً أو أدخل رابطاً');

    setSaving(true);
    try {
      let payload: any = {
        docType, title: title.trim(),
        description: description.trim() || undefined,
      };
      if (file) {
        // تحقّق من الحجم — 3 ميغا حد أعلى للتخزين في DB
        if (file.size > 3 * 1024 * 1024) {
          toast.error('الحد الأقصى 3MB. استخدم رابطاً خارجياً للملفات الأكبر.');
          setSaving(false);
          return;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        payload = {
          ...payload,
          fileName: file.name,
          mimeType: file.type,
          fileData: dataUrl,
        };
      } else {
        payload = { ...payload, fileUrl: externalUrl.trim() };
      }
      await api.post(`/employees/${employeeId}/documents`, payload);
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'تعذّر الرفع');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-zinc-100">
          <h3 className="font-bold">رفع {TYPE_LABEL[docType] ?? 'وثيقة'}</h3>
          <button onClick={onClose}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <Input label="العنوان *" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <div>
            <label className="text-xs font-bold text-zinc-700 block mb-1">ملف (اختياري — حتى 3MB)</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm" />
          </div>
          <Input label="أو رابط خارجي" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://..." />
          <Input label="وصف" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving} disabled={saving}>حفظ</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
