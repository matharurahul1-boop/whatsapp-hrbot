'use client';

import { useState, useEffect } from 'react';
import { Zap, Eye, EyeOff, Lock, ArrowRight, Loader2, AlertCircle, CheckCircle2, Smartphone } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const REMEMBER_KEY = 'hrbot_remember_id';

export default function LoginPage() {
  const supabase = createClient();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [rememberMe,  setRememberMe]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) { setEmail(saved); setRememberMe(true); }
    } catch {}
  }, []);

  function reset() { setError(''); setInfo(''); }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); reset();

    let loginEmail = email.trim();

    // If input is not an email, treat as WhatsApp/mobile number — look up email
    if (!loginEmail.includes('@')) {
      const res = await fetch('/api/auth/lookup-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loginEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'No account found for this number'); setLoading(false); return; }
      loginEmail = data.email;
    }

    const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (err) { setError(err.message); setLoading(false); return; }

    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {}

    window.location.href = '/dashboard';
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

        {/* Card */}
        <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
          <p className="text-sm font-semibold text-surface-950 mb-5">Sign in to your workspace</p>

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

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="label">Email or WhatsApp number</label>
              <div className="relative">
                <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com or 9876543210" required autoFocus autoComplete="email" className="input pl-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="label">Password</label>
                <a href="/forgot-password" className="text-2xs text-brand-400 hover:text-brand-300 font-medium">Forgot password?</a>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required autoComplete="current-password" className="input pl-9 pr-10" />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-950 transition-colors">
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-surface-400 accent-brand-500 cursor-pointer"
              />
              <span className="text-xs text-surface-600">Remember me</span>
            </label>
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Signing in…</> : <>Sign In <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        </div>

        {/* Footer links */}
        <div className="mt-5 text-center">
          <p className="text-xs text-surface-500">WhatsApp AI HR Management</p>
        </div>
      </div>
    </div>
  );
}
