'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CheckSquare, Calendar, Clock,
  Users, MessageSquare, Settings, Zap, ChevronRight,
  FileText, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { UserRole } from '@/types/database.types';

interface NavItem {
  href:   string;
  label:  string;
  icon:   React.ReactNode;
  roles:  UserRole[];
  color:  string;
}

const NAV: NavItem[] = [
  { href: '/dashboard',  label: 'Dashboard',  icon: <LayoutDashboard className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-brand-400'  },
  { href: '/tasks',      label: 'Tasks',       icon: <CheckSquare     className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-violet-400' },
  { href: '/leave',      label: 'Leave',       icon: <Calendar        className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-amber-400'  },
  { href: '/attendance', label: 'Attendance',  icon: <Clock           className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-cyan-400'   },
  { href: '/employees',  label: 'Employees',   icon: <Users           className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager'],           color: 'text-pink-400'   },
  { href: '/whatsapp',   label: 'WA Logs',     icon: <MessageSquare   className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr','manager','employee'], color: 'text-green-400'  },
  { href: '/policy',     label: 'Policy Bot',  icon: <FileText        className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr'],                        color: 'text-blue-400'   },
  { href: '/escalation', label: 'Escalation',  icon: <AlertTriangle   className="h-[18px] w-[18px]" />, roles: ['super_admin','admin','hr'],                        color: 'text-orange-400' },
];

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin', admin: 'Admin', hr: 'HR', manager: 'Manager', employee: 'Employee',
};
const ROLE_COLOR: Record<UserRole, string> = {
  super_admin: 'text-brand-400   bg-brand-500/10',
  admin:       'text-brand-400   bg-brand-500/10',
  hr:          'text-violet-400  bg-violet-500/10',
  manager:     'text-amber-400   bg-amber-500/10',
  employee:    'text-cyan-400    bg-cyan-500/10',
};

export default function Sidebar({ role, orgName }: { role: UserRole; orgName?: string }) {
  const pathname = usePathname();
  const visible  = NAV.filter(n => n.roles.includes(role));

  return (
    <aside className="sidebar">
      {/* ── Brand ── */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-surface-300/30 shrink-0">
        <div className="relative shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success border-2 border-surface-0" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-surface-950 leading-none">HRBot</p>
          {orgName && (
            <p className="text-2xs text-surface-600 truncate mt-0.5">{orgName}</p>
          )}
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto no-scrollbar">
        <p className="px-3 mb-2 text-2xs font-bold text-surface-600 uppercase tracking-widest select-none">
          Main Menu
        </p>

        {visible.map(item => {
          const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-surface-200/80 text-surface-950'
                  : 'text-surface-700 hover:text-surface-900 hover:bg-surface-200/40'
              )}
            >
              {/* Active left bar */}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-brand-500" />
              )}
              <span className={cn('shrink-0', active ? item.color : 'text-surface-600')}>
                {item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {active && <ChevronRight className="h-3.5 w-3.5 text-surface-500 shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div className="px-3 pt-2 pb-4 border-t border-surface-300/30 shrink-0 space-y-0.5">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
            pathname.startsWith('/settings')
              ? 'bg-surface-200/80 text-surface-950'
              : 'text-surface-700 hover:text-surface-900 hover:bg-surface-200/40'
          )}
        >
          <Settings className={cn(
            'h-[18px] w-[18px] shrink-0',
            pathname.startsWith('/settings') ? 'text-surface-700' : 'text-surface-600'
          )} />
          <span className="flex-1">Settings</span>
        </Link>

        <div className="px-3 pt-2">
          <span className={cn(
            'inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-1 rounded-lg',
            ROLE_COLOR[role]
          )}>
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            {ROLE_LABEL[role]}
          </span>
        </div>
      </div>
    </aside>
  );
}
