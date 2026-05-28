import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/utils/audit';
import type { IntentEntities, ToolCallResult } from '@/types/agent.types';
import type { Task } from '@/types/database.types';
import { formatDate } from '@/lib/utils/date';

export async function createTask(
  org_id: string,
  createdBy: string,
  entities: IntentEntities
): Promise<ToolCallResult> {
  const db = createAdminClient();

  if (!entities.task_title) {
    return { success: false, message: 'Task title is required.', error: 'missing_title' };
  }

  let assignedTo = createdBy;

  if (entities.assignee) {
    const { data: found } = await db
      .from('users')
      .select('id, full_name')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${entities.assignee}%`)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (found) {
      assignedTo = found.id;
    }
  }

  const { data: task, error } = await db
    .from('tasks')
    .insert({
      organization_id: org_id,
      title: entities.task_title,
      assigned_to: assignedTo,
      assigned_by: createdBy,
      due_date: entities.deadline ?? null,
      status: 'pending',
      priority: 'medium',
      source: 'whatsapp',
    })
    .select()
    .single();

  if (error) return { success: false, message: 'Failed to create task.', error: error.message };

  await writeAuditLog({
    org_id,
    actor_id: createdBy,
    actor_type: 'user',
    action: 'CREATE_TASK',
    table_name: 'tasks',
    record_id: task.id,
    new_data: task,
    source: 'whatsapp',
  });

  const { data: assignee } = await db
    .from('users')
    .select('full_name')
    .eq('id', assignedTo)
    .single();

  return {
    success: true,
    data: { task_id: task.id, assignee_name: assignee?.full_name ?? 'You' },
    message: `Task "${task.title}" created and assigned to ${assignee?.full_name ?? 'you'}${task.due_date ? ` — due ${formatDate(task.due_date)}` : ''}.`,
  };
}

export async function listTasks(
  org_id: string,
  userId: string,
  filter: 'my' | 'pending' | 'all' = 'my'
): Promise<ToolCallResult> {
  const db = createAdminClient();

  let query = db
    .from('tasks')
    .select('id, title, status, priority, due_date, assigned_to')
    .eq('organization_id', org_id)
    .is('deleted_at', null)
    .order('due_date', { ascending: true })
    .limit(10);

  if (filter === 'my') {
    query = query.eq('assigned_to', userId).neq('status', 'completed');
  } else if (filter === 'pending') {
    query = query.eq('status', 'pending');
  }

  const { data: tasks, error } = await query;

  if (error) return { success: false, message: 'Could not fetch tasks.', error: error.message };
  if (!tasks?.length) return { success: true, data: { tasks: [] }, message: 'No tasks found.' };

  const formatted = tasks.map((t) => ({
    title: t.title,
    status: t.status,
    due: t.due_date ? formatDate(t.due_date) : 'No deadline',
  }));

  return { success: true, data: { tasks: formatted }, message: '' };
}

export async function completeTask(
  org_id: string,
  userId: string,
  taskId?: string,
  taskTitle?: string
): Promise<ToolCallResult> {
  const db = createAdminClient();

  let query = db
    .from('tasks')
    .select('id, title, assigned_to')
    .eq('organization_id', org_id)
    .eq('assigned_to', userId)
    .neq('status', 'completed');

  if (taskId) {
    query = query.eq('id', taskId);
  } else if (taskTitle) {
    query = query.ilike('title', `%${taskTitle}%`);
  }

  const { data: tasks } = await query.limit(1);
  const task = tasks?.[0] as Task | undefined;

  if (!task) return { success: false, message: 'Task not found.', error: 'not_found' };

  const { error } = await db
    .from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', task.id);

  if (error) return { success: false, message: 'Failed to complete task.', error: error.message };

  await writeAuditLog({
    org_id,
    actor_id: userId,
    actor_type: 'user',
    action: 'COMPLETE_TASK',
    table_name: 'tasks',
    record_id: task.id,
    new_data: { status: 'completed' },
    source: 'whatsapp',
  });

  return { success: true, message: `Task "${task.title}" marked as complete! ✅` };
}
