'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Eye, EyeOff, Mail, Lock, User, ArrowRight, Loader2, AlertCircle, CheckCircle2, Building2, Phone, BriefcaseBusiness, Users, Clock3 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [tab,      setTab]      = useState<'login' | 'signup'>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name,     setName]     = useState('');
  const [orgName, setOrgName] = useState('');
  const [waNumber, setWaNumber] = useState('');
  const [department, setDepartment] = useState('Human Resources');
  const [designation, setDesignation] = useState('Administrator');
  const [companySize, setCompanySize] = useState('1-10');
  const [workdayStart, setWorkdayStart] = useState('09:00');
  const [workdayEnd, setWorkdayEnd] = useState('18:00');
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
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true); reset();
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: name, orgName, email, password, waNumber,
          department, designation, companySize,
          timezone: 'Asia/Kolkata', workdayStart, workdayEnd,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Registration failed');

      if (result.emailConfirmationRequired) {
        setLoading(false);
        setInfo('Workspace created! Check your email to confirm the account, then sign in.');
        setTab('login');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(`Account created, but sign-in failed: ${signInError.message}`);
      window.location.href = '/dashboard';
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : 'Registration failed');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-brand-500/[0.04] blur-3xl" />

      <div className={`w-full ${tab === 'signup' ? 'max-w-[560px]' : 'max-w-[360px]'} relative z-10 transition-all`}>
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
            <form onSubmit={handleSignup} className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">Administrator</p>
                <p className="text-xs text-surface-600 mt-0.5">Your account and contact information</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="label">Your full name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ashish Kumar" required autoFocus className="input pl-9" />
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
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com" required autoComplete="email" className="input pl-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label">Department</label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="text" value={department} onChange={e => setDepartment(e.target.value)} required className="input pl-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="label">Job title</label>
                <div className="relative">
                  <BriefcaseBusiness className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} required className="input pl-9" />
                </div>
              </div>
              </div>

              <div className="border-t border-surface-300/70 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">Workspace</p>
                <p className="text-xs text-surface-600 mt-0.5 mb-4">Used to initialize tasks, attendance, leave, and onboarding</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="label">Company / organisation</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                      <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Acme Corp" required className="input pl-9" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="label">Company size</label>
                    <select value={companySize} onChange={e => setCompanySize(e.target.value)} required className="input">
                      <option value="1-10">1–10 employees</option>
                      <option value="11-50">11–50 employees</option>
                      <option value="51-200">51–200 employees</option>
                      <option value="201-500">201–500 employees</option>
                      <option value="501+">501+ employees</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="label">Workday starts</label>
                    <div className="relative">
                      <Clock3 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                      <input type="time" value={workdayStart} onChange={e => setWorkdayStart(e.target.value)} required className="input pl-9" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="label">Workday ends</label>
                    <div className="relative">
                      <Clock3 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                      <input type="time" value={workdayEnd} onChange={e => setWorkdayEnd(e.target.value)} required className="input pl-9" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 border-t border-surface-300/70 pt-5">
              <div className="space-y-1.5">
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                  <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ chars, upper/lower/number" required minLength={8} autoComplete="new-password" className="input pl-9 pr-10" />
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
              </div>
              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : <>Create Account <ArrowRight className="h-4 w-4" /></>}
              </button>
              <p className="text-xs text-surface-500 text-center">Your workspace and required HR defaults are created together.</p>
            </form>
          )}
        </div>

        {/* Footer links */}
        <div className="mt-5 text-center">
          <p className="text-xs text-surface-500">WhatsApp AI HR Management</p>
        </div>
      </div>
    </div>
  );
}
