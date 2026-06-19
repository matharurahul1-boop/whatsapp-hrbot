'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, LogOut, X, Menu, ChevronRight, Home, Sun, Moon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils/cn';
import { useTheme } from '@/components/layout/ThemeProvider';
import { useSidebar } from '@/components/layout/SidebarProvider';
import InstallButton from '@/components/layout/InstallButton';

interface HeaderProps {
  userName:  string;
  userRole:  string;
  avatarUrl: string | null;
}

interface Notification {
  id:         string;
  title:      string;
  body:       string;
  is_read:    boolean;
  created_at: string;
  action_url: string | null;
}

const CRUMB_MAP: Record<string, string> = {
  dashboard:  'Dashboard',
  tasks:      'Tasks',
  leave:      'Leave',
  attendance: 'Attendance',
  employees:  'Employees',
  whatsapp:   'WA Logs',
  settings:   'Settings',
};

export default function Header({ userName, userRole, avatarUrl }: HeaderProps) {
  const router   = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const { theme, toggleTheme } = useTheme();

  const { mobileOpen, openMobile, closeMobile } = useSidebar();

  const notifRef    = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs,    setNotifs]    = useState<Notification[]>([]);
  const [unread,    setUnread]    = useState(0);

  // Breadcrumbs
  const segments = pathname.split('/').filter(Boolean);
  const crumbs   = segments.map((s, i) => ({
    label: CRUMB_MAP[s] ?? s.charAt(0).toUpperCase() + s.slice(1),
    href:  '/' + segments.slice(0, i + 1).join('/'),
  }));

  useEffect(() => {
    fetch('/api/notifications?limit=20')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) { setNotifs(j.data ?? []); setUnread(j.unread_count ?? 0); } });
  }, []);

  // Close notif on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close sidebar when the backdrop overlay is tapped
  useEffect(() => {
    const overlay = document.getElementById('sidebar-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', closeMobile);
    return () => overlay.removeEventListener('click', closeMobile);
  }, [closeMobile]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH', body: '{}', headers: { 'Content-Type': 'application/json' } });
    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
    setUnread(0);
  }

  const timeAgo = (d: string) => {
    const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <header className="topbar shrink-0">
      {/* Left — hamburger + breadcrumbs */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Mobile-only hamburger (desktop uses the one in the sidebar brand section) */}
        <button
          onClick={() => mobileOpen ? closeMobile() : openMobile()}
          className="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg text-surface-600 hover:bg-surface-300 hover:text-surface-950 transition-colors shrink-0"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
          <a href="/dashboard" className="shrink-0 text-surface-600 hover:text-surface-900 transition-colors p-1 rounded-lg hover:bg-surface-200">
            <Home className="h-3.5 w-3.5" />
          </a>
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3 w-3 text-surface-500 shrink-0" />
              {i === crumbs.length - 1 ? (
                <span className="text-sm font-semibold text-surface-950 truncate max-w-[120px] sm:max-w-none">{c.label}</span>
              ) : (
                <a href={c.href} className="text-sm text-surface-600 hover:text-surface-900 transition-colors truncate hidden sm:inline">
                  {c.label}
                </a>
              )}
            </span>
          ))}
        </nav>
      </div>

      {/* Right — theme toggle + notifications + user + logout */}
      <div className="flex items-center gap-1.5 shrink-0">

        {/* PWA Install */}
        <InstallButton />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-600 hover:bg-surface-200 hover:text-surface-950 transition-colors"
        >
          {theme === 'dark'
            ? <Sun  className="h-4 w-4" />
            : <Moon className="h-4 w-4" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            className={cn(
              'relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              notifOpen ? 'bg-surface-300 text-surface-950' : 'text-surface-600 hover:bg-surface-200 hover:text-surface-950'
            )}
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-2xs font-bold text-white leading-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-10 z-50 w-72 sm:w-80 rounded-2xl bg-surface-100 border border-surface-300 shadow-modal animate-[scaleIn_0.15s_ease-out]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-300">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-surface-950">Notifications</span>
                  {unread > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-500/15 px-1.5 text-2xs font-bold text-brand-400">
                      {unread}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unread > 0 && (
                    <button onClick={markAllRead} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => setNotifOpen(false)} className="flex h-6 w-6 items-center justify-center rounded-lg text-surface-600 hover:text-surface-950 hover:bg-surface-300 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto no-scrollbar divide-y divide-surface-300/40">
                {notifs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-200">
                      <Bell className="h-5 w-5 text-surface-500" />
                    </div>
                    <p className="text-sm text-surface-600">All caught up!</p>
                  </div>
                ) : notifs.map(n => (
                  <div
                    key={n.id}
                    onClick={() => { if (n.action_url) router.push(n.action_url); setNotifOpen(false); }}
                    className={cn(
                      'flex gap-3 px-4 py-3 cursor-pointer hover:bg-surface-200/50 transition-colors',
                      !n.is_read && 'bg-brand-500/[0.04]'
                    )}
                  >
                    {!n.is_read && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0" />}
                    <div className={cn('flex-1 min-w-0', n.is_read && 'pl-3.5')}>
                      <p className="text-xs font-semibold text-surface-900 truncate">{n.title}</p>
                      <p className="text-xs text-surface-600 mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-2xs text-surface-500 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-surface-300 mx-1 hidden sm:block" />

        {/* User info */}
        <div className="hidden sm:flex items-center gap-2 pl-0.5">
          <Avatar src={avatarUrl} name={userName} size="sm" />
          <div className="hidden md:block text-left">
            <p className="text-xs font-semibold text-surface-950 leading-tight truncate max-w-[120px]">{userName}</p>
            <p className="text-2xs text-surface-600 capitalize">{userRole.replace('_', ' ')}</p>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={signOut}
          title="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-600 hover:text-danger hover:bg-danger/10 transition-colors ml-0.5"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
