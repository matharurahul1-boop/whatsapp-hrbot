import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import TaskKanban from '@/components/tasks/TaskKanban';
import CreateTaskModal from '@/components/tasks/CreateTaskModal';
import RefreshButton from '@/components/ui/RefreshButton';
import RealtimeWatcher from '@/components/realtime/RealtimeWatcher';
import { isRealtimeRefreshEnabled } from '@/lib/utils/realtime-settings';
import { isEmployee } from '@/lib/rbac';

export const metadata = { title: 'Tasks — HRBot' };
export const revalidate = 0;

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/login');
  const { organization_id: orgId, role } = profile;

  // Fetch tasks + employees in parallel
  let taskQuery = db
    .from('tasks')
    .select(`
      id, title, description, status, priority, deadline, reminders, created_by,
      assignee:users!tasks_assignee_id_fkey(id, full_name, avatar_url),
      creator:users!tasks_created_by_fkey(id, full_name, avatar_url)
    `)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  // Employees only ever see tasks assigned to them, created by them, or last
  // updated by them; everyone else (manager/hr/admin/super_admin) sees the
  // whole organization.
  if (isEmployee(role)) {
    taskQuery = taskQuery.or(`assignee_id.eq.${user.id},created_by.eq.${user.id},updated_by.eq.${user.id}`);
  }

  const [tasksRes, empRes, realtimeEnabled] = await Promise.all([
    taskQuery,
    db.from('users')
      .select('id, full_name')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name'),
    isRealtimeRefreshEnabled(db, orgId, 'tasks'),
  ]);

  const tasks     = (tasksRes.data ?? []) as unknown as Parameters<typeof TaskKanban>[0]['tasks'];
  const employees = empRes.data ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-up">
      <RealtimeWatcher orgId={orgId} table="tasks" enabled={realtimeEnabled} />
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <CreateTaskModal employees={employees} />
        </div>
      </div>

      {/* Kanban board */}
      <TaskKanban
        tasks={tasks}
        userId={user.id}
        userRole={role}
        employees={employees}
      />
    </div>
  );
}
