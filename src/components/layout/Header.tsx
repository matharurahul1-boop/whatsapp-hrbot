'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, LogOut, X, ChevronRight, Home, Sun, Moon, ExternalLink, Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { useTheme } from '@/components/layout/ThemeProvider';
import { useSidebar } from '@/components/layout/SidebarProvider';
import InstallButton from '@/components/layout/InstallButton';
import { useToast } from '@/components/ui/Toast';

interface HeaderProps {
  userId:    string;
  userName:  string;
  userRole:  string;
  userEmail: string;
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
  employees:  'Team',
  whatsapp:   'WA Logs',
  settings:   'Settings',
};

export default function Header({ userId, userName, userRole, userEmail, avatarUrl }: HeaderProps) {
  const router   = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  const { closeMobile } = useSidebar();

  const notifRef    = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs,    setNotifs]    = useState<Notification[]>([]);
  const [unread,    setUnread]    = useState(0);
  const [signOutOpen,    setSignOutOpen]    = useState(false);
  const [signingOut,     setSigningOut]     = useState(false);
  const [viewingNotif,   setViewingNotif]   = useState<Notification | null>(null);

  // Profile dropdown — opened by clicking the avatar/name in the header
  const profileRef = useRef<HTMLDivElement>(null);
  const [profileOpen,    setProfileOpen]    = useState(false);
  const [profileLoaded,  setProfileLoaded]  = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pFullName,    setPFullName]    = useState(userName);
  const [pDepartment,  setPDepartment]  = useState('');
  const [pDesignation, setPDesignation] = useState('');
  const [pAvatarUrl,   setPAvatarUrl]   = useState(avatarUrl ?? '');
  const [pSaving, setPSaving] = useState(false);
  const [pSaved,  setPSaved]  = useState(false);
  const [pError,  setPError]  = useState('');

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

  // Live-update the bell without requiring a page refresh — previously this
  // only ever fetched once on mount, so a notification created after the
  // page loaded (e.g. a task assignment) stayed invisible until the user
  // manually reloaded. Mirrors the same postgres_changes pattern already
  // used by useRealtimeTasks/useRealtimeLeave/useRealtimeAttendance,
  // filtered to this user's own rows (matches the /api/notifications GET
  // route's own per-user scoping).
  useEffect(() => {
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          setNotifs(prev => prev.some(x => x.id === n.id) ? prev : [n, ...prev]);
          if (!n.is_read) setUnread(u => u + 1);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          setNotifs(prev => prev.map(x => (x.id === n.id ? n : x)));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase]);

  // Close notif / profile dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function toggleProfile() {
    setNotifOpen(false);
    setProfileOpen(o => !o);
    if (!profileLoaded) {
      setProfileLoading(true);
      const { data } = await supabase
        .from('users')
        .select('full_name, department, designation, avatar_url')
        .eq('id', userId)
        .single();
      if (data) {
        setPFullName(data.full_name ?? '');
        setPDepartment(data.department ?? '');
        setPDesignation(data.designation ?? '');
        setPAvatarUrl(data.avatar_url ?? '');
      }
      setProfileLoaded(true);
      setProfileLoading(false);
    }
  }

  async function saveProfile() {
    setPSaving(true);
    setPError('');
    const { error: err } = await supabase
      .from('users')
      .update({
        full_name:   pFullName.trim(),
        department:  pDepartment.trim() || null,
        designation: pDesignation.trim() || null,
        avatar_url:  pAvatarUrl.trim() || null,
      })
      .eq('id', userId);
    if (err) { setPError(err.message); toast(err.message, 'error'); setPSaving(false); return; }
    setPSaving(false);
    setPSaved(true);
    toast('Profile updated.');
    router.refresh();
    setTimeout(() => setPSaved(false), 2500);
  }

  // Close sidebar when the backdrop overlay is tapped
  useEffect(() => {
    const overlay = document.getElementById('sidebar-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', closeMobile);
    return () => overlay.removeEventListener('click', closeMobile);
  }, [closeMobile]);

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH', body: '{}', headers: { 'Content-Type': 'application/json' } });
    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
    setUnread(0);
  }

  function openNotification(n: Notification) {
    setNotifOpen(false);
    setViewingNotif(n);
    if (!n.is_read) {
      fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => {});
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setUnread(u => Math.max(0, u - 1));
    }
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
      {/* Left — breadcrumbs */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
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
            onClick={() => { setProfileOpen(false); setNotifOpen(o => !o); }}
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
                    onClick={() => openNotification(n)}
                    className={cn(
                      'flex gap-3 px-4 py-3 cursor-pointer hover:bg-surface-200/50 transition-colors',
                      !n.is_read && 'bg-brand-500/[0.04]'
                    )}
                  >
                    {!n.is_read && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0" />}
                    <div className={cn('flex-1 min-w-0', n.is_read && 'pl-3.5')}>
                      <p className="text-xs font-semibold text-surface-900 leading-snug">{n.title}</p>
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

        {/* User info — click to edit profile */}
        <div className="relative hidden sm:block" ref={profileRef}>
          <button
            type="button"
            onClick={toggleProfile}
            className={cn(
              'flex items-center gap-2 pl-0.5 pr-2 py-1 rounded-lg transition-colors',
              profileOpen ? 'bg-surface-300' : 'hover:bg-surface-200'
            )}
          >
            <Avatar src={avatarUrl} name={userName} size="sm" />
            <div className="hidden md:block text-left">
              <p className="text-xs font-semibold text-surface-950 leading-tight truncate max-w-[120px]">{userName}</p>
              <p className="text-2xs text-surface-600 capitalize">{userRole.replace('_', ' ')}</p>
            </div>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl bg-surface-100 border border-surface-300 shadow-modal animate-[scaleIn_0.15s_ease-out]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-300">
                <span className="text-sm font-semibold text-surface-950">Edit Profile</span>
                <button onClick={() => setProfileOpen(false)} className="flex h-6 w-6 items-center justify-center rounded-lg text-surface-600 hover:text-surface-950 hover:bg-surface-300 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {profileLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {pError && (
                    <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {pError}
                    </div>
                  )}
                  <div>
                    <label className="block text-2xs font-medium text-surface-700 mb-1">Full name</label>
                    <input
                      type="text" value={pFullName} onChange={e => setPFullName(e.target.value)}
                      className="w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-medium text-surface-700 mb-1">Email</label>
                    <input
                      type="text" value={userEmail} disabled
                      className="w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2 text-sm text-surface-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-2xs font-medium text-surface-700 mb-1">Department</label>
                      <input
                        type="text" value={pDepartment} onChange={e => setPDepartment(e.target.value)}
                        className="w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
                      />
                    </div>
                    <div>
                      <label className="block text-2xs font-medium text-surface-700 mb-1">Designation</label>
                      <input
                        type="text" value={pDesignation} onChange={e => setPDesignation(e.target.value)}
                        className="w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-2xs font-medium text-surface-700 mb-1">Avatar URL</label>
                    <input
                      type="text" value={pAvatarUrl} onChange={e => setPAvatarUrl(e.target.value)} placeholder="https://..."
                      className="w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2 text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={pSaving || !pFullName.trim()}
                    className="flex items-center justify-center gap-2 w-full rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors"
                  >
                    {pSaving
                      ? <Loader2      className="h-3.5 w-3.5 animate-spin" />
                      : pSaved
                        ? <CheckCircle2 className="h-3.5 w-3.5" />
                        : <Save         className="h-3.5 w-3.5" />}
                    {pSaving ? 'Saving…' : pSaved ? 'Saved!' : 'Save changes'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={() => setSignOutOpen(true)}
          title="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-600 hover:text-danger hover:bg-danger/10 transition-colors ml-0.5"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      <Dialog open={!!viewingNotif} onOpenChange={o => { if (!o) setViewingNotif(null); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{viewingNotif?.title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-surface-800 whitespace-pre-wrap">{viewingNotif?.body}</p>
            {viewingNotif && (
              <p className="text-xs text-surface-500 mt-3">{timeAgo(viewingNotif.created_at)}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setViewingNotif(null)}>Close</Button>
            {viewingNotif?.action_url && (
              <Button
                variant="primary"
                size="md"
                className="gap-1.5"
                onClick={() => { const url = viewingNotif.action_url!; setViewingNotif(null); router.push(url); }}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Go to details
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign out?"
        description="You'll need to sign in again to access your dashboard."
        confirmLabel="Sign out"
        variant="danger"
        loading={signingOut}
        onConfirm={signOut}
      />
    </header>
  );
}
