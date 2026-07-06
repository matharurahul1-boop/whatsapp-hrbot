import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { CheckSquare, Calendar, Clock, UserPlus } from 'lucide-react';
import { isEmployee } from '@/lib/rbac';

interface ActivityFeedProps {
  orgId:  string;
  userId: string;
  role:   string;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  CREATE_TASK:      <CheckSquare className="h-3 w-3" />,
  APPLY_LEAVE:      <Calendar    className="h-3 w-3" />,
  APPROVE_LEAVE:    <Calendar    className="h-3 w-3" />,
  CHECK_IN:         <Clock       className="h-3 w-3" />,
  START_ONBOARDING: <UserPlus    className="h-3 w-3" />,
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function ActivityFeed({ orgId, userId, role }: ActivityFeedProps) {
  const db = createAdminClient();
  let query = db
    .from('audit_logs')
    .select(`
      id, action, table_name, new_data, created_at,
      actor:users!audit_logs_actor_id_fkey(id, full_name, avatar_url)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(12);

  // Employees only see their own activity; everyone else sees the whole
  // organization's, matching the rest of the dashboard's scoping.
  if (isEmployee(role)) query = query.eq('actor_id', userId);

  const { data: logs } = await query;

  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
        <p className="text-sm text-surface-600 text-center py-6">No activity yet</p>
      </Card>
    );
  }

  const formatAction = (log: typeof logs[0]) => {
    const actor = (log.actor as { full_name?: string } | null)?.full_name ?? 'Someone';
    switch (log.table_name) {
      case 'tasks':          return `${actor} ${log.action === 'CREATE' ? 'created' : 'updated'} a task`;
      case 'leave_requests': return `${actor} ${log.action === 'CREATE' ? 'applied for' : 'reviewed'} leave`;
      case 'attendance_records': return `${actor} checked in`;
      case 'users':          return `${actor} was onboarded`;
      default:               return `${actor} performed an action`;
    }
  };

  return (
    <Card noPad>
      <div className="px-5 pt-5 pb-3">
        <CardTitle>Recent Activity</CardTitle>
      </div>
      <div className="divide-y divide-surface-300/40 max-h-80 overflow-y-auto no-scrollbar">
        {logs.map(log => {
          const actor = log.actor as { id?: string; full_name?: string; avatar_url?: string } | null;
          return (
            <div key={log.id} className="flex items-start gap-3 px-5 py-3">
              <Avatar src={actor?.avatar_url} name={actor?.full_name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-surface-900 leading-snug">{formatAction(log)}</p>
                <p className="text-2xs text-surface-500 mt-0.5">{timeAgo(log.created_at)}</p>
              </div>
              <StatusBadge status={log.action.toLowerCase()} className="shrink-0 text-2xs" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
