'use client';

import { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react';

interface SidebarCtx {
  collapsed:   boolean;
  toggle:      () => void;
  mobileOpen:  boolean;
  openMobile:  () => void;
  closeMobile: () => void;
}

const Ctx = createContext<SidebarCtx>({
  collapsed: false, toggle: () => {},
  mobileOpen: false, openMobile: () => {}, closeMobile: () => {},
});

// useLayoutEffect fires before browser paint (no flash); fall back to useEffect on SSR
const useSyncEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed,  setCollapsed]  = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useSyncEffect(() => {
    const saved = localStorage.getItem('hrbot-sidebar-collapsed');
    if (saved !== null) {
      setCollapsed(saved === 'true');
    } else {
      // Auto-collapse on screens narrower than xl (1280px) — gives content more room
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

  return (
    <Ctx.Provider value={{ collapsed, toggle, mobileOpen, openMobile, closeMobile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSidebar() {
  return useContext(Ctx);
}
