'use client';

import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback } from 'react';

interface SidebarCtx {
  collapsed:       boolean;
  toggle:          () => void;
  mobileOpen:      boolean;
  openMobile:      () => void;
  closeMobile:     () => void;
  pendingPath:     string | null;
  startNavigation: (href: string) => void;
  clearNavigation: () => void;
}

const Ctx = createContext<SidebarCtx>({
  collapsed: false, toggle: () => {},
  mobileOpen: false, openMobile: () => {}, closeMobile: () => {},
  pendingPath: null, startNavigation: () => {}, clearNavigation: () => {},
});

const useSyncEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useSyncEffect(() => {
    const saved = localStorage.getItem('hrbot-sidebar-collapsed');
    if (saved !== null) {
      setCollapsed(saved === 'true');
    } else {
      setCollapsed(window.innerWidth < 1280);
    }
  }, []);

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('hrbot-sidebar-collapsed', String(next));
      return next;
    });
  }

  function openMobile() {
    setMobileOpen(true);
    document.querySelector('.sidebar')?.classList.add('sidebar-open');
    document.getElementById('sidebar-overlay')?.classList.remove('hidden');
  }

  function closeMobile() {
    setMobileOpen(false);
    document.querySelector('.sidebar')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-overlay')?.classList.add('hidden');
  }

  // useCallback keeps identity stable so SidebarShell's effect dep array is safe
  const startNavigation = useCallback((href: string) => setPendingPath(href), []);
  const clearNavigation = useCallback(() => setPendingPath(null), []);

  return (
    <Ctx.Provider value={{
      collapsed, toggle,
      mobileOpen, openMobile, closeMobile,
      pendingPath, startNavigation, clearNavigation,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSidebar() {
  return useContext(Ctx);
}
