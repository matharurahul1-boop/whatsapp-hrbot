'use client';

import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback } from 'react';

export type SidebarMode = 'expanded' | 'collapsed' | 'hover';

interface SidebarCtx {
  mode:            SidebarMode;
  setMode:         (m: SidebarMode) => void;
  mobileOpen:      boolean;
  openMobile:      () => void;
  closeMobile:     () => void;
  pendingPath:     string | null;
  startNavigation: (href: string) => void;
  clearNavigation: () => void;
}

const Ctx = createContext<SidebarCtx>({
  mode: 'expanded', setMode: () => {},
  mobileOpen: false, openMobile: () => {}, closeMobile: () => {},
  pendingPath: null, startNavigation: () => {}, clearNavigation: () => {},
});

const useSyncEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [mode,        setModeState]  = useState<SidebarMode>('expanded');
  const [mobileOpen,  setMobileOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useSyncEffect(() => {
    const saved = localStorage.getItem('hrbot-sidebar-mode') as SidebarMode | null;
    if (saved === 'expanded' || saved === 'collapsed' || saved === 'hover') {
      setModeState(saved);
    }
  }, []);

  function setMode(m: SidebarMode) {
    setModeState(m);
    localStorage.setItem('hrbot-sidebar-mode', m);
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

  const startNavigation = useCallback((href: string) => setPendingPath(href), []);
  const clearNavigation = useCallback(() => setPendingPath(null), []);

  return (
    <Ctx.Provider value={{
      mode, setMode,
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
