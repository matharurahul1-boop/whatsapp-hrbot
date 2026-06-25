import { NextRequest, NextResponse } from 'next/server';
import { createClient }        from '@/lib/supabase/server';
import { createAdminClient }   from '@/lib/supabase/admin';
import { writeAuditLog }       from '@/lib/utils/audit';
import { notifyLeaveDecision } from '@/lib/whatsapp/notify';
import { z } from 'zod';

const ActionSchema = z.object({
  action: z.enum(['approved', 'rejected']),
  remarks: z.string().max(500).optional(),
});

// POST /api/leave/[id]/approve
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  if (!['super_admin','admin','hr','manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { data: request, error: fetchErr } = await db
    .from('leave_requests')
    .select('*, leave_type:leave_types(name), employee:users!leave_requests_employee_id_fkey(id,full_name,manager_id)')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single();

  if (fetchErr || !request) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  if (request.status !== 'pending') return NextResponse.json({ error: `Request is already ${request.status}` }, { status: 409 });

  const employee = request.employee as { id: string; full_name: string; manager_id: string | null } | null;

  if (profile.role === 'manager' && employee?.manager_id !== user.id) {
    return NextResponse.json({ error: 'You can only review your direct reports' }, { status: 403 });
  }

  // ── Balance deduction on approval (decrement remaining_days) ──────────────
  if (parsed.data.action === 'approved') {
    const leaveYear = new Date(request.start_date).getFullYear();

    const { data: balance } = await db
      .from('leave_balances')
      .select('id, remaining_days')
      .eq('employee_id', request.employee_id)
      .eq('leave_type_id', request.leave_type_id)
      .eq('year', leaveYear)
      .single();

    if (balance) {
      const newRemaining = Math.max(0, balance.remaining_days - (request.duration_days ?? 0));
      const { error: balanceErr } = await db
        .from('leave_balances')
        .update({ remaining_days: newRemaining })
        .eq('id', balance.id);

      if (balanceErr) {
        console.error('[Leave Approve] Balance deduction failed:', balanceErr.message);
      }
    }
  }

  const { data: updated, error } = await db
    .from('leave_requests')
    .update({
      status:      parsed.data.action,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      remarks:     parsed.data.remarks,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // In-app notification for employee
  await db.rpc('create_notification', {
    p_org_id:     profile.organization_id,
    p_user_id:    request.employee_id,
    p_type:       'leave_decision',
    p_title:      `Leave ${parsed.data.action}`,
    p_body:       `Your ${request.duration_days}-day leave request has been ${parsed.data.action}.`,
    p_action_url: `/leave`,
    p_meta:       { leave_request_id: id, action: parsed.data.action },
  });

  await writeAuditLog({
    org_id:     profile.organization_id,
    actor_id:   user.id,
    action:     'UPDATE',
    table_name: 'leave_requests',
    record_id:  id,
    old_data:   request as Record<string, unknown>,
    new_data:   updated as Record<string, unknown>,
  });

  const { data: reviewer } = await db.from('users').select('full_name').eq('id', user.id).single();
  const leaveType = request.leave_type as { name: string } | null;

  notifyLeaveDecision({
    orgId:         profile.organization_id,
    employeeId:    request.employee_id,
    action:        parsed.data.action,
    leaveTypeName: leaveType?.name ?? 'Leave',
    startDate:     request.start_date,
    endDate:       request.end_date,
    reviewerName:  reviewer?.full_name ?? 'your manager',
    remarks:       parsed.data.remarks,
  }).catch(() => {});

  return NextResponse.json({ data: updated });
}
