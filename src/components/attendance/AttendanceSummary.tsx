import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { isEmployee } from '@/lib/rbac';

export default async function AttendanceSummary({ orgId, userId, role }: { orgId: string; userId: string; role: string }) {
  const db    = createAdminClient();
  const today = new Date().toISOString().split('T')[0];

  let query = db
    .from('attendance_records')
    .select(`
      id, status, check_in_time, check_out_time,
      employee:users!attendance_records_employee_id_fkey(id, full_name, avatar_url)
    `)
    .eq('organization_id', orgId)
    .eq('date', today)
    .order('check_in_time', { ascending: false })
    .limit(8);

  // Employees see only their own attendance status here; everyone else sees
  // the whole organization's, matching the Attendance page's scoping.
  if (isEmployee(role)) query = query.eq('employee_id', userId);

  const { data: records } = await query;

  const present = records?.filter(r => ['present','late'].includes(r.status)).length ?? 0;
  const absent  = records?.filter(r => r.status === 'absent').length ?? 0;
  const onLeave = records?.filter(r => r.status === 'on_leave').length ?? 0;
  const total   = records?.length ?? 0;
  const pct     = total > 0 ? Math.round(present / total * 100) : 0;

  return (
    <Card noPad>
      <div className="px-5 pt-5 pb-3">
        <CardTitle>Today&apos;s Attendance</CardTitle>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 divide-x divide-surface-300/40 border-y border-surface-300/40">
        {[
          { label: 'Present', value: present, color: 'text-success' },
          { label: 'Absent',  value: absent,  color: 'text-danger'  },
          { label: 'On Leave',value: onLeave, color: 'text-info'    },
        ].map(s => (
          <div key={s.label} className="flex flex-col items-center py-3">
            <span className={`text-xl font-bold tabular ${s.color}`}>{s.value}</span>
            <span className="text-2xs text-surface-600 mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="px-5 py-3">
        <div className="flex items-center justify-between text-2xs text-surface-600 mb-1.5">
          <span>Attendance rate</span>
          <span className="font-semibold text-surface-900">{pct}%</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Employee list */}
      {records && records.length > 0 ? (
        <ul className="divide-y divide-surface-300/40 pb-2">
          {records.slice(0, 6).map(r => {
            const emp     = r.employee as { id?: string; full_name?: string; avatar_url?: string } | null;
            const fmt     = (t: string | null) => t
              ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
              : null;
            const inTime  = fmt(r.check_in_time);
            const outTime = fmt(r.check_out_time);
            return (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                <Avatar src={emp?.avatar_url} name={emp?.full_name} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-surface-900 truncate">{emp?.full_name ?? '—'}</p>
                  <div className="flex gap-2 mt-0.5">
                    {inTime  && <p className="text-2xs text-success">In: {inTime}</p>}
                    {outTime && <p className="text-2xs text-danger">Out: {outTime}</p>}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-surface-600 text-center py-6">No records yet today</p>
      )}
    </Card>
  );
}
