'use client';

import { useSidebar } from './SidebarProvider';

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="skeleton h-8 w-44 rounded-xl" />
          <div className="skeleton h-4 w-28 rounded-lg" />
        </div>
        <div className="skeleton h-9 w-32 rounded-xl" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-card space-y-3">
            <div className="flex items-center justify-between">
              <div className="skeleton h-4 w-28 rounded" />
              <div className="skeleton h-9 w-9 rounded-xl" />
            </div>
            <div className="skeleton h-9 w-14 rounded-lg" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
        ))}
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div className="skeleton h-5 w-36 rounded" />
          <div className="skeleton h-4 w-16 rounded" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <div className="skeleton h-2.5 w-2.5 rounded-full shrink-0" />
            <div className="skeleton h-4 rounded flex-1" style={{ maxWidth: `${55 + (i * 9) % 35}%` }} />
            <div className="skeleton h-5 w-14 rounded-md ml-auto shrink-0" />
            <div className="skeleton h-6 w-6 rounded-full shrink-0" />
          </div>
        ))}
      </div>

      <div className="card space-y-3">
        <div className="skeleton h-5 w-48 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 p-3 rounded-xl border border-surface-300/40">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton h-6 w-10 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ContentShell({ children }: { children: React.ReactNode }) {
  const { pendingPath } = useSidebar();
  if (pendingPath) return <LoadingSkeleton />;
  return <>{children}</>;
}
