'use client';

import { useState, useEffect } from 'react';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import { StatusBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils/cn';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
} from '@/components/ui/Modal';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-danger shadow-[0_0_6px_0_rgba(239,68,68,0.4)]',
  high:   'bg-warning',
  medium: 'bg-info',
  low:    'bg-surface-500',
};

interface Person { id?: string; full_name?: string; avatar_url?: string | null }

interface Task {
  id:          string;
  title:       string;
  description: string | null;
  status:      string;
  priority:    string;
  deadline:    string | null;
  assignee:    Person | null;
  creator:     Person | null;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm py-1.5">
      <span className="text-surface-600 shrink-0">{label}</span>
      <span className="text-surface-900 font-medium text-right">{children}</span>
    </div>
  );
}

export default function RecentTasksList({ tasks }: { tasks: Task[] }) {
  const [selected, setSelected] = useState<Task | null>(null);

  // Multiple independent Radix Dialogs live on this dashboard page (this one
  // + the Recent Activity detail modal). Radix's controlled-dialog close can
  // occasionally leave `pointer-events: none` stuck on <body>, which makes
  // every subsequent click (including opening another dialog) silently do
  // nothing. Explicitly clear it whenever this dialog closes.
  useEffect(() => {
    if (!selected) document.body.style.pointerEvents = '';
  }, [selected]);

  return (
    <>
      <ul className="divide-y divide-surface-300/40">
        {tasks.map(t => {
          const overdue = t.deadline && new Date(t.deadline) < new Date();
          return (
            <li key={t.id}>
              <button
                onClick={() => setSelected(t)}
                className="task-row w-full px-3 py-3 hover:bg-surface-200/30 transition-colors text-left"
              >
                <span className={cn('h-2 w-2 rounded-full', PRIORITY_COLORS[t.priority] ?? 'bg-surface-500')} />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-surface-900 block truncate">{t.title}</span>
                  {t.deadline ? (
                    <p className={cn('text-xs mt-0.5 truncate', overdue ? 'text-danger font-medium' : 'text-surface-600')}>
                      {overdue ? '⚠ Overdue · ' : ''}{formatDate(t.deadline)}
                    </p>
                  ) : (
                    <p className="text-xs text-surface-500 mt-0.5 truncate">No deadline</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {t.assignee && (
                    <Avatar
                      src={t.assignee.avatar_url ?? undefined}
                      name={t.assignee.full_name}
                      size="xs"
                      title={
                        t.creator && t.creator.id === t.assignee.id
                          ? `Self-assigned by: ${t.assignee.full_name ?? 'Unknown'}`
                          : `Assigned to: ${t.assignee.full_name ?? 'Unknown'}`
                      }
                    />
                  )}
                  {t.creator && t.creator.id !== t.assignee?.id && (
                    <Avatar
                      src={t.creator.avatar_url ?? undefined}
                      name={t.creator.full_name}
                      size="xs"
                      title={`Assigned by: ${t.creator.full_name ?? 'Unknown'}`}
                    />
                  )}
                  <StatusBadge status={t.status} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          {selected && (
            <DialogBody>
              <div className="space-y-1 divide-y divide-surface-300/40">
                <DetailRow label="Status"><StatusBadge status={selected.status} /></DetailRow>
                <DetailRow label="Priority">
                  <span className="inline-flex items-center gap-1.5 capitalize">
                    <span className={cn('h-2 w-2 rounded-full', PRIORITY_COLORS[selected.priority] ?? 'bg-surface-500')} />
                    {selected.priority}
                  </span>
                </DetailRow>
                <DetailRow label="Deadline">
                  {selected.deadline ? formatDateTime(selected.deadline) : '—'}
                </DetailRow>
                <DetailRow label="Assigned To">
                  {selected.assignee ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar src={selected.assignee.avatar_url ?? undefined} name={selected.assignee.full_name} size="xs" />
                      {selected.assignee.full_name}
                    </span>
                  ) : 'Unassigned'}
                </DetailRow>
                <DetailRow label="Assigned By">
                  {selected.creator ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar src={selected.creator.avatar_url ?? undefined} name={selected.creator.full_name} size="xs" />
                      {selected.creator.full_name}
                    </span>
                  ) : '—'}
                </DetailRow>
              </div>
              {selected.description && (
                <div className="mt-4">
                  <p className="text-2xs font-semibold text-surface-500 uppercase tracking-wider mb-1.5">Description</p>
                  <p className="text-sm text-surface-800 whitespace-pre-wrap">{selected.description}</p>
                </div>
              )}
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
