'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, CheckSquare, Calendar, Clock,
  Users, MessageSquare, Settings, FileText, Building2,
  MoreHorizontal, X,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { UserRole } from '@/types/database.types';

const ALL: UserRole[] = ['super_admin', 'admin', 'hr', 'hr_assistant', 'manager', 'employee'];
const MGR: UserRole[] = ['super_admin', 'admin', 'hr', 'hr_assistant', 'manager'];
const HR:  UserRole[] = ['super_admin', 'admin', 'hr'];
const ADMIN: UserRole[] = ['super_admin', 'admin'];

const PRIMARY = [
  { href: '/dashboard',  label: 'Home',  Icon: LayoutDashboard, color: 'text-brand-400',  roles: ALL },
  { href: '/tasks',      label: 'Tasks', Icon: CheckSquare,     color: 'text-violet-400', roles: ALL },
  { href: '/leave',      label: 'Leave', Icon: Calendar,        color: 'text-amber-400',  roles: ALL },
  { href: '/attendance', label: 'Attendance', Icon: Clock,       color: 'text-cyan-400',   roles: ALL },
];

const MORE_ITEMS = [
  { href: '/employees',  label: 'Team',       Icon: Users,         color: 'text-pink-400',    roles: MGR },
  { href: '/whatsapp',   label: 'WA Logs',    Icon: MessageSquare, color: 'text-green-400',   roles: ALL },
  { href: '/policy',     label: 'Policy',     Icon: FileText,      color: 'text-blue-400',    roles: HR  },
  { href: '/organizations', label: 'Orgs', Icon: Building2, color: 'text-orange-400',  roles: ADMIN },
  { href: '/settings',   label: 'Settings',   Icon: Settings,      color: 'text-surface-400', roles: ALL },
];

export default function BottomNav({ role }: { role: UserRole }) {
  const pathname  = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const primary    = PRIMARY.filter(n => n.roles.includes(role));
  const more       = MORE_ITEMS.filter(n => n.roles.includes(role));
  const moreActive = more.some(n => pathname === n.href || pathname.startsWith(n.href + '/'));

  // Close popup on outside tap
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      {/* Dim backdrop when popup is open */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <nav
        className="fixed bottom-0 inset-x-0 z-50 lg:hidden border-t border-surface-300/40"
        style={{
          background:           'rgba(12,12,26,0.97)',
          backdropFilter:       'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          paddingBottom:        'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex items-stretch justify-around">
          {primary.map(({ href, label, Icon, color }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 flex-1 py-2.5 px-1 min-h-[54px] select-none transition-all duration-150',
                  active ? color : 'text-surface-600 active:text-surface-700'
                )}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-current" />
                )}
                <Icon
                  className={cn('h-5 w-5 shrink-0 transition-transform duration-150', active && 'scale-110')}
                  strokeWidth={active ? 2.5 : 2}
                />
                <span className="text-[10px] font-semibold leading-none tracking-tight">{label}</span>
              </Link>
            );
          })}

          {/* More — opens a cloud popup above the nav bar */}
          {more.length > 0 && (
            <div ref={ref} className="relative flex-1 flex flex-col items-center justify-center">
              <button
                onClick={() => setOpen(o => !o)}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 w-full min-h-[54px] py-2.5 px-1 select-none transition-all duration-150',
                  (open || moreActive) ? 'text-brand-400' : 'text-surface-600'
                )}
              >
                {moreActive && !open && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-current" />
                )}
                {open
                  ? <X className="h-5 w-5 shrink-0 scale-110" strokeWidth={2.5} />
                  : <MoreHorizontal className="h-5 w-5 shrink-0" strokeWidth={2} />
                }
                <span className="text-[10px] font-semibold leading-none tracking-tight">More</span>
              </button>

              {/* Cloud popup */}
              {open && (
                <div
                  className="absolute bottom-[calc(100%+10px)] right-0 min-w-[192px] max-w-[calc(100vw-1rem)] rounded-2xl border border-surface-300/50 shadow-modal"
                  style={{
                    background:           'rgba(17,17,35,0.98)',
                    backdropFilter:       'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    animation:            'fadeUp 0.15s ease-out',
                  }}
                >
                  {/* Tail — border triangle */}
                  <div
                    className="absolute -bottom-[8px] right-[22px]"
                    style={{
                      width: 0, height: 0,
                      borderLeft:  '8px solid transparent',
                      borderRight: '8px solid transparent',
                      borderTop:   '8px solid rgba(50,50,80,0.7)',
                    }}
                  />
                  {/* Tail — fill triangle */}
                  <div
                    className="absolute -bottom-[6px] right-[23px]"
                    style={{
                      width: 0, height: 0,
                      borderLeft:  '7px solid transparent',
                      borderRight: '7px solid transparent',
                      borderTop:   '7px solid rgba(17,17,35,0.98)',
                    }}
                  />

                  <div className="p-1.5">
                    {more.map(({ href, label, Icon, color }) => {
                      const active = pathname === href || pathname.startsWith(href + '/');
                      return (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setOpen(false)}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-100',
                            active
                              ? 'bg-surface-200/80'
                              : 'hover:bg-surface-200/40 active:bg-surface-200/60'
                          )}
                        >
                          <Icon
                            className={cn('h-[18px] w-[18px] shrink-0', active ? color : 'text-surface-600')}
                            strokeWidth={active ? 2.5 : 2}
                          />
                          <span className={cn(
                            'text-sm font-medium',
                            active ? 'text-surface-950' : 'text-surface-700'
                          )}>
                            {label}
                          </span>
                          {active && (
                            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
