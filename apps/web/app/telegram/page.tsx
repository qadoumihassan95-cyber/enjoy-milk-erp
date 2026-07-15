'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send,
  Plus,
  X,
  Search,
  RefreshCw,
  Power,
  PlugZap,
  Trash2,
  Pencil,
  CheckCircle2,
  AlertCircle,
  Clock,
  ScrollText,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Stat, Badge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const ROLES = [
  { value: 'ADMIN', label: 'مدير عام (كل الصلاحيات)' },
  { value: 'MANAGER', label: 'مدير (مالية + موظفين + إنتاج)' },
  { value: 'EMPLOYEE', label: 'موظف (دوام + إنتاج + تقارير)' },
  { value: 'VIEWER', label: 'مشاهد (تقارير فقط)' },
];
const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'مدير عام',
  MANAGER: 'مدير',
  EMPLOYEE: 'موظف',
  VIEWER: 'مشاهد',
};
const ACCOUNT_TYPES = [
  { value: 'BOT', label: 'بوت' },
  { value: 'CHANNEL', label: 'قناة' },
  { value: 'GROUP', label: 'مجموعة' },
  { value: 'USER', label: 'مستخدم' },
];

function statusBadge(status: string) {
  switch (status) {
    case 'CONNECTED':
      return <Badge variant="success" dot>متصل</Badge>;
    case 'PENDING':
      return <Badge variant="warning" dot>قيد الانتظار</Badge>;
    case 'DISCONNECTED':
      return <Badge variant="danger" dot>غير متصل</Badge>;
    case 'DISABLED':
      return <Badge variant="default" dot>مُعطَّل</Badge>;
    case 'ERROR':
      return <Badge variant="danger" dot>خطأ</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
}

export default function TelegramPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['tg-accounts'],
    queryFn: () => api.get('/telegram/accounts').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['tg-accounts'] });
  const refreshLogs = () => qc.invalidateQueries({ queryKey: ['tg-logs'] });

  const action = useMutation({
    mutationFn: ({ id, op }: { id: string; op: string }) =>
      api.post(`/telegram/accounts/${id}/${op}`).then((r) => r.data),
    onSuccess: (res, vars) => {
      const msg =
        res?.description ||
        (vars.op === 'test' ? (res?.ok ? 'الاتصال ناجح' : 'فشل الاتصال')
          : vars.op === 'reconnect' ? 'تمت إعادة الربط'
          : vars.op === 'disable' ? 'تم التعطيل'
          : 'تم التفعيل');
      res?.ok === false ? toast.error(msg) : toast.success(msg);
      refresh();
      refreshLogs();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'فشلت العملية'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/telegram/accounts/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('تم حذف الحساب');
      refresh();
      refreshLogs();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'تعذّر الحذف'),
  });

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = search.trim().toLowerCase();
    return accounts.filter((a: any) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!q) return true;
      return [a.name, a.username, a.botUsername, a.chatId, ROLE_LABEL[a.role]]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [accounts, search, statusFilter]);

  const connected = (accounts ?? []).filter((a: any) => a.status === 'CONNECTED').length;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6 pb-24 md:pb-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">إدارة التليغرام</h1>
              <p className="text-sm text-zinc-500 mt-0.5">ربط متعدد للحسابات والبوتات — صلاحيات وحالة اتصال وسجلّ</p>
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> إضافة حساب / بوت
          </Button>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="إجمالي الحسابات" value={accounts?.length ?? 0} />
          <Stat label="متصل" value={connected} state="good" />
          <Stat label="غير متصل / خطأ" value={(accounts ?? []).filter((a: any) => ['DISCONNECTED', 'ERROR'].includes(a.status)).length} state={(accounts ?? []).some((a: any) => ['DISCONNECTED', 'ERROR'].includes(a.status)) ? 'warning' : 'good'} />
          <Stat label="مُعطَّل" value={(accounts ?? []).filter((a: any) => a.status === 'DISABLED').length} />
        </section>

        {(showForm || editing) && (
          <AccountForm
            account={editing}
            onClose={() => { setShowForm(false); setEditing(null); }}
            onSaved={() => { setShowForm(false); setEditing(null); refresh(); refreshLogs(); }}
          />
        )}

        {/* Search + filter */}
        <Card className="p-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث: اسم، username، chat id، صلاحية..."
              className="w-full h-10 pr-9 pl-3 rounded-lg border border-zinc-200 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5 text-sm flex-wrap">
            {[
              { v: 'all', l: 'الكل' },
              { v: 'CONNECTED', l: 'متصل' },
              { v: 'DISCONNECTED', l: 'غير متصل' },
              { v: 'DISABLED', l: 'مُعطَّل' },
              { v: 'ERROR', l: 'خطأ' },
            ].map((s) => (
              <button
                key={s.v}
                onClick={() => setStatusFilter(s.v)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold ${statusFilter === s.v ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}
              >
                {s.l}
              </button>
            ))}
          </div>
        </Card>

        {/* Accounts list */}
        {isLoading ? (
          <Card className="p-8 text-center text-zinc-500">جاري التحميل...</Card>
        ) : !accounts || accounts.length === 0 ? (
          <Card className="p-12 text-center">
            <Send className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
            <p className="text-zinc-500">لا توجد حسابات Telegram مرتبطة</p>
            <p className="text-xs text-zinc-400 mt-1">أضف بوتاً عبر التوكن الذي تحصل عليه من @BotFather</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center text-zinc-500">لا نتائج مطابقة</Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {filtered.map((a: any) => (
              <Card key={a.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold flex items-center gap-2 flex-wrap">
                      {a.name}
                      {statusBadge(a.status)}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {a.botUsername ? `@${a.botUsername}` : a.username ? `@${a.username}` : '—'}
                      {a.accountType ? ` · ${a.accountType}` : ''}
                    </div>
                  </div>
                  <Badge variant="info">{ROLE_LABEL[a.role] ?? a.role}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-zinc-600">
                  <div><span className="text-zinc-400">التوكن:</span> <span className="font-mono">{a.tokenMasked || '—'}</span></div>
                  <div><span className="text-zinc-400">Chat ID:</span> <span className="font-mono">{a.chatId || '—'}</span></div>
                  <div><span className="text-zinc-400">Webhook:</span> {a.webhookSet ? <span className="text-emerald-600 font-bold">مُسجَّل</span> : <span className="text-amber-600">غير مُسجَّل</span>}</div>
                  <div><span className="text-zinc-400">الهاتف:</span> {a.phone || '—'}</div>
                  <div className="flex items-center gap-1"><Clock className="h-3 w-3 text-zinc-400" /> آخر نشاط: {a.lastActivityAt ? formatDate(a.lastActivityAt) : '—'}</div>
                  <div className="flex items-center gap-1"><RefreshCw className="h-3 w-3 text-zinc-400" /> آخر مزامنة: {a.lastSyncAt ? formatDate(a.lastSyncAt) : '—'}</div>
                </div>

                {a.lastError && (
                  <div className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded p-2 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {a.lastError}
                  </div>
                )}
                {a.notes && <div className="text-[11px] text-zinc-500">📝 {a.notes}</div>}

                <div className="flex gap-1.5 flex-wrap pt-1 border-t border-zinc-100">
                  <Button size="sm" variant="outline" onClick={() => action.mutate({ id: a.id, op: 'test' })} loading={action.isPending && action.variables?.id === a.id && action.variables?.op === 'test'}>
                    <PlugZap className="h-3 w-3" /> اختبار
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => action.mutate({ id: a.id, op: 'reconnect' })} loading={action.isPending && action.variables?.id === a.id && action.variables?.op === 'reconnect'}>
                    <RefreshCw className="h-3 w-3" /> إعادة ربط
                  </Button>
                  {a.status === 'DISABLED' ? (
                    <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => action.mutate({ id: a.id, op: 'enable' })}>
                      <Power className="h-3 w-3" /> تفعيل
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="text-amber-700 border-amber-200 hover:bg-amber-50" onClick={() => action.mutate({ id: a.id, op: 'disable' })}>
                      <Power className="h-3 w-3" /> تعطيل
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => { setEditing(a); setShowForm(false); }}>
                    <Pencil className="h-3 w-3" /> تعديل
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => { if (confirm(`حذف الحساب «${a.name}»؟`)) del.mutate(a.id); }}>
                    <Trash2 className="h-3 w-3" /> حذف
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <LogsPanel accounts={accounts ?? []} />
      </div>
    </AppShell>
  );
}

