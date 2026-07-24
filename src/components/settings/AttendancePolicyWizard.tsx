'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, ChevronLeft, ChevronRight, Pencil, Plus, X, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useToast } from '@/components/ui/Toast';

// ── Types ────────────────────────────────────────────────────────────────
// Mirrors the attendance_policies table (202607241400_attendance_policy.sql).
interface Shift { name: string; start: string; end: string; }
interface GeoFence { name: string; lat: number; lng: number; radius_m: number; }
interface Holiday { date: string; name: string; }

interface AttendancePolicy {
  working_days_type: '5' | '5.5' | '6' | 'rotational';
  weekly_offs: string[];
  shift_type: 'single' | 'multiple_fixed' | 'rotational';
  shifts: Shift[];
  shift_assignment_method: 'manager_assigned' | 'self_select' | 'roster_based' | null;

  is_flexible_hours: boolean;
  flexible_window_start: string | null;
  flexible_window_end: string | null;
  full_day_hours: number;

  grace_period_enabled: boolean;
  grace_minutes: number;
  late_allowed_per_month: number;
  late_violation_action: 'half_day' | 'lop' | 'flag' | 'manager_discretion';

  half_day_threshold_hours: number;
  early_leave_tracked_separately: boolean;
  early_leave_threshold_minutes: number | null;

  capture_methods: string[];
  geo_fence_locations: GeoFence[];
  has_field_employees: boolean;
  wfh_enabled: boolean;
  wfh_requires_approval: boolean;
  wfh_counts_as_attendance: boolean;

  overtime_enabled: boolean;
  overtime_threshold_hours: number | null;
  overtime_requires_preapproval: boolean;

  regularization_enabled: boolean;
  regularization_monthly_limit: number;
  regularization_approver_role: string;

  holidays: Holiday[];
  auto_sync_leave_attendance: boolean;

  escalation_notify: 'manager' | 'hr' | 'both';
  escalation_frequency: 'realtime' | 'weekly' | 'monthly';
  employee_dashboard_visible: boolean;

  summary_text: string | null;
  is_configured: boolean;
}

const DEFAULTS: AttendancePolicy = {
  working_days_type: '5',
  weekly_offs: ['sat', 'sun'],
  shift_type: 'single',
  shifts: [{ name: 'General', start: '09:00', end: '18:00' }],
  shift_assignment_method: null,
  is_flexible_hours: false,
  flexible_window_start: null,
  flexible_window_end: null,
  full_day_hours: 9,
  grace_period_enabled: true,
  grace_minutes: 15,
  late_allowed_per_month: 3,
  late_violation_action: 'flag',
  half_day_threshold_hours: 4.5,
  early_leave_tracked_separately: false,
  early_leave_threshold_minutes: null,
  capture_methods: ['web'],
  geo_fence_locations: [],
  has_field_employees: false,
  wfh_enabled: false,
  wfh_requires_approval: true,
  wfh_counts_as_attendance: true,
  overtime_enabled: false,
  overtime_threshold_hours: null,
  overtime_requires_preapproval: true,
  regularization_enabled: true,
  regularization_monthly_limit: 2,
  regularization_approver_role: 'manager',
  holidays: [],
  auto_sync_leave_attendance: true,
  escalation_notify: 'manager',
  escalation_frequency: 'weekly',
  employee_dashboard_visible: true,
  summary_text: null,
  is_configured: false,
};

const DAY_LABEL: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const CAPTURE_LABEL: Record<string, string> = {
  biometric: 'Biometric', mobile_gps: 'Mobile app (GPS)', selfie: 'Selfie-based',
  web: 'Web check-in', ip_restricted: 'IP-restricted login',
};

