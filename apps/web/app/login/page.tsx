'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, AlertCircle } from 'lucide-react';
import { Button, Input, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export default function LoginPage() {
  const router = useRouter();
  const { setUser, setTokens } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      setUser(res.data.user);
      setTokens(res.data.accessToken, res.data.refreshToken);
      router.push('/dashboard');
    } catch (err: any) {
      // Network error (API down, CORS, etc)
      if (err?.code === 'ERR_NETWORK' || !err?.response) {
        setError(
          '⚠️ لا يمكن الوصول للسيرفر. تأكد أن الـ API يعمل على المنفذ 3001 (شغّل pnpm dev في terminal آخر)',
        );
      } else if (err?.response?.status === 401) {
        setError('بيانات الدخول غير صحيحة');
      } else {
        const message =
          err?.response?.data?.message?.message ||
          err?.response?.data?.message ||
          err?.message ||
          'فشل تسجيل الدخول';
        setError(typeof message === 'string' ? message : JSON.stringify(message));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-zinc-50 via-white to-zinc-100">
      <Card className="w-full max-w-md p-8 shadow-xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-900 flex items-center justify-center text-white text-3xl font-black mb-4">
            🥛
          </div>
          <h1 className="text-2xl font-black tracking-tight">Enjoy Milk ERP</h1>
          <p className="text-sm text-zinc-500 mt-1">نظام حليب إنجوي</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 z-10" />
            <Input
              label="البريد الإلكتروني"
              type="email"
              placeholder="admin@enjoymilk.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pr-9"
              autoComplete="email"
              required
            />
          </div>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 z-10" />
            <Input
              label="كلمة المرور"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-9"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <Button type="submit" loading={loading} size="lg" className="w-full">
            تسجيل الدخول
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-zinc-100 text-center">
          <p className="text-xs text-zinc-500 mb-2">حسابات تجريبية:</p>
          <div className="text-xs font-mono space-y-0.5 text-zinc-600">
            <div>admin@enjoymilk.local / Admin@123</div>
            <div>operator@enjoymilk.local / Admin@123</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
