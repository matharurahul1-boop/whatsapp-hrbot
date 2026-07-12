import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import EmployeeGrid from '@/components/employees/EmployeeGrid';
import InvitePanel from '@/components/employees/InvitePanel';
import CreateAccountModal from '@/components/employees/CreateAccountModal';
import RefreshButton from '@/components/ui/RefreshButton';
import RealtimeWatcher from '@/components/realtime/RealtimeWatcher';
import { isRealtimeRefreshEnabled } from '@/lib/utils/realtime-settings';

export const metadata = { title: 'Team — HRBot' };
export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
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
  if (profile.role === 'employee') redirect('/dashboard');

  const [{ data: employees }, realtimeEnabled] = await Promise.all([
    db.from('v_employee_directory')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('full_name'),
    isRealtimeRefreshEnabled(db, profile.organization_id, 'team'),
  ]);

  const canEdit   = ['super_admin', 'admin', 'hr'].includes(profile.role);
  const canInvite = ['super_admin', 'admin', 'hr'].includes(profile.role);

  return (
    <div className="max-w-7xl mx-auto animate-fade-up space-y-6">
      <RealtimeWatcher orgId={profile.organization_id} table="users" enabled={realtimeEnabled} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">{employees?.length ?? 0} team members</p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton />
          {canInvite && <InvitePanel />}
          {canInvite && <CreateAccountModal actorRole={profile.role} />}
        </div>
      </div>

      <EmployeeGrid
        employees={(employees ?? []) as Parameters<typeof EmployeeGrid>[0]['employees']}
        canEdit={canEdit}
      />
    </div>
  );
}
