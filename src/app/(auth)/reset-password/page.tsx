'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router   = useRouter();
  const supabase = createClient();

  // The reset-password email link logs the browser into a short-lived
  // "recovery" session. supabase-js parses that from the URL automatically
  // and fires PASSWORD_RECOVERY once it's ready to accept a new password.
  const [ready,   setReady]   = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // If a session already exists (e.g. link opened a second time), the
    // event may not fire again — check directly as a fallback.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const timer = setTimeout(() => setLinkError(prev => (ready ? prev : true)), 5000);
    return () => { listener.subscription.unsubscribe(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true); setError('');

    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) { setError(err.message); return; }

    setSuccess(true);
    setTimeout(() => { router.push('/dashboard'); router.refresh(); }, 1500);
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-brand-500/[0.04] blur-3xl" />

      <div className="w-full max-w-[360px] relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow mb-4">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-950">Set a new password</h1>
          <p className="text-sm text-surface-600 mt-1">Choose something you haven't used before</p>
        </div>

        <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
          {success ? (
            <div className="text-center space-y-3 py-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <p className="text-sm font-semibold text-surface-950">Password updated</p>
              <p className="text-xs text-surface-600">Redirecting to your dashboard…</p>
            </div>
          ) : linkError && !ready ? (
            <div className="text-center space-y-3 py-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
                <AlertCircle className="h-6 w-6 text-danger" />
              </div>
              <p className="text-sm font-semibold text-surface-950">Link expired or invalid</p>
              <p className="text-xs text-surface-600">Password reset links only work once and expire after a while.</p>
              <a href="/forgot-password" className="inline-block text-xs text-brand-400 hover:text-brand-300 font-medium mt-1">
                Request a new link →
              </a>
            </div>
          ) : !ready ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="label">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" required autoFocus autoComplete="new-password" className="input pl-9 pr-10" />
                  <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-950 transition-colors">
                    {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label">Confirm new password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type={showPw ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat password" required autoComplete="new-password" className="input pl-9" />
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Updating…</> : <>Update password <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
