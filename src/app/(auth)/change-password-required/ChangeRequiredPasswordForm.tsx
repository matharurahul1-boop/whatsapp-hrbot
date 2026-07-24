'use client';

import { useState } from 'react';
import { Zap, Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';

export function ChangeRequiredPasswordForm() {
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/change-required-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not change password');
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-brand-500/[0.04] blur-3xl" />

      <div className="w-full max-w-[360px] relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow mb-4">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-950">HRBot</h1>
        </div>

        <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
          <div className="flex items-start gap-2.5 rounded-xl bg-brand-500/[0.08] border border-brand-500/20 px-3.5 py-3 text-sm text-surface-800 mb-5">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-brand-400" />
            <p>Your workspace was set up by someone else, so set your own password before continuing.</p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger mb-4">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="label">New password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ chars, upper/lower/number" required minLength={8} autoFocus autoComplete="new-password" className="input pl-9 pr-10" />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-950 transition-colors">
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="label">Confirm password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input type={showPw ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat password" required minLength={8} autoComplete="new-password" className="input pl-9" />
              </div>
            </div>
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <>Set Password &amp; Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
