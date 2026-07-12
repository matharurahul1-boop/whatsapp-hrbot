'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils/date';
import { canApproveLeaveFor } from '@/lib/rbac';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

interface LeaveRequest {
  id:           string;
  start_date:   string;
  end_date:     string;
  duration_days: number;
  status:       string;
  reason:       string | null;
  created_at:   string;
  reviewed_at:  string | null;
  remarks:      string | null;
  employee: {
    id:         string;
    full_name:  string;
    avatar_url: string | null;
    department: string | null;
    role:       string;
  } | null;
  leave_type: {
    name:  string;
    color: string | null;
  } | null;
  reviewer: {
    id:        string;
    full_name: string;
  } | null;
}

interface LeaveRequestsTableProps {
  requests:   LeaveRequest[];
  canApprove: boolean;
  viewerRole: string;
}

export default function LeaveRequestsTable({ requests, canApprove, viewerRole }: LeaveRequestsTableProps) {
  const router = useRouter();
  const [confirm, setConfirm]   = useState<{ id: string; action: 'approved' | 'rejected' } | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleDecision() {
    if (!confirm) return;
    setLoading(true);
    try {
      await fetch(`/api/leave/${confirm.id}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: confirm.action }),
      });
      setConfirm(null);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!requests.length) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><Clock className="h-5 w-5" /></div>
        <p className="empty-state-title">No leave requests</p>
        <p className="empty-state-desc">Leave requests will appear here once submitted.</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th>Dates</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Applied</th>
              {canApprove && <th></th>}
            </tr>
          </thead>
          <tbody>
            {requests.map(r => {
              const emp = r.employee;
              return (
                <tr key={r.id}>
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
                  <td>
                    <div className="flex items-center gap-1.5">
                      {r.leave_type?.color && (
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.leave_type.color }} />
                      )}
                      <span className="text-sm text-surface-900">{r.leave_type?.name ?? '—'}</span>
                    </div>
                  </td>
                  <td className="text-sm text-surface-800">
                    {formatDate(r.start_date)}
                    {r.start_date !== r.end_date && (
                      <span className="text-surface-600"> → {formatDate(r.end_date)}</span>
                    )}
                  </td>
                  <td className="text-sm font-medium text-surface-900">
                    {r.duration_days}d
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.reviewer && (r.status === 'approved' || r.status === 'rejected') && (
                      <p className="text-2xs text-surface-500 mt-1">
                        {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.reviewer.full_name}
                      </p>
                    )}
                  </td>
                  <td className="text-xs text-surface-600">{formatDate(r.created_at)}</td>
                  {canApprove && (
                    <td>
                      {/* Approval is per-row hierarchy-based, not a flat
                          role gate — an hr_assistant sees the column but
                          only gets buttons on employee/manager rows, not on
                          an hr peer's request. */}
                      {r.status === 'pending' && emp && canApproveLeaveFor(viewerRole, emp.role) && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setConfirm({ id: r.id, action: 'approved' })}
                            className="p-1.5 rounded-lg text-success hover:bg-success/10 transition-colors"
                            title="Approve"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirm({ id: r.id, action: 'rejected' })}
                            className="p-1.5 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                            title="Reject"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={open => !open && setConfirm(null)}
        title={confirm?.action === 'approved' ? 'Approve Leave' : 'Reject Leave'}
        description={
          confirm?.action === 'approved'
            ? 'This will approve the leave request and notify the employee.'
            : 'This will reject the leave request and notify the employee.'
        }
        confirmLabel={confirm?.action === 'approved' ? 'Approve' : 'Reject'}
        variant={confirm?.action === 'approved' ? 'primary' : 'danger'}
        loading={loading}
        onConfirm={handleDecision}
      />
    </>
  );
}
