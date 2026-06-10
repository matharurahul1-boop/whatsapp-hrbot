import { NextRequest, NextResponse } from 'next/server';
import { createClient }       from '@/lib/supabase/server';
import { createAdminClient }  from '@/lib/supabase/admin';
import { writeAuditLog }      from '@/lib/utils/audit';
import { notifyTaskAssigned } from '@/lib/whatsapp/task-notify';
import { z } from 'zod';

const UpdateTaskSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  deadline:    z.string().datetime().nullable().optional(),
  priority:    z.enum(['low','medium','high','urgent']).optional(),
  status:      z.enum(['todo','in_progress','done','cancelled']).optional(),
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
  if (task.organization_id !== profile?.organization_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

  // Employees can only update tasks assigned to them or created by them
  if (profile.role === 'employee' && task.assignee_id !== user.id && task.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: updated, error } = await db
    .from('tasks')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'UPDATE', table_name: 'tasks', record_id: id, old_data: task, new_data: updated });

  // WhatsApp notification — only when the assignee changed to someone else
  const newAssigneeId = parsed.data.assignee_id;
  if (newAssigneeId && newAssigneeId !== task.assignee_id && newAssigneeId !== user.id) {
    const { data: creator } = await db.from('users').select('full_name').eq('id', user.id).single();
    notifyTaskAssigned({
      orgId:       profile.organization_id,
      taskId:      id,
      taskTitle:   updated.title,
      priority:    updated.priority,
      deadline:    updated.deadline ?? null,
      assigneeId:  newAssigneeId,
      creatorName: creator?.full_name ?? 'your manager',
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

  // Only manager+ or creator can delete
  const canDelete = ['super_admin','admin','hr','manager'].includes(profile.role) || task.created_by === user.id;
  if (!canDelete) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await db.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'DELETE', table_name: 'tasks', record_id: id, old_data: task });

  return new NextResponse(null, { status: 204 });
}
