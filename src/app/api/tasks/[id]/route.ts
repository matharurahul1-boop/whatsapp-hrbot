import { NextRequest, NextResponse } from 'next/server';
import { createClient }       from '@/lib/supabase/server';
import { createAdminClient }  from '@/lib/supabase/admin';
import { writeAuditLog }      from '@/lib/utils/audit';
import { notifyTaskAssigned, notifyTaskCompleted, notifyTaskDeleted, notifyTaskUpdated } from '@/lib/whatsapp/notify';
import { scheduleTaskReminders } from '@/lib/tasks/scheduleReminders';
import { formatDateTime, deadlineToUTCDate } from '@/lib/utils/date';
import { isEmployee, isManagerOrAbove } from '@/lib/rbac';
import { z } from 'zod';

const UpdateTaskSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  deadline:    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),  // combined datetime or null to clear
  priority:    z.enum(['low','medium','high','urgent']).optional(),
  status:      z.enum(['todo','in_progress','done','cancelled']).optional(),
  reminders:   z.array(z.string()).nullable().optional(),
});

async function getTaskAndProfile(id: string, userId: string) {
  const db = createAdminClient();
  const [{ data: profile }, { data: task }] = await Promise.all([
    db.from('users').select('organization_id, role').eq('id', userId).single(),
    db.from('tasks').select('*').eq('id', id).is('deleted_at', null).single(),
  ]);
  return { profile, task, db };
}

// GET /api/tasks/[id]
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: task, error } = await db
    .from('tasks')
    .select(`*, assignee:users!tasks_assignee_id_fkey(id,full_name,avatar_url,email), creator:users!tasks_created_by_fkey(id,full_name), comments:task_comments(*, author:users(id,full_name,avatar_url))`)
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error || !task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (task.organization_id !== profile.organization_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (isEmployee(profile.role) && task.assignee_id !== user.id && task.created_by !== user.id && task.updated_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ data: task });
}

