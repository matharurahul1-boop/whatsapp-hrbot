'use client';

import { useState, useEffect } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
} from '@/components/ui/Modal';

type JsonRecord = Record<string, unknown>;

interface ActivityLog {
  id:         string;
  action:     string;
  table_name: string;
  old_data:   JsonRecord | null;
  new_data:   JsonRecord | null;
  created_at: string;
  actor:      { id?: string; full_name?: string; avatar_url?: string } | null;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ACTION_LABELS: Record<string, string> = {
  CREATE_TASK:      'Task Created',
  UPDATE_TASK:      'Task Updated',
  COMPLETE_TASK:    'Task Completed',
  DELETE_TASK:      'Task Deleted',
  ADD_TASK_NOTE:    'Note Added',
  APPLY_LEAVE:      'Leave Applied',
  APPROVE_LEAVE:    'Leave Approved',
  REJECT_LEAVE:     'Leave Rejected',
  CANCEL:           'Leave Cancelled',
  CHECK_IN:         'Checked In',
  MANUAL_ATTENDANCE:'Attendance Added',
  START_ONBOARDING: 'Onboarding Started',
};

function friendlyActionLabel(log: ActivityLog): string {
  if (ACTION_LABELS[log.action]) return ACTION_LABELS[log.action];
  // Generic dashboard actions (CREATE/UPDATE/DELETE) are named per-table above
  // for the bot's actions; fall back to a per-table label for dashboard writes.
  if (log.action === 'CREATE') {
    if (log.table_name === 'tasks') return 'Task Created';
    if (log.table_name === 'leave_requests') return 'Leave Applied';
    if (log.table_name === 'attendance_records') return 'Checked In';
  }
  if (log.action === 'UPDATE') {
    if (log.table_name === 'tasks') return 'Task Updated';
    if (log.table_name === 'leave_requests') return 'Leave Reviewed';
    if (log.table_name === 'attendance_records') return 'Attendance Updated';
    if (log.table_name === 'users') return 'Profile Updated';
  }
  if (log.action === 'DELETE' && log.table_name === 'tasks') return 'Task Deleted';
  return log.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Fields a task update can touch, in priority order, so "changed 3 things"
// still leads with the most relevant one instead of an arbitrary key order.
const TASK_FIELD_LABELS: Record<string, (v: unknown) => string> = {
  status:   v => `status to ${String(v).replace('_', ' ')}`,
  priority: v => `priority to ${v}`,
  deadline: v => `deadline`,
  title:    v => `title to "${v}"`,
  description: () => `the description`,
};

function describeActivity(log: ActivityLog): string {
  const actor = log.actor?.full_name ?? 'Someone';
  const nd = log.new_data ?? {};
  const od = log.old_data ?? {};
  const title = (nd.title ?? od.title) as string | undefined;

  switch (log.action) {
    case 'CREATE_TASK':
    case 'CREATE':
      if (log.table_name === 'tasks')
        return `${actor} created task "${(nd as JsonRecord).title ?? 'Untitled'}"`;
      if (log.table_name === 'leave_requests')
        return `${actor} applied for ${nd.leave_type_name ?? ''} leave${nd.start_date ? ` (${nd.start_date} to ${nd.end_date})` : ''}`;
      if (log.table_name === 'attendance_records')
        return `${actor} checked in`;
      break;
    case 'UPDATE_TASK': {
      const changed = Object.keys(nd).filter(k => k !== 'title' && k in TASK_FIELD_LABELS);
      if (changed.length === 1) {
        return `${actor} changed ${TASK_FIELD_LABELS[changed[0]](nd[changed[0]])} on "${title ?? 'a task'}"`;
      }
      if (changed.length > 1) {
        return `${actor} updated ${changed.length} fields on "${title ?? 'a task'}"`;
      }
      return `${actor} updated "${title ?? 'a task'}"`;
    }
    case 'UPDATE':
      if (log.table_name === 'tasks') return `${actor} updated "${title ?? 'a task'}"`;
      if (log.table_name === 'leave_requests') return `${actor} reviewed a leave request`;
      if (log.table_name === 'attendance_records')
        return nd.check_out_time ? `${actor} checked out` : `${actor}'s attendance was updated`;
      if (log.table_name === 'users') return `${actor} updated a team member's profile`;
      break;
    case 'COMPLETE_TASK':
      return `${actor} marked "${title ?? 'a task'}" as complete`;
    case 'DELETE_TASK':
    case 'DELETE':
      return `${actor} deleted task "${title ?? 'Untitled'}"`;
    case 'ADD_TASK_NOTE':
      return `${actor} added a note to "${title ?? 'a task'}"`;
    case 'APPLY_LEAVE':
      return `${actor} applied for ${nd.leave_type_name ?? ''} leave${nd.start_date ? ` (${nd.start_date} to ${nd.end_date})` : ''}`;
    case 'APPROVE_LEAVE':
      return `${actor} approved ${nd.employee_name ?? "an employee's"} ${nd.leave_type_name ?? ''} leave`;
    case 'REJECT_LEAVE':
      return `${actor} rejected ${nd.employee_name ?? "an employee's"} ${nd.leave_type_name ?? ''} leave`;
    case 'CANCEL':
      return `${actor} cancelled ${od.leave_type_name ? `a ${od.leave_type_name}` : 'a'} leave request`;
    case 'CHECK_IN':
      return `${actor} checked in`;
    case 'MANUAL_ATTENDANCE':
      return `${actor} added a manual attendance record`;
    case 'START_ONBOARDING':
      return `${actor} started onboarding`;
  }
  return `${actor} performed an action`;
}

// Fields that are internal/opaque (UUIDs, timestamps already shown elsewhere)
// and not useful to show in the detail modal's field list.
const HIDDEN_DETAIL_FIELDS = new Set([
  'id', 'organization_id', 'assignee_id', 'created_by', 'updated_by',
  'employee_id', 'leave_type_id', 'reviewed_by', 'updated_at',
]);

function labelFor(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && ISO_DATETIME_RE.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    }
  }
  return String(v);
}

