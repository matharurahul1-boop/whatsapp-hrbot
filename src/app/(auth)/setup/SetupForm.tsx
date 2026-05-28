'use client';

import { useState }    from 'react';
import { useRouter }   from 'next/navigation';
import {
  Zap, AlertCircle, Loader2,
  LogOut, Building2, User, ArrowRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Props {
  userId:      string;
  email:       string;
  prefillName: string;
}

export default function SetupForm({ userId, email, prefillName }: Props) {
  const router   = useRouter();
  const supabase = createClient();

  const [fullName, setFullName] = useState(prefillName);
  const [orgName,  setOrgName]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !orgName.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res  = await fetch('/api/auth/setup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fullName, orgName, userId, email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Setup failed');

      // Hard navigate so the server layout picks up the new session/profile
      window.location.href = '/dashboard';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-brand-500/[0.04] blur-3xl" />

      <div className="w-full max-w-[400px] relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow mb-4">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-950">HRBot</h1>
          <p className="text-sm text-surface-600 mt-1">Create your admin workspace</p>
        </div>

        {/* Signed-in chip */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-surface-300/80 bg-surface-100 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-surface-700">
            <User className="h-3.5 w-3.5 text-brand-400" />
            <span>
              Signed in as{' '}
              <span className="font-medium text-surface-950 truncate max-w-[160px] inline-block align-bottom">
                {email}
              </span>
            </span>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs text-surface-600 hover:text-danger transition-colors shrink-0 ml-2"
          >
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
          <p className="text-sm font-semibold text-surface-950 mb-1">Set up your workspace</p>
          <p className="text-xs text-surface-600 mb-5">
            Creates your organisation and admin profile. Only needed once.
          </p>

          <form onSubmit={handleCreate} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Full name */}
            <div className="space-y-1.5">
              <label className="label">Your full name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Ashish Kumar"
                  required
                  autoFocus
                  className="input pl-9"
                />
              </div>
            </div>

            {/* Org name */}
            <div className="space-y-1.5">
              <label className="label">Company / Organisation name</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  placeholder="Acme Corp"
                  required
                  className="input pl-9"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !fullName.trim() || !orgName.trim()}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50"
            >
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</>
                : <>Create Admin Account <ArrowRight className="h-4 w-4" /></>
              }
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-surface-500 mt-5">
          Have an invite link?{' '}
          <a href="/join" className="text-brand-400 hover:text-brand-300 font-medium">
            Join your team →
          </a>
        </p>
      </div>
    </div>
  );
}
