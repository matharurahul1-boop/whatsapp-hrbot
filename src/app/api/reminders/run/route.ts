/**
 * Reminder dispatcher — two composite cron jobs (Vercel Hobby = 2 cron limit):
 *
 *   morning  30 3 * * *  (9:00 AM IST)
 *     ├─ check-in reminders  (employees not yet checked in)
 *     ├─ task deadline        (due tomorrow  → users with '1_day'  pref)
 *     ├─ task deadline        (due today     → users with 'same_day' pref)
 *     └─ bot_reminders       (fire_at <= now)
 *
 *   evening  30 12 * * * (6:00 PM IST)
 *     ├─ check-out reminders (employees not yet checked out)
 *     └─ bot_reminders       (fire_at <= now)
 *
 * Individual ?type= values (checkin / checkout / deadline / bot) are still
 * supported for manual testing via Bearer auth.
 *
 * Auth: Authorization: Bearer <APP_SECRET>  OR  x-vercel-cron: 1 header
 */

import { NextRequest, NextResponse }      from 'next/server';
import { createAdminClient }              from '@/lib/supabase/admin';
import { sendText }                       from '@/lib/whatsapp/client';
import {
  notifyCheckInReminder,
  notifyCheckOutReminder,
  notifyTaskDeadlineReminder,
} from '@/lib/whatsapp/notify';

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function tomorrowIST(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function authorize(req: NextRequest): boolean {
  const isCron = req.headers.get('x-vercel-cron') === '1';
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  return isCron || (!!secret && auth === `Bearer ${secret}`);
}

// ── POST — manual trigger ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { type } = await req.json() as { type: string };
  return dispatch(type);
}

// ── GET — Vercel Cron ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const type = req.nextUrl.searchParams.get('type') ?? '';
  return dispatch(type);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function dispatch(type: string): Promise<NextResponse> {
  const results: Record<string, number> = {};

  if (type === 'morning') {
    results.checkin    = await runCheckinReminders();
    results.deadline   = await runDeadlineReminders();
    results.bot        = await fireBotReminders();
  } else if (type === 'evening') {
    results.checkout   = await runCheckoutReminders();
    results.bot        = await fireBotReminders();
  } else if (type === 'checkin')  {
    results.checkin    = await runCheckinReminders();
  } else if (type === 'checkout') {
    results.checkout   = await runCheckoutReminders();
  } else if (type === 'deadline') {
    results.deadline   = await runDeadlineReminders();
  } else if (type === 'bot') {
    results.bot        = await fireBotReminders();
  } else {
    // Legacy default — task-offset window check (kept for backward compat)
    results.task_offsets = await runTaskOffsetReminders();
  }

  console.log(`[Reminders:${type || 'legacy'}]`, results);
  return NextResponse.json({ ok: true, type, ...results });
}

// ── 1. Check-in reminders ─────────────────────────────────────────────────────

async function runCheckinReminders(): Promise<number> {
  const db    = createAdminClient();
  const today = todayIST();
  let   sent  = 0;

  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  for (const org of orgs ?? []) {
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
      sent++;
      await delay(150);
    }
  }

  console.log(`[Reminders:checkin] sent=${sent}`);
  return sent;
}

// ── 2. Check-out reminders ────────────────────────────────────────────────────

async function runCheckoutReminders(): Promise<number> {
  const db    = createAdminClient();
  const today = todayIST();
  let   sent  = 0;

  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  for (const org of orgs ?? []) {
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

    for (const rec of pendingCheckouts ?? []) {
      const emp = Array.isArray(rec.employee) ? rec.employee[0] : rec.employee as { full_name: string; wa_number: string | null } | null;
      if (!emp?.wa_number) continue;
      await notifyCheckOutReminder({
        orgId:        org.id,
        waNumber:     emp.wa_number,
        employeeName: emp.full_name,
        checkInTime:  rec.check_in_time,
      });
      sent++;
      await delay(150);
    }
  }

  console.log(`[Reminders:checkout] sent=${sent}`);
  return sent;
}

