import { NextRequest, NextResponse } from 'next/server';
import { createClient }       from '@/lib/supabase/server';
import { createAdminClient }  from '@/lib/supabase/admin';
import { writeAuditLog }      from '@/lib/utils/audit';
import { notifyTaskAssigned } from '@/lib/whatsapp/notify';
import { isEmployee, isManager, isHrOrAbove } from '@/lib/rbac';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  title:       z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assignee_id: z.string().uuid().optional(),
  deadline:    z.string().datetime().optional(),
  priority:    z.enum(['low','medium','high','urgent']).default('medium'),
  status:      z.enum(['todo','in_progress','done','cancelled']).default('todo'),
  reminders:   z.array(z.string()).optional(),
});

// GET /api/tasks — list tasks for authenticated user's org
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const status   = searchParams.get('status');
  const priority = searchParams.get('priority');
  const assignee = searchParams.get('assignee_id');
  const page     = parseInt(searchParams.get('page') ?? '1');
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100);
  const offset   = (page - 1) * limit;

  let query = db
    .from('tasks')
    .select(`
      *,
      assignee:users!tasks_assignee_id_fkey(id, full_name, avatar_url),
      creator:users!tasks_created_by_fkey(id, full_name),
      comments:task_comments(count)
    `, { count: 'exact' })
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status)   query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);

  // Employees only see their own + assigned tasks
  if (profile.role === 'employee') {
    if (assignee) {
      query = query.eq('assignee_id', user.id);
    } else {
      query = query.or(`assignee_id.eq.${user.id},created_by.eq.${user.id}`);
    }
  } else if (assignee) {
    query = query.eq('assignee_id', assignee);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count, page, limit });
}

// POST /api/tasks — create task
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // ── RBAC: assignee restrictions ──────────────────────────────────────────────
  const requestedAssignee = parsed.data.assignee_id;
  if (requestedAssignee && requestedAssignee !== user.id) {
    if (isEmployee(profile.role)) {
      // Employees can only create tasks for themselves
      return NextResponse.json(
        { error: 'Employees can only assign tasks to themselves' },
        { status: 403 },
      );
    }
    if (isManager(profile.role)) {
      // Managers can only assign to their direct reports
      const { data: reportCheck } = await db
        .from('users')
        .select('id')
        .eq('id', requestedAssignee)
        .eq('manager_id', user.id)
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true)
        .maybeSingle();
      if (!reportCheck) {
        return NextResponse.json(
          { error: 'Managers can only assign tasks to their direct reports' },
          { status: 403 },
        );
      }
    }
    // HR+ can assign to anyone in the org — no extra check
  }

  const { data: task, error } = await db.from('tasks').insert({
    ...parsed.data,
    organization_id: profile.organization_id,
    created_by: user.id,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'CREATE', table_name: 'tasks', record_id: task.id, new_data: task });

  // ── WhatsApp notification — only when assigned to someone else ───────────────
  const assigneeId = parsed.data.assignee_id;
  if (assigneeId && assigneeId !== user.id) {
    const { data: creator } = await db.from('users').select('full_name').eq('id', user.id).single();
    notifyTaskAssigned({
      orgId:       profile.organization_id,
      taskTitle:   task.title,
      priority:    task.priority,
      deadline:    task.deadline ?? null,
      assigneeId,
      creatorName: creator?.full_name ?? 'your manager',
    }).catch(() => {}); // already swallows errors but being explicit
  }

  return NextResponse.json({ data: task }, { status: 201 });
}
