import type { createAdminClient } from '@/lib/supabase/admin';

// Reads the org's attendance_policies row (Settings → Attendance Policy
// wizard) and computes late/half-day status from it. Orgs that never ran the
// wizard have no row — every caller here must treat that as "policy not
// configured," falling back to the unconditional 'present' status attendance
// used before this existed. Shared between the WhatsApp executor
// (src/lib/ai/executor.ts) and the dashboard self check-in/out route
// (src/app/api/attendance/route.ts) so both surfaces enforce the same policy.

interface AttendancePolicyForCheckIn {
  is_flexible_hours: boolean;
  shifts: { name: string; start: string; end: string }[];
  grace_period_enabled: boolean;
  grace_minutes: number;
  half_day_threshold_hours: number;
}

export async function fetchAttendancePolicy(
  db: ReturnType<typeof createAdminClient>, orgId: string,
): Promise<AttendancePolicyForCheckIn | null> {
  const { data } = await db
    .from('attendance_policies')
    .select('is_flexible_hours, shifts, grace_period_enabled, grace_minutes, half_day_threshold_hours')
    .eq('organization_id', orgId).eq('is_configured', true)
    .maybeSingle();
  return (data as AttendancePolicyForCheckIn | null) ?? null;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function istMinutesSinceMidnight(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

// Flexible-hours orgs, and orgs without a configured shift start time, never
// mark 'late' — there's no fixed line to be late against. Fixed-shift orgs
// mark 'late' once check-in passes shift start + grace period (grace
// defaults to 0 minutes when the org disabled it).
export async function computeCheckInStatus(
  db: ReturnType<typeof createAdminClient>, orgId: string, checkInAt: Date,
): Promise<{ status: 'present' | 'late'; policy: AttendancePolicyForCheckIn | null; shiftStart: string | null }> {
  const policy = await fetchAttendancePolicy(db, orgId);
  const shiftStart = policy && !policy.is_flexible_hours ? (policy.shifts?.[0]?.start ?? null) : null;
  if (!policy || !shiftStart) return { status: 'present', policy, shiftStart: null };

  const graceMinutes = policy.grace_period_enabled ? policy.grace_minutes : 0;
  const cutoff = hhmmToMinutes(shiftStart) + graceMinutes;
  const status = istMinutesSinceMidnight(checkInAt) > cutoff ? 'late' : 'present';
  return { status, policy, shiftStart };
}

// Called once hours worked is known (at check-out). Overrides whatever
// check-in set (present/late) when the shift fell short of the configured
// half-day threshold — half-day takes priority since a short day is a short
// day regardless of what time it started. Returns null (no override) when
// there's no configured policy or hours couldn't be computed.
export async function computeHalfDayStatus(
  db: ReturnType<typeof createAdminClient>, orgId: string, hoursWorked: number | null, currentStatus: string | null,
): Promise<'half_day' | null> {
  if (hoursWorked === null || currentStatus === 'half_day') return null;
  const policy = await fetchAttendancePolicy(db, orgId);
  if (!policy) return null;
  return hoursWorked < policy.half_day_threshold_hours ? 'half_day' : null;
}
