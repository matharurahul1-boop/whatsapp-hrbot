const REMINDER_OFFSETS: Record<string, number> = {
  '1_hour':  1  * 60 * 60 * 1000,
  '2_hours': 2  * 60 * 60 * 1000,
  '4_hours': 4  * 60 * 60 * 1000,
  '1_day':   24 * 60 * 60 * 1000,
};

interface ScheduleInput {
  id: string;
  deadline: string | null;
  due_time: string | null;
  reminders: string[] | null;
}

export function scheduleTaskReminders(task: ScheduleInput): void {
  const webhookUrl = process.env.N8N_TASK_REMINDER_WEBHOOK_URL;
  if (!webhookUrl || !task.deadline || !task.due_time || !task.reminders?.length) return;

  const timeStr = task.due_time.slice(0, 5); // HH:MM
  const deadlineUTC = new Date(`${task.deadline}T${timeStr}+05:30`).getTime();
  const now = Date.now();

  for (const reminder of task.reminders) {
    const offset = REMINDER_OFFSETS[reminder];
    if (!offset) continue;

    const fireAt = deadlineUTC - offset;
    if (fireAt <= now) continue;

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id:             task.id,
        reminder,
        fire_at:             new Date(fireAt).toISOString(),
        scheduled_deadline:  task.deadline,
        scheduled_due_time:  timeStr,
      }),
    }).catch(err =>
      console.error(`[scheduleReminders] ${reminder} for task ${task.id}:`, err)
    );
  }
}
