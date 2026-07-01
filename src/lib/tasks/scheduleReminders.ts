import { createAdminClient } from '@/lib/supabase/admin';

const REMINDER_OFFSETS: Record<string, number> = {
  '1_hour':  1  * 60 * 60 * 1000,
  '2_hours': 2  * 60 * 60 * 1000,
  '4_hours': 4  * 60 * 60 * 1000,
  '1_day':   24 * 60 * 60 * 1000,
};

interface ScheduleInput {
  id: string;
  organization_id: string;
  deadline: string | null;  // full ISO datetime (timestamptz from DB)
  reminders: string[] | null;
}

export async function scheduleTaskReminders(task: ScheduleInput): Promise<void> {
  if (!task.deadline || !task.reminders?.length) return;

  const deadlineUTC = new Date(task.deadline).getTime();
  const now         = Date.now();

  const rows: Array<{
    organization_id: string;
    type: string;
    task_id: string;
    task_reminder: string;
    fire_at: string;
    scheduled_deadline: string;
  }> = [];

  for (const reminder of task.reminders) {
    const offset = REMINDER_OFFSETS[reminder];
    if (!offset) continue;
    const fireAt = deadlineUTC - offset;
    if (fireAt <= now) continue;
    rows.push({
      organization_id:    task.organization_id,
      type:               'task',
      task_id:            task.id,
      task_reminder:      reminder,
      fire_at:            new Date(fireAt).toISOString(),
      scheduled_deadline: task.deadline,
    });
  }

  if (!rows.length) return;

  const db = createAdminClient();

  // Remove any unsent reminders for this task before inserting fresh ones,
  // so re-saving a task doesn't queue duplicate notifications.
  await db
    .from('bot_reminders')
    .delete()
    .eq('task_id', task.id)
    .eq('type', 'task')
    .eq('sent', false);

  const { error } = await db.from('bot_reminders').insert(rows);
  if (error) console.error('[scheduleReminders] insert error:', error.message);
}
