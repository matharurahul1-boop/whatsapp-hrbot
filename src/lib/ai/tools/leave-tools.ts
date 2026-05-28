import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/utils/audit';
import type { IntentEntities, ToolCallResult } from '@/types/agent.types';
import { formatDate, calcBusinessDays } from '@/lib/utils/date';

export async function applyLeave(
  org_id: string,
  userId: string,
  entities: IntentEntities
): Promise<ToolCallResult> {
  const db = createAdminClient();

  if (!entities.leave_type || !entities.start_date || !entities.end_date) {
    const missing: string[] = [];
    if (!entities.leave_type) missing.push('leave type (Casual/Sick/Annual)');
    if (!entities.start_date) missing.push('start date');
    if (!entities.end_date) missing.push('end date (or number of days)');
    return {
      success: false,
      message: `Please provide: ${missing.join(', ')}.`,
      error: 'missing_fields',
    };
  }

  // Resolve leave type
  const { data: leaveType } = await db
    .from('leave_types')
    .select('id, name, requires_approval')
    .eq('organization_id', org_id)
    .ilike('name', `%${entities.leave_type}%`)
    .single();

  if (!leaveType) {
    return { success: false, message: `Leave type "${entities.leave_type}" not found.`, error: 'not_found' };
  }

  // Check balance
  const year = new Date(entities.start_date).getFullYear();
  const { data: balance } = await db
    .from('leave_balances')
    .select('remaining_days')
    .eq('user_id', userId)
    .eq('leave_type_id', leaveType.id)
    .eq('year', year)
    .single();

  const totalDays = calcBusinessDays(entities.start_date, entities.end_date);

  if (balance && balance.remaining_days < totalDays) {
    return {
      success: false,
      message: `You only have ${balance.remaining_days} days remaining for ${leaveType.name}. Requested: ${totalDays} days.`,
      error: 'insufficient_balance',
    };
  }

  const { data: request, error } = await db
    .from('leave_requests')
    .insert({
      organization_id: org_id,
      user_id: userId,
      leave_type_id: leaveType.id,
      start_date: entities.start_date,
      end_date: entities.end_date,
      total_days: totalDays,
      reason: entities.reason ?? null,
      status: leaveType.requires_approval ? 'pending' : 'approved',
      source: 'whatsapp',
    })
    .select()
    .single();

  if (error) return { success: false, message: 'Failed to submit leave request.', error: error.message };

  await writeAuditLog({
    org_id,
    actor_id: userId,
    actor_type: 'user',
    action: 'APPLY_LEAVE',
    table_name: 'leave_requests',
    record_id: request.id,
    new_data: request,
    source: 'whatsapp',
  });

  return {
    success: true,
    data: {
      request_id: request.id,
      leave_type: leaveType.name,
      total_days: totalDays,
      status: request.status,
    },
    message: `Leave applied: ${leaveType.name} from ${formatDate(entities.start_date)} to ${formatDate(entities.end_date)} (${totalDays} days). Status: ${request.status}.`,
  };
}

export async function checkLeaveBalance(
  org_id: string,
  userId: string
): Promise<ToolCallResult> {
  const db = createAdminClient();
  const year = new Date().getFullYear();

  const { data: balances, error } = await db
    .from('leave_balances')
    .select('remaining_days, total_days, used_days, leave_types(name, color_hex)')
    .eq('user_id', userId)
    .eq('year', year);

  if (error) return { success: false, message: 'Could not fetch leave balance.', error: error.message };

  const formatted = (balances ?? []).map((b: any) => ({
    type: b.leave_types?.name ?? 'Unknown',
    remaining: b.remaining_days,
    total: b.total_days,
    used: b.used_days,
  }));

  return {
    success: true,
    data: { balances: formatted },
    message: '',
  };
}

export async function approveOrRejectLeave(
  org_id: string,
  approverId: string,
  requestId: string,
  action: 'approve' | 'reject',
  rejectionReason?: string
): Promise<ToolCallResult> {
  const db = createAdminClient();

  const updateData =
    action === 'approve'
      ? { status: 'approved', approved_by: approverId, approved_at: new Date().toISOString() }
      : { status: 'rejected', approved_by: approverId, rejection_reason: rejectionReason ?? null };

  const { error } = await db
    .from('leave_requests')
    .update(updateData)
    .eq('id', requestId)
    .eq('organization_id', org_id);

  if (error) return { success: false, message: 'Failed to update leave request.', error: error.message };

  await writeAuditLog({
    org_id,
    actor_id: approverId,
    actor_type: 'user',
    action: action === 'approve' ? 'APPROVE_LEAVE' : 'REJECT_LEAVE',
    table_name: 'leave_requests',
    record_id: requestId,
    new_data: updateData,
    source: 'whatsapp',
  });

  return {
    success: true,
    message: `Leave request ${action}d successfully.`,
  };
}
