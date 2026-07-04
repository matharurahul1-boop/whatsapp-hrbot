'use client';

import { useEffect, useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';

const useSyncEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const { mode, pendingPath, clearNavigation } = useSidebar();
  const pathname = usePathname();

  // In hover mode the sidebar overlays content (fixed, no push), so content padding
  // only shifts when mode is 'expanded'.
  useSyncEffect(() => {
    document.documentElement.setAttribute(
      'data-sidebar',
      mode === 'expanded' ? 'expanded' : 'collapsed',
    );
  }, [mode]);

  useSyncEffect(() => {
    clearNavigation();
  }, [pathname, clearNavigation]);

  return (
    <div className="sidebar-shell flex flex-col flex-1 min-w-0 overflow-hidden">
      {pendingPath && (
        <div className="fixed top-0 inset-x-0 z-[200] h-[2px] overflow-hidden">
          <div className="nav-progress-bar" />
        </div>
      )}
      {children}
    </div>
  );
}
