import { NextRequest, NextResponse } from 'next/server';
import { createClient }       from '@/lib/supabase/server';
import { createAdminClient }  from '@/lib/supabase/admin';
import { writeAuditLog }      from '@/lib/utils/audit';
import { notifyTaskAssigned, notifyTaskCompleted } from '@/lib/whatsapp/notify';
import { scheduleTaskReminders } from '@/lib/tasks/scheduleReminders';
import { isEmployee } from '@/lib/rbac';
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

  // Notify creator when task is marked completed (and they're not the one completing it)
  const justCompleted =
    updateData.status === 'done' &&
    task.status !== 'done' &&
    updated.created_by &&
    updated.created_by !== user.id;

  if (justCompleted) {
    notifyTaskCompleted({
      orgId:           profile.organization_id,
      taskTitle:       updated.title,
      completedByName: actorName,
      creatorId:       updated.created_by,
    }).catch(() => {});
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

  if (profile.role === 'employee') return NextResponse.json({ error: 'Employees cannot delete tasks' }, { status: 403 });
  if (!['manager','hr','admin','super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'DELETE', table_name: 'tasks', record_id: id, old_data: task });

  return new NextResponse(null, { status: 204 });
}
