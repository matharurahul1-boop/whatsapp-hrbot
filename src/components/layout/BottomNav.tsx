'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CheckSquare, Calendar,
  Clock, Users, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { UserRole } from '@/types/database.types';

const ALL_ROLES: UserRole[] = ['super_admin', 'admin', 'hr', 'manager', 'employee'];
const MGR_ROLES: UserRole[] = ['super_admin', 'admin', 'hr', 'manager'];

const NAV = [
  { href: '/dashboard',  label: 'Home',       Icon: LayoutDashboard, color: 'text-brand-400',  roles: ALL_ROLES },
  { href: '/tasks',      label: 'Tasks',       Icon: CheckSquare,     color: 'text-violet-400', roles: ALL_ROLES },
  { href: '/leave',      label: 'Leave',       Icon: Calendar,        color: 'text-amber-400',  roles: ALL_ROLES },
  { href: '/employees',  label: 'Team',        Icon: Users,           color: 'text-pink-400',   roles: MGR_ROLES },
  { href: '/attendance', label: 'Time',        Icon: Clock,           color: 'text-cyan-400',   roles: ALL_ROLES },
  { href: '/whatsapp',   label: 'WA Logs',     Icon: MessageSquare,   color: 'text-green-400',  roles: ALL_ROLES },
];

export default function BottomNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const visible  = NAV.filter(n => n.roles.includes(role)).slice(0, 5);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-surface-300/40"
      style={{
        background:    'rgba(12,12,26,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex items-stretch justify-around">
        {visible.map(({ href, label, Icon, color }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 flex-1 py-2.5 px-1 min-h-[54px] transition-all duration-150 select-none',
                active ? color : 'text-surface-600 hover:text-surface-700'
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-current" />
              )}
              <Icon className={cn('h-5 w-5 shrink-0 transition-transform duration-150', active && 'scale-110')} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-semibold leading-none tracking-tight">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
