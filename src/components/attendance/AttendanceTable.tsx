import { formatDate } from '@/lib/utils/date';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, Badge } from '@/components/ui/Badge';

interface AttendanceRecord {
  id:             string;
  date:           string;
  check_in_time:  string | null;
  check_out_time: string | null;
  total_hours:    number | null;
  status:         string;
  employee: {
    id:         string;
    full_name:  string;
    avatar_url: string | null;
    department: string | null;
  } | null;
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

export default function AttendanceTable({
  records,
  showEmployee = true,
}: {
  records:      AttendanceRecord[];
  showEmployee?: boolean;
}) {
  if (!records.length) {
    return (
      <div className="empty-state py-12">
        <p className="empty-state-title">No records found</p>
        <p className="empty-state-desc">Attendance records will appear here once employees check in.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {showEmployee && <th>Employee</th>}
            <th>Date</th>
            <th>Check In</th>
            <th>Check Out</th>
            <th>Hours</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => {
            const emp = r.employee;
            return (
              <tr key={r.id}>
                {showEmployee && (
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar src={emp?.avatar_url} name={emp?.full_name} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-surface-900">{emp?.full_name ?? '—'}</p>
                        {emp?.department && (
                          <p className="text-xs text-surface-600">{emp.department}</p>
                        )}
                      </div>
                    </div>
                  </td>
                )}
                <td className="text-sm text-surface-800">{formatDate(r.date)}</td>
                <td className="text-sm font-medium text-surface-900 tabular">{fmt(r.check_in_time)}</td>
                <td className="text-sm font-medium text-surface-900 tabular">{fmt(r.check_out_time)}</td>
                <td className="text-sm text-surface-800">
                  {r.total_hours ? (
                    <span className="font-medium text-surface-950">{r.total_hours}h</span>
                  ) : '—'}
                </td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
