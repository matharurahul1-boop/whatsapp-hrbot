import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/dashboard/kpis — org-level KPI snapshot
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // Only admin/hr/manager see org KPIs; employees see personal stats
  if (profile.role === 'employee') {
    const [tasks, attendance, leave] = await Promise.all([
      db.from('tasks').select('status', { count: 'exact', head: false })
        .or(`assignee_id.eq.${user.id},created_by.eq.${user.id}`)
        .is('deleted_at', null),
      db.from('attendance_records').select('status', { count: 'exact', head: false })
        .eq('employee_id', user.id)
        .gte('date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10)),
      db.from('leave_requests').select('status', { count: 'exact', head: false })
        .eq('employee_id', user.id)
        .eq('status', 'pending'),
    ]);

    return NextResponse.json({
      personal: true,
      open_tasks:       tasks.data?.filter(t => !['done','cancelled'].includes(t.status)).length ?? 0,
      completed_tasks:  tasks.data?.filter(t => t.status === 'done').length ?? 0,
      days_present:     attendance.data?.filter(a => ['present','late'].includes(a.status)).length ?? 0,
      pending_leave:    leave.data?.length ?? 0,
    });
  }

  const { data: kpis, error } = await db.rpc('get_org_kpis', { p_org_id: profile.organization_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Task trend for chart
  const { data: taskTrend } = await db.rpc('get_task_trend', { p_org_id: profile.organization_id });

  // Attendance heatmap (last 30 days)
  const { data: heatmap } = await db.rpc('get_attendance_heatmap', {
    p_org_id: profile.organization_id,
    p_days: 30,
  });

  return NextResponse.json({
    personal: false,
    kpis: kpis?.[0] ?? null,
    task_trend: taskTrend ?? [],
    attendance_heatmap: heatmap ?? [],
  });
}