// ── 3. Task deadline reminders ────────────────────────────────────────────────
//
// Sends two batches per morning cron:
//   a) Tasks due TOMORROW  → users whose reminder offset is '1_day' (default)
//   b) Tasks due TODAY     → users whose reminder offset is 'same_day'
//
// Per-user preferences are stored in users.metadata.task_reminders:
//   { enabled: true, offset: '1_day' | 'same_day', channels: ['whatsapp'] }

async function runDeadlineReminders(): Promise<number> {
  const db      = createAdminClient();
  const today   = todayIST();
  const tomorrow = tomorrowIST();
  let   sent    = 0;

  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  for (const org of orgs ?? []) {
    // Query both today and tomorrow tasks in one shot
    const todayStart    = `${today}T00:00:00+05:30`;
    const tomorrowStart = `${tomorrow}T00:00:00+05:30`;
    const tomorrowEnd   = `${tomorrow}T23:59:59+05:30`;

    const { data: tasks } = await db
      .from('tasks')
      .select(`
        id, title, deadline,
        assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number, metadata)
      `)
      .eq('organization_id', org.id)
      .gte('deadline', todayStart)
      .lte('deadline', tomorrowEnd)
      .not('status', 'in', '("done","cancelled")')
      .is('deleted_at', null);

    for (const task of tasks ?? []) {
      const assignee = (Array.isArray(task.assignee) ? task.assignee[0] : task.assignee) as {
        id: string; full_name: string; wa_number: string | null;
        metadata?: { task_reminders?: { enabled?: boolean; offset?: string; channels?: string[] } };
      } | null;
      if (!assignee?.wa_number) continue;

      const prefs   = assignee.metadata?.task_reminders ?? {};
      if (prefs.enabled === false) continue;

      const offset   = prefs.offset ?? '1_day'; // default: 1 day before
      const channels: string[] = prefs.channels?.length ? prefs.channels : ['whatsapp'];

      const deadlineMs     = new Date(task.deadline as string).getTime();
      const tomorrowStartMs = new Date(tomorrowStart).getTime();

      // '1_day'   → remind for tasks due tomorrow
      // 'same_day' → remind for tasks due today (already past midnight)
      const isDueTomorrow = deadlineMs >= tomorrowStartMs;
      const isDueToday    = !isDueTomorrow;

      const shouldSend =
        (offset === '1_day'    && isDueTomorrow) ||
        (offset === 'same_day' && isDueToday);

      if (!shouldSend) continue;

      if (channels.includes('in_app')) {
        await db.from('notifications').insert({
          user_id:         assignee.id,
          organization_id: org.id,
          title:           '⏰ Task deadline reminder',
          body:            `"${task.title}" is ${isDueTomorrow ? 'due tomorrow' : 'due today'}.`,
          action_url:      `/tasks`,
          is_read:         false,
        }).then(({ error }) => { if (error) console.error('[reminder in_app]', error.message); });
      }

      if (channels.includes('whatsapp')) {
        await notifyTaskDeadlineReminder({
          orgId:        org.id,
          waNumber:     assignee.wa_number,
          assigneeName: assignee.full_name,
          taskTitle:    task.title,
          deadline:     task.deadline as string,
          reminderType: isDueTomorrow ? '1_day' : 'same_day',
        });
      }

      sent++;
      await delay(150);
    }
  }

  console.log(`[Reminders:deadline] sent=${sent}`);
  return sent;
}

// ── 4. Custom bot_reminders ───────────────────────────────────────────────────
//
// Reads bot_reminders rows where fire_at <= now, sends WhatsApp message,
// then deletes the row so it doesn't fire again.

