import type { createAdminClient } from '@/lib/supabase/admin';

export const NOTIFICATION_GROUPS = ['tasks', 'leave', 'attendance', 'onboarding', 'other'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const NOTIFICATION_GROUP_LABEL: Record<NotificationGroup, string> = {
  tasks: 'Tasks', leave: 'Leave', attendance: 'Attendance', onboarding: 'Onboarding', other: 'Other',
};

export interface NotificationTypeMeta {
  key:     string;
  label:   string;
  group:   NotificationGroup;
  channel: 'whatsapp' | 'in_app' | 'both';
}

// Every automated notification the app can send, one row per distinct
// trigger. `channel` reflects what actually fires today (see notify.ts /
// escalate-leaves / reminders routes) — it's descriptive only, toggling
// off here skips every channel for that type.
export const NOTIFICATION_TYPES: NotificationTypeMeta[] = [
  { key: 'task_assigned',            label: 'Task assigned',                 group: 'tasks',    channel: 'both'     },
  { key: 'task_updated',             label: 'Task updated',                  group: 'tasks',    channel: 'both'     },
  { key: 'task_completed',           label: 'Task completed',                group: 'tasks',    channel: 'both'     },
  { key: 'task_deleted',             label: 'Task deleted',                  group: 'tasks',    channel: 'both'     },
  { key: 'task_deadline_reminder',   label: 'Task deadline reminder',        group: 'tasks',    channel: 'both'     },

  { key: 'leave_approval_needed',    label: 'Leave approval needed',         group: 'leave',    channel: 'both'     },
  { key: 'leave_decision',           label: 'Leave approved / rejected',     group: 'leave',    channel: 'both'     },
  { key: 'leave_cancelled',          label: 'Leave cancelled',               group: 'leave',    channel: 'both'     },
  { key: 'leave_escalation_manager', label: 'Escalation to manager (24h)',   group: 'leave',    channel: 'whatsapp' },
  { key: 'leave_escalation_admin',   label: 'Escalation to admin (48h)',     group: 'leave',    channel: 'whatsapp' },
  { key: 'leave_escalation_employee',label: 'Escalation to employee (72h)',  group: 'leave',    channel: 'whatsapp' },

  { key: 'attendance_checkin_reminder',  label: 'Check-in reminder',         group: 'attendance', channel: 'whatsapp' },
  { key: 'attendance_checkout_reminder', label: 'Check-out reminder',        group: 'attendance', channel: 'whatsapp' },

  { key: 'onboarding_started',        label: 'Onboarding started',          group: 'onboarding', channel: 'both'     },
  { key: 'onboarding_account_created',label: 'Account created (credentials)', group: 'onboarding', channel: 'whatsapp' },
  { key: 'onboarding_welcome',        label: 'Welcome message',             group: 'onboarding', channel: 'whatsapp' },

  { key: 'bot_reminder',  label: 'Custom reminders', group: 'other', channel: 'whatsapp' },
  { key: 'hr_broadcast',  label: 'HR broadcast',     group: 'other', channel: 'whatsapp' },
];

export type NotificationTypeKey = (typeof NOTIFICATION_TYPES)[number]['key'];

/** Reads organizations.settings.notification_toggles[type] — defaults to true (on) when unset. */
export async function isNotificationTypeEnabled(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
  type: string,
): Promise<boolean> {
  const { data } = await db.from('organizations').select('settings').eq('id', orgId).single();
  const settings = (data?.settings as Record<string, unknown>) ?? {};
  const toggles  = (settings.notification_toggles as Record<string, boolean>) ?? {};
  return toggles[type] !== false;
}
