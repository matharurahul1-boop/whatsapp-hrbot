'use client';

import { useEffect, useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';

const useSyncEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const { collapsed, pendingPath, clearNavigation } = useSidebar();
  const pathname = usePathname();

  // Drive padding via data attribute on <html> so CSS is static (never purged by Tailwind JIT)
  useSyncEffect(() => {
    document.documentElement.setAttribute(
      'data-sidebar',
      collapsed ? 'collapsed' : 'expanded',
    );
  }, [collapsed]);

  // Clear pending navigation state when the route change actually completes
  useEffect(() => {
    clearNavigation();
  }, [pathname, clearNavigation]);

  return (
    <div className="sidebar-shell flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Top progress bar — visible while a nav click is in-flight */}
      {pendingPath && (
        <div className="fixed top-0 inset-x-0 z-[200] h-[2px] overflow-hidden">
          <div className="nav-progress-bar" />
        </div>
      )}
      {children}
    </div>
  );
}
