/**
 * POST /api/reminders/run  — attendance reminders (checkin / checkout / deadline)
 * GET  /api/reminders/run  — task due-date reminders driven by per-user preferences
 *                            called by Vercel Cron every hour
 *
 * Auth: Authorization: Bearer <APP_SECRET>  OR  x-vercel-cron: 1 header
 *
 * POST body: { type: "checkin" | "checkout" | "deadline" }
 * GET fires based on IST hour:
 *   09:00 → "1_day" (due tomorrow) + "on_due" (due today)
 *   16:00 → "2_hours" (due today, assumed EOD 18:00)
 *   17:00 → "1_hour"  (due today, assumed EOD 18:00)
 */

import { NextRequest, NextResponse }      from 'next/server';
import { createAdminClient }              from '@/lib/supabase/admin';
import {
  notifyCheckInReminder,
  notifyCheckOutReminder,
  notifyTaskDeadlineReminder,
} from '@/lib/whatsapp/notify';

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

function tomorrowIST(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export async function POST(req: NextRequest) {
  // Auth: Bearer APP_SECRET
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { type } = await req.json() as { type: string };
  const db  = createAdminClient();
  const today    = todayIST();
  const tomorrow = tomorrowIST();

  // ── Fetch all active orgs ─────────────────────────────────────────────────
  const { data: orgs } = await db
    .from('organizations')
    .select('id, name')
    .not('wa_phone_number_id', 'is', null);

  if (!orgs?.length) return NextResponse.json({ ok: true, processed: 0 });

  let processed = 0;

  for (const org of orgs) {
    // ── Check-in reminder ─────────────────────────────────────────────────────
    if (type === 'checkin') {
      // All active employees in this org
      const { data: employees } = await db
        .from('users')
        .select('id, full_name, wa_number')
        .eq('organization_id', org.id)
        .eq('is_active', true)
        .eq('role', 'employee')
        .not('wa_number', 'is', null);

      if (!employees?.length) continue;

      // Who already checked in today?
      const { data: checkedIn } = await db
        .from('attendance_records')
        .select('employee_id')
        .eq('organization_id', org.id)
        .eq('date', today);

      const checkedInIds = new Set((checkedIn ?? []).map((r: any) => r.employee_id));

      for (const emp of employees) {
        if (!emp.wa_number || checkedInIds.has(emp.id)) continue;
        await notifyCheckInReminder({
          orgId:        org.id,
          waNumber:     emp.wa_number,
          employeeName: emp.full_name,
        });
        processed++;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // ── Checkout reminder ─────────────────────────────────────────────────────
    if (type === 'checkout') {
      // Employees who checked in but not out
      const { data: pendingCheckouts } = await db
        .from('attendance_records')
        .select('employee_id, check_in_time, employee:users!attendance_records_employee_id_fkey(full_name, wa_number)')
        .eq('organization_id', org.id)
        .eq('date', today)
        .not('check_in_time', 'is', null)
        .is('check_out_time', null);

      for (const rec of (pendingCheckouts ?? [])) {
        const emp = (rec as any).employee;
        if (!emp?.wa_number) continue;
        await notifyCheckOutReminder({
          orgId:        org.id,
          waNumber:     emp.wa_number,
          employeeName: emp.full_name,
          checkInTime:  rec.check_in_time,
        });
        processed++;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // ── Task deadline reminder (tasks due tomorrow) ───────────────────────────
    if (type === 'deadline') {
      const { data: dueTasks } = await db
        .from('tasks')
        .select(`
          id, title, deadline,
          assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number)
        `)
        .eq('organization_id', org.id)
        .eq('deadline', tomorrow)
        .not('status', 'in', '("done","cancelled")')
        .is('deleted_at', null);

      for (const task of (dueTasks ?? [])) {
        const assignee = (task as any).assignee;
        if (!assignee?.wa_number) continue;
        await notifyTaskDeadlineReminder({
          orgId:        org.id,
          waNumber:     assignee.wa_number,
          assigneeName: assignee.full_name,
          taskTitle:    task.title,
          deadline:     task.deadline,
        });
        processed++;
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }

  console.log(`[Reminders:${type}] ✅ processed=${processed}`);
  return NextResponse.json({ ok: true, type, processed });
}

// ── GET — per-task due-date reminders (Vercel Cron, runs every 30 min) ────────
//
// For each reminder offset the task has set, this handler fires when
//   now + offset  falls within a ±30-min window around the task's deadline.
//
// i.e., it finds tasks where:
//   deadline BETWEEN (now + offset - 30min)  AND  (now + offset + 30min)
//
// Each reminder fires exactly once per task per day because the window is
// too narrow to be hit by two consecutive hourly runs.
//
// Channel preference (WhatsApp / in-app) comes from the assignee's
// users.metadata.task_reminders.channels (set in Settings → Notifications).

const REMINDER_OFFSETS: Record<string, number> = {
  '1_hour':  1  * 60 * 60 * 1000,
  '2_hours': 2  * 60 * 60 * 1000,
  '4_hours': 4  * 60 * 60 * 1000,
  '1_day':   24 * 60 * 60 * 1000,
};

const REMINDER_LABEL: Record<string, string> = {
  '1_hour':  'due in 1 hour',
  '2_hours': 'due in 2 hours',
  '4_hours': 'due in 4 hours',
  '1_day':   'due tomorrow',
};

export async function GET(req: NextRequest) {
  const isCron = req.headers.get('x-vercel-cron') === '1';
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  if (!isCron && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db  = createAdminClient();
  const now = new Date();
  const WINDOW_MS = 30 * 60 * 1000; // ±30-min window around each offset

  // All active orgs with WhatsApp configured
  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  if (!orgs?.length) return NextResponse.json({ ok: true, processed: 0 });

  let processed = 0;

  for (const [offsetKey, offsetMs] of Object.entries(REMINDER_OFFSETS)) {
    // Target moment = now + offset. Work in IST for date/time matching.
    const targetMs   = now.getTime() + offsetMs;
    const targetDate = new Date(targetMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD IST

    // Fetch tasks due on targetDate that have due_time set AND have this reminder
    const { data: tasks } = await db
      .from('tasks')
      .select(`
        id, title, deadline, due_time, reminders, organization_id,
        assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number, metadata)
      `)
      .eq('deadline', targetDate)
      .not('due_time', 'is', null)
      .contains('reminders', [offsetKey])
      .not('status', 'in', '("done","cancelled")')
      .is('deleted_at', null);

    // Filter by time window in JS (due_time is IST; compute exact UTC moment and compare)
    const inWindow = (tasks ?? []).filter(task => {
      const deadlineUTC = new Date(`${task.deadline}T${(task as any).due_time.slice(0, 5)}+05:30`);
      const reminderUTC = deadlineUTC.getTime() - offsetMs;
      return Math.abs(now.getTime() - reminderUTC) <= WINDOW_MS;
    });

    for (const task of inWindow) {
      const assignee = (task as any).assignee;
      if (!assignee) continue;

      // Channel preference: default to WhatsApp if no settings saved
      const prefs    = assignee.metadata?.task_reminders ?? {};
      const enabled  = prefs.enabled !== false; // default on
      if (!enabled) continue;
      const channels: string[] = prefs.channels?.length ? prefs.channels : ['whatsapp'];

      const notifKey = `/tasks?reminder=${task.id}&t=${offsetKey}`;

      // In-app notification
      if (channels.includes('in_app')) {
        await db.from('notifications').insert({
          user_id:         assignee.id,
          organization_id: task.organization_id,
          title:           '⏰ Task reminder',
          body:            `"${task.title}" is ${REMINDER_LABEL[offsetKey]}.`,
          action_url:      notifKey,
          is_read:         false,
        }).then(({ error }) => { if (error) console.error('[reminder in_app]', error.message); });
      }

      // WhatsApp notification
      if (channels.includes('whatsapp') && assignee.wa_number) {
        await notifyTaskDeadlineReminder({
          orgId:        task.organization_id,
          waNumber:     assignee.wa_number,
          assigneeName: assignee.full_name,
          taskTitle:    task.title,
          deadline:     task.deadline,
        });
      }

      processed++;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`[Reminders:task-GET] ✅ processed=${processed} at ${now.toISOString()}`);
  return NextResponse.json({ ok: true, processed, checkedAt: now.toISOString() });
}
