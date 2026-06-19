'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center p-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-danger/10 border border-danger/20">
        <AlertTriangle className="h-8 w-8 text-danger" />
      </div>

      <div>
        <h2 className="text-lg font-bold text-surface-950">Something went wrong</h2>
        <p className="text-sm text-surface-600 mt-1.5 max-w-xs">
          An unexpected error occurred on this page. Try again or return to the dashboard.
        </p>
        {error.digest && (
          <p className="text-2xs text-surface-500 mt-2 font-mono">Error ID: {error.digest}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-semibold
                     bg-surface-200 text-surface-900 border border-surface-300 hover:bg-surface-300 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-semibold
                     bg-brand-gradient text-white shadow-glow-sm hover:opacity-90 transition-opacity"
        >
          <Home className="h-3.5 w-3.5" />
          Dashboard
        </Link>
      </div>
    </div>
  );
}
