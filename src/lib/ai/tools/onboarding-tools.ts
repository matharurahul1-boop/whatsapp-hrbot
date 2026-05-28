import { createAdminClient } from '@/lib/supabase/admin';
import { generateEmployeeId } from '@/lib/utils/employee-id';
import { writeAuditLog } from '@/lib/utils/audit';
import type { ToolCallResult } from '@/types/agent.types';

export async function startOnboarding(
  org_id: string,
  initiatedBy: string,
  employeeName: string,
  employeeWaNumber: string
): Promise<ToolCallResult> {
  const db = createAdminClient();

  // Check if user already exists
  const { data: existing } = await db
    .from('users')
    .select('id, onboarding_status')
    .eq('wa_number', employeeWaNumber)
    .eq('organization_id', org_id)
    .single();

  if (existing?.onboarding_status === 'completed') {
    return { success: false, message: 'This employee has already completed onboarding.', error: 'already_onboarded' };
  }

  let userId = existing?.id;

  if (!userId) {
    // Create placeholder user
    const { data: newUser, error } = await db.auth.admin.createUser({
      email: `${employeeWaNumber.replace('+', '')}@whatsapp.placeholder`,
      phone: employeeWaNumber,
      user_metadata: { full_name: employeeName },
    });

    if (error) return { success: false, message: 'Failed to create user account.', error: error.message };

    await db.from('users').insert({
      id: newUser.user.id,
      organization_id: org_id,
      full_name: employeeName,
      email: `${employeeWaNumber.replace('+', '')}@whatsapp.placeholder`,
      wa_number: employeeWaNumber,
      role: 'employee',
      onboarding_status: 'in_progress',
    });

    userId = newUser.user.id;
  }

  // Create onboarding session
  const { data: session, error: sessionError } = await db
    .from('onboarding_sessions')
    .insert({
      organization_id: org_id,
      user_id: userId,
      initiated_by: initiatedBy,
      current_step: 1,
      total_steps: 8,
      status: 'in_progress',
    })
    .select()
    .single();

  if (sessionError) return { success: false, message: 'Failed to start onboarding session.', error: sessionError.message };

  return {
    success: true,
    data: { session_id: session.id, user_id: userId, current_step: 1 },
    message: `Onboarding started for ${employeeName}. They will receive a WhatsApp message shortly.`,
  };
}

export async function saveOnboardingStep(
  sessionId: string,
  step: number,
  data: Record<string, unknown>
): Promise<ToolCallResult> {
  const db = createAdminClient();

  const { data: session } = await db
    .from('onboarding_sessions')
    .select('collected_data, total_steps')
    .eq('id', sessionId)
    .single();

  if (!session) return { success: false, message: 'Session not found.', error: 'not_found' };

  const newData = { ...(session.collected_data as Record<string, unknown>), [`step_${step}`]: data };
  const nextStep = step + 1;
  const isComplete = nextStep > session.total_steps;

  const { error } = await db
    .from('onboarding_sessions')
    .update({
      collected_data: newData,
      current_step: isComplete ? session.total_steps : nextStep,
      status: isComplete ? 'completed' : 'in_progress',
      completed_at: isComplete ? new Date().toISOString() : null,
    })
    .eq('id', sessionId);

  if (error) return { success: false, message: 'Failed to save step.', error: error.message };

  if (isComplete) {
    // Generate employee ID
    const empId = await generateEmployeeId();
    const { data: sess } = await db
      .from('onboarding_sessions')
      .select('user_id')
      .eq('id', sessionId)
      .single();

    if (sess) {
      await db
        .from('users')
        .update({ employee_id: empId, onboarding_status: 'completed' })
        .eq('id', sess.user_id);
    }

    return { success: true, data: { complete: true, employee_id: empId }, message: empId };
  }

  return { success: true, data: { next_step: nextStep }, message: '' };
}

export async function getOnboardingStatus(
  org_id: string,
  userId: string
): Promise<ToolCallResult> {
  const db = createAdminClient();

  const { data: session } = await db
    .from('onboarding_sessions')
    .select('current_step, total_steps, status')
    .eq('organization_id', org_id)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) return { success: false, message: 'No onboarding session found.', error: 'not_found' };

  return {
    success: true,
    data: session,
    message: `Onboarding: Step ${session.current_step}/${session.total_steps} — ${session.status}`,
  };
}
