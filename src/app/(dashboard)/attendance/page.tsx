import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import AttendanceTable from '@/components/attendance/AttendanceTable';
import CheckInWidget from '@/components/attendance/CheckInWidget';
import AttendanceHeatmap from '@/components/dashboard/AttendanceHeatmap';
import { todayISO } from '@/lib/utils/date';

export const metadata = { title: 'Attendance — HRBot' };
export const revalidate = 0;

export default async function AttendancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role, full_name')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/login');

  const { organization_id: orgId, role } = profile;
  const isManager  = ['super_admin', 'admin', 'hr', 'manager'].includes(role);
  const today      = todayISO();
  const since      = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const firstName  = profile.full_name?.split(' ')[0] ?? 'there';

  let query = db
    .from('attendance_records')
    .select(`
      id, date, check_in_time, check_out_time, total_hours, status,
      employee:users!attendance_records_employee_id_fkey(id, full_name, avatar_url, department)
    `)
    .eq('organization_id', orgId)
    .gte('date', since)
    .order('date', { ascending: false })
    .order('check_in_time', { ascending: false })
    .limit(100);

  if (!isManager) query = query.eq('employee_id', user.id);

  const [recordsRes, todayRes, heatmapRes] = await Promise.all([
    query,
    db.from('attendance_records')
      .select('id, status, check_in_time, check_out_time, total_hours')
      .eq('employee_id', user.id)
      .eq('date', today)
      .single(),
    isManager
      ? db.rpc('get_attendance_heatmap', { p_org_id: orgId, p_days: 30 })
      : Promise.resolve({ data: null }),
  ]);

  const records      = (recordsRes.data ?? []) as unknown as Parameters<typeof AttendanceTable>[0]['records'];
  const todayRecord  = todayRes.data ?? null;
  const heatmapData  = heatmapRes.data ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-up">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Last 30 days · {records.length} records</p>
        </div>
      </div>

      {/* Check-in widget */}
      <CheckInWidget todayRecord={todayRecord} firstName={firstName} />

      {/* Org heatmap for managers */}
      {isManager && heatmapData.length > 0 && (
        <AttendanceHeatmap data={heatmapData} />
      )}

      {/* Records table */}
      <section>
        <p className="section-title">{isManager ? 'All Records' : 'My Records'}</p>
        <AttendanceTable records={records} showEmployee={isManager} />
      </section>
    </div>
  );
}
