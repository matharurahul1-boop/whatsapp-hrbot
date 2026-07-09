import { NextRequest, NextResponse }       from 'next/server';
import { createAdminClient }               from '@/lib/supabase/admin';
import { notifyTaskDeadlineReminder }      from '@/lib/whatsapp/notify';

const REMINDER_LABEL: Record<string, string> = {
  '1_hour':  'due in 1 hour',
  '2_hours': 'due in 2 hours',
  '4_hours': 'due in 4 hours',
  '1_day':   'due tomorrow',
};

export async function POST(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { task_id, reminder, scheduled_deadline } = body;

  if (!task_id || !reminder) {
    return NextResponse.json({ error: 'Missing task_id or reminder' }, { status: 400 });
  }

  const db = createAdminClient();

  const { data: task } = await db
    .from('tasks')
    .select(`
      id, title, deadline, reminders, organization_id, status,
      assignee:users!tasks_assignee_id_fkey(id, full_name, wa_number, metadata)
    `)
    .eq('id', task_id)
    .is('deleted_at', null)
    .single();

  if (!task) return NextResponse.json({ ok: true, skipped: 'task_not_found' });
  if (task.status === 'done' || task.status === 'cancelled') {
    return NextResponse.json({ ok: true, skipped: 'task_completed' });
  }

  // Bail if deadline changed since reminder was scheduled
  if (task.deadline !== scheduled_deadline) {
    return NextResponse.json({ ok: true, skipped: 'deadline_changed' });
  }

  // Bail if this reminder was removed from the task
  if (!(task.reminders as string[] | null)?.includes(reminder)) {
    return NextResponse.json({ ok: true, skipped: 'reminder_removed' });
  }

  const assignee = (task as any).assignee;
  if (!assignee) return NextResponse.json({ ok: true, skipped: 'no_assignee' });

  const prefs    = assignee.metadata?.task_reminders ?? {};
  if (prefs.enabled === false) return NextResponse.json({ ok: true, skipped: 'notifications_disabled' });
  const channels: string[] = prefs.channels?.length ? prefs.channels : ['whatsapp'];

  const notifKey = `/tasks?reminder=${task.id}&t=${reminder}`;

  if (channels.includes('in_app')) {
    await db.from('notifications').insert({
      user_id:         assignee.id,
      organization_id: task.organization_id,
      type:            'agent_notification',
      title:           '⏰ Task reminder',
      body:            `"${task.title}" is ${REMINDER_LABEL[reminder] ?? 'due soon'}.`,
      action_url:      notifKey,
      is_read:         false,
    }).then(({ error }) => {
      if (error) console.error('[reminders/task] in_app insert:', error.message);
    });
  }

  if (channels.includes('whatsapp') && assignee.wa_number) {
    await notifyTaskDeadlineReminder({
      orgId:        task.organization_id,
      waNumber:     assignee.wa_number,
      assigneeName: assignee.full_name,
      taskTitle:    task.title,
      deadline:     task.deadline as string,
      reminderType: reminder,
    });
  }

  console.log(`[reminders/task] ✅ notified ${assignee.full_name} — ${reminder} for "${task.title}"`);
  return NextResponse.json({ ok: true, notified: assignee.full_name, reminder });
}
