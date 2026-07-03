/**
 * Central WhatsApp notification hub.
 *
 * Every exported function is fire-and-forget — it logs errors internally
 * and never throws, so WA delivery failures never break API responses.
 *
 * Covers:
 *  - Tasks    : assigned, reassigned, completed, updated, deleted, deadline reminder
 *  - Leave    : submitted (→ manager), decision (→ employee), cancelled (→ manager)
 *  - Attendance: check-in reminder, checkout reminder
 *  - Onboarding: welcome message for new employee
 *  - Broadcast : HR sends message to all / filtered employees
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { sendText }          from '@/lib/whatsapp/client';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_EMOJI: Record<string, string> = {
  urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'No deadline';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function firstName(fullName: string | null | undefined): string {
  return (fullName ?? 'there').split(' ')[0];
}

/** Lookup a user's wa_number. Returns null if not set. */
async function getWaNumber(userId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.from('users').select('wa_number').eq('id', userId).single();
  return data?.wa_number ?? null;
}

/** Fire-and-forget wrapper — always resolves, never rejects. */
async function fire(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[Notify:${label}] ❌`, err instanceof Error ? err.message : err);
  }
}

// ── TASK NOTIFICATIONS ────────────────────────────────────────────────────────

export async function notifyTaskAssigned(opts: {
  orgId: string;
  taskTitle: string;
  priority: string;
  deadline: string | null;
  assigneeId: string;
  creatorName: string;
}): Promise<void> {
  return fire('TaskAssigned', async () => {
    const db = createAdminClient();
    const { data: assignee } = await db
      .from('users').select('full_name, wa_number')
      .eq('id', opts.assigneeId).single();
    if (!assignee?.wa_number) return;

    const msg =
      `📋 *Hi ${firstName(assignee.full_name)}, you have a new task!*\n\n` +
      `*${opts.taskTitle}*\n\n` +
      `${PRIORITY_EMOJI[opts.priority] ?? '⚪'} Priority: *${opts.priority}*\n` +
      `🗓 Deadline: *${fmtDate(opts.deadline)}*\n` +
      `👤 Assigned by: *${opts.creatorName}*\n\n` +
      `Reply *my tasks* to view all your pending tasks.`;

    await sendText(assignee.wa_number, msg, opts.orgId);
    console.log(`[Notify:TaskAssigned] ✅ ${assignee.wa_number}`);
  });
}

export async function notifyTaskCompleted(opts: {
  orgId: string;
  taskTitle: string;
  completedByName: string;
  creatorId: string;
}): Promise<void> {
  return fire('TaskCompleted', async () => {
    const waNum = await getWaNumber(opts.creatorId);
    if (!waNum) return;

    const msg =
      `✅ *Task completed!*\n\n` +
      `*${opts.taskTitle}*\n` +
      `Marked done by: *${opts.completedByName}*\n\n` +
      `Reply *my tasks* to view remaining tasks.`;

    await sendText(waNum, msg, opts.orgId);
    console.log(`[Notify:TaskCompleted] ✅ ${waNum}`);
  });
}

export async function notifyTaskUpdated(opts: {
  orgId:       string;
  taskTitle:   string;
  field:       string;
  value:       string;
  assigneeId:  string;
  updaterName: string;
}): Promise<void> {
  return fire('TaskUpdated', async () => {
    const db = createAdminClient();
    const { data: assignee } = await db
      .from('users').select('full_name, wa_number')
      .eq('id', opts.assigneeId).single();
    if (!assignee?.wa_number) return;

    const msg =
      `📝 *Task updated, ${firstName(assignee.full_name)}!*\n\n` +
      `*${opts.taskTitle}*\n\n` +
      `${opts.field} changed to: *${opts.value}*\n` +
      `Updated by: *${opts.updaterName}*\n\n` +
      `Reply *my tasks* to view your tasks.`;

    await sendText(assignee.wa_number, msg, opts.orgId);
    console.log(`[Notify:TaskUpdated] ✅ ${assignee.wa_number}`);
  });
}

export async function notifyTaskDeleted(opts: {
  orgId:       string;
  taskTitle:   string;
  assigneeId:  string;
  deleterName: string;
}): Promise<void> {
  return fire('TaskDeleted', async () => {
    const db = createAdminClient();
    const { data: assignee } = await db
      .from('users').select('full_name, wa_number')
      .eq('id', opts.assigneeId).single();
    if (!assignee?.wa_number) return;

    const msg =
      `🗑️ *Task removed, ${firstName(assignee.full_name)}!*\n\n` +
      `*${opts.taskTitle}* has been deleted by *${opts.deleterName}*.\n\n` +
      `Reply *my tasks* to view your remaining tasks.`;

    await sendText(assignee.wa_number, msg, opts.orgId);
    console.log(`[Notify:TaskDeleted] ✅ ${assignee.wa_number}`);
  });
}

const REMINDER_LABEL: Record<string, string> = {
  '1_hour':  '1-hour reminder',
  '2_hours': '2-hour reminder',
  '4_hours': '4-hour reminder',
  '1_day':   '1-day reminder',
};

export async function notifyTaskDeadlineReminder(opts: {
  orgId: string;
  waNumber: string;
  assigneeName: string;
  taskTitle: string;
  deadline: string;
  reminderType?: string | null;
}): Promise<void> {
  return fire('TaskDeadline', async () => {
    // Format full ISO datetime in IST (e.g. "15 Jul 2026, 02:30 PM")
    const d = new Date(opts.deadline);
    const deadlineStr = isNaN(d.getTime())
      ? fmtDate(opts.deadline)
      : d.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: true,
        });

    const label = opts.reminderType ? REMINDER_LABEL[opts.reminderType] : null;

    const msg =
      `⏰ *Deadline reminder, ${firstName(opts.assigneeName)}!*` +
      (label ? ` _(${label})_` : '') + `\n\n` +
      `*${opts.taskTitle}*\n` +
      `Due: *${deadlineStr}*\n\n` +
      `Reply *my tasks* to view and update your tasks.`;

    await sendText(opts.waNumber, msg, opts.orgId);
    console.log(`[Notify:TaskDeadline] ✅ ${opts.waNumber}`);
  });
}

// ── LEAVE NOTIFICATIONS ───────────────────────────────────────────────────────

export async function notifyLeaveSubmitted(opts: {
  orgId: string;
  managerId: string | null;
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  reason?: string | null;
}): Promise<void> {
  return fire('LeaveSubmitted', async () => {
    // Notify the manager (or fallback: any HR/admin in org)
    let targetId = opts.managerId;
    const db = createAdminClient();

    if (!targetId) {
      const { data: hr } = await db
        .from('users')
        .select('id')
        .eq('organization_id', opts.orgId)
        .in('role', ['hr', 'admin', 'super_admin'])
        .eq('is_active', true)
        .limit(1)
        .single();
      targetId = hr?.id ?? null;
    }

    if (!targetId) return;
    const waNum = await getWaNumber(targetId);
    if (!waNum) return;

    const isSingle = opts.startDate === opts.endDate;
    const dateStr  = isSingle
      ? fmtDate(opts.startDate)
      : `${fmtDate(opts.startDate)} → ${fmtDate(opts.endDate)}`;

    const msg =
      `📩 *New leave request*\n\n` +
      `👤 *${opts.employeeName}*\n` +
      `📋 Type: *${opts.leaveTypeName}*\n` +
      `🗓 ${dateStr} _(${opts.durationDays} day${opts.durationDays > 1 ? 's' : ''})_\n` +
      (opts.reason ? `💬 "${opts.reason}"\n` : '') +
      `\nReply *approve leave for ${opts.employeeName.split(' ')[0]}* or ` +
      `*reject leave for ${opts.employeeName.split(' ')[0]}* to action.`;

    await sendText(waNum, msg, opts.orgId);
    console.log(`[Notify:LeaveSubmitted] ✅ ${waNum}`);
  });
}

export async function notifyLeaveDecision(opts: {
  orgId: string;
  employeeId: string;
  action: 'approved' | 'rejected';
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  reviewerName: string;
  remarks?: string | null;
}): Promise<void> {
  return fire('LeaveDecision', async () => {
    const waNum = await getWaNumber(opts.employeeId);
    if (!waNum) return;

    const isSingle = opts.startDate === opts.endDate;
    const dateStr  = isSingle
      ? fmtDate(opts.startDate)
      : `${fmtDate(opts.startDate)} → ${fmtDate(opts.endDate)}`;

    const approved = opts.action === 'approved';

    const msg =
      `${approved ? '✅' : '❌'} *Your leave request has been ${opts.action}!*\n\n` +
      `📋 Type: *${opts.leaveTypeName}*\n` +
      `🗓 *${dateStr}*\n` +
      `👤 Reviewed by: *${opts.reviewerName}*\n` +
      (opts.remarks && !approved ? `\n💬 Reason: ${opts.remarks}\n` : '') +
      (approved
        ? `\nEnjoy your time off! 🎉`
        : `\nPlease contact HR if you have questions.`);

    await sendText(waNum, msg, opts.orgId);
    console.log(`[Notify:LeaveDecision] ✅ ${waNum}`);
  });
}

export async function notifyLeaveCancelled(opts: {
  orgId: string;
  managerId: string | null;
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
}): Promise<void> {
  return fire('LeaveCancelled', async () => {
    let targetId = opts.managerId;
    if (!targetId) {
      const db = createAdminClient();
      const { data: hr } = await db.from('users').select('id')
        .eq('organization_id', opts.orgId).in('role', ['hr', 'admin'])
        .eq('is_active', true).limit(1).single();
      targetId = hr?.id ?? null;
    }
    if (!targetId) return;
    const waNum = await getWaNumber(targetId);
    if (!waNum) return;

    const msg =
      `🚫 *Leave cancelled*\n\n` +
      `*${opts.employeeName}* has cancelled their *${opts.leaveTypeName}* ` +
      `leave scheduled for *${fmtDate(opts.startDate)}*.\n\n` +
      `No action required.`;

    await sendText(waNum, msg, opts.orgId);
    console.log(`[Notify:LeaveCancelled] ✅ ${waNum}`);
  });
}

// ── ATTENDANCE NOTIFICATIONS ──────────────────────────────────────────────────

export async function notifyCheckInReminder(opts: {
  orgId: string;
  waNumber: string;
  employeeName: string;
}): Promise<void> {
  return fire('CheckInReminder', async () => {
    const msg =
      `🌅 *Good morning, ${firstName(opts.employeeName)}!*\n\n` +
      `You haven't checked in yet today.\n\n` +
      `Reply *checkin* to mark your attendance.\n` +
      `_Work from home? That counts too!_ 😊`;

    await sendText(opts.waNumber, msg, opts.orgId);
    console.log(`[Notify:CheckInReminder] ✅ ${opts.waNumber}`);
  });
}

