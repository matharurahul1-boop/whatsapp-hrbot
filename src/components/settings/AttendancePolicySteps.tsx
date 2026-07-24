'use client';

import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { AttendancePolicy, Shift } from '@/lib/utils/attendance-policy-shared';
import { ATTENDANCE_DAY_LABEL, ATTENDANCE_CAPTURE_LABEL } from '@/lib/utils/attendance-policy-shared';

// Pure step renderer for the Attendance Policy wizard — no data fetching, no
// save/footer logic. Shared between the Settings page's AttendancePolicyWizard
// (self-contained, persists via the API) and the New Organization flow
// (collects state locally, submitted together with org creation). Both wrap
// this with their own navigation/footer.

export const ATTENDANCE_STAGE_TITLES = [
  'Work structure basics', 'Shift timing rules', 'Late coming & grace period',
  'Half-day & early leaving', 'Attendance capture method', 'Overtime',
  'Regularization', 'Holidays & leave interplay', 'Escalation & visibility',
];

export function StepShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
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

export function AttendancePolicySteps({ policy, set, step }: {
  policy: AttendancePolicy;
  set: <K extends keyof AttendancePolicy>(key: K, value: AttendancePolicy[K]) => void;
  step: number;
}) {
  return (
    <>
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
              <Pills multi options={['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => ({ value: d, label: ATTENDANCE_DAY_LABEL[d] }))}
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
            <Pills multi options={Object.entries(ATTENDANCE_CAPTURE_LABEL).map(([value, label]) => ({ value, label }))}
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
    </>
  );
}
