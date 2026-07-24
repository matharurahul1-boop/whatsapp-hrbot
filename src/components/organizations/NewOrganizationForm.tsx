'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, CheckCircle2,
  Building2, Phone, BriefcaseBusiness, Users, Clock3,
} from 'lucide-react';

export function NewOrganizationForm() {
  const router = useRouter();

  const [name,        setName]        = useState('');
  const [waNumber,    setWaNumber]    = useState('');
  const [email,       setEmail]       = useState('');
  const [department,  setDepartment]  = useState('Human Resources');
  const [designation, setDesignation] = useState('Administrator');
  const [orgName,      setOrgName]      = useState('');
  const [companySize,  setCompanySize]  = useState('1-10');
  const [workdayStart, setWorkdayStart] = useState('09:00');
  const [workdayEnd,   setWorkdayEnd]   = useState('18:00');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [info,    setInfo]    = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true); setError(''); setInfo('');
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
      if (!response.ok) throw new Error(result.error || 'Could not create organization');

      setInfo(result.emailConfirmationRequired
        ? `Workspace "${orgName}" created. The new admin needs to confirm ${email} before they can sign in.`
        : `Workspace "${orgName}" created — ${email} can sign in now.`);
      setName(''); setWaNumber(''); setEmail(''); setOrgName('');
      setPassword(''); setConfirmPassword('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create organization');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-surface-300/80 bg-surface-100 p-6 shadow-card">
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

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">Administrator</p>
          <p className="text-xs text-surface-600 mt-0.5">The founding admin account for this new workspace</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="label">Full name</label>
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
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@company.com" required autoComplete="off" className="input pl-9" />
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
            <label className="label">Admin password</label>
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
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : <>Create Organization <ArrowRight className="h-4 w-4" /></>}
        </button>
        <p className="text-xs text-surface-500 text-center">The workspace and its required HR defaults are created together. You stay signed in as yourself.</p>
      </form>
    </div>
  );
}
