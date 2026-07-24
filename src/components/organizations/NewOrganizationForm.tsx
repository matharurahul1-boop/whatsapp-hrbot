'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  User, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, CheckCircle2,
  Building2, Phone, BriefcaseBusiness, Clock3, ChevronLeft, ChevronRight, SkipForward,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { AttendancePolicy } from '@/lib/utils/attendance-policy-shared';
import { ATTENDANCE_POLICY_DEFAULTS, composeAttendancePolicySummary } from '@/lib/utils/attendance-policy-shared';
import { AttendancePolicySteps, ATTENDANCE_STAGE_TITLES, StepShell } from '@/components/settings/AttendancePolicySteps';
import { SelectOrCustom } from '@/components/ui/SelectOrCustom';
import { JOB_TITLE_OPTIONS } from '@/lib/constants/org-fields';

type FormStage = 'org' | 'attendance' | 'review';

export function NewOrganizationForm() {
  const router = useRouter();
  const [stage, setStage] = useState<FormStage>('org');

  // ── Administrator + Workspace fields ──────────────────────────────────────
  const [name,        setName]        = useState('');
  const [waNumber,    setWaNumber]    = useState('');
  const [email,       setEmail]       = useState('');
  const [designation, setDesignation] = useState('Administrator');
  const [orgName,      setOrgName]      = useState('');
  const [companySize,  setCompanySize]  = useState('1-10');
  const [workdayStart, setWorkdayStart] = useState('09:00');
  const [workdayEnd,   setWorkdayEnd]   = useState('18:00');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  // ── Attendance policy (optional — can be skipped and set up later) ───────
  const [attendanceStep, setAttendanceStep] = useState(0); // 0..8 stages, 9 = review
  const [policy, setPolicyState] = useState<AttendancePolicy>(ATTENDANCE_POLICY_DEFAULTS);
  const [skipAttendance, setSkipAttendance] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [info,    setInfo]    = useState('');

  function setPolicy<K extends keyof AttendancePolicy>(key: K, value: AttendancePolicy[K]) {
    setPolicyState(p => ({ ...p, [key]: value }));
  }

  function handleOrgNext(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setError('');
    setStage('attendance');
  }

  async function handleCreate() {
    setLoading(true); setError(''); setInfo('');
    try {
      const attendancePolicy = skipAttendance ? undefined : {
        ...policy,
        summary_text: composeAttendancePolicySummary(policy),
        is_configured: true,
      };
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: name, orgName, email, password, waNumber,
          designation, companySize,
          timezone: 'Asia/Kolkata', workdayStart, workdayEnd,
          attendancePolicy,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create organization');

      setInfo(result.emailConfirmationRequired
        ? `Workspace "${orgName}" created. The new admin needs to confirm ${email} before they can sign in.`
        : `Workspace "${orgName}" created — ${email} can sign in now.`);
      setName(''); setWaNumber(''); setEmail(''); setOrgName('');
      setPassword(''); setConfirmPassword('');
      setPolicyState(ATTENDANCE_POLICY_DEFAULTS);
      setSkipAttendance(false);
      setAttendanceStep(0);
      setStage('org');
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

      {/* ── Stage 1: Administrator + Workspace ── */}
      {stage === 'org' && (
        <form onSubmit={handleOrgNext} className="space-y-5">
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
              <label className="label">Job title</label>
              <div className="relative">
                <BriefcaseBusiness className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none z-10" />
                <SelectOrCustom
                  value={designation} onChange={setDesignation}
                  options={JOB_TITLE_OPTIONS} placeholder="Select job title" required
                  className="input pl-9"
                />
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

          <button type="submit" className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-brand-gradient text-white text-sm font-semibold mt-1 transition-all shadow-glow-sm hover:opacity-90">
            Next: Attendance policy <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      )}

      {/* ── Stage 2: Attendance policy (optional, skippable) ── */}
      {stage === 'attendance' && (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">Attendance Policy</p>
              <p className="text-xs text-surface-600 mt-0.5">Optional — working days, shifts, grace period, and more. You can set this up later from Settings instead.</p>
            </div>
            <button
              type="button"
              onClick={() => { setSkipAttendance(true); setStage('review'); }}
              className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-surface-600 hover:text-surface-900"
            >
              <SkipForward className="h-3.5 w-3.5" /> Skip for now
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {Array.from({ length: ATTENDANCE_STAGE_TITLES.length }).map((_, i) => (
              <div key={i} className={cn('h-1 flex-1 rounded-full', i <= attendanceStep ? 'bg-brand-500' : 'bg-surface-300')} />
            ))}
          </div>
          <p className="text-xs text-surface-500">Step {attendanceStep + 1} of {ATTENDANCE_STAGE_TITLES.length}</p>

          <AttendancePolicySteps policy={policy} set={setPolicy} step={attendanceStep} />

          <div className="flex items-center justify-between pt-2 border-t border-surface-300">
            <button
              type="button"
              onClick={() => attendanceStep === 0 ? setStage('org') : setAttendanceStep(s => s - 1)}
              className="flex items-center gap-1.5 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (attendanceStep < ATTENDANCE_STAGE_TITLES.length - 1) { setAttendanceStep(s => s + 1); return; }
                setSkipAttendance(false);
                setStage('review');
              }}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 transition-colors"
            >
              {attendanceStep < ATTENDANCE_STAGE_TITLES.length - 1 ? <>Next <ChevronRight className="h-3.5 w-3.5" /></> : <>Review <ChevronRight className="h-3.5 w-3.5" /></>}
            </button>
          </div>
        </div>
      )}

      {/* ── Stage 3: Review & create ── */}
      {stage === 'review' && (
        <div className="space-y-5">
          <StepShell
            title="Review & create"
            sub="Nothing is created until you confirm."
          >
            <div className="rounded-lg border border-surface-300 bg-surface-200/50 px-4 py-3 text-sm text-surface-800 space-y-1">
              <p><span className="text-surface-500">Admin:</span> {name} ({email}), {designation}</p>
              <p><span className="text-surface-500">Workspace:</span> {orgName}, {companySize} employees, {workdayStart}–{workdayEnd}</p>
            </div>
            {skipAttendance ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-surface-300 bg-surface-200/50 px-4 py-3 text-sm text-surface-600">
                Attendance policy skipped — the new admin can configure it later from Settings → Attendance Policy.
              </div>
            ) : (
              <div className="rounded-lg border border-surface-300 bg-surface-200/50 px-4 py-3 text-sm text-surface-800 leading-relaxed">
                {composeAttendancePolicySummary(policy)}
              </div>
            )}
          </StepShell>

          <div className="flex items-center justify-between pt-2 border-t border-surface-300">
            <button
              type="button"
              onClick={() => setStage('attendance')}
              className="flex items-center gap-1.5 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-brand-gradient text-white text-sm font-semibold px-5 py-2.5 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : <>Create Organization <ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
