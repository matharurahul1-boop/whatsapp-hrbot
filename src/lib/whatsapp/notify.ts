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
import { sendSmartText } from '@/lib/whatsapp/client';
import { sendPush } from '@/lib/push/send';
import { formatDateTime } from '@/lib/utils/date';
import { canApproveLeaveFor } from '@/lib/rbac';
import { isNotificationTypeEnabled } from '@/lib/utils/notification-settings';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_EMOJI: Record<string, string> = {
  urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢',
};

// Date-only — used for leave start/end dates, which have no time component.
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'No deadline';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Date + time — used for task deadlines, which do have one and default to
// 5 PM IST if not set explicitly (see parseDeadlineString).
function fmtDeadline(iso: string | null | undefined): string {
  if (!iso) return 'No deadline';
  return `${formatDateTime(iso)} IST`;
}

function firstName(fullName: string | null | undefined): string {
  return (fullName ?? 'there').split(' ')[0];
}

/** Lookup a user's wa_number + name together — sendSmartText needs both. */
async function getWaAndName(userId: string): Promise<{ wa_number: string; full_name: string } | null> {
  const db = createAdminClient();
  const { data } = await db.from('users').select('wa_number, full_name').eq('id', userId).single();
  if (!data?.wa_number) return null;
  return { wa_number: data.wa_number, full_name: data.full_name };
}

