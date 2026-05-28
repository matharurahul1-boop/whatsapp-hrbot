import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default:  'bg-surface-300 text-surface-800',
        brand:    'bg-brand-500/10 text-brand-400',
        success:  'bg-success/10 text-success',
        warning:  'bg-warning/10 text-warning',
        danger:   'bg-danger/10 text-danger',
        info:     'bg-info/10 text-info',
        outline:  'border border-surface-400 text-surface-800',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span className={cn('h-1.5 w-1.5 rounded-full', {
          'bg-brand-500': variant === 'brand',
          'bg-success':   variant === 'success',
          'bg-warning':   variant === 'warning',
          'bg-danger':    variant === 'danger',
          'bg-info':      variant === 'info',
          'bg-surface-600': !variant || variant === 'default',
        })} />
      )}
      {children}
    </span>
  );
}

// Convenience exports for common use cases
const statusVariantMap: Record<string, VariantProps<typeof badgeVariants>['variant']> = {
  todo:        'default',
  in_progress: 'info',
  done:        'success',
  cancelled:   'danger',
  pending:     'warning',
  approved:    'success',
  rejected:    'danger',
  present:     'success',
  absent:      'danger',
  late:        'warning',
  on_leave:    'info',
  half_day:    'warning',
  low:         'default',
  medium:      'info',
  high:        'warning',
  urgent:      'danger',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = statusVariantMap[status] ?? 'default';
  const label   = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return <Badge variant={variant} dot className={className}>{label}</Badge>;
}

export { Badge, badgeVariants };
