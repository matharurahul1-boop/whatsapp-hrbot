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
        .not('status', 'in', '("completed","cancelled")')
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

// ── GET — per-user task due-date reminders (called by Vercel Cron hourly) ────
export async function GET(req: NextRequest) {
  // Accept Vercel's internal cron header or the usual Bearer token
  const isCron = req.headers.get('x-vercel-cron') === '1';
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  if (!isCron && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createAdminClient();

  // Current IST hour (0-23)
  const istHour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false })
  );

  // Which reminder windows are active right now?
  const activeTimings: string[] = [];
  if (istHour >= 8 && istHour <= 10) activeTimings.push('1_day', 'on_due');
  if (istHour === 16)                 activeTimings.push('2_hours');
  if (istHour === 17)                 activeTimings.push('1_hour');

  if (!activeTimings.length) {
    return NextResponse.json({ ok: true, message: `No task reminders at IST hour ${istHour}` });
  }

  const today    = todayIST();
  const tomorrow = tomorrowIST();

  const deadlineFor: Record<string, string> = {
    '1_day':   tomorrow,
    'on_due':  today,
    '2_hours': today,
    '1_hour':  today,
  };

  const labelFor: Record<string, string> = {
    '1_day':   'due tomorrow',
    'on_due':  'due today',
    '2_hours': 'due in ~2 hours',
    '1_hour':  'due in ~1 hour',
  };

  // Only orgs with WhatsApp configured
  const { data: orgs } = await db
    .from('organizations')
    .select('id')
    .not('wa_phone_number_id', 'is', null);

  if (!orgs?.length) return NextResponse.json({ ok: true, processed: 0 });

  let processed = 0;

  for (const org of orgs) {
    // Pre-load today's reminder notifications to skip duplicates (avoids N+1 per task)
    const { data: todayNotifs } = await db
      .from('notifications')
      .select('action_url')
      .eq('organization_id', org.id)
      .gte('created_at', `${today}T00:00:00`)
      .like('action_url', '/tasks?reminder=%');

    const sentToday = new Set<string>((todayNotifs ?? []).map((n: any) => n.action_url));

    for (const timing of activeTimings) {
      const { data: tasks } = await db
        .from('tasks')
        .select(`
          id, title, deadline,
          assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number, metadata)
        `)
        .eq('organization_id', org.id)
        .eq('deadline', deadlineFor[timing])
        .not('status', 'in', '("done","completed","cancelled")')
        .is('deleted_at', null);

      for (const task of (tasks ?? [])) {
        const assignee = (task as any).assignee;
        if (!assignee) continue;

        // Respect per-user preferences
        const prefs = assignee.metadata?.task_reminders;
        if (!prefs?.enabled || !prefs?.timings?.includes(timing)) continue;

        const channels: string[] = prefs.channels ?? ['whatsapp'];
        const notifKey = `/tasks?reminder=${task.id}&t=${timing}`;
        if (sentToday.has(notifKey)) continue;

        // In-app notification
        if (channels.includes('in_app')) {
          const { error: insErr } = await db.from('notifications').insert({
            user_id:         assignee.id,
            organization_id: org.id,
            title:           '⏰ Task reminder',
            body:            `"${task.title}" is ${labelFor[timing]}.`,
            action_url:      notifKey,
            is_read:         false,
          });
          if (!insErr) sentToday.add(notifKey);
        }

        // WhatsApp notification
        if (channels.includes('whatsapp') && assignee.wa_number) {
          await notifyTaskDeadlineReminder({
            orgId:        org.id,
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
  }

  console.log(`[Reminders:task-GET] ✅ hour=${istHour} timings=[${activeTimings}] processed=${processed}`);
  return NextResponse.json({ ok: true, timings: activeTimings, processed });
}