/** Fire-and-forget wrapper — always resolves, never rejects. */
async function fire(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[Notify:${label}] ❌`, err instanceof Error ? err.message : err);
  }
}

/** Insert a bell-dropdown row so the in-app notification shows this event
 *  regardless of whether the recipient has push notifications enabled or is
 *  reachable on WhatsApp — sendPush only fires real browser push (silently
 *  does nothing without an active subscription) and doesn't touch this
 *  table on its own. */
async function writeInApp(userId: string, orgId: string, title: string, body: string, actionUrl: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from('notifications').insert({
    user_id: userId,
    organization_id: orgId,
    type: 'agent_notification',
    title,
    body,
    action_url: actionUrl,
    is_read: false,
  });
  if (error) console.error('[Notify] in_app insert failed:', error.message);
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
    if (!(await isNotificationTypeEnabled(db, opts.orgId, 'task_assigned'))) return;
    const { data: assignee } = await db
      .from('users').select('full_name, wa_number')
      .eq('id', opts.assigneeId).single();

    const sends: Promise<unknown>[] = [
      sendPush(opts.assigneeId, {
        title: '📋 New task assigned',
        body:  `${opts.taskTitle} — assigned by ${opts.creatorName}`,
        url:   '/tasks',
        tag:   'task-assigned',
      }),
      writeInApp(opts.assigneeId, opts.orgId, '📋 New task assigned', `${opts.taskTitle} — assigned by ${opts.creatorName}`, '/tasks'),
    ];

    if (assignee?.wa_number) {
      const msg =
        `📋 *Hi ${firstName(assignee.full_name)}, you have a new task!*\n\n` +
        `*${opts.taskTitle}*\n\n` +
        `${PRIORITY_EMOJI[opts.priority] ?? '⚪'} Priority: *${opts.priority}*\n` +
        `🗓 Deadline: *${fmtDeadline(opts.deadline)}*\n` +
        `👤 Assigned by: *${opts.creatorName}*\n\n` +
        `Reply *my tasks* to view all your pending tasks.`;
      sends.push(sendSmartText(assignee.wa_number, msg, opts.orgId, firstName(assignee.full_name)));
    }

    await Promise.all(sends);
    console.log(`[Notify:TaskAssigned] ✅ push${assignee?.wa_number ? ' + wa:' + assignee.wa_number : ' only'}`);
  });
}

export async function notifyTaskCompleted(opts: {
  orgId: string;
  taskTitle: string;
  completedByName: string;
  creatorId: string;
}): Promise<void> {
  return fire('TaskCompleted', async () => {
    if (!(await isNotificationTypeEnabled(createAdminClient(), opts.orgId, 'task_completed'))) return;
    const creator = await getWaAndName(opts.creatorId);

    const sends: Promise<unknown>[] = [
      sendPush(opts.creatorId, {
        title: '✅ Task completed',
        body:  `${opts.taskTitle} — marked done by ${opts.completedByName}`,
        url:   '/tasks',
        tag:   'task-completed',
      }),
      writeInApp(opts.creatorId, opts.orgId, '✅ Task completed', `${opts.taskTitle} — marked done by ${opts.completedByName}`, '/tasks'),
    ];

    if (creator) {
      const msg =
        `✅ *Task completed!*\n\n` +
        `*${opts.taskTitle}*\n` +
        `Marked done by: *${opts.completedByName}*\n\n` +
        `Reply *my tasks* to view remaining tasks.`;
      sends.push(sendSmartText(creator.wa_number, msg, opts.orgId, firstName(creator.full_name)));
    }

    await Promise.all(sends);
    console.log(`[Notify:TaskCompleted] ✅ push${creator ? ' + wa:' + creator.wa_number : ' only'}`);
  });
}

export async function notifyTaskUpdated(opts: {
  orgId:       string;
  taskTitle:   string;
  field:       string;
  oldValue:    string;
  value:       string;
  field2?:     string;
  oldValue2?:  string;
  value2?:     string;
  assigneeId:  string;
  updaterName: string;
}): Promise<void> {
  return fire('TaskUpdated', async () => {
    const db = createAdminClient();
    if (!(await isNotificationTypeEnabled(db, opts.orgId, 'task_updated'))) return;
    const { data: assignee } = await db
      .from('users').select('full_name, wa_number')
      .eq('id', opts.assigneeId).single();

    const changeSummary = `${opts.field} changed from ${opts.oldValue} to ${opts.value}` +
      (opts.field2 && opts.value2 ? `, ${opts.field2} changed from ${opts.oldValue2} to ${opts.value2}` : '');

    const sends: Promise<unknown>[] = [
      sendPush(opts.assigneeId, {
        title: '📝 Task updated',
        body:  `${opts.taskTitle} — ${changeSummary}`,
        url:   '/tasks',
        tag:   'task-updated',
      }),
      writeInApp(opts.assigneeId, opts.orgId, '📝 Task updated', `${opts.taskTitle} — ${changeSummary}`, '/tasks'),
    ];

    if (assignee?.wa_number) {
      // Every field shows both the old and new value, not just the new one —
      // "title" gets a friendlier label since "title changed from..." reads
      // oddly lowercase, everything else keeps the raw field name.
      const changeLine = (field: string, oldVal: string, newVal: string) =>
        `${field === 'title' ? 'Title' : field} changed from *${oldVal}* to *${newVal}*\n`;
      const msg =
        `📝 *Task updated, ${firstName(assignee.full_name)}!*\n\n` +
        `*${opts.taskTitle}*\n\n` +
        changeLine(opts.field, opts.oldValue, opts.value) +
        (opts.field2 && opts.oldValue2 && opts.value2 ? changeLine(opts.field2, opts.oldValue2, opts.value2) : '') +
        `Updated by: *${opts.updaterName}*\n\n` +
        `Reply *my tasks* to view your tasks.`;
      sends.push(sendSmartText(assignee.wa_number, msg, opts.orgId, firstName(assignee.full_name)));
    }

    await Promise.all(sends);
    console.log(`[Notify:TaskUpdated] ✅ push${assignee?.wa_number ? ' + wa:' + assignee.wa_number : ' only'}`);
  });
}

export async function notifyTaskDeleted(opts: {
  orgId:       string;
  taskTitle:   string;
  priority?:   string | null;
  deadline?:   string | null;
  assigneeId:  string;
  deleterName: string;
}): Promise<void> {
  return fire('TaskDeleted', async () => {
    const db = createAdminClient();
    if (!(await isNotificationTypeEnabled(db, opts.orgId, 'task_deleted'))) return;
    const { data: assignee } = await db
      .from('users').select('full_name, wa_number')
      .eq('id', opts.assigneeId).single();

    const sends: Promise<unknown>[] = [
      sendPush(opts.assigneeId, {
        title: '🗑️ Task removed',
        body:  `${opts.taskTitle} was deleted by ${opts.deleterName}`,
        url:   '/tasks',
        tag:   'task-deleted',
      }),
      writeInApp(opts.assigneeId, opts.orgId, '🗑️ Task removed', `${opts.taskTitle} was deleted by ${opts.deleterName}`, '/tasks'),
    ];

    if (assignee?.wa_number) {
      const pEmoji = opts.priority ? PRIORITY_EMOJI[opts.priority] ?? '⚪' : null;
      const msg =
        `🗑️ *Task removed, ${firstName(assignee.full_name)}!*\n\n` +
        `*${opts.taskTitle}*\n` +
        (pEmoji ? `${pEmoji} Priority: *${opts.priority}*\n` : '') +
        (opts.deadline ? `🗓 Deadline: *${fmtDeadline(opts.deadline)}*\n` : '') +
        `Deleted by: *${opts.deleterName}*\n\n` +
        `Reply *my tasks* to view your remaining tasks.`;
      sends.push(sendSmartText(assignee.wa_number, msg, opts.orgId, firstName(assignee.full_name)));
    }

    await Promise.all(sends);
    console.log(`[Notify:TaskDeleted] ✅ push${assignee?.wa_number ? ' + wa:' + assignee.wa_number : ' only'}`);
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
    if (!(await isNotificationTypeEnabled(createAdminClient(), opts.orgId, 'task_deadline_reminder'))) return;
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

    await sendSmartText(opts.waNumber, msg, opts.orgId, firstName(opts.assigneeName));
    console.log(`[Notify:TaskDeadline] ✅ ${opts.waNumber}`);
  });
}

// ── LEAVE NOTIFICATIONS ───────────────────────────────────────────────────────

/**
 * Notifies EVERY eligible approver in the org, not just one — per the role
 * hierarchy in rbac.ts (canApproveLeaveFor), so e.g. an employee's request
 * reaches every hr_assistant/hr/admin/super_admin, not a single fallback
 * pick. Replaces the previous notifyLeaveSubmitted, which only notified one
 * recipient (the manager, or the first HR-ish user found) and used a flat
 * hardcoded role list that didn't account for the applicant's own role
 * (e.g. it would treat other hr_assistants as valid targets even when the
 * applicant was themselves hr_assistant, which the hierarchy forbids).
 */
export async function notifyLeaveApprovalNeeded(opts: {
  orgId: string;
  applicantRole: string;
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  reason?: string | null;
}): Promise<void> {
  return fire('LeaveApprovalNeeded', async () => {
    const db = createAdminClient();
    if (!(await isNotificationTypeEnabled(db, opts.orgId, 'leave_approval_needed'))) return;
    const { data: candidates } = await db
      .from('users')
      .select('id, full_name, wa_number, role')
      .eq('organization_id', opts.orgId)
      .eq('is_active', true)
      .is('deleted_at', null);

    const approvers = (candidates ?? []).filter(u => canApproveLeaveFor(u.role, opts.applicantRole));
    if (!approvers.length) return;

    const isSingle = opts.startDate === opts.endDate;
    const dateStr  = isSingle
      ? fmtDate(opts.startDate)
      : `${fmtDate(opts.startDate)} → ${fmtDate(opts.endDate)}`;

    const title = '📩 New leave request';
    const body  = `${opts.employeeName} — ${opts.leaveTypeName}, ${dateStr}`;

    const sends: Promise<unknown>[] = [];
    for (const approver of approvers) {
      sends.push(sendPush(approver.id, { title, body, url: '/leave', tag: 'leave-submitted' }));
      sends.push(writeInApp(approver.id, opts.orgId, title, body, '/leave'));

      if (approver.wa_number) {
        const msg =
          `📩 *New leave request*\n\n` +
          `👤 *${opts.employeeName}*\n` +
          `📋 Type: *${opts.leaveTypeName}*\n` +
          `🗓 ${dateStr} _(${opts.durationDays} day${opts.durationDays > 1 ? 's' : ''})_\n` +
          (opts.reason ? `💬 "${opts.reason}"\n` : '') +
          `\nReply *approve leave for ${opts.employeeName.split(' ')[0]}* or ` +
          `*reject leave for ${opts.employeeName.split(' ')[0]}* to action.`;
        sends.push(sendSmartText(approver.wa_number, msg, opts.orgId, firstName(approver.full_name)));
      }
    }

    await Promise.all(sends);
    console.log(`[Notify:LeaveApprovalNeeded] ✅ notified ${approvers.length} approver(s)`);
  });
}

export async function notifyLeaveDecision(opts: {
  orgId: string;
  employeeId: string;
  employeeName: string;
  applicantRole: string;
  reviewerId: string;
  action: 'approved' | 'rejected';
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  reviewerName: string;
  remarks?: string | null;
}): Promise<void> {
  return fire('LeaveDecision', async () => {
    const db = createAdminClient();
    if (!(await isNotificationTypeEnabled(db, opts.orgId, 'leave_decision'))) return;
    const target = await getWaAndName(opts.employeeId);

    const isSingle = opts.startDate === opts.endDate;
    const dateStr  = isSingle
      ? fmtDate(opts.startDate)
      : `${fmtDate(opts.startDate)} → ${fmtDate(opts.endDate)}`;

    const approved = opts.action === 'approved';
    const sends: Promise<unknown>[] = [];

    // 1. The applicant themselves.
    sends.push(
      sendPush(opts.employeeId, {
        title: approved ? '✅ Leave approved' : '❌ Leave rejected',
        body:  `${opts.leaveTypeName} — ${dateStr}`,
        url:   '/leave',
        tag:   'leave-decision',
      }),
      writeInApp(opts.employeeId, opts.orgId, approved ? '✅ Leave approved' : '❌ Leave rejected', `${opts.leaveTypeName} — ${dateStr}`, '/leave'),
    );
    if (target) {
      const msg =
        `${approved ? '✅' : '❌'} *Your leave request has been ${opts.action}!*\n\n` +
        `📋 Type: *${opts.leaveTypeName}*\n` +
        `🗓 *${dateStr}*\n` +
        `👤 Reviewed by: *${opts.reviewerName}*\n` +
        (opts.remarks && !approved ? `\n💬 Reason: ${opts.remarks}\n` : '') +
        (approved
          ? `\nEnjoy your time off! 🎉`
          : `\nPlease contact HR if you have questions.`);
      sends.push(sendSmartText(target.wa_number, msg, opts.orgId, firstName(target.full_name)));
    }

    // 2. Every other approver who was originally notified about this
    // request (canApproveLeaveFor, same set notifyLeaveApprovalNeeded
    // used) — everyone except the applicant and whoever just made the
    // decision, so they know it's resolved and no longer needs action.
    const { data: candidates } = await db
      .from('users')
      .select('id, full_name, wa_number, role')
      .eq('organization_id', opts.orgId)
      .eq('is_active', true)
      .is('deleted_at', null);

    const others = (candidates ?? []).filter(u =>
      u.id !== opts.employeeId && u.id !== opts.reviewerId && canApproveLeaveFor(u.role, opts.applicantRole)
    );

    const othersTitle = approved ? '✅ Leave request resolved' : '❌ Leave request resolved';
    const othersBody  = `${opts.employeeName} — ${opts.leaveTypeName}, ${dateStr} — ${opts.action} by ${opts.reviewerName}`;
    for (const other of others) {
      sends.push(
        sendPush(other.id, { title: othersTitle, body: othersBody, url: '/leave', tag: 'leave-decision' }),
        writeInApp(other.id, opts.orgId, othersTitle, othersBody, '/leave'),
      );
      if (other.wa_number) {
        const msg =
          `${approved ? '✅' : '❌'} *Leave request resolved*\n\n` +
          `👤 *${opts.employeeName}*\n` +
          `📋 Type: *${opts.leaveTypeName}*\n` +
          `🗓 ${dateStr}\n` +
          `${approved ? 'Approved' : 'Rejected'} by *${opts.reviewerName}*\n\n` +
          `No action needed.`;
        sends.push(sendSmartText(other.wa_number, msg, opts.orgId, firstName(other.full_name)));
      }
    }

    await Promise.all(sends);
    console.log(`[Notify:LeaveDecision] ✅ applicant${target ? ' + wa' : ''} + ${others.length} other approver(s) notified`);
  });
}

/**
 * Notifies every approver eligible to have approved this leave (per the
 * same canApproveLeaveFor hierarchy as notifyLeaveApprovalNeeded) that it
 * was cancelled — not just one fallback recipient. Uses the leave owner's
 * role (applicantRole), the same tier that would have been asked to
 * approve it in the first place, regardless of who actually triggered the
 * cancellation (self-cancel or HR+ cancelling on someone's behalf).
 */
export async function notifyLeaveCancelled(opts: {
  orgId: string;
  applicantRole: string;
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
}): Promise<void> {
  return fire('LeaveCancelled', async () => {
    const db = createAdminClient();
    if (!(await isNotificationTypeEnabled(db, opts.orgId, 'leave_cancelled'))) return;
    const { data: candidates } = await db
      .from('users')
      .select('id, full_name, wa_number, role')
      .eq('organization_id', opts.orgId)
      .eq('is_active', true)
      .is('deleted_at', null);

    const approvers = (candidates ?? []).filter(u => canApproveLeaveFor(u.role, opts.applicantRole));
    if (!approvers.length) return;

    const msg =
      `🚫 *Leave cancelled*\n\n` +
      `*${opts.employeeName}* has cancelled their *${opts.leaveTypeName}* ` +
      `leave scheduled for *${fmtDate(opts.startDate)}*.\n\n` +
      `No action required.`;

    const sends: Promise<unknown>[] = [];
    for (const approver of approvers) {
      sends.push(writeInApp(approver.id, opts.orgId, '🚫 Leave cancelled', `${opts.employeeName} — ${opts.leaveTypeName}, ${fmtDate(opts.startDate)}`, '/leave'));
      if (approver.wa_number) {
        sends.push(sendSmartText(approver.wa_number, msg, opts.orgId, firstName(approver.full_name)));
      }
    }

    await Promise.all(sends);
    console.log(`[Notify:LeaveCancelled] ✅ notified ${approvers.length} approver(s)`);
  });
}

// ── ATTENDANCE NOTIFICATIONS ──────────────────────────────────────────────────

export async function notifyCheckInReminder(opts: {
  orgId: string;
  waNumber: string;
  employeeName: string;
}): Promise<void> {
  return fire('CheckInReminder', async () => {
    if (!(await isNotificationTypeEnabled(createAdminClient(), opts.orgId, 'attendance_checkin_reminder'))) return;
    const msg =
      `🌅 *Good morning, ${firstName(opts.employeeName)}!*\n\n` +
      `You haven't checked in yet today.\n\n` +
      `Reply *checkin* to mark your attendance.\n` +
      `_Work from home? That counts too!_ 😊`;

    await sendSmartText(opts.waNumber, msg, opts.orgId, firstName(opts.employeeName));
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
    if (!(await isNotificationTypeEnabled(createAdminClient(), opts.orgId, 'attendance_checkout_reminder'))) return;
    const cinStr = new Date(opts.checkInTime).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
    });

    const msg =
      `🌙 *Don't forget to check out, ${firstName(opts.employeeName)}!*\n\n` +
      `You checked in at *${cinStr}* and haven't checked out yet.\n\n` +
      `Reply *checkout* to mark your departure.\n` +
      `_Your hours won't be calculated until you check out._ ⏱`;

    await sendSmartText(opts.waNumber, msg, opts.orgId, firstName(opts.employeeName));
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
    if (!(await isNotificationTypeEnabled(createAdminClient(), opts.orgId, 'onboarding_welcome'))) return;
    const msg =
      `👋 *Welcome to ${opts.companyName}, ${firstName(opts.employeeName)}!*\n\n` +
      `I'm your AI HR assistant on WhatsApp. Here's what I can help you with:\n\n` +
      `📋 *Tasks* — "my tasks", "create task [title]"\n` +
      `📅 *Leave* — "apply sick leave", "my leave balance"\n` +
      `⏰ *Attendance* — "checkin", "checkout", "my attendance"\n` +
      `❓ *Help* — just type "help" anytime\n\n` +
      `_Reply in English or Hindi — I understand both!_ 🤖`;

    await sendSmartText(opts.waNumber, msg, opts.orgId, firstName(opts.employeeName));
    console.log(`[Notify:Welcome] ✅ ${opts.waNumber}`);
  });
}

