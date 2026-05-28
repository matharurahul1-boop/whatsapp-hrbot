'use client';

import { formatDate } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import type { LeaveRequestStatus } from '@/types/database.types';

interface LeaveRequest {
  id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  status: LeaveRequestStatus;
  reason: string | null;
  created_at: string;
  leave_types: { name: string; color_hex: string } | null;
  users: { full_name: string } | null;
}

const statusColors: Record<LeaveRequestStatus, string> = {
  pending:   'badge-yellow',
  approved:  'badge-green',
  rejected:  'badge-red',
  cancelled: 'badge-slate',
};

export default function LeaveList({
  requests,
  role,
  userId,
  orgId,
}: {
  requests: LeaveRequest[];
  role: string;
  userId: string;
  orgId: string;
}) {
  const showEmployee = role !== 'employee';

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Leave Requests</h2>
        <span className="text-sm text-slate-400">{requests.length} records</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {showEmployee && <th className="text-left px-4 py-3 font-semibold text-slate-600">Employee</th>}
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Duration</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Days</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Applied</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.length === 0 ? (
              <tr>
                <td colSpan={showEmployee ? 6 : 5} className="px-4 py-10 text-center text-slate-400">
                  No leave requests
                </td>
              </tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  {showEmployee && (
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {r.users?.full_name ?? '—'}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: r.leave_types?.color_hex ?? '#22c55e' }}
                      />
                      {r.leave_types?.name ?? '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatDate(r.start_date)} — {formatDate(r.end_date)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.total_days}d</td>
                  <td className="px-4 py-3">
                    <span className={cn('badge', statusColors[r.status])}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {formatDate(r.created_at.split('T')[0])}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
