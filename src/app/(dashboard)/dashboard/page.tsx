import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import {
  CheckSquare, Users, Clock, Calendar,
  TrendingUp, AlertTriangle,
} from 'lucide-react';
import { StatCard } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import RecentTasks from '@/components/tasks/RecentTasks';
import AttendanceSummary from '@/components/attendance/AttendanceSummary';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import AttendanceHeatmap from '@/components/dashboard/AttendanceHeatmap';
import RefreshButton from '@/components/ui/RefreshButton';

export const metadata = { title: 'Dashboard — HRBot' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
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

  const orgId = profile.organization_id;
  const isAdmin = ['super_admin', 'admin', 'hr', 'manager'].includes(profile.role);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const hour  = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = profile.full_name?.split(' ')[0] ?? 'there';

  // Parallel data fetch
  const [kpisRes, taskTrendRes, heatmapRes] = await Promise.all([
    db.rpc('get_org_kpis', { p_org_id: orgId }),
    db.rpc('get_task_trend', { p_org_id: orgId }),
    db.rpc('get_attendance_heatmap', { p_org_id: orgId, p_days: 30 }),
  ]);

  const kpis        = kpisRes.data?.[0];
  const taskTrend   = taskTrendRes.data ?? [];
  const heatmapData = heatmapRes.data ?? [];

  // Personal stats for employees
  let personalStats = null;
  if (!isAdmin) {
    const [myTasks, myAtt, myLeave] = await Promise.all([
      db.from('tasks').select('status', { count: 'exact', head: false })
        .or(`assignee_id.eq.${user.id},created_by.eq.${user.id},updated_by.eq.${user.id}`)
        .is('deleted_at', null),
      db.from('attendance_records').select('status')
        .eq('employee_id', user.id).eq('date', today).single(),
      db.from('leave_requests').select('id', { count: 'exact', head: true })
        .eq('employee_id', user.id).eq('status', 'pending'),
    ]);
    personalStats = {
      openTasks:    myTasks.data?.filter(t => !['done', 'cancelled'].includes(t.status)).length ?? 0,
      doneTasks:    myTasks.data?.filter(t => t.status === 'done').length ?? 0,
      todayStatus:  myAtt.data?.status ?? null,
      pendingLeave: myLeave.count ?? 0,
    };
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-fade-up">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-surface-950">
            {greeting}, {firstName} 👋
          </h2>
          <p className="text-sm text-surface-700 mt-1">
            {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <RefreshButton />
      </div>

      {/* ── KPI Cards ── */}
      {isAdmin && kpis ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            label="Active Employees"
            value={kpis.active_employees ?? 0}
            icon={<Users className="h-4 w-4" />}
            color="brand"
            delta={kpis.new_this_month > 0 ? { value: `+${kpis.new_this_month} this month`, positive: true } : undefined}
          />
          <StatCard
            label="Present Today"
            value={kpis.present_today ?? 0}
            suffix={`/ ${kpis.active_employees ?? 0}`}
            icon={<Clock className="h-4 w-4" />}
            color="success"
            delta={{ value: `${kpis.attendance_pct_today ?? 0}%`, positive: (kpis.attendance_pct_today ?? 0) >= 75 }}
          />
          <StatCard
            label="Open Tasks"
            value={kpis.open_tasks ?? 0}
            icon={<CheckSquare className="h-4 w-4" />}
            color={kpis.overdue_tasks > 0 ? 'danger' : 'info'}
            delta={kpis.overdue_tasks > 0 ? { value: `${kpis.overdue_tasks} overdue`, positive: false } : undefined}
          />
          <StatCard
            label="Pending Leave"
            value={kpis.pending_leave_requests ?? 0}
            icon={<Calendar className="h-4 w-4" />}
            color="warning"
          />
        </div>
      ) : personalStats ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Open Tasks"     value={personalStats.openTasks}    icon={<CheckSquare className="h-4 w-4" />} color="info" />
          <StatCard label="Completed"      value={personalStats.doneTasks}    icon={<TrendingUp  className="h-4 w-4" />} color="success" />
          <StatCard
            label="Today"
            value={personalStats.todayStatus
              ? personalStats.todayStatus.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
              : 'Not checked in'}
            icon={<Clock className="h-4 w-4" />}
            color={personalStats.todayStatus === 'present' ? 'success' : personalStats.todayStatus === 'absent' ? 'danger' : 'warning'}
          />
          <StatCard label="Pending Leave"  value={personalStats.pendingLeave} icon={<Calendar className="h-4 w-4" />} color="warning" />
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* ── Overdue alert banner ── */}
      {isAdmin && kpis && kpis.overdue_tasks > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
          <p className="text-sm text-danger">
            <span className="font-semibold">{kpis.overdue_tasks} tasks</span> are overdue and need attention.
          </p>
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Tasks — 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          <Suspense fallback={<SkeletonCard className="h-64" />}>
            <RecentTasks orgId={orgId} userId={user.id} role={profile.role} />
          </Suspense>

          {/* Attendance heatmap */}
          {isAdmin && heatmapData.length > 0 && (
            <AttendanceHeatmap data={heatmapData} />
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <Suspense fallback={<SkeletonCard className="h-48" />}>
            <AttendanceSummary orgId={orgId} userId={user.id} role={profile.role} />
          </Suspense>

          <Suspense fallback={<SkeletonCard className="h-64" />}>
            <ActivityFeed orgId={orgId} userId={user.id} role={profile.role} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
