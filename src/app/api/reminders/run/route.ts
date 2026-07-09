/**
 * Reminder dispatcher — two composite cron jobs (Vercel Hobby = 2 cron limit):
 *
 *   morning  30 3 * * *  (9:00 AM IST)
 *     ├─ check-in reminders  (employees not yet checked in)
 *     ├─ deadline reminders  (same_day → due today, 1_day → due tomorrow, 2_days → due day after)
 *     └─ bot_reminders       (fire_at <= now)
 *
 *   evening  30 12 * * * (6:00 PM IST)
 *     ├─ check-out reminders (employees not yet checked out)
 *     └─ bot_reminders       (fire_at <= now)
 *
 * Supported reminder offsets: same_day | 1_day | 2_days
 * Sub-day offsets (1_hour, 2_hours, 4_hours) removed — not reliably coverable
 * with only 2 cron slots.
 *
 * Individual ?type= values are still supported for manual testing.
 *
 * Auth: Authorization: Bearer <CRON_SECRET or APP_SECRET>.
 */

import { NextRequest, NextResponse }      from 'next/server';
import { createAdminClient }              from '@/lib/supabase/admin';
import { sendSmartText }                  from '@/lib/whatsapp/client';
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
  const auth   = req.headers.get('authorization') ?? '';
  const secrets = [process.env.CRON_SECRET, process.env.APP_SECRET].filter(Boolean);
  return secrets.some(secret => auth === `Bearer ${secret}`);
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
    results.deadline = await runDeadlineReminders();   // same_day, 1_day, 2_days
    results.bot      = await fireBotReminders();
  } else if (type === 'evening') {
    results.checkout = await runCheckoutReminders();
    results.bot      = await fireBotReminders();
  } else if (type === 'checkin')  {
    results.checkin  = await runCheckinReminders();
  } else if (type === 'checkout') {
    results.checkout = await runCheckoutReminders();
  } else if (type === 'deadline') {
    results.deadline = await runDeadlineReminders();
  } else if (type === 'bot') {
    results.bot      = await fireBotReminders();
  } else {
    results.deadline = await runDeadlineReminders();
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
  const today    = todayIST();
  const tomorrow = tomorrowIST();
  const dayAfter = dayAfterTomorrowIST();
  let   sent     = 0;

  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  for (const org of orgs ?? []) {
    for (const [targetDate, reminderKey, label] of [
      [today,    'same_day', 'due today'],
      [tomorrow, '1_day',    'due tomorrow'],
      [dayAfter, '2_days',   'due in 2 days'],
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
          metadata?: { task_reminders?: { enabled?: boolean; channels?: string[] } };
        } | null;
        if (!assignee) continue;

        const prefs    = assignee.metadata?.task_reminders;
        if (prefs?.enabled === false) continue;
        const channels = prefs?.channels?.length ? prefs.channels : ['whatsapp', 'in_app'];

        if (channels.includes('in_app')) {
          await db.from('notifications').insert({
            user_id:         assignee.id,
            organization_id: org.id,
            title:           '⏰ Task deadline reminder',
            body:            `"${task.title}" is ${label}.`,
            action_url:      '/tasks',
            is_read:         false,
          }).then(({ error }) => { if (error) console.error('[reminder in_app]', error.message); });
        }

        if (channels.includes('whatsapp') && assignee.wa_number) {
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
      const { data: recipient } = await db.from('users').select('full_name')
        .eq('wa_number', rem.wa_number).eq('organization_id', rem.organization_id ?? '').maybeSingle();
      await sendSmartText(
        rem.wa_number,
        `⏰ *Reminder:* ${rem.custom_message}`,
        rem.organization_id ?? '',
        recipient?.full_name?.split(' ')[0] ?? 'there',
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

// ── Utility ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