export async function notifyCheckOutReminder(opts: {
  orgId: string;
  waNumber: string;
  employeeName: string;
  checkInTime: string;
}): Promise<void> {
  return fire('CheckOutReminder', async () => {
    const cinStr = new Date(opts.checkInTime).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
    });

    const msg =
      `🌙 *Don't forget to check out, ${firstName(opts.employeeName)}!*\n\n` +
      `You checked in at *${cinStr}* and haven't checked out yet.\n\n` +
      `Reply *checkout* to mark your departure.\n` +
      `_Your hours won't be calculated until you check out._ ⏱`;

    await sendText(opts.waNumber, msg, opts.orgId);
    console.log(`[Notify:CheckOutReminder] ✅ ${opts.waNumber}`);
  });
}

// ── ONBOARDING / WELCOME ──────────────────────────────────────────────────────

export async function notifyWelcome(opts: {
  orgId: string;
  waNumber: string;
  employeeName: string;
  companyName: string;
}): Promise<void> {
  return fire('Welcome', async () => {
    const msg =
      `👋 *Welcome to ${opts.companyName}, ${firstName(opts.employeeName)}!*\n\n` +
      `I'm your AI HR assistant on WhatsApp. Here's what I can help you with:\n\n` +
      `📋 *Tasks* — "my tasks", "create task [title]"\n` +
      `📅 *Leave* — "apply sick leave", "my leave balance"\n` +
      `⏰ *Attendance* — "checkin", "checkout", "my attendance"\n` +
      `❓ *Help* — just type "help" anytime\n\n` +
      `_Reply in English or Hindi — I understand both!_ 🤖`;

    await sendText(opts.waNumber, msg, opts.orgId);
    console.log(`[Notify:Welcome] ✅ ${opts.waNumber}`);
  });
}

