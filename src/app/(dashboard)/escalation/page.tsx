import { createClient }      from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect }          from 'next/navigation';
import EscalationClient      from './EscalationClient';

export const metadata = { title: 'Escalation Engine — HRBot' };
export const revalidate = 0;

export default async function EscalationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['super_admin', 'admin', 'hr'].includes(profile.role)) {
    redirect('/dashboard');
  }

  // Fetch pending leave requests with escalation info
  const { data: leaves } = await db
    .from('leave_requests')
    .select(`
      id, created_at, start_date, end_date, total_days, reason,
      escalated_manager_at, escalated_admin_at,
      user:users!leave_requests_user_id_fkey(full_name, wa_number, department),
      leave_type:leave_types!leave_requests_leave_type_id_fkey(name, color_hex),
      approver:users!leave_requests_approved_by_fkey(full_name)
    `)
    .eq('organization_id', profile.organization_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  return (
    <EscalationClient
      initialLeaves={(leaves ?? []) as unknown as Parameters<typeof EscalationClient>[0]['initialLeaves']}
    />
  );
}
