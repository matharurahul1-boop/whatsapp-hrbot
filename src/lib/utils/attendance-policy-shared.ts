// Shared between the client-side Attendance Policy wizard (Settings page and
// the New Organization flow, src/components/settings/AttendancePolicySteps.tsx)
// and server-side org provisioning (src/lib/auth/provision-admin.ts) — pure,
// framework-agnostic, no React/Next imports, so it's safe to use from both.

export interface Shift { name: string; start: string; end: string; }
export interface GeoFence { name: string; lat: number; lng: number; radius_m: number; }
export interface Holiday { date: string; name: string; }

export interface AttendancePolicy {
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
  // Only meaningful when has_field_employees is true — asked as a follow-up,
  // not bundled into the same toggle, so "field employees exist but no
  // separate policy needed" is distinguishable from "no field employees."
  field_employees_separate_policy: boolean;
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
  // Only meaningful when employee_dashboard_visible is true.
  employee_dashboard_detail: 'summary' | 'detailed';

  summary_text: string | null;
  is_configured: boolean;
}

export const ATTENDANCE_POLICY_DEFAULTS: AttendancePolicy = {
  working_days_type: '5',
  weekly_offs: ['sat', 'sun'],
  shift_type: 'single',
  shifts: [{ name: 'General', start: '09:00', end: '18:00' }],
  shift_assignment_method: null,
  is_flexible_hours: false,
  // Non-null even though flexible hours defaults off — the wizard's time
  // inputs are controlled and DISPLAY these values via a `?? '08:00'`
  // fallback the moment flexible hours is turned on, but a controlled
  // input's displayed fallback never gets committed to state unless the
  // user actually touches the field. Defaulting here instead of at render
  // time means what's shown always matches what actually gets saved.
  flexible_window_start: '08:00',
  flexible_window_end: '11:00',
  full_day_hours: 9,
  grace_period_enabled: true,
  grace_minutes: 15,
  late_allowed_per_month: 3,
  late_violation_action: 'flag',
  half_day_threshold_hours: 4.5,
  early_leave_tracked_separately: false,
  // Same "displayed default must equal saved default" reasoning as above.
  early_leave_threshold_minutes: 30,
  capture_methods: ['web'],
  geo_fence_locations: [],
  has_field_employees: false,
  field_employees_separate_policy: false,
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
  employee_dashboard_detail: 'summary',
  summary_text: null,
  is_configured: false,
};

export const ATTENDANCE_DAY_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};
export const ATTENDANCE_CAPTURE_LABEL: Record<string, string> = {
  biometric: 'Biometric', mobile_gps: 'Mobile app (GPS)', selfie: 'Selfie-based',
  web: 'Web check-in', ip_restricted: 'IP-restricted login',
};

function ordinal(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// Composes the plain-English summary shown at the end of the wizard —
// deterministic template, not an LLM call, so it's instant and always
// consistent with what's about to be saved.
export function composeAttendancePolicySummary(p: AttendancePolicy): string {
  const lines: string[] = [];

  const daysLabel = p.working_days_type === 'rotational' ? 'a rotational schedule' : `${p.working_days_type} days a week`;
  const offs = p.weekly_offs.length ? p.weekly_offs.map(d => ATTENDANCE_DAY_LABEL[d] ?? d).join(' & ') : 'no fixed weekly off';
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

  lines.push(`Attendance captured via ${p.capture_methods.map(m => ATTENDANCE_CAPTURE_LABEL[m] ?? m).join(', ')}${p.geo_fence_locations.length ? `, geo-fenced to ${p.geo_fence_locations.length} location(s)` : ''}.`);

  if (p.has_field_employees) {
    lines.push(p.field_employees_separate_policy
      ? 'Field/remote employees follow a separate attendance policy.'
      : 'Field employees exist but follow the same attendance policy as everyone else.');
  }

  if (p.wfh_enabled) {
    lines.push(`Work-from-home is a separate category${p.wfh_requires_approval ? ', requires approval,' : ''} and ${p.wfh_counts_as_attendance ? 'counts' : "doesn't count"} toward attendance the same as office days.`);
  }

  if (p.overtime_enabled) {
    lines.push(`Overtime is tracked after ${ordinal(p.overtime_threshold_hours ?? p.full_day_hours)}${p.overtime_requires_preapproval ? ', pre-approval required' : ''}.`);
  }

  lines.push(p.regularization_enabled
    ? `Employees can request regularization up to ${p.regularization_monthly_limit} time(s)/month, approved by ${p.regularization_approver_role}.`
    : 'Attendance regularization requests are not allowed.');

  lines.push(`${p.holidays.length} holiday(s) on the calendar. Approved leave ${p.auto_sync_leave_attendance ? 'will not' : 'may'} show as absent.`);

  lines.push(`Repeated lateness/absenteeism notifies ${p.escalation_notify === 'both' ? 'manager & HR' : p.escalation_notify.toUpperCase()}, ${p.escalation_frequency}. ${
    p.employee_dashboard_visible
      ? `Employees can see their own attendance ${p.employee_dashboard_detail === 'detailed' ? 'in full day-by-day detail' : 'as a summary only'}.`
      : "Employees can't see their own attendance summary."
  }`);

  return lines.join(' ');
}
