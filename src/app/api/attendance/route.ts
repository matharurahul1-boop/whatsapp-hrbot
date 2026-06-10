import { NextRequest, NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog }   from '@/lib/utils/audit';
import { todayISO, istNow } from '@/lib/utils/date';
import { isHrOrAbove, isManagerOrAbove } from '@/lib/rbac';
import { z } from 'zod';

// ── Self check-in (employees, managers, everyone) ─────────────────────────────
const CheckInSchema = z.object({
  notes:    z.string().max(500).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
});

// ── Manual entry schema (HR+ only) ───────────────────────────────────────────
const ManualEntrySchema = z.object({
  employee_id:    z.string().uuid(),
  date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_in_time:  z.string().datetime().optional(),
  check_out_time: z.string().datetime().optional(),
  status:         z.enum(['present', 'absent', 'half_day', 'late', 'on_leave']).default('present'),
  notes:          z.string().max(500).optional(),
});

// ── Edit schema (HR+ only — updates an existing record by id) ────────────────
const EditRecordSchema = z.object({
  record_id:      z.string().uuid(),
  check_in_time:  z.string().datetime().optional(),
  check_out_time: z.string().datetime().optional(),
  status:         z.enum(['present', 'absent', 'half_day', 'late', 'on_leave']).optional(),
  notes:          z.string().max(500).optional(),
});

// GET /api/attendance
// employee  → own records only
// manager   → their direct reports + self
// hr/admin  → entire org
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const employeeId = searchParams.get('employee_id');
  const from  = searchParams.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to    = searchParams.get('to')   ?? todayISO();
  const page  = parseInt(searchParams.get('page') ?? '1');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
  const offset = (page - 1) * limit;

  let query = db
    .from('attendance_records')
    .select(
      `*, employee:users!attendance_records_employee_id_fkey(id,full_name,avatar_url,department)`,
      { count: 'exact' },
    )
    .eq('organization_id', profile.organization_id)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('check_in_time', { ascending: false })
    .range(offset, offset + limit - 1);

  if (isHrOrAbove(profile.role)) {
    // HR+ see everyone; optional filter by employee_id
    if (employeeId) query = query.eq('employee_id', employeeId);
  } else if (isManagerOrAbove(profile.role)) {
    // Manager: own records + direct reports
    if (employeeId) {
      // Verify the requested employee is their direct report
      const { data: report } = await db
        .from('users').select('id')
        .eq('id', employeeId).eq('manager_id', user.id).maybeSingle();
      if (!report) {
        return NextResponse.json({ error: 'Forbidden — not your direct report' }, { status: 403 });
      }
      query = query.eq('employee_id', employeeId);
    } else {
      // All direct reports + self
      const { data: reports } = await db
        .from('users').select('id')
        .eq('manager_id', user.id).eq('organization_id', profile.organization_id);
      const ids = [user.id, ...(reports ?? []).map((r: any) => r.id)];
      query = query.in('employee_id', ids);
    }
  } else {
    // Employee: own records only
    query = query.eq('employee_id', user.id);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count, page, limit });
}

// POST /api/attendance
// Normal body  → employee self check-in
// HR+ body with employee_id + date → manual attendance entry for any employee
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // ── HR+ manual entry (has employee_id in body) ─────────────────────────────
  if (body.employee_id) {
    if (!isHrOrAbove(profile.role)) {
      return NextResponse.json({ error: 'Only HR and above can create attendance records for others' }, { status: 403 });
    }

    const parsed = ManualEntrySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

    // Verify employee belongs to same org
    const { data: emp } = await db.from('users')
      .select('id').eq('id', parsed.data.employee_id).eq('organization_id', profile.organization_id).single();
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const { employee_id, date, check_in_time, check_out_time, status, notes } = parsed.data;
    const { data: record, error } = await db
      .from('attendance_records')
      .upsert(
        { organization_id: profile.organization_id, employee_id, date, check_in_time, check_out_time, status, notes, source: 'dashboard' },
        { onConflict: 'employee_id,date' },
      )
      .select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog({
      org_id: profile.organization_id, actor_id: user.id,
      action: 'MANUAL_ATTENDANCE', table_name: 'attendance_records',
      record_id: record.id, new_data: record,
    });

    return NextResponse.json({ data: record }, { status: 201 });
  }

  // ── Self check-in ──────────────────────────────────────────────────────────
  const parsed = CheckInSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const today = todayISO();
  const { data: existing } = await db
    .from('attendance_records')
    .select('id, check_in_time, check_out_time, status')
    .eq('employee_id', user.id).eq('date', today).single();

  if (existing) {
    return NextResponse.json({ error: 'Already checked in today', data: existing }, { status: 409 });
  }

  const { data: record, error } = await db.from('attendance_records').insert({
    organization_id: profile.organization_id,
    employee_id:     user.id,
    date:            today,
    check_in_time:   new Date().toISOString(),
    status:          'present',
    notes:           parsed.data.notes ?? null,
    location:        parsed.data.location ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    org_id: profile.organization_id, actor_id: user.id,
    action: 'CREATE', table_name: 'attendance_records', record_id: record.id, new_data: record,
  });

  return NextResponse.json({ data: record }, { status: 201 });
}

// PATCH /api/attendance
// Normal (no record_id) → employee self check-out
// HR+ with record_id   → edit any attendance record
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // ── HR+ edit by record_id ──────────────────────────────────────────────────
  if (body.record_id) {
    if (!isHrOrAbove(profile.role)) {
      return NextResponse.json({ error: 'Only HR and above can edit attendance records' }, { status: 403 });
    }

    const parsed = EditRecordSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

    // Verify the record belongs to same org
    const { data: existing } = await db
      .from('attendance_records').select('*')
      .eq('id', parsed.data.record_id).eq('organization_id', profile.organization_id).single();
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const { record_id, ...patch } = parsed.data;
    const { data: updated, error } = await db
      .from('attendance_records')
      .update(patch)
      .eq('id', record_id)
      .select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog({
      org_id: profile.organization_id, actor_id: user.id,
      action: 'UPDATE', table_name: 'attendance_records', record_id, old_data: existing, new_data: updated,
    });

    return NextResponse.json({ data: updated });
  }

  // ── Self check-out ─────────────────────────────────────────────────────────
  const today = todayISO();
  const { data: existing } = await db
    .from('attendance_records').select('*')
    .eq('employee_id', user.id).eq('date', today).single();

  if (!existing) return NextResponse.json({ error: 'No check-in found for today' }, { status: 404 });
  if (existing.check_out_time) return NextResponse.json({ error: 'Already checked out', data: existing }, { status: 409 });

  const { data: updated, error } = await db
    .from('attendance_records')
    .update({ check_out_time: new Date().toISOString() })
    .eq('id', existing.id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: updated });
}
