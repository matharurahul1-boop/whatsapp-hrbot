import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import LeaveBalanceCards from '@/components/leave/LeaveBalanceCards';
import LeaveRequestsTable from '@/components/leave/LeaveRequestsTable';
import ApplyLeaveModal from '@/components/leave/ApplyLeaveModal';

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
  if (profile.role === 'employee') redirect('/tasks');

  const { organization_id: orgId, role } = profile;
  const year      = new Date().getFullYear();
  const isManager = ['super_admin', 'admin', 'hr', 'manager'].includes(role);

  // Parallel fetches
  let requestQuery = db
    .from('leave_requests')
    .select(`
      id, start_date, end_date, duration_days, status, reason, created_at,
      employee:users!leave_requests_employee_id_fkey(id, full_name, avatar_url, department),
      leave_type:leave_types(name, color)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!isManager) requestQuery = requestQuery.eq('employee_id', user.id);

  const [requestsRes, balancesRes, leaveTypesRes] = await Promise.all([
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
  ]);

  const requests   = (requestsRes.data ?? []) as unknown as Parameters<typeof LeaveRequestsTable>[0]['requests'];
  const balances   = balancesRes.data ?? [];
  const leaveTypes = leaveTypesRes.data ?? [];

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-up">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="page-subtitle">
            {isManager
              ? `${pendingCount} pending approval${pendingCount !== 1 ? 's' : ''}`
              : 'Apply and track your leave requests'}
          </p>
        </div>
        <ApplyLeaveModal leaveTypes={leaveTypes} />
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
          {isManager ? 'All Requests' : 'My Requests'}
        </p>
        <LeaveRequestsTable requests={requests} canApprove={isManager} />
      </section>
    </div>
  );
}