/** Sent when an admin/HR user creates an account directly (not self-signup).
 *  Includes login credentials, so the WA Logs record is redacted — only
 *  this fire-and-forget send sees the real password. */
export async function notifyAccountCreated(opts: {
  orgId: string;
  waNumber: string;
  employeeName: string;
  companyName: string;
  email: string;
  password: string;
  loginUrl: string;
}): Promise<void> {
  return fire('AccountCreated', async () => {
    if (!(await isNotificationTypeEnabled(createAdminClient(), opts.orgId, 'onboarding_account_created'))) return;
    const msg =
      `👋 *Welcome to ${opts.companyName}, ${firstName(opts.employeeName)}!*\n\n` +
      `An account has been created for you. Here are your login details:\n\n` +
      `📧 Email: ${opts.email}\n` +
      `🔑 Password: ${opts.password}\n\n` +
      `Sign in at: ${opts.loginUrl}\n` +
      `_Please change your password after your first login._\n\n` +
      `I'm also your AI HR assistant right here on WhatsApp — type "help" anytime to see what I can do.`;

    await sendSmartText(
      opts.waNumber,
      msg,
      opts.orgId,
      firstName(opts.employeeName),
      `👋 Welcome message with login credentials sent to ${firstName(opts.employeeName)}.`,
    );
    console.log(`[Notify:AccountCreated] ✅ ${opts.waNumber}`);
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

  if (!(await isNotificationTypeEnabled(db, opts.orgId, 'hr_broadcast'))) {
    console.log('[Notify:Broadcast] skipped — disabled for org');
    return { sent: 0, skipped: 0 };
  }

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
      await sendSmartText(emp.wa_number, header, opts.orgId, firstName(emp.full_name));
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
