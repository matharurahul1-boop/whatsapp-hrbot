/**
 * Reminder dispatcher — two composite cron jobs (Vercel Hobby = 2 cron limit):
 *
 *   morning  30 3 * * *  (9:00 AM IST)
 *     ├─ check-in reminders  (employees not yet checked in)
 *     ├─ deadline reminders  (1_day → due tomorrow, 2_days → due day after tomorrow)
 *     ├─ offset reminders    (1h/2h/4h tasks whose window falls around 9 AM)
 *     └─ bot_reminders       (fire_at <= now)
 *
 *   evening  30 12 * * * (6:00 PM IST)
 *     ├─ check-out reminders (employees not yet checked out)
 *     ├─ offset reminders    (1h/2h/4h tasks whose window falls around 6 PM)
 *     └─ bot_reminders       (fire_at <= now)
 *
 * Individual ?type= values are still supported for manual testing.
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

function dayAfterTomorrowIST(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
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
    results.checkin  = await runCheckinReminders();
    results.deadline = await runDeadlineReminders();   // date-based: 1_day, 2_days
    results.offsets  = await runTaskOffsetReminders(); // time-based: 1h/2h/4h near 9 AM
    results.bot      = await fireBotReminders();
    pingN8n(); // keep Render instance awake
  } else if (type === 'evening') {
    results.checkout = await runCheckoutReminders();
    results.offsets  = await runTaskOffsetReminders(); // time-based: 1h/2h/4h near 6 PM
    results.bot      = await fireBotReminders();
    pingN8n(); // keep Render instance awake
  } else if (type === 'checkin')  {
    results.checkin  = await runCheckinReminders();
  } else if (type === 'checkout') {
    results.checkout = await runCheckoutReminders();
  } else if (type === 'deadline') {
    results.deadline = await runDeadlineReminders();
  } else if (type === 'offsets') {
    results.offsets  = await runTaskOffsetReminders();
  } else if (type === 'bot') {
    results.bot      = await fireBotReminders();
  } else {
    results.deadline = await runDeadlineReminders();
    results.offsets  = await runTaskOffsetReminders();
  }

  console.log(`[Reminders:${type || 'all'}]`, results);
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

// ── 3. Date-based deadline reminders ─────────────────────────────────────────
//
// Reads tasks.reminders[] per task to determine which date-based offsets apply:
//   '1_day'  → task is due TOMORROW    → send reminder today
//   '2_days' → task is due DAY AFTER TOMORROW → send reminder today
//
// Always sends to BOTH WhatsApp AND in-app bell.
// Respects the per-user master on/off toggle (users.metadata.task_reminders.enabled).

async function runDeadlineReminders(): Promise<number> {
  const db       = createAdminClient();
  const tomorrow = tomorrowIST();
  const dayAfter = dayAfterTomorrowIST();
  let   sent     = 0;

  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  for (const org of orgs ?? []) {
    // Run for 1_day (tasks due tomorrow) and 2_days (tasks due day after tomorrow)
    for (const [targetDate, reminderKey, label] of [
      [tomorrow, '1_day',  'due tomorrow'],
      [dayAfter, '2_days', 'due in 2 days'],
    ] as const) {
      const dayStart = `${targetDate}T00:00:00+05:30`;
      const dayEnd   = `${targetDate}T23:59:59+05:30`;

      const { data: tasks } = await db
        .from('tasks')
        .select(`
          id, title, deadline,
          assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number, metadata)
        `)
        .eq('organization_id', org.id)
        .gte('deadline', dayStart)
        .lte('deadline', dayEnd)
        .contains('reminders', [reminderKey])
        .not('status', 'in', '("done","cancelled")')
        .is('deleted_at', null);

      for (const task of tasks ?? []) {
        const assignee = (Array.isArray(task.assignee) ? task.assignee[0] : task.assignee) as {
          id: string; full_name: string; wa_number: string | null;
          metadata?: { task_reminders?: { enabled?: boolean } };
        } | null;
        if (!assignee) continue;

        // Respect master on/off toggle
        if ((assignee.metadata?.task_reminders as { enabled?: boolean } | undefined)?.enabled === false) continue;

        // In-app bell
        await db.from('notifications').insert({
          user_id:         assignee.id,
          organization_id: org.id,
          title:           '⏰ Task deadline reminder',
          body:            `"${task.title}" is ${label}.`,
          action_url:      '/tasks',
          is_read:         false,
        }).then(({ error }) => { if (error) console.error('[reminder in_app]', error.message); });

        // WhatsApp
        if (assignee.wa_number) {
          await notifyTaskDeadlineReminder({
            orgId:        org.id,
            waNumber:     assignee.wa_number,
            assigneeName: assignee.full_name,
            taskTitle:    task.title,
            deadline:     task.deadline as string,
            reminderType: reminderKey,
          });
        }

        sent++;
        await delay(150);
      }
    }
  }

  console.log(`[Reminders:deadline] sent=${sent}`);
  return sent;
}

// ── 4. Custom bot_reminders ───────────────────────────────────────────────────

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
      firedIds.push(rem.id);
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
    }
  }

  if (firedIds.length > 0) {
    await db.from('bot_reminders').delete().in('id', firedIds);
  }

  console.log(`[Reminders:bot] sent=${sent} deleted=${firedIds.length}`);
  return sent;
}

// ── 5. Time-based offset reminders (sub-day) ─────────────────────────────────
//
// For 1_hour / 2_hours / 4_hours offsets stored in tasks.reminders[].
// Checks tasks whose deadline falls within a ±30 min window of (now + offset).
// Called from both morning (9 AM) and evening (6 PM) crons — catches tasks
// due around 10 AM, 11 AM, 1 PM (morning) and 7 PM, 8 PM, 10 PM (evening).
// Always sends to BOTH WhatsApp AND in-app bell.

const REMINDER_OFFSETS: Record<string, number> = {
  '1_hour':  1  * 60 * 60 * 1000,
  '2_hours': 2  * 60 * 60 * 1000,
  '4_hours': 4  * 60 * 60 * 1000,
};

const REMINDER_LABEL: Record<string, string> = {
  '1_hour':  'due in 1 hour',
  '2_hours': 'due in 2 hours',
  '4_hours': 'due in 4 hours',
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
    const targetMs   = now.getTime() + offsetMs;
    const targetLow  = new Date(targetMs - WINDOW).toISOString();
    const targetHigh = new Date(targetMs + WINDOW).toISOString();

    const { data: tasks } = await db
      .from('tasks')
      .select(`
        id, title, deadline, organization_id,
        assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number, metadata)
      `)
      .gte('deadline', targetLow)
      .lte('deadline', targetHigh)
      .contains('reminders', [offsetKey])
      .not('status', 'in', '("done","cancelled")')
      .is('deleted_at', null);

    for (const task of tasks ?? []) {
      const deadlineMs = new Date(task.deadline as string).getTime();
      if (Math.abs(now.getTime() - (deadlineMs - offsetMs)) > WINDOW) continue;

      const assignee = (Array.isArray(task.assignee) ? task.assignee[0] : task.assignee) as {
        id: string; full_name: string; wa_number: string | null;
        metadata?: { task_reminders?: { enabled?: boolean } };
      } | null;
      if (!assignee) continue;

      // Respect master on/off toggle
      if ((assignee.metadata?.task_reminders as { enabled?: boolean } | undefined)?.enabled === false) continue;

      // In-app bell — always
      await db.from('notifications').insert({
        user_id:         assignee.id,
        organization_id: task.organization_id,
        title:           '⏰ Task reminder',
        body:            `"${task.title}" is ${REMINDER_LABEL[offsetKey]}.`,
        action_url:      '/tasks',
        is_read:         false,
      });

      // WhatsApp — always
      if (assignee.wa_number) {
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

// Fire-and-forget ping to keep the Render n8n instance awake between messages.
// Render Free spins down after ~15 min; this runs at 9 AM and 6 PM IST via cron.
function pingN8n(): void {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: '_keepalive_', message: 'ping', org_id: '' }),
  }).then(() => console.log('[n8n keepalive] ping sent'))
    .catch(e  => console.warn('[n8n keepalive] ping failed:', e?.message));
}
