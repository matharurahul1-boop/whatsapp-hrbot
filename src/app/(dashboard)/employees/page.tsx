import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import EmployeeGrid from '@/components/employees/EmployeeGrid';
import InvitePanel from '@/components/employees/InvitePanel';

export const metadata = { title: 'Employees — HRBot' };
export const revalidate = 60;

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

  const { data: employees } = await db
    .from('v_employee_directory')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('full_name');

  const canEdit   = ['super_admin', 'admin', 'hr'].includes(profile.role);
  const canInvite = ['super_admin', 'admin', 'hr'].includes(profile.role);

  return (
    <div className="max-w-7xl mx-auto animate-fade-up space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">{employees?.length ?? 0} team members</p>
        </div>
        {canInvite && (
          <InvitePanel orgId={profile.organization_id} />
        )}
      </div>

      <EmployeeGrid
        employees={(employees ?? []) as Parameters<typeof EmployeeGrid>[0]['employees']}
        canEdit={canEdit}
      />
    </div>
  );
}
