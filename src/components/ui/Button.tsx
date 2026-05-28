'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';
import { Loader2 } from 'lucide-react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40 disabled:pointer-events-none select-none whitespace-nowrap shrink-0',
  {
    variants: {
      variant: {
        primary:   'bg-brand-gradient text-white shadow-glow-sm hover:shadow-glow active:scale-[0.98]',
        secondary: 'bg-surface-200 text-surface-900 border border-surface-300 hover:bg-surface-300 hover:border-surface-400 active:scale-[0.98]',
        ghost:     'text-surface-800 hover:bg-surface-200 hover:text-surface-950 active:scale-[0.98]',
        danger:    'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 active:scale-[0.98]',
        success:   'bg-success/10 text-success border border-success/20 hover:bg-success/20 active:scale-[0.98]',
        link:      'text-brand-400 hover:text-brand-300 underline-offset-4 hover:underline p-0 h-auto',
        outline:   'border border-surface-400 text-surface-800 hover:bg-surface-200 hover:text-surface-950 active:scale-[0.98]',
      },
      size: {
        xs: 'text-xs h-6 px-2',
        sm: 'text-xs h-7 px-2.5',
        md: 'text-sm h-9 px-4',
        lg: 'text-sm h-11 px-5',
        xl: 'text-base h-12 px-6',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
        'icon-lg': 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?:  boolean;
  loading?:  boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : leftIcon ? (
          <span className="shrink-0">{leftIcon}</span>
        ) : null}
        {children}
        {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
