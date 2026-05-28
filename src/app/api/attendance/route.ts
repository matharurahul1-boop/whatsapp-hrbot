import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/utils/audit';
import { todayISO, istNow } from '@/lib/utils/date';
import { z } from 'zod';

const CheckInSchema = z.object({
  notes: z.string().max(500).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
});

// GET /api/attendance
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const employeeId = searchParams.get('employee_id');
  const from       = searchParams.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to         = searchParams.get('to')   ?? todayISO();
  const page       = parseInt(searchParams.get('page') ?? '1');
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
  const offset     = (page - 1) * limit;

  let query = db
    .from('attendance_records')
    .select(`
      *,
      employee:users!attendance_records_employee_id_fkey(id,full_name,avatar_url,department)
    `, { count: 'exact' })
    .eq('organization_id', profile.organization_id)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('check_in_time', { ascending: false })
    .range(offset, offset + limit - 1);

  // Employees only see themselves
  if (profile.role === 'employee') {
    query = query.eq('employee_id', user.id);
  } else if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count, page, limit });
}

// POST /api/attendance — check in
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = CheckInSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const today = todayISO();

  // Check already checked in
  const { data: existing } = await db
    .from('attendance_records')
    .select('id, check_in_time, check_out_time, status')
    .eq('employee_id', user.id)
    .eq('date', today)
    .single();

  if (existing) {
    return NextResponse.json({ error: 'Already checked in today', data: existing }, { status: 409 });
  }

  const now = istNow();

  const { data: record, error } = await db.from('attendance_records').insert({
    organization_id: profile.organization_id,
    employee_id: user.id,
    date: today,
    check_in_time: new Date().toISOString(),
    status: 'present',
    notes: parsed.data.notes ?? null,
    location: parsed.data.location ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'CREATE', table_name: 'attendance_records', record_id: record.id, new_data: record });

  return NextResponse.json({ data: record }, { status: 201 });
}

// PATCH /api/attendance — check out
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const today = todayISO();

  const { data: existing } = await db
    .from('attendance_records')
    .select('*')
    .eq('employee_id', user.id)
    .eq('date', today)
    .single();

  if (!existing) return NextResponse.json({ error: 'No check-in found for today' }, { status: 404 });
  if (existing.check_out_time) return NextResponse.json({ error: 'Already checked out', data: existing }, { status: 409 });

  const { data: updated, error } = await db
    .from('attendance_records')
    .update({ check_out_time: new Date().toISOString() })
    .eq('id', existing.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: updated });
}
