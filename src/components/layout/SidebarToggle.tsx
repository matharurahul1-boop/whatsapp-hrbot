'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useSidebar } from './SidebarProvider';

/**
 * Floating pill that sits exactly on the sidebar's right border, vertically centred.
 * Slides left/right in sync with the sidebar width transition.
 * Desktop-only — mobile uses the hamburger in the topbar.
 */
export function SidebarToggle() {
  const { collapsed, toggle } = useSidebar();

  // Sidebar widths: expanded = 256px, collapsed = 64px.
  // Button width = 24px (w-6). Center on border = sidebarWidth - 12px.
  const leftPx = collapsed ? 52 : 244;

  return (
    <button
      onClick={toggle}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="hidden lg:flex fixed -translate-y-1/2 z-50
                 h-6 w-6 items-center justify-center rounded-full
                 bg-surface-100 border border-surface-300
                 text-surface-500
                 hover:bg-brand-500 hover:border-brand-500 hover:text-white
                 shadow-card cursor-pointer"
      style={{
        left: leftPx,
        top: '1.75rem', /* half of h-14 (56px) — centres pill on the topbar / breadcrumb line */
        transition: 'left 0.3s ease, background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
      }}
    >
      {collapsed
        ? <ChevronsRight className="h-3 w-3" />
        : <ChevronsLeft  className="h-3 w-3" />}
    </button>
  );
}
