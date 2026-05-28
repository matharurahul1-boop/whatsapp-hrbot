import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/utils/audit';
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

  // Only manager+ can approve/reject
  if (!['super_admin','admin','hr','manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { data: request, error: fetchErr } = await db
    .from('leave_requests')
    .select('*, employee:users!leave_requests_employee_id_fkey(id,full_name,manager_id)')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single();

  if (fetchErr || !request) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  if (request.status !== 'pending') return NextResponse.json({ error: `Request is already ${request.status}` }, { status: 409 });

  // Managers can only approve their direct reports
  if (profile.role === 'manager' && request.employee?.manager_id !== user.id) {
    return NextResponse.json({ error: 'You can only review your direct reports' }, { status: 403 });
  }

  const { data: updated, error } = await db
    .from('leave_requests')
    .update({
      status: parsed.data.action,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      remarks: parsed.data.remarks,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create in-app notification for employee
  await db.rpc('create_notification', {
    p_org_id: profile.organization_id,
    p_user_id: request.employee_id,
    p_type: 'leave_decision',
    p_title: `Leave ${parsed.data.action}`,
    p_body: `Your ${request.duration_days}-day leave request has been ${parsed.data.action}.`,
    p_action_url: `/leave`,
    p_meta: { leave_request_id: id, action: parsed.data.action },
  });

  await writeAuditLog({
    org_id: profile.organization_id,
    actor_id: user.id,
    action: 'UPDATE',
    table_name: 'leave_requests',
    record_id: id,
    old_data: request,
    new_data: updated,
  });

  return NextResponse.json({ data: updated });
}
