import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import LeaveBalanceCards from '@/components/leave/LeaveBalanceCards';
import LeaveRequestsTable from '@/components/leave/LeaveRequestsTable';
import ApplyLeaveModal from '@/components/leave/ApplyLeaveModal';
import RefreshButton from '@/components/ui/RefreshButton';
import RealtimeWatcher from '@/components/realtime/RealtimeWatcher';
import { isRealtimeRefreshEnabled } from '@/lib/utils/realtime-settings';
import { canApplyForLeave, canApproveLeaveFor } from '@/lib/rbac';

export const metadata = { title: 'Leave — HRBot' };
export const revalidate = 0;

export default async function LeavePage() {
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
  const year        = new Date().getFullYear();
  // Viewing everyone's requests is a manager+ privilege (hr_assistant included,
  // since it sits above manager in rank). Approving is per-row, hierarchy-based
  // (see canApproveLeaveFor) — canApprove here just decides whether to show the
  // action column / pending-count subtitle at all.
  const canViewAll  = ['super_admin', 'admin', 'hr', 'hr_assistant', 'manager'].includes(role);
  const canApprove  = ['super_admin', 'admin', 'hr', 'hr_assistant'].includes(role);
  const canApply    = canApplyForLeave(role);

  // Parallel fetches
  let requestQuery = db
    .from('leave_requests')
    .select(`
      id, start_date, end_date, duration_days, status, reason, created_at, reviewed_at, remarks,
      employee:users!leave_requests_employee_id_fkey(id, full_name, avatar_url, department, role),
      leave_type:leave_types(name, color),
      reviewer:users!leave_requests_reviewed_by_fkey(id, full_name)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!canViewAll) requestQuery = requestQuery.eq('employee_id', user.id);

  const [requestsRes, balancesRes, leaveTypesRes, realtimeEnabled] = await Promise.all([
    requestQuery,
    db.from('v_leave_summary')
      .select('leave_type, color, entitled_days, used_days, remaining_days')
      .eq('employee_id', user.id)
      .eq('year', year),
    db.from('leave_types')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),
    isRealtimeRefreshEnabled(db, orgId, 'leave'),
  ]);

  const requests   = (requestsRes.data ?? []) as unknown as Parameters<typeof LeaveRequestsTable>[0]['requests'];
  const balances   = balancesRes.data ?? [];
  const leaveTypes = leaveTypesRes.data ?? [];

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-up">
      <RealtimeWatcher orgId={orgId} table="leave_requests" enabled={realtimeEnabled} />
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="page-subtitle">
            {canApprove
              ? `${pendingCount} pending approval${pendingCount !== 1 ? 's' : ''}`
              : canViewAll
                ? 'Track leave requests across the team'
                : 'Apply and track your leave requests'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton />
          {canApply && <ApplyLeaveModal leaveTypes={leaveTypes} />}
        </div>
      </div>

      {/* Balance cards (own balance always shown) */}
      {balances.length > 0 && (
        <section>
          <p className="section-title">My Leave Balance — {year}</p>
          <LeaveBalanceCards balances={balances} />
        </section>
      )}

      {/* Requests table */}
      <section>
        <p className="section-title">
          {canViewAll ? 'All Requests' : 'My Requests'}
        </p>
        <LeaveRequestsTable requests={requests} canApprove={canApprove} viewerRole={role} />
      </section>
    </div>
  );
}
