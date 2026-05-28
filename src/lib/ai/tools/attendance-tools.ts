import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/utils/audit';
import type { ToolCallResult } from '@/types/agent.types';

export async function checkIn(
  org_id: string,
  userId: string,
  location?: { lat: number; lng: number; address?: string }
): Promise<ToolCallResult> {
  const db = createAdminClient();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  // Check if already checked in today
  const { data: existing } = await db
    .from('attendance_records')
    .select('id, check_in_time, check_out_time')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  if (existing?.check_in_time && !existing?.check_out_time) {
    const time = new Date(existing.check_in_time).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });
    return {
      success: false,
      message: `You already checked in today at ${time}. Send "checkout" to check out.`,
      error: 'already_checked_in',
    };
  }

  const { data: record, error } = await db
    .from('attendance_records')
    .upsert({
      organization_id: org_id,
      user_id: userId,
      date: today,
      check_in_time: now,
      status: 'present',
      location: location ?? null,
      source: 'whatsapp',
    })
    .select()
    .single();

  if (error) return { success: false, message: 'Failed to record check-in.', error: error.message };

  await writeAuditLog({
    org_id,
    actor_id: userId,
    actor_type: 'user',
    action: 'CHECK_IN',
    table_name: 'attendance_records',
    record_id: record.id,
    new_data: record,
    source: 'whatsapp',
  });

  const timeStr = new Date(now).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });

  return { success: true, message: timeStr };
}

export async function checkOut(
  org_id: string,
  userId: string
): Promise<ToolCallResult> {
  const db = createAdminClient();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const { data: record } = await db
    .from('attendance_records')
    .select('id, check_in_time')
    .eq('user_id', userId)
    .eq('date', today)
    .not('check_in_time', 'is', null)
    .is('check_out_time', null)
    .single();

  if (!record) {
    return {
      success: false,
      message: "You haven't checked in today. Send \"checkin\" to mark your attendance.",
      error: 'not_checked_in',
    };
  }

  const { data: updated, error } = await db
    .from('attendance_records')
    .update({ check_out_time: now })
    .eq('id', record.id)
    .select()
    .single();

  if (error) return { success: false, message: 'Failed to record check-out.', error: error.message };

  const timeStr = new Date(now).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
  const hours = updated.total_hours?.toFixed(1) ?? '0';

  return { success: true, data: { time: timeStr, hours }, message: `${timeStr} | ${hours}h` };
}

export async function getMyAttendance(
  org_id: string,
  userId: string,
  days = 7
): Promise<ToolCallResult> {
  const db = createAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const { data: records, error } = await db
    .from('attendance_records')
    .select('date, check_in_time, check_out_time, total_hours, status')
    .eq('user_id', userId)
    .eq('organization_id', org_id)
    .gte('date', since)
    .order('date', { ascending: false });

  if (error) return { success: false, message: 'Could not fetch attendance.', error: error.message };

  const formatted = (records ?? []).map((r: any) => ({
    date: r.date,
    status: r.status,
    hours: r.total_hours ? `${r.total_hours}h` : '—',
  }));

  return { success: true, data: { records: formatted }, message: '' };
}

export async function getAbsenteesToday(org_id: string): Promise<ToolCallResult> {
  const db = createAdminClient();
  const today = new Date().toISOString().split('T')[0];

  const { data: employees } = await db
    .from('users')
    .select('id, full_name')
    .eq('organization_id', org_id)
    .eq('is_active', true)
    .eq('role', 'employee');

  const { data: presentIds } = await db
    .from('attendance_records')
    .select('user_id')
    .eq('organization_id', org_id)
    .eq('date', today)
    .eq('status', 'present');

  const presentSet = new Set((presentIds ?? []).map((r: any) => r.user_id));
  const absent = (employees ?? []).filter((e: any) => !presentSet.has(e.id));

  return {
    success: true,
    data: { absent },
    message: absent.length === 0
      ? 'Everyone has checked in today!'
      : `${absent.length} absent: ${absent.map((e: any) => e.full_name).join(', ')}`,
  };
}
