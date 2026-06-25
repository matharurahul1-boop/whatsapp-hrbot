/**
 * POST /api/reminders/run  — attendance reminders (checkin / checkout / deadline)
 * GET  /api/reminders/run  — task due-date reminders + optional ?type= attendance reminders
 *
 * Auth: Authorization: Bearer <APP_SECRET>  OR  x-vercel-cron: 1 header
 *
 * Cron schedule (vercel.json):
 *   30 3 * * *  → GET ?type=checkin  (9:00 AM IST)
 *   30 3 * * *  → GET ?type=deadline (9:00 AM IST)
 *   30 12 * * * → GET ?type=checkout (6:00 PM IST)
 *   0  3 * * *  → GET               (task due-date window checks)
 *
 * NOTE: Vercel Hobby plan allows max 2 daily cron jobs. Upgrade to Pro for
 * per-hour task-reminder windows (1_hour / 2_hours / 4_hours offsets).
 */

import { NextRequest, NextResponse }      from 'next/server';
import { createAdminClient }              from '@/lib/supabase/admin';
import {
  notifyCheckInReminder,
  notifyCheckOutReminder,
  notifyTaskDeadlineReminder,
} from '@/lib/whatsapp/notify';

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function tomorrowIST(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function authorize(req: NextRequest): boolean {
  const isCron  = req.headers.get('x-vercel-cron') === '1';
  const auth    = req.headers.get('authorization') ?? '';
  const secret  = process.env.APP_SECRET;
  return isCron || (!!secret && auth === `Bearer ${secret}`);
}

// ── POST — triggered by external callers (e.g. manual test) ──────────────────
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { type } = await req.json() as { type: string };
  return runAttendanceReminders(type);
}

// ── GET — Vercel Cron or Bearer-auth callers ──────────────────────────────────
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get('type');

  // Attendance reminder types routed via ?type= query param
  if (type === 'checkin' || type === 'checkout' || type === 'deadline') {
    return runAttendanceReminders(type);
  }

  // Default: task due-date reminders
  return runTaskDueDateReminders();
}

// ── Attendance reminders (checkin / checkout / deadline) ──────────────────────

async function runAttendanceReminders(type: string): Promise<NextResponse> {
  const db    = createAdminClient();
  const today = todayIST();
  const tomorrow = tomorrowIST();

  const { data: orgs } = await db
    .from('organizations')
    .select('id, name')
    .not('wa_phone_number_id', 'is', null);

  if (!orgs?.length) return NextResponse.json({ ok: true, type, processed: 0 });

  let processed = 0;

  for (const org of orgs) {
    // ── Check-in reminder ───────────────────────────────────────────────────
    if (type === 'checkin') {
      const { data: employees } = await db
        .from('users')
        .select('id, full_name, wa_number')
        .eq('organization_id', org.id)
        .eq('is_active', true)
        .eq('role', 'employee')
        .not('wa_number', 'is', null);

      if (!employees?.length) continue;

      const { data: checkedIn } = await db
        .from('attendance_records')
        .select('employee_id')
        .eq('organization_id', org.id)
        .eq('date', today);

      const checkedInIds = new Set((checkedIn ?? []).map(r => r.employee_id));

      for (const emp of employees) {
        if (!emp.wa_number || checkedInIds.has(emp.id)) continue;
        await notifyCheckInReminder({ orgId: org.id, waNumber: emp.wa_number, employeeName: emp.full_name });
        processed++;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // ── Checkout reminder ───────────────────────────────────────────────────
    if (type === 'checkout') {
      const { data: pendingCheckouts } = await db
        .from('attendance_records')
        .select(`
          employee_id, check_in_time,
          employee:users!attendance_records_employee_id_fkey(full_name, wa_number)
        `)
        .eq('organization_id', org.id)
        .eq('date', today)
        .not('check_in_time', 'is', null)
        .is('check_out_time', null);

      for (const rec of (pendingCheckouts ?? [])) {
        const emp = rec.employee as { full_name: string; wa_number: string | null } | null;
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

    // ── Task deadline reminder (tasks due tomorrow) ─────────────────────────
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
        const assignee = task.assignee as { full_name: string; wa_number: string | null } | null;
        if (!assignee?.wa_number) continue;
        await notifyTaskDeadlineReminder({
          orgId:        org.id,
          waNumber:     assignee.wa_number,
          assigneeName: assignee.full_name,
          taskTitle:    task.title,
          deadline:     task.deadline ?? tomorrow,
          dueTime:      (task as Record<string, unknown>).due_time as string | null ?? null,
        });
        processed++;
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }

  console.log(`[Reminders:${type}] ✅ processed=${processed}`);
  return NextResponse.json({ ok: true, type, processed });
}

// ── Task due-date reminders (per-user offset windows) ─────────────────────────
//
// For each reminder offset, fires when now is within ±30 min of the
// (deadline − offset) moment. Run this GET endpoint every 30–60 min
// via cron for accurate reminder delivery. With Vercel Hobby (daily
// cron only), the "1_day" offset is the only reliably-fired window.

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

async function runTaskDueDateReminders(): Promise<NextResponse> {
  const db  = createAdminClient();
  const now = new Date();
  const WINDOW_MS = 30 * 60 * 1000;

  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  if (!orgs?.length) return NextResponse.json({ ok: true, processed: 0 });

  let processed = 0;

  for (const [offsetKey, offsetMs] of Object.entries(REMINDER_OFFSETS)) {
    const targetMs   = now.getTime() + offsetMs;
    const targetDate = new Date(targetMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

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

    const inWindow = (tasks ?? []).filter(task => {
      const dueTime = (task as Record<string, unknown>).due_time as string;
      const deadlineUTC = new Date(`${task.deadline}T${dueTime.slice(0, 5)}+05:30`);
      const reminderUTC = deadlineUTC.getTime() - offsetMs;
      return Math.abs(now.getTime() - reminderUTC) <= WINDOW_MS;
    });

    for (const task of inWindow) {
      const assignee = task.assignee as {
        id: string; full_name: string; wa_number: string | null;
        metadata?: { task_reminders?: { enabled?: boolean; channels?: string[] } };
      } | null;
      if (!assignee) continue;

      const prefs    = assignee.metadata?.task_reminders ?? {};
      const enabled  = prefs.enabled !== false;
      if (!enabled) continue;
      const channels: string[] = prefs.channels?.length ? prefs.channels : ['whatsapp'];

      if (channels.includes('in_app')) {
        await db.from('notifications').insert({
          user_id:         assignee.id,
          organization_id: task.organization_id,
          title:           '⏰ Task reminder',
          body:            `"${task.title}" is ${REMINDER_LABEL[offsetKey]}.`,
          action_url:      `/tasks?reminder=${task.id}&t=${offsetKey}`,
          is_read:         false,
        }).then(({ error }) => { if (error) console.error('[reminder in_app]', error.message); });
      }

      if (channels.includes('whatsapp') && assignee.wa_number) {
        await notifyTaskDeadlineReminder({
          orgId:        task.organization_id,
          waNumber:     assignee.wa_number,
          assigneeName: assignee.full_name,
          taskTitle:    task.title,
          deadline:     task.deadline ?? targetDate,
          dueTime:      (task as Record<string, unknown>).due_time as string | null ?? null,
          reminderType: offsetKey,
        });
      }

      processed++;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`[Reminders:task-GET] ✅ processed=${processed} at ${now.toISOString()}`);
  return NextResponse.json({ ok: true, processed, checkedAt: now.toISOString() });
}
