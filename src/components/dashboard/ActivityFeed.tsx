import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { isEmployee } from '@/lib/rbac';
import ActivityFeedList from './ActivityFeedList';

interface ActivityFeedProps {
  orgId:  string;
  userId: string;
  role:   string;
}

export default async function ActivityFeed({ orgId, userId, role }: ActivityFeedProps) {
  const db = createAdminClient();
  let query = db
    .from('audit_logs')
    .select(`
      id, action, table_name, old_data, new_data, created_at,
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

  return (
    <Card noPad>
      <div className="px-5 pt-5 pb-3">
        <CardTitle>Recent Activity</CardTitle>
      </div>
      <ActivityFeedList logs={logs as unknown as Parameters<typeof ActivityFeedList>[0]['logs']} />
    </Card>
  );
}
