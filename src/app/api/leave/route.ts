import { NextRequest, NextResponse } from 'next/server';
import { createClient }         from '@/lib/supabase/server';
import { createAdminClient }    from '@/lib/supabase/admin';
import { writeAuditLog }        from '@/lib/utils/audit';
import { notifyLeaveApprovalNeeded, notifyLeaveCancelled } from '@/lib/whatsapp/notify';
import { isHrOrAbove, isEmployee, canApplyForLeave } from '@/lib/rbac';
import { z } from 'zod';

// Matches the label format the WhatsApp bot folds into `reason` (see
// executor.ts's APPLY_LEAVE) — there's no dedicated half-day column on
// leave_requests, so both paths must agree on the same tag text or the
// same request would read differently depending on where it came from.
const HALF_DAY_LABEL: Record<'first' | 'second', string> = {
  first:  'First Half, 9:00 AM–1:00 PM',
  second: 'Second Half, 2:00 PM–6:00 PM',
};

const ApplyLeaveSchema = z.object({
  leave_type_id: z.string().uuid(),
  start_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Not required when half_day is set — a half day is always exactly one
  // day, so end_date would be ignored anyway.
  end_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason:        z.string().max(500).optional(),
  half_day:      z.enum(['first', 'second']).optional(),
  // HR+ can apply on behalf of another employee
  employee_id:   z.string().uuid().optional(),
}).refine(d => !!d.half_day || !!d.end_date, { message: 'end_date is required unless half_day is set', path: ['end_date'] });

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
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const limit     = Math.min(Math.max(1, parseInt(searchParams.get('limit') ?? '50') || 50), 100);
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

  // Employees see only their own requests; everyone else sees the whole org.
  if (isEmployee(profile.role)) {
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

  // ── RBAC: everyone except admin/super_admin can have leave applied for
  // them — either by themselves, or by HR+ filing on their behalf. ─────────
  let targetEmployeeId = user.id;
  let targetProfile: typeof profile = profile;

  if (parsed.data.employee_id && parsed.data.employee_id !== user.id) {
    if (!isHrOrAbove(profile.role)) {
      return NextResponse.json({ error: 'Only HR and above can apply leave on behalf of others' }, { status: 403 });
    }
    const { data: emp } = await db
      .from('users')
      .select('id, organization_id, role, manager_id, full_name')
      .eq('id', parsed.data.employee_id)
      .eq('organization_id', profile.organization_id)
      .single();
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    targetEmployeeId = emp.id;
    targetProfile    = emp as typeof profile;
  } else if (!canApplyForLeave(profile.role)) {
    return NextResponse.json({ error: 'Admins and super admins cannot apply for their own leave.' }, { status: 403 });
  }

  if (!canApplyForLeave(targetProfile.role)) {
    return NextResponse.json({ error: 'Leave cannot be applied for admins or super admins.' }, { status: 422 });
  }

  // Calculate duration — a half day is always exactly one day, so it
  // ignores whatever end_date the client sent.
  const endDateStr = parsed.data.half_day ? parsed.data.start_date : parsed.data.end_date;
  if (!endDateStr) return NextResponse.json({ error: 'end_date is required' }, { status: 422 });
  const start = new Date(parsed.data.start_date);
  const end   = new Date(endDateStr);
  if (end < start) return NextResponse.json({ error: 'end_date must be >= start_date' }, { status: 422 });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (start < today) return NextResponse.json({ error: 'Leave cannot start in the past' }, { status: 422 });
  const durationDays = parsed.data.half_day
    ? 0.5
    : Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const { data: leaveType } = await db.from('leave_types').select('id')
    .eq('id', parsed.data.leave_type_id).eq('organization_id', profile.organization_id)
    .eq('is_active', true).maybeSingle();
  if (!leaveType) return NextResponse.json({ error: 'Leave type is not available in your organization' }, { status: 422 });

  // Check balance (skip for admin/hr — they manage the system)
  const year = start.getFullYear();
  {
    const { data: balance } = await db
      .from('leave_balances')
      .select('remaining_days')
      .eq('employee_id', targetEmployeeId)
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
    .eq('employee_id', targetEmployeeId)
    .in('status', ['pending','approved'])
    .lte('start_date', endDateStr)
    .gte('end_date', parsed.data.start_date)
    .limit(1);

  if (overlap && overlap.length > 0) {
    return NextResponse.json({ error: 'This employee already has a leave request overlapping those dates' }, { status: 409 });
  }

  // There's no dedicated half-day column on leave_requests, so the label is
  // folded into reason instead — the one field every leave listing
  // (WhatsApp, dashboard, audit log) already surfaces.
  const halfDayTag = parsed.data.half_day ? `[${HALF_DAY_LABEL[parsed.data.half_day]}]` : null;
  const reason = [halfDayTag, parsed.data.reason].filter(Boolean).join(' ') || undefined;

  const { data: request, error } = await db.from('leave_requests').insert({
    leave_type_id:   parsed.data.leave_type_id,
    start_date:      parsed.data.start_date,
    end_date:        endDateStr,
    reason,
    organization_id: profile.organization_id,
    employee_id:     targetEmployeeId,
    duration_days:   durationDays,
    status:          'pending',
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch leave type name for the notification + audit log
  const { data: lt } = await db.from('leave_types').select('name').eq('id', parsed.data.leave_type_id).single();

  await writeAuditLog({
    org_id: profile.organization_id, actor_id: user.id,
    action: 'CREATE', table_name: 'leave_requests', record_id: request.id,
    new_data: { ...request, leave_type_name: lt?.name ?? null },
  });

  // Awaited — see the comment on the equivalent call in
  // api/leave/[id]/approve/route.ts for why this can't be fire-and-forget.
  await notifyLeaveApprovalNeeded({
    orgId:         profile.organization_id,
    applicantRole: targetProfile.role,
    employeeName:  (targetProfile as any).full_name ?? 'An employee',
    leaveTypeName: lt?.name ?? 'Leave',
    startDate:     parsed.data.start_date,
    endDate:       endDateStr,
    durationDays,
    reason,
  });

  return NextResponse.json({ data: request }, { status: 201 });
}

// ── DELETE /api/leave?id=<uuid> — cancel a leave request ─────────────────────
// Employee: can cancel their own pending/approved leave
// HR+: can cancel any employee's leave
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const leaveId = req.nextUrl.searchParams.get('id');
  if (!leaveId) return NextResponse.json({ error: 'Leave request ID required (?id=)' }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role, full_name, manager_id')
    .eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { data: request } = await db
    .from('leave_requests')
    .select('id, employee_id, status, start_date, leave_type_id')
    .eq('id', leaveId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!request) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

  // RBAC: employee cancels own; HR+ cancels anyone's
  if (request.employee_id !== user.id && !isHrOrAbove(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!['pending', 'approved'].includes(request.status)) {
    return NextResponse.json({ error: `Cannot cancel a ${request.status} leave request` }, { status: 409 });
  }

  const { data: cancelled, error: cancelError } = await db
    .from('leave_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', leaveId)
    .eq('status', request.status)
    .select('id').maybeSingle();
  if (cancelError) return NextResponse.json({ error: cancelError.message }, { status: 500 });
  if (!cancelled) return NextResponse.json({ error: 'Leave request changed concurrently; please retry' }, { status: 409 });

  const { data: cancelledLt } = await db.from('leave_types').select('name').eq('id', request.leave_type_id).single();

  await writeAuditLog({
    org_id: profile.organization_id, actor_id: user.id,
    action: 'CANCEL', table_name: 'leave_requests', record_id: leaveId,
    old_data: { ...request, leave_type_name: cancelledLt?.name ?? null }, new_data: { status: 'cancelled' },
  });

  // Notify every eligible approver when employee self-cancels — profile.role
  // is the leave owner's role here specifically because this branch only
  // runs when request.employee_id === user.id (the actor IS the owner).
  if (request.employee_id === user.id) {
    const lt = cancelledLt;
    // Awaited — see the comment on the equivalent call in
    // api/leave/[id]/approve/route.ts for why this can't be fire-and-forget.
    await notifyLeaveCancelled({
      orgId:         profile.organization_id,
      applicantRole: profile.role,
      employeeName:  (profile as any).full_name ?? 'An employee',
      leaveTypeName: lt?.name ?? 'Leave',
      startDate:     request.start_date,
    });
  }

  return NextResponse.json({ ok: true });
}
