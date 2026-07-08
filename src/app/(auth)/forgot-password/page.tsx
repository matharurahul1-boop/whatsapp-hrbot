'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Mail, Lock, Eye, EyeOff, KeyRound, ArrowRight, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Step = 'email' | 'code';

const RESEND_COOLDOWN_SECONDS = 45;

export default function ForgotPasswordPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [step,     setStep]     = useState<Step>('email');
  const [email,    setEmail]    = useState('');
  const [code,     setCode]     = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  // True only while redirecting after a successful reset — keeps the button
  // disabled through the redirect instead of flashing back to enabled.
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const checkRes = await fetch('/api/auth/check-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (!checkRes.ok) {
      const json = await checkRes.json().catch(() => ({}));
      setLoading(false);
      setError(json.error === 'No account found for this email'
        ? 'No account found with this email address.'
        : (json.error ?? 'Something went wrong. Please try again.'));
      return;
    }

    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());

    setLoading(false);
    if (err) { setError(err.message); return; }
    setStep('code');
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function resendCode() {
    setLoading(true);
    setError(''); setInfo('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
    setLoading(false);
    if (err) { setError(err.message); return; }
    setInfo('A new code has been sent.');
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function verifyAndReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setLoading(true);

    // Verifying the OTP establishes a session for this browser, which
    // updateUser then uses to actually set the new password.
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type:  'recovery',
    });
    if (verifyErr) {
      setLoading(false);
      setError(verifyErr.message.includes('expired') || verifyErr.message.includes('invalid')
        ? 'That code is incorrect or has expired. Request a new one below.'
        : verifyErr.message);
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setLoading(false);
      setError(updateErr.message);
      return;
    }

    // Stay disabled straight through the redirect — no gap where the button
    // flashes back to enabled between the update succeeding and navigation.
    setRedirecting(true);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-brand-500/[0.04] blur-3xl" />

      <div className="w-full max-w-[360px] relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow mb-4">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-950">Reset your password</h1>
          <p className="text-sm text-surface-600 mt-1">
            {step === 'email' ? "We'll email you a verification code" : 'Enter the code and your new password'}
          </p>
        </div>

        <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger mb-4">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {info && !error && (
            <div className="rounded-xl bg-success/10 border border-success/20 px-3.5 py-3 text-sm text-success mb-4">
              {info}
            </div>
          )}

          {step === 'email' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-1.5">
                <label className="label">Work email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus autoComplete="email" className="input pl-9" />
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Sending…</> : <>Send code <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyAndReset} className="space-y-4">
              <p className="text-xs text-surface-600 -mt-1">
                Code sent to <span className="font-medium text-surface-900">{email}</span>.{' '}
                <button type="button" onClick={() => { setStep('email'); setError(''); setInfo(''); }} className="text-brand-400 hover:text-brand-300 font-medium">
                  Wrong email?
                </button>
              </p>
              <div className="space-y-1.5">
                <label className="label">Verification code</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input
                    type="text" inputMode="numeric" value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="Enter verification code" required autoFocus
                    className="input pl-9 tracking-[0.2em] font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" required autoComplete="new-password" className="input pl-9 pr-10" />
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
              <button type="submit" disabled={loading || redirecting} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
                {loading || redirecting ? <><Loader2 className="h-4 w-4 animate-spin" />Updating…</> : <>Reset password <ArrowRight className="h-4 w-4" /></>}
              </button>
              <button type="button" onClick={resendCode} disabled={loading || redirecting || resendCooldown > 0} className="w-full text-center text-xs text-surface-600 hover:text-surface-900 disabled:opacity-50">
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Didn't get it? Resend code"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-surface-600 mt-5">
          <a href="/login" className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 font-medium">
            <ArrowLeft className="h-3 w-3" /> Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
