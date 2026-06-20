import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/utils/date';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-danger shadow-[0_0_6px_0_rgba(239,68,68,0.4)]',
  high:   'bg-warning',
  medium: 'bg-info',
  low:    'bg-surface-500',
};

export default async function RecentTasks({
  orgId, userId, role,
}: {
  orgId:  string;
  userId: string;
  role:   string;
}) {
  const db = createAdminClient();
  let query = db
    .from('tasks')
    .select(`
      id, title, status, priority, deadline,
      assignee:users!tasks_assignee_id_fkey(id, full_name, avatar_url)
    `)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .not('status', 'in', '("done","cancelled")')
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(6);

  if (role === 'employee') {
    query = query.or(`assignee_id.eq.${userId},created_by.eq.${userId}`);
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
        <ul className="divide-y divide-surface-300/40">
          {tasks.map(t => {
            const assignee = t.assignee as { id?: string; full_name?: string; avatar_url?: string } | null;
            const overdue  = t.deadline && new Date(t.deadline) < new Date();
            return (
              <li key={t.id} className="task-row px-3 py-3 hover:bg-surface-200/30 transition-colors">
                <span className={cn('h-2 w-2 rounded-full', PRIORITY_COLORS[t.priority] ?? 'bg-surface-500')} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-900 truncate">{t.title}</p>
                  {t.deadline ? (
                    <p className={cn('text-xs mt-0.5 truncate', overdue ? 'text-danger font-medium' : 'text-surface-600')}>
                      {overdue ? '⚠ Overdue · ' : ''}{formatDate(t.deadline)}
                    </p>
                  ) : (
                    <p className="text-xs text-surface-500 mt-0.5 truncate">No deadline</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {assignee && (
                    <Avatar src={assignee.avatar_url} name={assignee.full_name} size="xs" />
                  )}
                  <StatusBadge status={t.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
