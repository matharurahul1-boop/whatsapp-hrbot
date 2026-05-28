'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

// ── Input ─────────────────────────────────────────────────────────────
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?:   React.ReactNode;
  rightIcon?:  React.ReactNode;
  error?:      string;
  label?:      string;
  hint?:       string;
  wrapperClassName?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, leftIcon, rightIcon, error, label, hint, wrapperClassName, id, ...props }, ref) => {
    const inputId = id ?? React.useId();
    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3 text-surface-600 pointer-events-none">{leftIcon}</span>
          )}
          <input
            id={inputId}
            type={type}
            ref={ref}
            className={cn(
              'input',
              leftIcon  && 'pl-9',
              rightIcon && 'pr-9',
              error     && 'border-danger/50 focus:ring-danger/40 focus:border-danger/50',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 text-surface-600">{rightIcon}</span>
          )}
        </div>
        {error && <p className="field-error">{error}</p>}
        {!error && hint && <p className="text-xs text-surface-600">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

// ── Textarea ──────────────────────────────────────────────────────────
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  label?: string;
  hint?:  string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, label, hint, id, ...props }, ref) => {
    const inputId = id ?? React.useId();
    return (
      <div className="flex flex-col gap-1.5">
        {label && <label htmlFor={inputId} className="label">{label}</label>}
        <textarea
          id={inputId}
          ref={ref}
          className={cn(
            'flex min-h-[80px] w-full rounded-lg bg-surface-200 border border-surface-300',
            'px-3 py-2 text-sm text-surface-950 placeholder:text-surface-600 resize-none',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-danger/50 focus:ring-danger/40',
            className
          )}
          {...props}
        />
        {error && <p className="field-error">{error}</p>}
        {!error && hint && <p className="text-xs text-surface-600">{hint}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

// ── Select ────────────────────────────────────────────────────────────
export interface SelectNativeProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?:   string;
  label?:   string;
  options?: { value: string; label: string }[];
}

const SelectNative = React.forwardRef<HTMLSelectElement, SelectNativeProps>(
  ({ className, error, label, options, children, id, ...props }, ref) => {
    const inputId = id ?? React.useId();
    return (
      <div className="flex flex-col gap-1.5">
        {label && <label htmlFor={inputId} className="label">{label}</label>}
        <select
          id={inputId}
          ref={ref}
          className={cn(
            'input appearance-none cursor-pointer',
            error && 'border-danger/50 focus:ring-danger/40',
            className
          )}
          {...props}
        >
          {options
            ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
            : children}
        </select>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }
);
SelectNative.displayName = 'SelectNative';

export { Input, Textarea, SelectNative };
