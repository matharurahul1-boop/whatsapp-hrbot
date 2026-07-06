import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { isEmployee } from '@/lib/rbac';
import RecentTasksList from './RecentTasksList';

export default async function RecentTasks({
  orgId,
  userId,
  role,
}: {
  orgId:  string;
  userId: string;
  role:   string;
}) {
  const db = createAdminClient();
  let query = db
    .from('tasks')
    .select(`
      id, title, description, status, priority, deadline,
      assignee:users!tasks_assignee_id_fkey(id, full_name, avatar_url),
      creator:users!tasks_created_by_fkey(id, full_name, avatar_url)
    `)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .not('status', 'in', '("done","cancelled")')
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(6);

  // Employees only see their own upcoming tasks here; everyone else sees
  // the whole organization's, matching the Tasks page's scoping.
  if (isEmployee(role)) {
    query = query.or(`assignee_id.eq.${userId},created_by.eq.${userId},updated_by.eq.${userId}`);
  }

  const { data: tasks } = await query;

  return (
    <Card noPad>
      <div className="px-3 sm:px-5 pt-5 pb-3 flex items-center justify-between">
        <CardTitle>Upcoming Tasks</CardTitle>
        <Link href="/tasks">
          <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="h-3 w-3" />}>
            View all
          </Button>
        </Link>
      </div>

      {!tasks?.length ? (
        <div className="empty-state py-10">
          <div className="empty-state-icon">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="empty-state-title">No pending tasks</p>
          <p className="empty-state-desc">All caught up! Create a new task to get started.</p>
        </div>
      ) : (
        <RecentTasksList tasks={tasks as unknown as Parameters<typeof RecentTasksList>[0]['tasks']} />
      )}
    </Card>
  );
}
