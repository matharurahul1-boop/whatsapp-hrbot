'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Eye, EyeOff, Mail, Lock, User, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [tab,      setTab]      = useState<'login' | 'signup'>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');

  function reset() { setError(''); setInfo(''); }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); reset();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); return; }
    // Hard navigate so the server layout re-runs with the new session cookie.
    // Middleware will redirect /dashboard → /setup if profile doesn't exist yet.
    window.location.href = '/dashboard';
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true); reset();
    const { data, error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/setup` },
    });
    if (err) { setError(err.message); setLoading(false); return; }
    if (data?.user?.identities?.length === 0) {
      setError('An account with this email already exists. Please sign in.');
      setTab('login'); setLoading(false); return;
    }
    if (data?.session) { window.location.href = '/setup'; return; }
    setLoading(false);
    setInfo('Account created! Check your email to confirm, then sign in.');
    setTab('login');
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-brand-500/[0.04] blur-3xl" />

      <div className="w-full max-w-[360px] relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow mb-4">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-950">HRBot</h1>
          <p className="text-sm text-surface-600 mt-1">AI-powered HR Management System</p>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-xl border border-surface-300 bg-surface-200/60 p-1 mb-4 gap-1">
          {(['login', 'signup'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); reset(); }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                tab === t
                  ? 'bg-brand-gradient text-white shadow-glow-sm'
                  : 'text-surface-600 hover:text-surface-950'
              }`}
            >
              {t === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
          <p className="text-sm font-semibold text-surface-950 mb-5">
            {tab === 'login' ? 'Sign in to your workspace' : 'Create your admin account'}
          </p>

          {/* Banners */}
          {info && (
            <div className="flex items-start gap-2.5 rounded-xl bg-success/10 border border-success/20 px-3.5 py-3 text-sm text-success mb-4">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              {info}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger mb-4">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Sign In */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com" required autoFocus autoComplete="email" className="input pl-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" className="input pl-9 pr-10" />
                  <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-950 transition-colors">
                    {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Signing in…</> : <>Sign In <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          )}

          {/* Sign Up */}
          {tab === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-1.5">
                <label className="label">Your full name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ashish Kumar" required autoFocus className="input pl-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com" required autoComplete="email" className="input pl-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" required autoComplete="new-password" className="input pl-9 pr-10" />
                  <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-950 transition-colors">
                    {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : <>Create Account <ArrowRight className="h-4 w-4" /></>}
              </button>
              <p className="text-xs text-surface-500 text-center">You'll set up your organization name next</p>
            </form>
          )}
        </div>

        {/* Footer links */}
        <div className="mt-5 space-y-2 text-center">
          <p className="text-xs text-surface-500">WhatsApp AI HR Management</p>
          <p className="text-xs text-surface-600">
            Got an invite?{' '}
            <a href="/join" className="text-brand-400 hover:text-brand-300 font-medium">Join your team →</a>
          </p>
        </div>
      </div>
    </div>
  );
}
