'use client';

import { useSidebar } from './SidebarProvider';

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div className={`flex flex-col flex-1 min-w-0 overflow-hidden transition-[padding] duration-300 ease-in-out ${
      collapsed ? 'md:pl-16' : 'md:pl-64'
    }`}>
      {children}
    </div>
  );
}
