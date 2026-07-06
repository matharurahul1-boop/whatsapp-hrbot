'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import {
  LayoutDashboard, CheckSquare, Calendar, Clock,
  Users, MessageSquare, Settings, Zap,
  FileText, AlertTriangle, X, Loader2,
  PanelLeftClose, PanelLeftOpen, ChevronLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { UserRole } from '@/types/database.types';
import { useSidebar, type SidebarMode } from './SidebarProvider';

interface NavItem {
  href:  string;
  label: string;
  icon:  React.ReactNode;
  roles: UserRole[];
  color: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard',  label: 'Dashboard',  icon: <LayoutDashboard className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-brand-400'  },
  { href: '/tasks',      label: 'Tasks',       icon: <CheckSquare     className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-violet-400' },
  { href: '/leave',      label: 'Leave',       icon: <Calendar        className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-amber-400'  },
  { href: '/attendance', label: 'Attendance',  icon: <Clock           className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-cyan-400'   },
  { href: '/employees',  label: 'Team',        icon: <Users           className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager'],           color: 'text-pink-400'   },
  { href: '/whatsapp',   label: 'WA Logs',     icon: <MessageSquare   className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-green-400'  },
  { href: '/policy',     label: 'Policy Bot',  icon: <FileText        className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr'],                     color: 'text-blue-400'   },
  { href: '/escalation', label: 'Escalation',  icon: <AlertTriangle   className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr'],                     color: 'text-orange-400' },
];

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin', admin: 'Admin', hr: 'HR', manager: 'Manager', employee: 'Employee',
};
const ROLE_COLOR: Record<UserRole, string> = {
  super_admin: 'text-brand-400  bg-brand-500/10',
  admin:       'text-brand-400  bg-brand-500/10',
  hr:          'text-violet-400 bg-violet-500/10',
  manager:     'text-amber-400  bg-amber-500/10',
  employee:    'text-cyan-400   bg-cyan-500/10',
};

const MODE_OPTIONS: { key: SidebarMode; label: string }[] = [
  { key: 'expanded',  label: 'Expanded' },
  { key: 'collapsed', label: 'Collapsed' },
  { key: 'hover',     label: 'Expand on hover' },
];

function Tooltip({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-[60]
                    opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      <span className="relative block rounded-lg px-2.5 py-1.5 text-xs font-semibold
                       whitespace-nowrap shadow-modal"
            style={{ background: '#0c0c1a', color: '#e8e8f6' }}>
        {label}
        <span className="absolute right-full top-1/2 -translate-y-1/2"
              style={{ borderWidth: 5, borderStyle: 'solid',
                       borderColor: 'transparent #0c0c1a transparent transparent' }} />
      </span>
    </div>
  );
}

export default function Sidebar({ role, orgName }: { role: UserRole; orgName?: string }) {
  const pathname = usePathname();
  const { mode, setMode, closeMobile, pendingPath, startNavigation } = useSidebar();
  const [hovered,     setHovered]     = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = NAV.filter(n => n.roles.includes(role));

  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Close mode menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // On desktop: visually expanded when mode=expanded, or mode=hover and currently hovered.
  // On mobile: always show expanded layout (full-width overlay).
  const visualExpanded = !isDesktop || mode === 'expanded' || (mode === 'hover' && hovered);

  function isActive(href: string) {
    const target = pendingPath ?? pathname;
    return target === href || target.startsWith(href + '/');
  }

  const settingsActive = isActive('/settings');

  return (
    <aside
      className="sidebar"
      style={isDesktop ? {
        width: visualExpanded ? '256px' : '64px',
        // Show overflow when collapsed (tooltips) or when mode menu is open (popover above sidebar).
        overflow: (!visualExpanded || showModeMenu) ? 'visible' : 'hidden',
      } : undefined}
      onMouseEnter={() => { if (isDesktop) setHovered(true); }}
      onMouseLeave={() => { if (isDesktop) { setHovered(false); setShowModeMenu(false); } }}
    >

      {/* ── Brand ── */}
      <div className={cn(
        'group relative flex w-full items-center h-14 border-b border-surface-300/30 shrink-0',
        visualExpanded ? 'px-3 gap-2' : 'justify-center',
      )}>
        <div className={cn(
          'relative shrink-0',
          !visualExpanded && 'absolute left-1/2 -translate-x-1/2',
        )}>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success border-2 border-surface-0" />
        </div>

        <div className={cn(
          'min-w-0 flex-1 overflow-hidden transition-[opacity,width] duration-200',
          visualExpanded ? 'opacity-100' : 'opacity-0 w-0',
        )}>
          <p className="text-sm font-bold text-surface-950 leading-none whitespace-nowrap">HRBot</p>
          {orgName && <p className="text-2xs text-surface-600 truncate mt-0.5">{orgName}</p>}
        </div>

        {/* ChevronLeft — quick collapse to collapsed mode (desktop, expanded/hover) */}
        {isDesktop && visualExpanded && (
          <button
            onClick={() => { setMode('collapsed'); setShowModeMenu(false); }}
            title="Collapse sidebar"
            className="shrink-0 p-1.5 rounded-lg text-surface-600 hover:text-surface-950 hover:bg-surface-200 opacity-0 group-hover:opacity-100 transition-all duration-150"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        {/* Close button — mobile overlay only */}
        <button
          onClick={closeMobile}
          className="lg:hidden shrink-0 flex h-8 w-8 items-center justify-center rounded-lg
                     text-surface-600 hover:text-surface-950 hover:bg-surface-300 transition-colors"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Nav ── */}
      <nav className={cn(
        'flex-1 py-3 space-y-0.5 no-scrollbar',
        visualExpanded ? 'overflow-y-auto px-3' : 'overflow-visible px-1.5',
      )}>
        <p className={cn(
          'px-3 mb-2 text-2xs font-bold text-surface-600 uppercase tracking-widest select-none transition-[opacity,height] duration-200',
          visualExpanded ? 'opacity-100 h-auto' : 'opacity-0 h-0 mb-0 overflow-hidden',
        )}>
          Main Menu
        </p>

        {visible.map(item => {
          const active  = isActive(item.href);
          const loading = pendingPath === item.href;

          if (!visualExpanded) {
            return (
              <div key={item.href} className="group relative flex justify-center">
                <Link
                  href={item.href}
                  onClick={() => startNavigation(item.href)}
                  className={cn(
                    'relative flex items-center justify-center h-10 w-10 rounded-xl transition-all duration-150',
                    active ? 'bg-surface-200/80' : 'hover:bg-surface-200/40',
                  )}
                >
                  {active && !loading && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-brand-500" />
                  )}
                  <span className={cn('shrink-0', active ? item.color : 'text-surface-600 group-hover:text-surface-900')}>
                    {loading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : item.icon}
                  </span>
                </Link>
                <Tooltip label={item.label} />
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => startNavigation(item.href)}
              className={cn(
                'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-surface-200/80 text-surface-950'
                  : 'text-surface-700 hover:text-surface-900 hover:bg-surface-200/40',
              )}
            >
              {active && !loading && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-brand-500" />
              )}
              <span className={cn('shrink-0', active ? item.color : 'text-surface-600')}>
                {loading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Footer — settings + role badge ── */}
      <div className={cn(
        'pt-2 border-t border-surface-300/30 shrink-0 space-y-0.5',
        visualExpanded ? 'px-3 pb-2' : 'px-1.5 pb-2',
      )}>
        {!visualExpanded ? (
          <div className="group relative flex justify-center">
            <Link
              href="/settings"
              onClick={() => startNavigation('/settings')}
              className={cn(
                'relative flex items-center justify-center h-10 w-10 rounded-xl transition-all duration-150',
                settingsActive ? 'bg-surface-200/80' : 'hover:bg-surface-200/40',
              )}
            >
              {pendingPath === '/settings'
                ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-surface-700" />
                : <Settings className={cn(
                    'h-[18px] w-[18px] shrink-0',
                    settingsActive ? 'text-surface-700' : 'text-surface-600 group-hover:text-surface-900',
                  )} />
              }
            </Link>
            <Tooltip label="Settings" />
          </div>
        ) : (
          <>
            <Link
              href="/settings"
              onClick={() => startNavigation('/settings')}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                settingsActive
                  ? 'bg-surface-200/80 text-surface-950'
                  : 'text-surface-700 hover:text-surface-900 hover:bg-surface-200/40',
              )}
            >
              {pendingPath === '/settings'
                ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-surface-600" />
                : <Settings className={cn(
                    'h-[18px] w-[18px] shrink-0',
                    settingsActive ? 'text-surface-700' : 'text-surface-600',
                  )} />
              }
              <span className="flex-1">Settings</span>
            </Link>
            <div className="px-3 pt-1 pb-1">
              <span className={cn(
                'inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-1 rounded-lg',
                ROLE_COLOR[role],
              )}>
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                {ROLE_LABEL[role]}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Sidebar control (desktop only) — bottom popover ── */}
      {isDesktop && (
        <div className="relative border-t border-surface-300/30 px-2 py-2 shrink-0" ref={menuRef}>
          <button
            onClick={() => setShowModeMenu(v => !v)}
            title="Sidebar control"
            className={cn(
              'flex items-center rounded-lg text-surface-600 hover:text-surface-950 hover:bg-surface-200 transition-colors w-full',
              visualExpanded ? 'gap-2.5 px-3 py-2 text-sm' : 'justify-center p-3',
            )}
          >
            {mode === 'expanded'
              ? <PanelLeftClose className="h-4 w-4 shrink-0" />
              : <PanelLeftOpen  className="h-4 w-4 shrink-0" />}
            {visualExpanded && <span>Sidebar control</span>}
          </button>

          {/* Mode popover — opens upward */}
          {showModeMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-52 bg-surface-100 border border-surface-300 rounded-xl shadow-modal overflow-hidden z-50">
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-surface-600 uppercase tracking-wider">
                Sidebar control
              </p>
              {MODE_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setMode(key); setShowModeMenu(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-200/60 transition-colors"
                >
                  <span className={cn(
                    'w-2 h-2 rounded-full shrink-0 border-2',
                    mode === key ? 'bg-brand-400 border-brand-400' : 'border-surface-500',
                  )} />
                  <span className={mode === key ? 'text-surface-950 font-medium' : 'text-surface-700'}>
                    {label}
                  </span>
                </button>
              ))}
              <div className="h-2" />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
