'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Trash2, CheckCircle2, Circle, Loader2, Clock, XCircle, PlayCircle } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Avatar } from '@/components/ui/Avatar';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogBody, DialogFooter,
  ConfirmDialog,
} from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, SelectNative } from '@/components/ui/Input';
import { formatDateTime, toISTInputValue, deadlineToUTCDate } from '@/lib/utils/date';
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

const PRIORITIES = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

interface Employee { id: string; full_name: string; }

const REMINDER_OPTS = [
  { value: '1_hour',  label: '1 hr before'    },
  { value: '2_hours', label: '2 hrs before'   },
  { value: '4_hours', label: '4 hrs before'   },
  { value: '1_day',   label: '1 day / 24 hrs' },
  { value: '2_days',  label: '2 days / 48 hrs' },
] as const;

interface TaskCardProps {
  task: {
    id: string; title: string; status: string; priority: string;
    deadline: string | null; description: string | null;
    reminders: string[] | null;
    assignee: { id: string; full_name: string; avatar_url: string | null } | null;
  };
  canEdit:        boolean;
  canDelete?:     boolean;
  employees:      Employee[];
  listMode?:      boolean;
  onStatusChange?: (id: string, status: string) => void;
}

export default function TaskCard({ task, canEdit, canDelete = false, employees, listMode = false, onStatusChange }: TaskCardProps) {
  const router = useRouter();
  const [editOpen,      setEditOpen]      = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updating,      setUpdating]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [status,        setStatus]        = useState<TaskStatus>(task.status as TaskStatus);
  const [saveError,     setSaveError]     = useState<string | null>(null);

  // Track saved deadline locally so re-opening edit immediately
  // shows the latest saved value without waiting for router.refresh().
  const [savedDeadline,  setSavedDeadline]  = useState<string | null>(task.deadline);
  const [savedReminders, setSavedReminders] = useState<string[]>(task.reminders?.length ? task.reminders : ['1_day']);

  const [form, setForm] = useState({
    title:       task.title,
    description: task.description ?? '',
    assignee_id: task.assignee?.id ?? '',
    // Convert ISO datetime from DB to YYYY-MM-DDTHH:MM in IST for datetime-local input
    deadline:    task.deadline ? toISTInputValue(task.deadline) : '',
    priority:    task.priority,
    status:      task.status as TaskStatus,
    reminders:   task.reminders?.length ? task.reminders : ['1_day'],
  });

  const overdue = savedDeadline && status !== 'done' && deadlineToUTCDate(savedDeadline) < new Date();
  const cfg     = STATUS_CFG[status] ?? STATUS_CFG.todo;

  function setField(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function openEdit(e?: React.MouseEvent) {
    setSaveError(null);
    setForm({
      title:       task.title,
      description: task.description ?? '',
      assignee_id: task.assignee?.id ?? '',
      deadline:    savedDeadline ? toISTInputValue(savedDeadline) : '',
      priority:    task.priority,
      status:      status,
      reminders:   savedReminders,
    });
    setEditOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || updating) return;
    setUpdating(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        title:     form.title.trim(),
        priority:  form.priority,
        status:    form.status,
        reminders: form.reminders,
      };
      if (form.description) body.description = form.description;
      if (form.assignee_id) body.assignee_id = form.assignee_id;
      // Send combined datetime string; server splits into deadline + due_time
      body.deadline = form.deadline || null;

      const res = await fetch(`/api/tasks/${task.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (res.ok) {
        // Store full IST ISO string locally for display until router.refresh() completes
        setSavedDeadline(form.deadline ? form.deadline + ':00+05:30' : null);
        setSavedReminders(form.reminders);
        setStatus(form.status);
        onStatusChange?.(task.id, form.status);
        setEditOpen(false);
        router.refresh();
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = typeof errData.error === 'string'
          ? errData.error
          : `Save failed (${res.status})`;
        setSaveError(msg);
        console.error('[TaskCard] PATCH failed:', res.status, errData);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setSaveError(msg);
      console.error('[TaskCard] handleSave error:', err);
    } finally {
      setUpdating(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    setConfirmDelete(false);
    setEditOpen(false);
    router.refresh();
  }

  // Quick toggle done/todo without opening modal
  async function quickToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (updating || !canEdit) return;
    const next: TaskStatus = status === 'done' ? 'todo' : 'done';
    setUpdating(true);
    const prev = status;
    setStatus(next);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: next }),
    });
    if (!res.ok) setStatus(prev);
    else onStatusChange?.(task.id, next);
    setUpdating(false);
    router.refresh();
  }

  // List mode — render only the action button + modals (no card wrapper)
  if (listMode) {
    return (
      <>
        {canEdit && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="p-1.5 rounded-lg text-surface-500 hover:text-surface-900 hover:bg-surface-300/60 transition-all"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-50 min-w-[200px] max-w-[280px] rounded-xl bg-surface-100 border border-surface-300 shadow-modal p-1.5 animate-[scaleIn_0.12s_ease-out]"
                align="end" sideOffset={4}
              >
                {/* Task title shown in full */}
                <div className="px-2.5 py-2 mb-1 border-b border-surface-300/60">
                  <p className="text-xs font-semibold text-surface-900 leading-snug">{task.title}</p>
                </div>
                <DropdownMenu.Item
                  onSelect={() => openEdit()}
                  className="flex items-center gap-2.5 px-2.5 py-2 text-xs text-surface-700 rounded-lg cursor-pointer hover:bg-surface-200/80 outline-none"
                >
                  Edit Task
                </DropdownMenu.Item>
                {canDelete && <>
                  <DropdownMenu.Separator className="my-1 h-px bg-surface-300/80" />
                  <DropdownMenu.Item
                    onSelect={() => setConfirmDelete(true)}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs text-danger rounded-lg cursor-pointer hover:bg-danger/10 outline-none"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Task
                  </DropdownMenu.Item>
                </>}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
        <ConfirmDialog
          open={confirmDelete} onOpenChange={setConfirmDelete}
          title="Delete Task"
          description={`"${task.title}" will be permanently deleted.`}
          confirmLabel="Delete" variant="danger" onConfirm={handleDelete}
        />
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent size="md">
            <DialogHeader><DialogTitle>Update Task</DialogTitle></DialogHeader>
            <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
              <DialogBody className="space-y-4">
                {saveError && (
                  <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{saveError}</p>
                )}
                <Input label="Title *" value={form.title} onChange={e => setField('title', e.target.value)} autoFocus />
                <Textarea label="Description" placeholder="Optional details…" value={form.description} onChange={e => setField('description', e.target.value)} rows={3} />
                <div className="grid grid-cols-2 gap-4">
                  <SelectNative label="Status" value={form.status} onChange={e => setField('status', e.target.value)}>
                    {(Object.entries(STATUS_CFG) as [TaskStatus, typeof STATUS_CFG[TaskStatus]][]).map(([s, c]) => (
                      <option key={s} value={s}>{c.label}</option>
                    ))}
                  </SelectNative>
                  <SelectNative label="Priority" value={form.priority} onChange={e => setField('priority', e.target.value)} options={PRIORITIES} />
                </div>
                {employees.length > 0 && (
                  <SelectNative label="Assign to" value={form.assignee_id} onChange={e => setField('assignee_id', e.target.value)}>
                    <option value="">Unassigned</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                  </SelectNative>
                )}
                {/* lang="en-GB" forces Chrome's native datetime-local clock
                    to render 24-hour instead of "en"'s default 12-hour AM/PM. */}
                <Input label="Deadline" type="datetime-local" lang="en-GB" value={form.deadline} onChange={e => setField('deadline', e.target.value)} />

                {/* Reminders — only shown when a deadline is set */}
                {form.deadline && (
                  <div>
                    <label className="block text-xs font-medium text-surface-700 mb-1.5">
                      Reminders
                      <span className="ml-1 font-normal text-surface-400">(select one or more)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {REMINDER_OPTS.map(opt => {
                        const active = form.reminders.includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setForm(f => ({
                              ...f,
                              reminders: active
                                ? f.reminders.filter(r => r !== opt.value)
                                : [...f.reminders, opt.value],
                            }))}
                            className={cn(
                              'px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                              active
                                ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                                : 'border-surface-300 text-surface-600 hover:bg-surface-200'
                            )}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {form.reminders.length > 0 && (
                      <p className="text-[11px] text-surface-400 mt-1.5">
                        Sends WhatsApp message + in-app bell at the selected time(s)
                      </p>
                    )}
                  </div>
                )}
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" size="md" type="button" onClick={() => setConfirmDelete(true)} className="text-danger hover:text-danger hover:bg-danger/10 mr-auto">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
                </Button>
                <Button variant="ghost" size="md" type="button" onClick={() => setEditOpen(false)} disabled={updating}>Cancel</Button>
                <Button variant="primary" size="md" type="submit" loading={updating}>Save</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      {/* Card — clicking opens edit modal */}
      <div
        className="kanban-card group cursor-pointer"
        onClick={canEdit ? openEdit : undefined}
      >
        {/* Row 1 — check + title + menu */}
        <div className="flex items-start gap-2">
          <button
            onClick={quickToggle}
            disabled={updating || !canEdit}
            className={cn(
              'mt-0.5 shrink-0 transition-colors disabled:opacity-30',
              status === 'done' ? 'text-success hover:text-surface-600' : 'text-surface-500 hover:text-success'
            )}
          >
            {updating
              ? <Loader2      className="h-4 w-4 animate-spin text-brand-400" />
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
                <button
                  onClick={e => e.stopPropagation()}
                  className="shrink-0 p-0.5 rounded-md text-surface-500 opacity-0 group-hover:opacity-100 hover:text-surface-950 hover:bg-surface-300/80 transition-all"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-[200px] max-w-[280px] rounded-xl bg-surface-100 border border-surface-300 shadow-modal p-1.5 animate-[scaleIn_0.12s_ease-out]"
                  align="end" sideOffset={4}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Task title shown in full */}
                  <div className="px-2.5 py-2 mb-1 border-b border-surface-300/60">
                    <p className="text-xs font-semibold text-surface-900 leading-snug">{task.title}</p>
                  </div>
                  <DropdownMenu.Item
                    onSelect={() => openEdit()}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs text-surface-700 rounded-lg cursor-pointer hover:bg-surface-200/80 outline-none"
                  >
                    Edit Task
                  </DropdownMenu.Item>

                  {canDelete && <>
                    <DropdownMenu.Separator className="my-1 h-px bg-surface-300/80" />
                    <DropdownMenu.Item
                      onSelect={() => setConfirmDelete(true)}
                      className="flex items-center gap-2.5 px-2.5 py-2 text-xs text-danger rounded-lg cursor-pointer hover:bg-danger/10 outline-none"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Task
                    </DropdownMenu.Item>
                  </>}
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
                {overdue ? '⚠ ' : ''}{formatDateTime(task.deadline)}
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
        onConfirm={handleDelete}
      />

      {/* Edit modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Update Task</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
            <DialogBody className="space-y-4">
              {saveError && (
                <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{saveError}</p>
              )}
              <Input
                label="Title *"
                value={form.title}
                onChange={e => setField('title', e.target.value)}
                autoFocus
              />

              <Textarea
                label="Description"
                placeholder="Optional details…"
                value={form.description}
                onChange={e => setField('description', e.target.value)}
                rows={3}
              />

              <div className="grid grid-cols-2 gap-4">
                <SelectNative
                  label="Status"
                  value={form.status}
                  onChange={e => setField('status', e.target.value)}
                >
                  {(Object.entries(STATUS_CFG) as [TaskStatus, typeof STATUS_CFG[TaskStatus]][]).map(([s, c]) => (
                    <option key={s} value={s}>{c.label}</option>
                  ))}
                </SelectNative>

                <SelectNative
                  label="Priority"
                  value={form.priority}
                  onChange={e => setField('priority', e.target.value)}
                  options={PRIORITIES}
                />
              </div>

              {employees.length > 0 && (
                <SelectNative
                  label="Assign to"
                  value={form.assignee_id}
                  onChange={e => setField('assignee_id', e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                  ))}
                </SelectNative>
              )}

              <Input
                label="Deadline"
                type="datetime-local"
                // en-GB (not en) — Chrome renders the native datetime-local
                // picker's clock in whatever format that lang implies; "en"
                // (US) defaults to 12-hour AM/PM, en-GB defaults to 24-hour.
                lang="en-GB"
                value={form.deadline}
                onChange={e => setField('deadline', e.target.value)}
              />

              {form.deadline && (
                <div>
                  <label className="block text-xs font-medium text-surface-700 mb-1.5">
                    Reminders
                    <span className="ml-1 font-normal text-surface-400">(select one or more)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {REMINDER_OPTS.map(opt => {
                      const active = form.reminders.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm(f => ({
                            ...f,
                            reminders: active
                              ? f.reminders.filter(r => r !== opt.value)
                              : [...f.reminders, opt.value],
                          }))}
                          className={cn(
                            'px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                            active
                              ? 'border-brand-500 bg-brand-500/10 text-brand-500'
                              : 'border-surface-300 text-surface-600 hover:bg-surface-200'
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {form.reminders.length > 0 && (
                    <p className="text-[11px] text-surface-400 mt-1.5">
                      Sends WhatsApp message + in-app bell at the selected time(s)
                    </p>
                  )}
                </div>
              )}
            </DialogBody>

            <DialogFooter>
              <Button
                variant="ghost"
                size="md"
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-danger hover:text-danger hover:bg-danger/10 mr-auto"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete
              </Button>
              <Button variant="ghost" size="md" type="button" onClick={() => setEditOpen(false)} disabled={updating}>
                Cancel
              </Button>
              <Button variant="primary" size="md" type="submit" loading={updating}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
