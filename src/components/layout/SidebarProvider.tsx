'use client';

import { createContext, useContext, useState, useEffect } from 'react';

interface SidebarCtx {
  collapsed: boolean;
  toggle:    () => void;
}

const Ctx = createContext<SidebarCtx>({ collapsed: false, toggle: () => {} });

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem('hrbot-sidebar-collapsed') === 'true');
  }, []);

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('hrbot-sidebar-collapsed', String(next));
      return next;
    });
  }

  return <Ctx.Provider value={{ collapsed, toggle }}>{children}</Ctx.Provider>;
}

export function useSidebar() {
  return useContext(Ctx);
}
