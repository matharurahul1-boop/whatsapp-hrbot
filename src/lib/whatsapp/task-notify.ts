/**
 * WhatsApp notification helpers for task events.
 * All functions are fire-and-forget — they log errors but never throw,
 * so a WA delivery failure never breaks the API response.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { sendText }          from '@/lib/whatsapp/client';

const PRIORITY_EMOJI: Record<string, string> = {
  urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'No deadline';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ─── notifyTaskAssigned ───────────────────────────────────────────────────────
// Called from POST /api/tasks and PATCH /api/tasks/[id] whenever an assignee
// is set or changed.  Sends a WhatsApp message to the new assignee.

export async function notifyTaskAssigned(opts: {
  orgId:        string;
  taskId:       string;
  taskTitle:    string;
  priority:     string;
  deadline:     string | null;
  assigneeId:   string;
  creatorName:  string;
}): Promise<void> {
  try {
    const db = createAdminClient();

    // 1. Fetch the assignee's wa_number
    const { data: assignee } = await db
      .from('users')
      .select('full_name, wa_number')
      .eq('id', opts.assigneeId)
      .single();

    if (!assignee?.wa_number) return;   // no WA number — nothing to send

    // 2. Build the message
    const pEmoji   = PRIORITY_EMOJI[opts.priority] ?? '⚪';
    const deadline = fmtDate(opts.deadline);
    const firstName = assignee.full_name.split(' ')[0];

    const message =
      `📋 *Hi ${firstName}, you have a new task!*\n\n` +
      `*${opts.taskTitle}*\n\n` +
      `${pEmoji} Priority: *${opts.priority}*\n` +
      `🗓 Deadline: *${deadline}*\n` +
      `👤 Assigned by: *${opts.creatorName}*\n\n` +
      `Reply *my tasks* to view all your pending tasks.`;

    // 3. Send — fire and forget
    await sendText(assignee.wa_number, message, opts.orgId);

    console.log(`[TaskNotify] ✅ Sent to ${assignee.wa_number} for task "${opts.taskTitle}"`);
  } catch (err) {
    // Never propagate — WA notification failure must not break task creation
    console.error('[TaskNotify] ❌ Failed to send task notification:', err instanceof Error ? err.message : err);
  }
}