async function fireBotReminders(): Promise<number> {
  const db  = createAdminClient();
  const now = new Date().toISOString();
  let   sent = 0;

  const { data: reminders } = await db
    .from('bot_reminders')
    .select('id, organization_id, wa_number, custom_message, fire_at')
    .lte('fire_at', now)
    .order('fire_at', { ascending: true })
    .limit(100);

  if (!reminders?.length) return 0;

  const firedIds: string[] = [];

  for (const rem of reminders) {
    if (!rem.wa_number || !rem.custom_message) {
      firedIds.push(rem.id); // delete invalid rows too
      continue;
    }
    try {
      await sendText(
        rem.wa_number,
        `⏰ *Reminder:* ${rem.custom_message}`,
        rem.organization_id ?? '',
      );
      firedIds.push(rem.id);
      sent++;
      await delay(150);
      console.log(`[Reminders:bot] ✅ sent to ${rem.wa_number}: "${rem.custom_message.slice(0, 60)}"`);
    } catch (err) {
      console.error('[Reminders:bot] ❌ failed for', rem.wa_number, err instanceof Error ? err.message : err);
      // Leave in DB to retry next cron cycle
    }
  }

  // Delete fired reminders in one shot
  if (firedIds.length > 0) {
    await db.from('bot_reminders').delete().in('id', firedIds);
  }

  console.log(`[Reminders:bot] sent=${sent} deleted=${firedIds.length}`);
  return sent;
}

// ── 5. Legacy per-offset window check (Pro plan / manual testing) ─────────────
//
// Checks tasks.reminders[] against REMINDER_OFFSETS windows.
// With Hobby daily crons only the '1_day' offset is reliably triggered.
// On Pro plan (hourly crons), all four offsets work.

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

async function runTaskOffsetReminders(): Promise<number> {
  const db       = createAdminClient();
  const now      = new Date();
  const WINDOW   = 30 * 60 * 1000; // ±30 min
  let   processed = 0;

  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  for (const [offsetKey, offsetMs] of Object.entries(REMINDER_OFFSETS)) {
    const targetMs  = now.getTime() + offsetMs;
    const targetLow = new Date(targetMs - WINDOW).toISOString();
    const targetHigh= new Date(targetMs + WINDOW).toISOString();

    const { data: tasks } = await db
      .from('tasks')
      .select(`
        id, title, deadline, reminders, organization_id,
        assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number, metadata)
      `)
      .gte('deadline', targetLow)
      .lte('deadline', targetHigh)
      .contains('reminders', [offsetKey])
      .not('status', 'in', '("done","cancelled")')
      .is('deleted_at', null);

    for (const task of tasks ?? []) {
      const deadlineMs  = new Date(task.deadline as string).getTime();
      if (Math.abs(now.getTime() - (deadlineMs - offsetMs)) > WINDOW) continue;

      const assignee = (Array.isArray(task.assignee) ? task.assignee[0] : task.assignee) as {
        id: string; full_name: string; wa_number: string | null;
        metadata?: { task_reminders?: { enabled?: boolean; channels?: string[] } };
      } | null;
      if (!assignee) continue;

      const prefs   = assignee.metadata?.task_reminders ?? {};
      if (prefs.enabled === false) continue;
      const channels: string[] = prefs.channels?.length ? prefs.channels : ['whatsapp'];

      if (channels.includes('in_app')) {
        await db.from('notifications').insert({
          user_id:         assignee.id,
          organization_id: task.organization_id,
          title:           '⏰ Task reminder',
          body:            `"${task.title}" is ${REMINDER_LABEL[offsetKey]}.`,
          action_url:      `/tasks`,
          is_read:         false,
        });
      }

      if (channels.includes('whatsapp') && assignee.wa_number) {
        await notifyTaskDeadlineReminder({
          orgId:        task.organization_id,
          waNumber:     assignee.wa_number,
          assigneeName: assignee.full_name,
          taskTitle:    task.title,
          deadline:     task.deadline as string,
          reminderType: offsetKey,
        });
      }

      processed++;
      await delay(100);
    }
  }

  return processed;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