function ordinal(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// Composes the plain-English summary shown at the end of the wizard —
// deterministic template, not an LLM call, so it's instant and always
// consistent with what's about to be saved.
function composeSummary(p: AttendancePolicy): string {
  const lines: string[] = [];

  const daysLabel = p.working_days_type === 'rotational' ? 'a rotational schedule' : `${p.working_days_type} days a week`;
  const offs = p.weekly_offs.length ? p.weekly_offs.map(d => DAY_LABEL[d] ?? d).join(' & ') : 'no fixed weekly off';
  lines.push(`Employees work ${daysLabel}${p.working_days_type !== 'rotational' ? `, off on ${offs}` : ''}.`);

  if (p.shift_type === 'single') {
    const s = p.shifts[0];
    lines.push(p.is_flexible_hours
      ? `Flexible hours — log in any time between ${p.flexible_window_start ?? '?'} and ${p.flexible_window_end ?? '?'}, with ${ordinal(p.full_day_hours)} counted as a full day.`
      : `Standard shift ${s?.start ?? '?'}–${s?.end ?? '?'}, ${ordinal(p.full_day_hours)} counted as a full day.`);
  } else {
    lines.push(`${p.shift_type === 'rotational' ? 'Rotational' : 'Multiple fixed'} shifts: ${p.shifts.map(s => `${s.name} (${s.start}–${s.end})`).join(', ')}${p.shift_assignment_method ? `, assigned ${p.shift_assignment_method.replace(/_/g, ' ')}` : ''}.`);
  }

  if (p.grace_period_enabled) {
    lines.push(`${p.grace_minutes}-minute grace period for late login; ${p.late_allowed_per_month} late-comings allowed per month before it's ${
      p.late_violation_action === 'half_day' ? 'marked as a half-day' :
      p.late_violation_action === 'lop' ? 'treated as loss of pay' :
      p.late_violation_action === 'manager_discretion' ? "left to the manager's discretion" : 'flagged for HR'
    }.`);
  } else {
    lines.push('No grace period for late login.');
  }

  lines.push(`Less than ${ordinal(p.half_day_threshold_hours)} worked counts as a half-day.${p.early_leave_tracked_separately ? ` Early leaving is tracked separately (over ${p.early_leave_threshold_minutes ?? '?'} min early).` : ''}`);

  lines.push(`Attendance captured via ${p.capture_methods.map(m => CAPTURE_LABEL[m] ?? m).join(', ')}${p.geo_fence_locations.length ? `, geo-fenced to ${p.geo_fence_locations.length} location(s)` : ''}.`);

  if (p.wfh_enabled) {
    lines.push(`Work-from-home is a separate category${p.wfh_requires_approval ? ', requires approval,' : ''} and ${p.wfh_counts_as_attendance ? 'counts' : "doesn't count"} toward attendance the same as office days.`);
  }

  if (p.overtime_enabled) {
    lines.push(`Overtime is tracked after ${ordinal(p.overtime_threshold_hours ?? 0)}${p.overtime_requires_preapproval ? ', pre-approval required' : ''}.`);
  }

  lines.push(p.regularization_enabled
    ? `Employees can request regularization up to ${p.regularization_monthly_limit} time(s)/month, approved by ${p.regularization_approver_role}.`
    : 'Attendance regularization requests are not allowed.');

  lines.push(`${p.holidays.length} holiday(s) on the calendar. Approved leave ${p.auto_sync_leave_attendance ? 'will not' : 'may'} show as absent.`);

  lines.push(`Repeated lateness/absenteeism notifies ${p.escalation_notify === 'both' ? 'manager & HR' : p.escalation_notify.toUpperCase()}, ${p.escalation_frequency}. Employees ${p.employee_dashboard_visible ? 'can' : "can't"} see their own attendance summary.`);

  return lines.join(' ');
}

// ── Small building blocks ───────────────────────────────────────────────
function StepShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-semibold text-surface-950">{title}</h4>
        {sub && <p className="text-xs text-surface-500 mt-0.5">{sub}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Q({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-surface-700 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function Pills<T extends string>({ options, value, onChange, multi }: {
  options: { value: T; label: string }[];
  value: T[]; onChange: (v: T[]) => void; multi?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => {
        const active = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              if (multi) onChange(active ? value.filter(v => v !== o.value) : [...value, o.value]);
              else onChange([o.value]);
            }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              active ? 'border-brand-500 bg-brand-500/10 text-brand-500' : 'border-surface-300 bg-surface-0 text-surface-700 hover:bg-surface-200'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-sm text-surface-900">{label}</p>
        {hint && <p className="text-xs text-surface-500 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50', value ? 'bg-brand-500' : 'bg-surface-300')}
        aria-label={label}
      >
        <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5', value ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500';

function NumberInput({ value, onChange, min, max, step = 1, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2 max-w-[180px]">
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))} className={inputCls} />
      {suffix && <span className="text-xs text-surface-500 shrink-0">{suffix}</span>}
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="time" value={value} onChange={e => onChange(e.target.value)} className={cn(inputCls, 'max-w-[140px]')} />;
}

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)} className={inputCls}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Main wizard ─────────────────────────────────────────────────────────
export function AttendancePolicyWizard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [policy, setPolicy]   = useState<AttendancePolicy>(DEFAULTS);
  const [editing, setEditing] = useState(false);
  const [step, setStep]       = useState(0); // 0..8 stages, 9 = summary/confirm

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/organizations/attendance-policy');
      const json = await res.json();
      if (json.data) {
        setPolicy({ ...DEFAULTS, ...json.data });
        setEditing(false);
      } else {
        setPolicy(DEFAULTS);
        setEditing(true); // never configured — go straight into the wizard
      }
    } catch {
      toast('Failed to load attendance policy', 'error');
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof AttendancePolicy>(key: K, value: AttendancePolicy[K]) {
    setPolicy(p => ({ ...p, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const summary_text = composeSummary(policy);
      const res = await fetch('/api/organizations/attendance-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...policy, summary_text, is_configured: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');
      setPolicy({ ...DEFAULTS, ...json.data });
      setEditing(false);
      setStep(0);
      toast('Attendance policy saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save attendance policy', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-surface-500 py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  // ── Already configured, not editing: show the summary card ──────────
  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{policy.summary_text ?? composeSummary(policy)}</p>
        </div>
        <button
          type="button"
          onClick={() => { setStep(0); setEditing(true); }}
          className="flex items-center gap-2 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit attendance policy
        </button>
      </div>
    );
  }

  const STAGE_TITLES = [
    'Work structure basics', 'Shift timing rules', 'Late coming & grace period',
    'Half-day & early leaving', 'Attendance capture method', 'Overtime',
    'Regularization', 'Holidays & leave interplay', 'Escalation & visibility',
  ];
  const totalSteps = STAGE_TITLES.length + 1; // + confirmation step

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-brand-500' : 'bg-surface-300')} />
        ))}
      </div>
      <p className="text-xs text-surface-500">Step {step + 1} of {totalSteps}</p>

      {step === 0 && (
        <StepShell title="Stage 1 · Work structure basics">
          <Q label="How many working days does your organization follow in a week?">
            <Select value={policy.working_days_type} onChange={v => set('working_days_type', v)} options={[
              { value: '5', label: '5 days' }, { value: '5.5', label: '5.5 days' },
              { value: '6', label: '6 days' }, { value: 'rotational', label: 'Rotational' },
            ]} />
          </Q>
          {policy.working_days_type !== 'rotational' && (
            <Q label="What are your weekly offs?">
              <Pills multi options={['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => ({ value: d, label: DAY_LABEL[d] }))}
                value={policy.weekly_offs} onChange={v => set('weekly_offs', v)} />
            </Q>
          )}
          <Q label="Do all employees follow the same shift, or do you have multiple shifts?">
            <Select value={policy.shift_type} onChange={v => {
              set('shift_type', v);
              if (v !== 'single' && policy.shifts.length < 2) {
                set('shifts', [...policy.shifts, { name: 'Night', start: '21:00', end: '06:00' }]);
              }
            }} options={[
              { value: 'single', label: 'Single shift' }, { value: 'multiple_fixed', label: 'Multiple fixed shifts' },
              { value: 'rotational', label: 'Rotational shifts' },
            ]} />
          </Q>
          {policy.shift_type !== 'single' && (
            <>
              <Q label="Shifts — name, start & end time">
                <div className="space-y-2">
                  {policy.shifts.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={s.name} onChange={e => {
                        const next = [...policy.shifts]; next[i] = { ...s, name: e.target.value }; set('shifts', next);
                      }} placeholder="Shift name" className={cn(inputCls, 'max-w-[160px]')} />
                      <TimeInput value={s.start} onChange={v => { const next = [...policy.shifts]; next[i] = { ...s, start: v }; set('shifts', next); }} />
                      <span className="text-xs text-surface-500">to</span>
                      <TimeInput value={s.end} onChange={v => { const next = [...policy.shifts]; next[i] = { ...s, end: v }; set('shifts', next); }} />
                      {policy.shifts.length > 1 && (
                        <button type="button" onClick={() => set('shifts', policy.shifts.filter((_, j) => j !== i))} className="text-surface-400 hover:text-danger">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => set('shifts', [...policy.shifts, { name: '', start: '09:00', end: '18:00' }])}
                    className="flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-600">
                    <Plus className="h-3.5 w-3.5" /> Add shift
                  </button>
                </div>
              </Q>
              <Q label="How does shift assignment work?">
                <Select value={policy.shift_assignment_method ?? 'manager_assigned'} onChange={v => set('shift_assignment_method', v)} options={[
                  { value: 'manager_assigned', label: 'Manager-assigned' }, { value: 'self_select', label: 'Self-select' },
                  { value: 'roster_based', label: 'Roster-based' },
                ]} />
              </Q>
            </>
          )}
        </StepShell>
      )}

      {step === 1 && (
        <StepShell title="Stage 2 · Shift timing rules">
          <Q label="Is this a fixed-time shift or flexible hours?">
            <Pills options={[{ value: 'fixed', label: 'Fixed-time shift' }, { value: 'flexible', label: 'Flexible hours' }]}
              value={[policy.is_flexible_hours ? 'flexible' : 'fixed']} onChange={v => set('is_flexible_hours', v[0] === 'flexible')} />
          </Q>
          {!policy.is_flexible_hours ? (
            <Q label="Standard working hours">
              <div className="flex items-center gap-2">
                <TimeInput value={policy.shifts[0]?.start ?? '09:00'} onChange={v => { const next = [...policy.shifts]; next[0] = { ...next[0], start: v } as Shift; set('shifts', next); }} />
                <span className="text-xs text-surface-500">to</span>
                <TimeInput value={policy.shifts[0]?.end ?? '18:00'} onChange={v => { const next = [...policy.shifts]; next[0] = { ...next[0], end: v } as Shift; set('shifts', next); }} />
              </div>
            </Q>
          ) : (
            <Q label="Login window (employee can log in any time within this range)">
              <div className="flex items-center gap-2">
                <TimeInput value={policy.flexible_window_start ?? '08:00'} onChange={v => set('flexible_window_start', v)} />
                <span className="text-xs text-surface-500">to</span>
                <TimeInput value={policy.flexible_window_end ?? '11:00'} onChange={v => set('flexible_window_end', v)} />
              </div>
            </Q>
          )}
          <Q label="How many hours count as a full working day?">
            <NumberInput value={policy.full_day_hours} min={1} max={24} step={0.5} suffix="hrs" onChange={v => set('full_day_hours', v)} />
          </Q>
        </StepShell>
      )}

      {step === 2 && (
        <StepShell title="Stage 3 · Late coming & grace period">
          <ToggleRow label="Allow a grace period for late login?" value={policy.grace_period_enabled} onChange={v => set('grace_period_enabled', v)} />
          {policy.grace_period_enabled && (
            <>
              <Q label="Grace period (minutes)">
                <NumberInput value={policy.grace_minutes} min={0} max={180} suffix="min" onChange={v => set('grace_minutes', v)} />
              </Q>
              <Q label="Late-comings allowed per month before it's a violation">
                <NumberInput value={policy.late_allowed_per_month} min={0} max={60} onChange={v => set('late_allowed_per_month', v)} />
              </Q>
            </>
          )}
          <Q label="What happens after the grace/allowance limit is exceeded?">
            <Select value={policy.late_violation_action} onChange={v => set('late_violation_action', v)} options={[
              { value: 'half_day', label: 'Half-day deduction' }, { value: 'lop', label: 'Loss of pay (LOP)' },
              { value: 'flag', label: 'Just a flag for HR' }, { value: 'manager_discretion', label: 'Manager discretion' },
            ]} />
          </Q>
        </StepShell>
      )}

      {step === 3 && (
        <StepShell title="Stage 4 · Half-day & early leaving">
          <Q label="What defines a half-day? (hours worked below this counts as half-day)">
            <NumberInput value={policy.half_day_threshold_hours} min={0} max={24} step={0.5} suffix="hrs" onChange={v => set('half_day_threshold_hours', v)} />
          </Q>
          <ToggleRow label="Track early leaving separately from late coming?" value={policy.early_leave_tracked_separately} onChange={v => set('early_leave_tracked_separately', v)} />
          {policy.early_leave_tracked_separately && (
            <Q label="Early-leave threshold (minutes before shift end)">
              <NumberInput value={policy.early_leave_threshold_minutes ?? 30} min={0} max={480} suffix="min" onChange={v => set('early_leave_threshold_minutes', v)} />
            </Q>
          )}
        </StepShell>
      )}

      {step === 4 && (
        <StepShell title="Stage 5 · Attendance capture method">
          <Q label="How will employees mark attendance?">
            <Pills multi options={Object.entries(CAPTURE_LABEL).map(([value, label]) => ({ value, label }))}
              value={policy.capture_methods} onChange={v => set('capture_methods', v)} />
          </Q>
          {policy.capture_methods.includes('mobile_gps') && (
            <Q label="Office location(s) for geo-fencing">
              <div className="space-y-2">
                {policy.geo_fence_locations.map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={g.name} onChange={e => { const next = [...policy.geo_fence_locations]; next[i] = { ...g, name: e.target.value }; set('geo_fence_locations', next); }}
                      placeholder="Office name" className={cn(inputCls, 'max-w-[140px]')} />
                    <input type="number" value={g.lat} onChange={e => { const next = [...policy.geo_fence_locations]; next[i] = { ...g, lat: Number(e.target.value) }; set('geo_fence_locations', next); }}
                      placeholder="Lat" className={cn(inputCls, 'max-w-[100px]')} />
                    <input type="number" value={g.lng} onChange={e => { const next = [...policy.geo_fence_locations]; next[i] = { ...g, lng: Number(e.target.value) }; set('geo_fence_locations', next); }}
                      placeholder="Lng" className={cn(inputCls, 'max-w-[100px]')} />
                    <input type="number" value={g.radius_m} onChange={e => { const next = [...policy.geo_fence_locations]; next[i] = { ...g, radius_m: Number(e.target.value) }; set('geo_fence_locations', next); }}
                      placeholder="Radius (m)" className={cn(inputCls, 'max-w-[110px]')} />
                    <button type="button" onClick={() => set('geo_fence_locations', policy.geo_fence_locations.filter((_, j) => j !== i))} className="text-surface-400 hover:text-danger">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => set('geo_fence_locations', [...policy.geo_fence_locations, { name: '', lat: 0, lng: 0, radius_m: 200 }])}
                  className="flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-600">
                  <Plus className="h-3.5 w-3.5" /> Add location
                </button>
              </div>
            </Q>
          )}
          <ToggleRow label="Do field employees exist (separate remote/field attendance policy)?" value={policy.has_field_employees} onChange={v => set('has_field_employees', v)} />
          <ToggleRow label="Need Work-From-Home as a separate attendance category?" value={policy.wfh_enabled} onChange={v => set('wfh_enabled', v)} />
          {policy.wfh_enabled && (
            <>
              <ToggleRow label="WFH requires approval?" value={policy.wfh_requires_approval} onChange={v => set('wfh_requires_approval', v)} />
              <ToggleRow label="WFH counts toward attendance % the same as office days?" value={policy.wfh_counts_as_attendance} onChange={v => set('wfh_counts_as_attendance', v)} />
            </>
          )}
        </StepShell>
      )}

      {step === 5 && (
        <StepShell title="Stage 6 · Overtime">
          <ToggleRow label="Track and compensate overtime?" value={policy.overtime_enabled} onChange={v => set('overtime_enabled', v)} />
          {policy.overtime_enabled && (
            <>
              <Q label="Overtime starts after this many hours">
                <NumberInput value={policy.overtime_threshold_hours ?? policy.full_day_hours} min={0} max={24} step={0.5} suffix="hrs" onChange={v => set('overtime_threshold_hours', v)} />
              </Q>
              <ToggleRow label="Requires pre-approval?" value={policy.overtime_requires_preapproval} onChange={v => set('overtime_requires_preapproval', v)} />
            </>
          )}
        </StepShell>
      )}

      {step === 6 && (
        <StepShell title="Stage 7 · Regularization">
          <ToggleRow label="Can employees request attendance regularization (e.g. forgot to punch in/out)?" value={policy.regularization_enabled} onChange={v => set('regularization_enabled', v)} />
          {policy.regularization_enabled && (
            <>
              <Q label="How many regularization requests are allowed per month?">
                <NumberInput value={policy.regularization_monthly_limit} min={0} max={31} onChange={v => set('regularization_monthly_limit', v)} />
              </Q>
              <Q label="Who approves them?">
                <Select value={policy.regularization_approver_role} onChange={v => set('regularization_approver_role', v)} options={[
                  { value: 'manager', label: 'Manager' }, { value: 'hr', label: 'HR' }, { value: 'hr_assistant', label: 'HR Assistant' }, { value: 'admin', label: 'Admin' },
                ]} />
              </Q>
            </>
          )}
        </StepShell>
      )}

      {step === 7 && (
        <StepShell title="Stage 8 · Holidays & leave interplay">
          <Q label="Holiday calendar for the year">
            <div className="space-y-2">
              {policy.holidays.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="date" value={h.date} onChange={e => { const next = [...policy.holidays]; next[i] = { ...h, date: e.target.value }; set('holidays', next); }} className={cn(inputCls, 'max-w-[160px]')} />
                  <input value={h.name} onChange={e => { const next = [...policy.holidays]; next[i] = { ...h, name: e.target.value }; set('holidays', next); }} placeholder="Holiday name" className={inputCls} />
                  <button type="button" onClick={() => set('holidays', policy.holidays.filter((_, j) => j !== i))} className="text-surface-400 hover:text-danger">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => set('holidays', [...policy.holidays, { date: '', name: '' }])}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-600">
                <Plus className="h-3.5 w-3.5" /> Add holiday
              </button>
            </div>
          </Q>
          <ToggleRow label="Auto-sync attendance with approved leaves?" hint="Approved leave won't show as absent" value={policy.auto_sync_leave_attendance} onChange={v => set('auto_sync_leave_attendance', v)} />
        </StepShell>
      )}

      {step === 8 && (
        <StepShell title="Stage 9 · Escalation & visibility">
          <Q label="Who should be notified for repeated late-coming or absenteeism?">
            <Select value={policy.escalation_notify} onChange={v => set('escalation_notify', v)} options={[
              { value: 'manager', label: 'Manager' }, { value: 'hr', label: 'HR' }, { value: 'both', label: 'Both' },
            ]} />
          </Q>
          <Q label="At what frequency?">
            <Select value={policy.escalation_frequency} onChange={v => set('escalation_frequency', v)} options={[
              { value: 'realtime', label: 'Real-time' }, { value: 'weekly', label: 'Weekly digest' }, { value: 'monthly', label: 'Monthly digest' },
            ]} />
          </Q>
          <ToggleRow label="Should employees see their own attendance summary/dashboard?" value={policy.employee_dashboard_visible} onChange={v => set('employee_dashboard_visible', v)} />
        </StepShell>
      )}

      {step === 9 && (
        <StepShell title="Review & confirm" sub="Catch any misunderstandings before this goes live — nothing is saved until you confirm.">
          <div className="rounded-lg border border-surface-300 bg-surface-200/50 px-4 py-3 text-sm text-surface-800 leading-relaxed">
            {composeSummary(policy)}
          </div>
        </StepShell>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-surface-300">
        <button
          type="button"
          onClick={() => step === 0 ? setEditing(policy.is_configured ? false : true) : setStep(s => s - 1)}
          disabled={step === 0 && !policy.is_configured}
          className="flex items-center gap-1.5 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 disabled:opacity-40 disabled:cursor-not-allowed text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> {step === 0 ? 'Cancel' : 'Back'}
        </button>

        {step < totalSteps - 1 ? (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 transition-colors shadow-glow"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Confirm & save policy'}
          </button>
        )}
      </div>
    </div>
  );
}