// ── HR BROADCAST ──────────────────────────────────────────────────────────────

export interface BroadcastFilter {
  department?: string;
  role?: string;
  employeeIds?: string[];
}

export async function broadcastMessage(opts: {
  orgId: string;
  message: string;
  senderName: string;
  filter?: BroadcastFilter;
}): Promise<{ sent: number; skipped: number }> {
  const db = createAdminClient();

  let query = db
    .from('users')
    .select('id, full_name, wa_number')
    .eq('organization_id', opts.orgId)
    .eq('is_active', true)
    .not('wa_number', 'is', null);

  if (opts.filter?.department) query = query.eq('department', opts.filter.department);
  if (opts.filter?.role)       query = query.eq('role', opts.filter.role);
  if (opts.filter?.employeeIds?.length) query = query.in('id', opts.filter.employeeIds);

  const { data: employees } = await query;
  if (!employees?.length) return { sent: 0, skipped: 0 };

  const header =
    `📢 *Message from ${opts.senderName}*\n\n` +
    `${opts.message}`;

  let sent = 0;
  let skipped = 0;

  for (const emp of employees) {
    if (!emp.wa_number) { skipped++; continue; }
    try {
      await sendText(emp.wa_number, header, opts.orgId);
      sent++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    } catch {
      skipped++;
    }
  }

  console.log(`[Notify:Broadcast] ✅ sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}
