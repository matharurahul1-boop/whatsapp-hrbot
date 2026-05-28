const N8N_BASE = process.env.N8N_BASE_URL ?? '';
const N8N_SECRET = process.env.N8N_WEBHOOK_SECRET ?? '';

interface TriggerOptions {
  workflow: string;
  payload: Record<string, unknown>;
  orgId?: string;
}

export async function triggerWorkflow({ workflow, payload, orgId }: TriggerOptions): Promise<void> {
  const url = `${N8N_BASE}/webhook/${workflow}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-Secret': N8N_SECRET,
      ...(orgId && { 'X-Org-Id': orgId }),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`n8n webhook ${workflow} failed: ${res.status} — ${body}`);
  }
}

// Named helpers for each workflow
export const n8n = {
  notifyTaskAssigned: (orgId: string, taskId: string, assigneeId: string) =>
    triggerWorkflow({ workflow: 'task-assigned', payload: { task_id: taskId, assignee_id: assigneeId }, orgId }),

  notifyLeaveRequest: (orgId: string, requestId: string) =>
    triggerWorkflow({ workflow: 'leave-request', payload: { request_id: requestId }, orgId }),

  notifyLeaveDecision: (orgId: string, requestId: string, status: 'approved' | 'rejected') =>
    triggerWorkflow({ workflow: 'leave-decision', payload: { request_id: requestId, status }, orgId }),

  notifyOnboardingStarted: (orgId: string, sessionId: string) =>
    triggerWorkflow({ workflow: 'onboarding-started', payload: { session_id: sessionId }, orgId }),

  notifyOnboardingComplete: (orgId: string, userId: string, employeeId: string) =>
    triggerWorkflow({ workflow: 'onboarding-complete', payload: { user_id: userId, employee_id: employeeId }, orgId }),

  sendDailyReminders: (orgId: string) =>
    triggerWorkflow({ workflow: 'daily-reminders', payload: { org_id: orgId }, orgId }),
};