// PATCH /api/tasks/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = UpdateTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const { profile, task, db } = await getTaskAndProfile(id, user.id);
  if (!profile || !task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (task.organization_id !== profile.organization_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Only the assignee, the creator ("assigned by"), or manager+ may update a task —
  // EXCEPT an employee who is assigned a task BY SOMEONE ELSE: they can't
  // update it themselves. If they created it (self-assigned), they retain
  // full control. Mirrors executor.ts's UPDATE_TASK so the same rule applies
  // from WhatsApp and this dashboard.
  const isPrivileged    = isManagerOrAbove(profile.role);
  const actorIsCreator  = task.created_by === user.id;
  const isBlockedAsAssignee = task.assignee_id === user.id && isEmployee(profile.role) && !actorIsCreator;
  const actorIsAssignee = task.assignee_id === user.id && !isBlockedAsAssignee;
  // Toggling your own task's completion (the dashboard's quick-complete
  // checkbox, which flips status done<->todo) mirrors WhatsApp's
  // COMPLETE_TASK, which has no ownership restriction — being the assignee
  // is enough, even for an employee otherwise blocked from touching a task
  // assigned to them. Scoped to a pure status change (the only field) so it
  // can't be used to sneak other edits through alongside it.
  const isTogglingOwnCompletion = Object.keys(parsed.data).length === 1
    && parsed.data.status !== undefined && task.assignee_id === user.id;
  if (!actorIsAssignee && !actorIsCreator && !isPrivileged && !isTogglingOwnCompletion) {
    return NextResponse.json({
      error: isBlockedAsAssignee
        ? "You can't update a task that's assigned to you — please ask your manager or HR to do that."
        : 'You can only update tasks assigned to you or created by you',
    }, { status: 403 });
  }

  // Convert datetime-local (IST browser value) to UTC for storage, or null to clear
  const { deadline: deadlineISO, ...parsedRest } = parsed.data;
  const deadlineFields: Record<string, unknown> = {};
  if (deadlineISO !== undefined) {
    deadlineFields.deadline = deadlineISO === null ? null : new Date(deadlineISO + ':00+05:30').toISOString().slice(0, 19);
  }

  const updateData: Record<string, unknown> = { ...parsedRest, ...deadlineFields };

  const newAssignee = updateData.assignee_id;
  if (typeof newAssignee === 'string') {
    const { data: assignee } = await db.from('users').select('id')
      .eq('id', newAssignee).eq('organization_id', profile.organization_id)
      .eq('is_active', true).is('deleted_at', null).maybeSingle();
    if (!assignee) return NextResponse.json({ error: 'Assignee is not an active member of your organization' }, { status: 422 });
  }

  const { data: updated, error } = await db
    .from('tasks')
    .update({ ...updateData, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'UPDATE', table_name: 'tasks', record_id: id, old_data: task, new_data: updated });

  // Re-schedule reminders if deadline or reminders changed
  const deadlineFieldChanged =
    updateData.deadline  !== undefined ||
    updateData.reminders !== undefined;
  if (deadlineFieldChanged) {
    await scheduleTaskReminders({ id: updated.id, organization_id: profile.organization_id, deadline: updated.deadline ?? null, reminders: updated.reminders ?? [] });
  }

  const { data: actor } = await db.from('users').select('full_name').eq('id', user.id).single();
  const actorName = actor?.full_name ?? 'your manager';

  // Notify on assignee change
  const newAssigneeId = updateData.assignee_id as string | null | undefined;
  if (newAssigneeId && newAssigneeId !== task.assignee_id && newAssigneeId !== user.id) {
    notifyTaskAssigned({
      orgId:       profile.organization_id,
      taskTitle:   updated.title,
      priority:    updated.priority,
      deadline:    updated.deadline ?? null,
      assigneeId:  newAssigneeId,
      creatorName: actorName,
    }).catch(() => {});
  }

  // Notify "the other party" when task is marked completed: if the assignee
  // completed it, tell the creator; if the creator/manager completed it on
  // the assignee's behalf, tell the assignee.
  const justCompleted = updateData.status === 'done' && task.status !== 'done';
  const completionNotifyTarget = actorIsAssignee ? task.created_by : task.assignee_id;

  if (justCompleted && completionNotifyTarget && completionNotifyTarget !== user.id) {
    notifyTaskCompleted({
      orgId:           profile.organization_id,
      taskTitle:       updated.title,
      completedByName: actorName,
      creatorId:       completionNotifyTarget,
    }).catch(() => {});
  }

  // Notify "the other party" about any other field change (title,
  // description, priority, deadline, or a status change that isn't the
  // "completed" case handled above). This mirrors the WhatsApp bot's own
  // UPDATE_TASK notification (executor.ts) — previously that push+WhatsApp
  // message only ever fired when a task was edited via WhatsApp itself;
  // the exact same edit made from this dashboard silently sent nothing.
  const updateNotifyTarget = actorIsAssignee ? task.created_by : task.assignee_id;
  if (updateNotifyTarget && updateNotifyTarget !== user.id) {
    const changes: { field: string; oldValue: string; value: string }[] = [];
    if (updateData.title !== undefined && updateData.title !== task.title) {
      changes.push({ field: 'title', oldValue: task.title, value: String(updateData.title) });
    }
    if (updateData.priority !== undefined && updateData.priority !== task.priority) {
      changes.push({ field: 'priority', oldValue: task.priority, value: String(updateData.priority) });
    }
    // Compare actual instants, not raw strings — updateData.deadline is
    // re-derived from the incoming datetime-local value (line 83) and can
    // come out in a different string format (T vs space, trailing seconds)
    // than what's already stored, even when the deadline itself didn't
    // change (e.g. the edit form resubmits every field, not just the ones
    // the user touched). A plain !== comparison flagged that as a change.
    if (updateData.deadline !== undefined) {
      const oldMs = task.deadline ? deadlineToUTCDate(task.deadline).getTime() : null;
      const newMs = updated.deadline ? deadlineToUTCDate(updated.deadline).getTime() : null;
      if (oldMs !== newMs) {
        changes.push({
          field: 'deadline',
          oldValue: task.deadline ? `${formatDateTime(task.deadline)} IST` : 'No deadline',
          value: updated.deadline ? `${formatDateTime(updated.deadline)} IST` : 'No deadline',
        });
      }
    }
    if (updateData.status !== undefined && updateData.status !== task.status && updateData.status !== 'done') {
      changes.push({ field: 'status', oldValue: task.status, value: String(updateData.status) });
    }
    if (updateData.description !== undefined && updateData.description !== task.description) {
      changes.push({ field: 'description', oldValue: task.description || '(none)', value: (updateData.description as string) || '(none)' });
    }

    if (changes.length > 0) {
      notifyTaskUpdated({
        orgId:       profile.organization_id,
        taskTitle:   updated.title,
        field:       changes[0].field,
        oldValue:    changes[0].oldValue,
        value:       changes[0].value,
        field2:      changes[1]?.field,
        oldValue2:   changes[1]?.oldValue,
        value2:      changes[1]?.value,
        assigneeId:  updateNotifyTarget,
        updaterName: actorName,
      }).catch(() => {});
    }
  }

  return NextResponse.json({ data: updated });
}

// DELETE /api/tasks/[id] — soft delete
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { profile, task, db } = await getTaskAndProfile(id, user.id);
  if (!profile || !task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (task.organization_id !== profile.organization_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Only the assignee, the creator ("assigned by"), or manager+ may delete a task —
  // EXCEPT an employee who is assigned a task BY SOMEONE ELSE: they can't
  // delete it themselves. If they created it (self-assigned), they retain
  // full control. Mirrors executor.ts's DELETE_TASK so the same rule applies
  // from WhatsApp and this dashboard.
  const isPrivileged    = isManagerOrAbove(profile.role);
  const actorIsCreator  = task.created_by === user.id;
  const isBlockedAsAssignee = task.assignee_id === user.id && isEmployee(profile.role) && !actorIsCreator;
  const actorIsAssignee = task.assignee_id === user.id && !isBlockedAsAssignee;
  if (!actorIsAssignee && !actorIsCreator && !isPrivileged) {
    return NextResponse.json({
      error: isBlockedAsAssignee
        ? "You can't delete a task that's assigned to you — please ask your manager or HR to do that."
        : 'You can only delete tasks assigned to you or created by you',
    }, { status: 403 });
  }

  await db.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'DELETE', table_name: 'tasks', record_id: id, old_data: task });

  // Notification goes to "the other party" — see the matching note in PATCH.
  const notifyTargetId = actorIsAssignee ? task.created_by : task.assignee_id;
  if (notifyTargetId && notifyTargetId !== user.id) {
    const { data: deleter } = await db.from('users').select('full_name').eq('id', user.id).single();
    notifyTaskDeleted({
      orgId:       profile.organization_id,
      taskTitle:   task.title,
      priority:    task.priority,
      deadline:    task.deadline,
      assigneeId:  notifyTargetId,
      deleterName: deleter?.full_name ?? 'your manager',
    }).catch(() => {});
  }

  return new NextResponse(null, { status: 204 });
}
