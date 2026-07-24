'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, User, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, Building2, CheckCircle2, Phone, Briefcase, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { SelectOrCustom } from '@/components/ui/SelectOrCustom';
import { DEPARTMENT_OPTIONS, JOB_TITLE_OPTIONS } from '@/lib/constants/org-fields';

function JoinForm() {
  const router   = useRouter();
  const params   = useSearchParams();
  const supabase = createClient();

  const inviteToken = params.get('token') ?? '';

  // This page only works via a signed invite link (?token=...) minted by an
  // admin/HR user through the Team page's Invite panel — org + role are
  // baked into the token and re-verified server-side on submit, never
  // trusted from the URL alone. There used to be a bare-visit path that let
  // anyone pick from a public list of every organization on the platform
  // and self-join as an employee with no invite at all — closed, since
  // publicly enumerating every customer's org name is a real leak for a
  // product sold to multiple companies (and self-joining a stranger's
  // workspace was never intentional).
  const hasInviteLink = !!inviteToken;

  const [orgName,    setOrgName]    = useState('');
  const [role,       setRole]       = useState<'employee' | 'manager' | 'hr'>('employee');
  const [checking,   setChecking]   = useState(true);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState(false);
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [waNumber,    setWaNumber]    = useState('');
  const [department,  setDepartment]  = useState('');
  const [designation, setDesignation] = useState('');
  const [password,    setPassword]    = useState('');
  const [showPw,      setShowPw]      = useState(false);

  const ROLE_LABEL: Record<string, string> = { employee: 'Team Member', manager: 'Manager', hr: 'HR Staff' };

  useEffect(() => {
    if (!hasInviteLink) {
      setError('This link is invalid. Ask your admin or HR team for a fresh invite link.');
      setChecking(false);
      return;
    }
    fetch(`/api/auth/verify-invite?token=${encodeURIComponent(inviteToken)}`)
      .then(r => r.json())
      .then(d => {
        if (d.orgName) { setOrgName(d.orgName); setRole(d.role); }
        else setError(d.error ?? 'Invite link is invalid or has expired.');
      })
      .catch(() => setError('Could not verify invite link.'))
      .finally(() => setChecking(false));
  }, [hasInviteLink, inviteToken]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true); setError('');

    // Belt-and-suspenders: Supabase's own signUp() is supposed to reject an
    // already-registered email, but don't rely on that alone — check the
    // users table directly first so a quirky edge case can't silently
    // orphan or replace an existing employee's account.
    const checkRes = await fetch('/api/auth/check-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (checkRes.ok) {
      setError('This email already has an account. Please sign in instead.');
      setLoading(false);
      return;
    }

    const { data, error: err } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (err) { setError(err.message); setLoading(false); return; }
    if (data?.user?.identities?.length === 0) {
      setError('This email already has an account. Please sign in instead.');
      setLoading(false); return;
    }

    const res  = await fetch('/api/auth/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken, fullName: name, waNumber, department, designation }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Failed to join'); setLoading(false); return; }

    setSuccess(true);
    setTimeout(() => { router.push('/dashboard'); router.refresh(); }, 1500);
  }

  if (checking) return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
    </div>
  );

  if (success) return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="text-center space-y-3">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-success/10 mb-2">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <h2 className="text-xl font-bold text-surface-950">Welcome to the team! 🎉</h2>
        <p className="text-sm text-surface-600">Redirecting to your dashboard…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-brand-500/[0.04] blur-3xl" />

      <div className="w-full max-w-[360px] relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow mb-4">
            <Zap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-surface-950">Join HRBot</h1>
          <p className="text-sm text-surface-600 mt-1">You&apos;ve been invited to join a workspace</p>
        </div>

        {/* Org banner */}
        {orgName && !error && (
          <div className="flex items-center gap-3 rounded-xl bg-brand-500/[0.08] border border-brand-500/20 px-4 py-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 shrink-0">
              <Building2 className="h-4 w-4 text-brand-400" />
            </div>
            <div className="min-w-0">
              <p className="text-2xs text-surface-600 uppercase tracking-wide font-semibold">Joining as</p>
              <p className="text-sm font-semibold text-surface-950 truncate">
                {ROLE_LABEL[role]} @ <span className="text-brand-400">{orgName}</span>
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger mb-4">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Form */}
        {!error && (
          <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
            <p className="text-sm font-semibold text-surface-950 mb-5">Create your account</p>

            <form onSubmit={handleJoin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="label">Full name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" required autoFocus className="input pl-9" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="label">Work email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" className="input pl-9" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="label">WhatsApp number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="tel" value={waNumber} onChange={e => setWaNumber(e.target.value)} placeholder="+91 98765 43210" required className="input pl-9" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="label">Department</label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none z-10" />
                  <SelectOrCustom
                    value={department} onChange={setDepartment}
                    options={DEPARTMENT_OPTIONS} placeholder="Select department" required
                    className="input pl-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="label">Job title</label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none z-10" />
                  <SelectOrCustom
                    value={designation} onChange={setDesignation}
                    options={JOB_TITLE_OPTIONS} placeholder="Select job title" required
                    className="input pl-9"
                  />
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
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Joining…</> : <>Join Workspace <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-xs text-surface-600 mt-5">
          Already have an account?{' '}
          <a href="/login" className="text-brand-400 hover:text-brand-300 font-medium">Sign in →</a>
        </p>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
      </div>
    }>
      <JoinForm />
    </Suspense>
  );
}
