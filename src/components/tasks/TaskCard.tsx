'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Trash2, CheckCircle2, Circle, Loader2, Clock, XCircle, PlayCircle } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

const STATUS_CFG: Record<TaskStatus, { label: string; icon: React.ReactNode; pill: string }> = {
  todo:        { label: 'To Do',       icon: <Circle       className="h-3 w-3" />, pill: 'bg-surface-300/60 text-surface-700' },
  in_progress: { label: 'In Progress', icon: <PlayCircle   className="h-3 w-3" />, pill: 'bg-info/10 text-info'               },
  done:        { label: 'Done',        icon: <CheckCircle2 className="h-3 w-3" />, pill: 'bg-success/10 text-success'         },
  cancelled:   { label: 'Cancelled',   icon: <XCircle      className="h-3 w-3" />, pill: 'bg-danger/10 text-danger'           },
};

const PRI_DOT: Record<string, string> = {
  urgent: 'bg-danger  shadow-[0_0_4px_rgba(239,68,68,0.5)]',
  high:   'bg-warning',
  medium: 'bg-info',
  low:    'bg-surface-500',
};

interface TaskCardProps {
  task: {
    id: string; title: string; status: string; priority: string;
    deadline: string | null; description: string | null;
    assignee: { id: string; full_name: string; avatar_url: string | null } | null;
  };
  canEdit: boolean;
}

export default function TaskCard({ task, canEdit }: TaskCardProps) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updating,      setUpdating]      = useState(false);
  const [status,        setStatus]        = useState<TaskStatus>(task.status as TaskStatus);

  const overdue = task.deadline && status !== 'done' && new Date(task.deadline) < new Date();
  const cfg     = STATUS_CFG[status] ?? STATUS_CFG.todo;

  async function changeStatus(next: TaskStatus) {
    if (next === status || updating || !canEdit) return;
    setUpdating(true);
    const prev = status;
    setStatus(next); // optimistic
    const res = await fetch(`/api/tasks/${task.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: next }),
    });
    if (!res.ok) setStatus(prev); // rollback
    setUpdating(false);
    router.refresh();
  }

  async function deleteTask() {
    await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    setConfirmDelete(false);
    router.refresh();
  }

  return (
    <>
      <div className="kanban-card group">
        {/* Row 1 — check + title + menu */}
        <div className="flex items-start gap-2">
          <button
            onClick={() => changeStatus(status === 'done' ? 'todo' : 'done')}
            disabled={updating || !canEdit}
            className={cn(
              'mt-0.5 shrink-0 transition-colors disabled:opacity-30',
              status === 'done' ? 'text-success hover:text-surface-600' : 'text-surface-500 hover:text-success'
            )}
          >
            {updating
              ? <Loader2    className="h-4 w-4 animate-spin text-brand-400" />
              : status === 'done'
                ? <CheckCircle2 className="h-4 w-4" />
                : <Circle       className="h-4 w-4" />
            }
          </button>

          <p className={cn(
            'flex-1 text-sm font-medium text-surface-900 leading-snug break-words min-w-0',
            (status === 'done' || status === 'cancelled') && 'line-through text-surface-600 opacity-70'
          )}>
            {task.title}
          </p>

          {canEdit && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="shrink-0 p-0.5 rounded-md text-surface-500 opacity-0 group-hover:opacity-100 hover:text-surface-950 hover:bg-surface-300/80 transition-all">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-[160px] rounded-xl bg-surface-100 border border-surface-300 shadow-modal p-1.5 animate-[scaleIn_0.12s_ease-out]"
                  align="end" sideOffset={4}
                >
                  <p className="px-2.5 py-1.5 text-2xs font-bold text-surface-500 uppercase tracking-wider">
                    Set Status
                  </p>
                  {(Object.entries(STATUS_CFG) as [TaskStatus, typeof STATUS_CFG[TaskStatus]][]).map(([s, c]) => (
                    <DropdownMenu.Item
                      key={s}
                      onSelect={() => changeStatus(s)}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg cursor-pointer outline-none transition-colors',
                        s === status ? c.pill : 'text-surface-700 hover:bg-surface-200/80'
                      )}
                    >
                      <span>{c.icon}</span>
                      {c.label}
                      {s === status && <span className="ml-auto text-2xs opacity-50">✓</span>}
                    </DropdownMenu.Item>
                  ))}

                  <DropdownMenu.Separator className="my-1 h-px bg-surface-300/80" />

                  <DropdownMenu.Item
                    onSelect={() => setConfirmDelete(true)}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs text-danger rounded-lg cursor-pointer hover:bg-danger/10 outline-none"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Task
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>

        {/* Row 2 — description */}
        {task.description && (
          <p className="text-xs text-surface-600 line-clamp-2 mt-1.5 ml-6">{task.description}</p>
        )}

        {/* Row 3 — status pill */}
        <div className="mt-2 ml-6">
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold', cfg.pill)}>
            {cfg.icon}
            {cfg.label}
          </span>
        </div>

        {/* Row 4 — priority + deadline + assignee */}
        <div className="flex items-center gap-2 mt-2.5 ml-6">
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', PRI_DOT[task.priority] ?? 'bg-surface-500')} />
          <span className="text-2xs text-surface-600 capitalize">{task.priority}</span>

          {task.deadline && (
            <>
              <span className="text-surface-400 text-2xs">·</span>
              <span className={cn('flex items-center gap-1 text-2xs font-medium', overdue ? 'text-danger' : 'text-surface-600')}>
                <Clock className="h-3 w-3" />
                {overdue ? '⚠ ' : ''}{formatDate(task.deadline)}
              </span>
            </>
          )}

          {task.assignee && (
            <div className="flex items-center gap-1.5 ml-auto">
              <Avatar src={task.assignee.avatar_url} name={task.assignee.full_name} size="xs" />
              <span className="text-2xs text-surface-500 hidden group-hover:inline truncate max-w-[72px]">
                {task.assignee.full_name.split(' ')[0]}
              </span>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Task"
        description={`"${task.title}" will be permanently deleted.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={deleteTask}
      />
    </>
  );
}
