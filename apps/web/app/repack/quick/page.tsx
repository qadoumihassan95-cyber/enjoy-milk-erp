'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, X, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Field = 'output' | 'waste' | 'downtime';

export default function QuickEntryPage() {
  const router = useRouter();
  const [machineId, setMachineId] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [waste, setWaste] = useState('');
  const [downtime, setDowntime] = useState('');
  const [activeField, setActiveField] = useState<Field>('output');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: machines } = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.get('/repack/machines').then((r) => r.data),
  });

  useEffect(() => {
    if (machines?.length && !machineId) setMachineId(machines[0].id);
  }, [machines, machineId]);

  const submit = useMutation({
    mutationFn: (data: any) => api.post('/repack/quick', data).then((r) => r.data),
    onSuccess: () => {
      setSuccess(true);
      setError(null);
      setTimeout(() => {
        setOutput('');
        setWaste('');
        setDowntime('');
        setSuccess(false);
        setActiveField('output');
      }, 1500);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'فشل التسجيل');
    },
  });

  const setActive = (val: string) => {
    if (activeField === 'output') setOutput(val);
    else if (activeField === 'waste') setWaste(val);
    else setDowntime(val);
  };

  const padKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

  return (
    <AppShell>
      <div className="max-w-md mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            ← رجوع
          </button>
          <h1 className="font-bold text-base">إدخال إنتاج</h1>
          <div className="w-12" />
        </header>

        {/* Machines selector */}
        {(machines?.length ?? 0) > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {machines?.map((m: any) => (
              <button
                key={m.id}
                onClick={() => setMachineId(m.id)}
                className={cn(
                  'shrink-0 px-3 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap',
                  machineId === m.id
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-700 border-zinc-200',
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        {/* Success banner */}
        {success && (
          <Card className="bg-emerald-50 border-emerald-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center">
                <Check className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="font-bold text-emerald-900">تم التسجيل!</div>
                <div className="text-xs text-emerald-700">يمكنك إدخال المزيد</div>
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-4 flex items-center gap-3">
              <X className="h-5 w-5 text-red-600" />
              <div className="text-sm text-red-700">{error}</div>
            </CardContent>
          </Card>
        )}

        {/* 3 fields */}
        <div className="grid grid-cols-3 gap-2">
          <FieldButton
            active={activeField === 'output'}
            highlight
            onClick={() => setActiveField('output')}
            label="معبّأ"
            value={output || '0'}
          />
          <FieldButton
            active={activeField === 'waste'}
            onClick={() => setActiveField('waste')}
            label="هدر"
            value={waste || '0'}
          />
          <FieldButton
            active={activeField === 'downtime'}
            onClick={() => setActiveField('downtime')}
            label="عطل (د)"
            value={downtime || '0'}
          />
        </div>

        {/* Numeric pad */}
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {padKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    const cur =
                      activeField === 'output'
                        ? output
                        : activeField === 'waste'
                        ? waste
                        : downtime;
                    if (k === '⌫') setActive(cur.slice(0, -1));
                    else setActive(cur + k);
                  }}
                  className="h-14 rounded-xl bg-zinc-50 hover:bg-zinc-100 active:bg-zinc-200 font-bold text-xl transition-colors"
                >
                  {k}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <Button
          size="xl"
          loading={submit.isPending}
          disabled={!output || !machineId}
          onClick={() =>
            submit.mutate({
              machineId,
              outputUnits: +output,
              wasteUnits: +waste || 0,
              downtimeMinutes: +downtime || 0,
            })
          }
          className="w-full"
        >
          <Check className="h-5 w-5" />
          تسجيل
        </Button>

        <p className="text-xs text-center text-zinc-500">
          أدخل الكمية المعبّأة فقط · الباقي اختياري
        </p>
      </div>
    </AppShell>
  );
}

function FieldButton({
  active,
  highlight,
  onClick,
  label,
  value,
}: {
  active: boolean;
  highlight?: boolean;
  onClick: () => void;
  label: string;
  value: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-center rounded-xl border-2 p-3 transition-colors',
        active
          ? highlight
            ? 'border-zinc-900 bg-zinc-900 text-white'
            : 'border-zinc-900 bg-white'
          : 'border-zinc-200 bg-white text-zinc-700',
      )}
    >
      <div
        className={cn(
          'text-[10px] mb-1',
          active && highlight ? 'text-zinc-300' : 'text-zinc-500',
        )}
      >
        {label}
      </div>
      <div className="text-xl font-black" data-numeric>
        {value}
      </div>
    </button>
  );
}