function AccountForm({ account, onClose, onSaved }: { account: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = Boolean(account);
  const [form, setForm] = useState({
    name: account?.name ?? '',
    token: '',
    chatId: account?.chatId ?? '',
    username: account?.username ?? '',
    phone: account?.phone ?? '',
    accountType: account?.accountType ?? 'BOT',
    role: account?.role ?? 'VIEWER',
    notes: account?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('اسم الحساب مطلوب');
    if (!isEdit && !form.token.trim()) return toast.error('Bot Token مطلوب');
    setSaving(true);
    try {
      const body: any = {
        name: form.name,
        chatId: form.chatId || undefined,
        username: form.username || undefined,
        phone: form.phone || undefined,
        accountType: form.accountType,
        role: form.role,
        notes: form.notes || undefined,
      };
      if (form.token.trim()) body.token = form.token.trim();
      if (isEdit) {
        await api.patch(`/telegram/accounts/${account.id}`, body);
        toast.success('تم حفظ التعديلات');
      } else {
        await api.post('/telegram/accounts', body);
        toast.success('تمت إضافة الحساب وربطه');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{isEdit ? `تعديل حساب — ${account.name}` : 'إضافة حساب / بوت Telegram'}</CardTitle>
          <button onClick={onClose}><X className="h-4 w-4 text-zinc-400" /></button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="اسم الحساب / البوت *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input
              label={isEdit ? 'Bot Token (اتركه فارغاً للإبقاء على الحالي)' : 'Bot Token * (من @BotFather)'}
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder="123456:ABC-..."
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Chat ID (للإرسال)" value={form.chatId} onChange={(e) => setForm({ ...form, chatId: e.target.value })} />
            <Input label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="@..." />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="رقم الهاتف (اختياري)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 block">نوع الحساب</label>
              <select value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm">
                {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-700 block">صلاحيات الحساب</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <Input label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="rounded-lg bg-sky-50 border border-sky-100 p-3 text-xs text-sky-800 leading-relaxed">
            عند الحفظ يتم اختبار التوكن وتسجيل الـ webhook تلقائياً وربط الحساب بالنظام. التوكن يُخزَّن بأمان ولا يظهر كاملاً بعد الحفظ.
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving}>{isEdit ? 'حفظ التعديلات' : 'إضافة وربط'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LogsPanel({ accounts }: { accounts: any[] }) {
  const [accountId, setAccountId] = useState('');
  const [direction, setDirection] = useState('');
  const [q, setQ] = useState('');

  const { data: logs } = useQuery({
    queryKey: ['tg-logs', accountId, direction, q],
    queryFn: () => {
      const params = new URLSearchParams();
      if (accountId) params.set('accountId', accountId);
      if (direction) params.set('direction', direction);
      if (q) params.set('q', q);
      return api.get(`/telegram/accounts/logs?${params.toString()}`).then((r) => r.data);
    },
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ScrollText className="h-4 w-4" /> سجلّ العمليات (Logs)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 px-2 rounded-lg border border-zinc-200 text-sm">
            <option value="">كل الحسابات</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-9 px-2 rounded-lg border border-zinc-200 text-sm">
            <option value="">كل الأنواع</option>
            <option value="IN">وارد (IN)</option>
            <option value="OUT">صادر (OUT)</option>
            <option value="SYSTEM">نظام (SYSTEM)</option>
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث في العمليات..." className="h-9 px-3 rounded-lg border border-zinc-200 text-sm flex-1 min-w-[160px]" />
        </div>
        {!logs || logs.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-6">لا توجد سجلات</p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b sticky top-0">
                <tr>
                  <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الوقت</th>
                  <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الحساب</th>
                  <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">النوع</th>
                  <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">العملية</th>
                  <th className="text-right p-2.5 text-[10px] font-bold text-zinc-500 uppercase">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l: any) => (
                  <tr key={l.id} className="border-b border-zinc-100">
                    <td className="p-2.5 text-zinc-500 whitespace-nowrap">{formatDate(l.createdAt)}</td>
                    <td className="p-2.5 text-zinc-600">{l.account?.name ?? '—'}</td>
                    <td className="p-2.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100">{l.direction}</span></td>
                    <td className="p-2.5">{l.action}{l.error ? <span className="text-red-600 block text-[11px]">{l.error}</span> : null}</td>
                    <td className="p-2.5">{l.success ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
