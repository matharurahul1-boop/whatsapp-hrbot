import * as React from 'react';
import { cn } from '@/lib/utils/cn';

// ── Card root ─────────────────────────────────────────────────────────
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  glow?:  boolean;
  noPad?: boolean;
}

function Card({ className, hover = false, glow = false, noPad = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'glass-card',
        hover && 'cursor-pointer',
        glow  && 'border-glow',
        !noPad && 'p-5',
        className
      )}
      {...props}
    />
  );
}

// ── Card sub-components ───────────────────────────────────────────────
function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between mb-4', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-surface-950', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-surface-700 mt-0.5', className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between pt-4 mt-4 border-t border-surface-300/60', className)}
      {...props}
    />
  );
}

// ── Stat card ─────────────────────────────────────────────────────────
interface StatCardProps {
  label:    string;
  value:    string | number;
  icon?:    React.ReactNode;
  delta?:   { value: string; positive: boolean };
  color?:   'brand' | 'success' | 'warning' | 'danger' | 'info';
  suffix?:  string;
  className?: string;
}

const colorMap = {
  brand:   { bg: 'bg-brand-500/10',   icon: 'text-brand-400'  },
  success: { bg: 'bg-success/10',     icon: 'text-success'    },
  warning: { bg: 'bg-warning/10',     icon: 'text-warning'    },
  danger:  { bg: 'bg-danger/10',      icon: 'text-danger'     },
  info:    { bg: 'bg-info/10',        icon: 'text-info'       },
};

function StatCard({ label, value, icon, delta, color = 'brand', suffix, className }: StatCardProps) {
  const c = colorMap[color];
  return (
    <Card className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-surface-700 min-w-0 truncate">{label}</span>
        {icon && (
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0', c.bg, c.icon)}>
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-surface-950 tabular-nums leading-none">{value}</span>
        {suffix && <span className="text-sm text-surface-700 mb-0.5">{suffix}</span>}
      </div>
      {delta && (
        <span className={cn(
          'inline-flex items-center gap-1 text-xs font-medium w-fit px-1.5 py-0.5 rounded-md',
          delta.positive ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
        )}>
          {delta.positive ? '↑' : '↓'} {delta.value}
        </span>
      )}
    </Card>
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, StatCard };
