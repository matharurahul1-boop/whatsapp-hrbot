'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
  id:       string;
  message:  string;
  variant:  ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-success shrink-0" />,
  error:   <XCircle      className="h-4 w-4 text-danger  shrink-0" />,
  info:    <Info         className="h-4 w-4 text-brand-500 shrink-0" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setToasts(t => [...t, { id, message, variant }]);
    setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none w-[calc(100%-2rem)] sm:w-auto">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-xl border bg-surface-100 shadow-modal px-4 py-3 text-sm text-surface-950 animate-[scaleIn_0.15s_ease-out] sm:min-w-[280px] sm:max-w-sm',
              t.variant === 'success' && 'border-success/30',
              t.variant === 'error'   && 'border-danger/30',
              t.variant === 'info'    && 'border-brand-500/30',
            )}
          >
            {ICONS[t.variant]}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-surface-500 hover:text-surface-800 transition-colors shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
