'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, Badge, Button, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function InventoryPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: items, isLoading } = useQuery({
    queryKey: ['items', search],
    queryFn: () =>
      api
        .get('/inventory/items', { params: { search: search || undefined } })
        .then((r) => r.data),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/inventory/items/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
    onError: () => alert('تعذّر حذف الصنف'),
  });

  const handleDelete = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    if (confirm(`حذف الصنف "${item.name}"؟ سيُخفى من القائمة.`)) {
      del.mutate(item.id);
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">المخزون</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {items?.length ?? 0} صنف
            </p>
          </div>
          <Button onClick={() => router.push('/inventory/new')}>
            <Plus className="h-4 w-4" />
            صنف جديد
          </Button>
        </header>

        <Card className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 z-10" />
            <Input
              placeholder="ابحث بالاسم أو SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
        </Card>

        <Card>
          {isLoading ? (
            <div className="p-8 text-center text-zinc-500">جاري التحميل...</div>
          ) : !items || items.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="h-12 w-12 mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500">لا توجد أصناف</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      SKU
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الاسم
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      النوع
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الكمية
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      السعر
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      الحالة
                    </th>
                    <th className="text-right p-3 text-[10px] font-bold text-zinc-500 uppercase">
                      إجراء
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr
                      key={item.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50"
                    >
                      <td className="p-3 font-mono text-xs">{item.sku}</td>
                      <td className="p-3 font-medium">{item.name}</td>
                      <td className="p-3">
                        <Badge>{translateType(item.type)}</Badge>
                      </td>
                      <td className="p-3 font-bold" data-numeric>
                        {formatNumber(item.totalStock)} {item.unit}
                      </td>
                      <td className="p-3" data-numeric>
                        {item.sellPrice ? `${formatNumber(+item.sellPrice, 2)} د.أ` : '-'}
                      </td>
                      <td className="p-3">
                        {item.isLow ? (
                          <Badge variant="warning" dot>
                            منخفض
                          </Badge>
                        ) : (
                          <Badge variant="success" dot>
                            متوفر
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={(e) => handleDelete(e, item)}
                          disabled={del.isPending && del.variables === item.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                          title="حذف الصنف"
                        >
                          <Trash2 className="h-3 w-3" /> حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function translateType(type: string): string {
  const map: Record<string, string> = {
    POWDER_BULK: 'بودرة مستوردة',
    PACKAGING: 'تغليف',
    POWDER_RETAIL: 'منتج نهائي',
    CONSUMABLE: 'مستهلكات',
  };
  return map[type] ?? type;
}
