'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// ─── Button ─────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type BtnSize = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, children, className, disabled, ...props }, ref) => {
    const variants: Record<BtnVariant, string> = {
      primary: 'bg-zinc-900 text-white hover:bg-zinc-800 disabled:bg-zinc-300',
      secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200',
      ghost: 'text-zinc-700 hover:bg-zinc-100',
      danger: 'bg-red-600 text-white hover:bg-red-700',
      outline: 'border border-zinc-200 text-zinc-900 hover:bg-zinc-50',
    };
    const sizes: Record<BtnSize, string> = {
      sm: 'h-8 px-3 text-xs gap-1.5',
      md: 'h-10 px-4 text-sm gap-2',
      lg: 'h-12 px-5 text-base gap-2 font-semibold',
      xl: 'h-14 px-6 text-lg gap-2.5 font-bold',
    };
    return (
      <button
        ref={ref}
        disabled={loading || disabled}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-1',
          variants[variant], sizes[size], className,
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {!loading && children}
      </button>
    );
  },
);
Button.displayName = 'Button';

// ─── Input ──────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  big?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, big, className, type, onWheel, inputMode, ...props }, ref) => {
    const isNumber = type === 'number';
    return (
      <div className="space-y-1.5">
        {label && <label className="text-xs font-bold text-zinc-700 block">{label}</label>}
        <input
          ref={ref}
          type={type}
          // مهم: نمنع Wheel من تغيير قيمة الأرقام تلقائياً عند التمرير داخل حقل مركّز.
          onWheel={(e) => {
            if (isNumber) (e.target as HTMLInputElement).blur();
            onWheel?.(e);
          }}
          // على الموبايل نُظهر لوحة أرقام مناسبة للأرقام العشرية
          inputMode={inputMode ?? (isNumber ? 'decimal' : undefined)}
          className={cn(
            'w-full rounded-lg border border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400',
            'focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 focus:outline-none',
            'transition-colors duration-150',
            error && 'border-red-500',
            big ? 'h-14 px-4 text-2xl font-black text-center' : 'h-10 px-3 text-sm',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';

// ─── Card ───────────────────────────────────────────────────
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-zinc-200 bg-white', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 border-b border-zinc-100', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-bold text-base tracking-tight', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

// ─── Stat ───────────────────────────────────────────────────
interface StatProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number;
  hint?: string;
  state?: 'neutral' | 'good' | 'warning' | 'danger';
}

export function Stat({ label, value, unit, trend, hint, state = 'neutral' }: StatProps) {
  const states: Record<string, string> = {
    neutral: '',
    good: 'border-emerald-200',
    warning: 'border-amber-200',
    danger: 'border-red-200',
  };
  return (
    <div className={cn('rounded-xl border-2 bg-white p-4', states[state])}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span data-numeric className="text-2xl md:text-3xl font-black tracking-tight text-zinc-900">
          {value}
        </span>
        {unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
      {(trend !== undefined || hint) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          {trend !== undefined && (
            <span
              className={cn(
                'font-bold',
                trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-600' : 'text-zinc-500',
              )}
            >
              {trend > 0 ? '▲' : trend < 0 ? '▼' : '◆'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {hint && <span className="text-zinc-500">{hint}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton (loading placeholder) ──────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse bg-zinc-100 rounded-md',
        className || 'h-4 w-full',
      )}
    />
  );
}

/** مجموعة صفوف skeleton للجداول */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className={cn('h-6', j === 0 ? 'w-24' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Badge ──────────────────────────────────────────────────
type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  variant = 'default',
  children,
  dot,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
}) {
  const variants: Record<BadgeVariant, string> = {
    default: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  const dotColors: Record<BadgeVariant, string> = {
    default: 'bg-zinc-400',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    info: 'bg-blue-500',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold',
        variants[variant],
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[variant])} />}
      {children}
    </span>
  );
}
