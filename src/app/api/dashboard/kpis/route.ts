import { NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isEmployee } from '@/lib/rbac';

// GET /api/dashboard/kpis
// employee            → own personal stats
// manager/hr/admin/+  → full org KPIs with charts
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // ── Manager / HR / Admin / Super Admin: full org KPIs ──────────────────────
  if (!isEmployee(profile.role)) {
    const { data: kpis, error } = await db.rpc('get_org_kpis', { p_org_id: profile.organization_id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const [{ data: taskTrend }, { data: heatmap }] = await Promise.all([
      db.rpc('get_task_trend',         { p_org_id: profile.organization_id }),
      db.rpc('get_attendance_heatmap', { p_org_id: profile.organization_id, p_days: 30 }),
    ]);

    return NextResponse.json({
      scope:              'org',
      kpis:               kpis?.[0] ?? null,
      task_trend:         taskTrend ?? [],
      attendance_heatmap: heatmap ?? [],
    });
  }

  // ── Employee: personal stats ───────────────────────────────────────────────
  const [tasks, attendance, leave] = await Promise.all([
    db.from('tasks')
      .select('status')
      .or(`assignee_id.eq.${user.id},created_by.eq.${user.id}`)
      .is('deleted_at', null),
    db.from('attendance_records')
      .select('status')
      .eq('employee_id', user.id)
      .gte('date', monthAgo),
    db.from('leave_requests')
      .select('status')
      .eq('employee_id', user.id)
      .eq('status', 'pending'),
  ]);

  return NextResponse.json({
    scope:           'personal',
    open_tasks:      tasks.data?.filter(t => !['done', 'cancelled'].includes(t.status)).length ?? 0,
    completed_tasks: tasks.data?.filter(t => t.status === 'done').length ?? 0,
    days_present:    attendance.data?.filter(a => ['present', 'late'].includes(a.status)).length ?? 0,
    pending_leave:   leave.data?.length ?? 0,
  });
}
