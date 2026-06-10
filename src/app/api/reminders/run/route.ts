/**
 * POST /api/reminders/run
 *
 * Cron-triggered endpoint that sends daily WhatsApp reminders.
 * Call this at:
 *   - 10:00 AM IST  → check-in reminders for employees not yet checked in
 *   - 07:00 PM IST  → checkout reminders for employees who checked in but not out
 *   - 09:00 AM IST  → task deadline reminders (tasks due tomorrow)
 *
 * Secure with the APP_SECRET header:
 *   Authorization: Bearer <APP_SECRET>
 *
 * Body: { type: "checkin" | "checkout" | "deadline" }
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