function DetailFields({ data }: { data: JsonRecord | null }) {
  if (!data) return <p className="text-sm text-surface-500">No data recorded.</p>;
  const entries = Object.entries(data).filter(([k]) => !HIDDEN_DETAIL_FIELDS.has(k));
  if (entries.length === 0) return <p className="text-sm text-surface-500">No details recorded.</p>;
  return (
    <dl className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 text-sm">
          <dt className="text-surface-600 shrink-0">{labelFor(k)}</dt>
          <dd className="text-surface-900 font-medium text-right break-words">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ActivityFeedList({ logs }: { logs: ActivityLog[] }) {
  const [selected, setSelected] = useState<ActivityLog | null>(null);

  // Multiple independent Radix Dialogs live on this dashboard page (this one
  // + the Upcoming Tasks detail modal). Radix's controlled-dialog close can
  // occasionally leave `pointer-events: none` stuck on <body>, which makes
  // every subsequent click (including opening another dialog) silently do
  // nothing. Explicitly clear it whenever this dialog closes.
  useEffect(() => {
    if (!selected) document.body.style.pointerEvents = '';
  }, [selected]);

  return (
    <>
      <div className="divide-y divide-surface-300/40 max-h-80 overflow-y-auto no-scrollbar">
        {logs.map(log => (
          <button
            key={log.id}
            onClick={() => setSelected(log)}
            className="w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-surface-200/40 transition-colors"
          >
            <Avatar src={log.actor?.avatar_url} name={log.actor?.full_name} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-surface-900 leading-snug">{describeActivity(log)}</p>
              <p className="text-2xs text-surface-500 mt-0.5">{timeAgo(log.created_at)}</p>
            </div>
            <Badge variant="outline" className="shrink-0 text-2xs">{friendlyActionLabel(log)}</Badge>
          </button>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{selected ? friendlyActionLabel(selected) : ''}</DialogTitle>
          </DialogHeader>
          {selected && (
            <DialogBody>
              <div className="flex items-center gap-3 mb-4">
                <Avatar src={selected.actor?.avatar_url} name={selected.actor?.full_name} size="sm" />
                <div>
                  <p className="text-sm font-medium text-surface-900">{selected.actor?.full_name ?? 'Someone'}</p>
                  <p className="text-2xs text-surface-500">
                    {new Date(selected.created_at).toLocaleString('en-IN', {
                      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
                    })}
                  </p>
                </div>
              </div>
              <p className="text-sm text-surface-800 mb-4">{describeActivity(selected)}</p>

              {selected.old_data && (
                <div className="mb-4">
                  <p className="text-2xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Before</p>
                  <DetailFields data={selected.old_data} />
                </div>
              )}
              <div>
                <p className="text-2xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
                  {selected.old_data ? 'After' : 'Details'}
                </p>
                <DetailFields data={selected.new_data} />
              </div>
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
