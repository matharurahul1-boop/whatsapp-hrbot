import { NextRequest, NextResponse } from 'next/server';
import { createClient }         from '@/lib/supabase/server';
import { createAdminClient }    from '@/lib/supabase/admin';
import { writeAuditLog }        from '@/lib/utils/audit';
import { notifyLeaveSubmitted } from '@/lib/whatsapp/notify';
import { z } from 'zod';

const ApplyLeaveSchema = z.object({
  leave_type_id: z.string().uuid(),
  start_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason:        z.string().max(500).optional(),
});

// GET /api/leave — list leave requests
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const status    = searchParams.get('status');
  const employeeId = searchParams.get('employee_id');
  const year      = searchParams.get('year') ?? new Date().getFullYear().toString();
  const page      = parseInt(searchParams.get('page') ?? '1');
  const limit     = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100);
  const offset    = (page - 1) * limit;

  let query = db
    .from('leave_requests')
    .select(`
      *,
      employee:users!leave_requests_employee_id_fkey(id,full_name,avatar_url,department),
      leave_type:leave_types(id,name,color),
      reviewer:users!leave_requests_reviewed_by_fkey(id,full_name)
    `, { count: 'exact' })
    .eq('organization_id', profile.organization_id)
    .gte('start_date', `${year}-01-01`)
    .lte('start_date', `${year}-12-31`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status)     query = query.eq('status', status);

  // Employees see only their own requests
  if (profile.role === 'employee') {
    query = query.eq('employee_id', user.id);
  } else if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count, page, limit });
}

// POST /api/leave — apply for leave
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = ApplyLeaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role, manager_id, full_name').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // Calculate duration
  const start = new Date(parsed.data.start_date);
  const end   = new Date(parsed.data.end_date);
  if (end < start) return NextResponse.json({ error: 'end_date must be >= start_date' }, { status: 422 });
  const durationDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  // Check balance (skip for admin/hr — they manage the system)
  const year = start.getFullYear();
  const isAdmin = ['super_admin', 'admin', 'hr'].includes(profile.role);

  if (!isAdmin) {
    const { data: balance } = await db
      .from('leave_balances')
      .select('remaining_days')
      .eq('employee_id', user.id)
      .eq('leave_type_id', parsed.data.leave_type_id)
      .eq('year', year)
      .single();

    if (!balance) {
      return NextResponse.json({
        error: 'No leave balance found. Please contact HR to set up your leave entitlement.',
      }, { status: 422 });
    }

    if (balance.remaining_days < durationDays) {
      return NextResponse.json({
        error: `Insufficient leave balance. You need ${durationDays} day(s) but only ${balance.remaining_days} day(s) available.`,
      }, { status: 422 });
    }
  }

  // Check overlapping approved requests
  const { data: overlap } = await db
    .from('leave_requests')
    .select('id')
    .eq('employee_id', user.id)
    .in('status', ['pending','approved'])
    .lte('start_date', parsed.data.end_date)
    .gte('end_date', parsed.data.start_date)
    .limit(1);

  if (overlap && overlap.length > 0) {
    return NextResponse.json({ error: 'You already have a leave request overlapping those dates' }, { status: 409 });
  }

  const { data: request, error } = await db.from('leave_requests').insert({
    ...parsed.data,
    organization_id: profile.organization_id,
    employee_id: user.id,
    duration_days: durationDays,
    status: 'pending',
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'CREATE', table_name: 'leave_requests', record_id: request.id, new_data: request });

  // Fetch leave type name for the notification
  const { data: lt } = await db.from('leave_types').select('name').eq('id', parsed.data.leave_type_id).single();
  notifyLeaveSubmitted({
    orgId:         profile.organization_id,
    managerId:     (profile as any).manager_id ?? null,
    employeeName:  (profile as any).full_name ?? 'An employee',
    leaveTypeName: lt?.name ?? 'Leave',
    startDate:     parsed.data.start_date,
    endDate:       parsed.data.end_date,
    durationDays,
    reason:        parsed.data.reason,
  }).catch(() => {});

  return NextResponse.json({ data: request }, { status: 201 });
}
