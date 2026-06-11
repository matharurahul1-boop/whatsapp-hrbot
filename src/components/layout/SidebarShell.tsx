'use client';

import { useEffect } from 'react';
import { useSidebar } from './SidebarProvider';

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  // Drive padding via a data attribute on <html> so the CSS is always static
  // (avoids Tailwind JIT purging dynamic class names like `md:pl-64`).
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-sidebar',
      collapsed ? 'collapsed' : 'expanded',
    );
  }, [collapsed]);

  return (
    <div className="sidebar-shell flex flex-col flex-1 min-w-0 overflow-hidden">
      {children}
    </div>
  );
}
