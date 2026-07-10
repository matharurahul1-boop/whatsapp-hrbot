'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutGrid, List, Clock, AlertTriangle, CheckCircle2,
  Circle, PlayCircle, XCircle, MoreHorizontal, Loader2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import TaskCard from './TaskCard';
import { ExpandText } from '@/components/ui/ExpandText';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, deadlineToUTCDate } from '@/lib/utils/date';

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
type ViewMode   = 'kanban' | 'list';

const COLUMNS: { id: TaskStatus; label: string; color: string; dot: string; bg: string; accent: string; iconColor: string }[] = [
  { id: 'todo',        label: 'To Do',       color: 'text-surface-600', dot: 'bg-surface-400', bg: 'bg-surface-300/40', accent: 'border-t-surface-400', iconColor: 'text-surface-500' },
  { id: 'in_progress', label: 'In Progress',  color: 'text-info',        dot: 'bg-info',        bg: 'bg-info/10',        accent: 'border-t-info',        iconColor: 'text-info'        },
  { id: 'done',        label: 'Done',         color: 'text-success',     dot: 'bg-success',     bg: 'bg-success/10',     accent: 'border-t-success',     iconColor: 'text-success'     },
  { id: 'cancelled',   label: 'Cancelled',    color: 'text-danger',      dot: 'bg-danger',      bg: 'bg-danger/10',      accent: 'border-t-danger',      iconColor: 'text-danger'      },
];

const STAT_ICONS: Record<TaskStatus, React.ElementType> = {
  todo:        Circle,
  in_progress: PlayCircle,
  done:        CheckCircle2,
  cancelled:   XCircle,
};

const PRI_CFG: Record<string, { label: string; dot: string; border: string; text: string; bg: string }> = {
  urgent: { label: 'Urgent', dot: 'bg-danger',   border: 'border-l-danger',   text: 'text-danger',   bg: 'bg-danger/10'   },
  high:   { label: 'High',   dot: 'bg-warning',  border: 'border-l-warning',  text: 'text-warning',  bg: 'bg-warning/10'  },
  medium: { label: 'Medium', dot: 'bg-info',      border: 'border-l-info',     text: 'text-info',     bg: 'bg-info/10'     },
  low:    { label: 'Low',    dot: 'bg-surface-500', border: 'border-l-surface-400', text: 'text-surface-500', bg: 'bg-surface-200/60' },
};

const STATUS_CFG: Record<TaskStatus, { label: string; icon: React.ReactNode; pill: string }> = {
  todo:        { label: 'To Do',       icon: <Circle       className="h-3 w-3" />, pill: 'bg-surface-300/60 text-surface-700' },
  in_progress: { label: 'In Progress', icon: <PlayCircle   className="h-3 w-3" />, pill: 'bg-info/10 text-info'               },
  done:        { label: 'Done',        icon: <CheckCircle2 className="h-3 w-3" />, pill: 'bg-success/10 text-success'         },
  cancelled:   { label: 'Cancelled',   icon: <XCircle      className="h-3 w-3" />, pill: 'bg-danger/10 text-danger'           },
};

interface Task {
  id:          string;
  title:       string;
  status:      string;
  priority:    string;
  deadline:    string | null;
  description: string | null;
  reminders:   string[] | null;
  assignee:    { id: string; full_name: string; avatar_url: string | null } | null;
  creator:     { id: string; full_name: string; avatar_url: string | null } | null;
  created_by:  string;
}

interface Employee { id: string; full_name: string; }

interface TaskKanbanProps {
  tasks:     Task[];
  userId:    string;
  userRole:  string;
  employees: Employee[];
}

const PRIORITIES = ['', 'urgent', 'high', 'medium', 'low'];
const STATUSES: { id: string; label: string }[] = [
  { id: '',            label: 'All' },
  { id: 'todo',        label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done',        label: 'Done' },
  { id: 'cancelled',   label: 'Cancelled' },
];
const DEADLINE_PRESETS: { id: string; label: string }[] = [
  { id: '',        label: 'All' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'today',   label: 'Due Today' },
  { id: 'week',    label: 'Due This Week' },
  { id: 'none',    label: 'No Deadline' },
];

function matchesDeadlinePreset(task: Task, preset: string, now: Date): boolean {
  if (!preset) return true;
  if (preset === 'none') return !task.deadline;
  if (!task.deadline) return false;
  const d = deadlineToUTCDate(task.deadline);
  if (preset === 'overdue') return task.status !== 'done' && task.status !== 'cancelled' && d < now;
  if (preset === 'today') {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday    = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return d >= startOfToday && d <= endOfToday;
  }
  if (preset === 'week') {
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return d >= now && d <= weekFromNow;
  }
  return true;
}


/* ── Inline list-row quick toggle (mirrors TaskCard quickToggle) ── */
function ListRow({
  task, canEdit, canDelete, employees, onStatusChange,
}: { task: Task; canEdit: boolean; canDelete: boolean; employees: Employee[]; onStatusChange: (id: string, status: string) => void }) {
  const [status,   setStatus]   = useState<TaskStatus>(task.status as TaskStatus);
  const [updating, setUpdating] = useState(false);

  const overdue = task.deadline && status !== 'done' && status !== 'cancelled' &&
    deadlineToUTCDate(task.deadline) < new Date();
  const pri     = PRI_CFG[task.priority] ?? PRI_CFG.low;
  const stCfg   = STATUS_CFG[status] ?? STATUS_CFG.todo;

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
    else onStatusChange(task.id, next);
    setUpdating(false);
  }

  return (
    <div className={cn(
      'group flex items-center gap-3 px-4 py-3 border-b border-surface-200/60 last:border-0',
      'hover:bg-surface-200/40 transition-colors',
      'border-l-2',
      pri.border,
    )}>
      {/* Check toggle */}
      <button
        onClick={quickToggle}
        disabled={updating || !canEdit}
        className={cn(
          'shrink-0 transition-colors disabled:opacity-30',
          status === 'done' ? 'text-success hover:text-surface-500' : 'text-surface-400 hover:text-success'
        )}
      >
        {updating
          ? <Loader2      className="h-4 w-4 animate-spin text-brand-400" />
          : status === 'done'
            ? <CheckCircle2 className="h-4 w-4" />
            : <Circle       className="h-4 w-4" />
        }
      </button>

      {/* Title + description */}
      <div className="flex-1 min-w-0">
        <ExpandText
          className={cn(
            'text-sm font-medium text-surface-900 block',
            (status === 'done' || status === 'cancelled') && 'line-through text-surface-500 opacity-70'
          )}
        >
          {task.title}
        </ExpandText>
        {task.description && (
          <ExpandText className="text-xs text-surface-500 block mt-0.5">{task.description}</ExpandText>
        )}
      </div>

      {/* Assigned To */}
      <div className="hidden sm:flex items-center gap-1.5 w-32 shrink-0">
        {task.assignee ? (
          <>
            <Avatar src={task.assignee.avatar_url} name={task.assignee.full_name} size="xs" />
            <span className="text-xs text-surface-600 truncate">{task.assignee.full_name.split(' ')[0]}</span>
          </>
        ) : (
          <span className="text-xs text-surface-400 italic">Unassigned</span>
        )}
      </div>

      {/* Assigned By */}
      <div className="hidden md:flex items-center gap-1.5 w-32 shrink-0">
        {task.creator ? (
          <>
            <Avatar src={task.creator.avatar_url} name={task.creator.full_name} size="xs" />
            <span className="text-xs text-surface-600 truncate">{task.creator.full_name.split(' ')[0]}</span>
          </>
        ) : (
          <span className="text-xs text-surface-400">—</span>
        )}
      </div>

      {/* Priority */}
      <div className="hidden md:flex items-center gap-1.5 w-20 shrink-0">
        <span className={cn('h-2 w-2 rounded-full shrink-0', pri.dot)} />
        <span className={cn('text-xs font-medium capitalize', pri.text)}>{task.priority}</span>
      </div>

      {/* Status */}
      <div className="hidden lg:block w-28 shrink-0">
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold', stCfg.pill)}>
          {stCfg.icon}
          {stCfg.label}
        </span>
      </div>

      {/* Deadline */}
      <div className="hidden md:block w-28 shrink-0 text-right">
        {task.deadline ? (
          <span className={cn('flex items-center justify-end gap-1 text-xs font-medium', overdue ? 'text-danger' : 'text-surface-500')}>
            {overdue && <AlertTriangle className="h-3 w-3 shrink-0" />}
            <Clock className="h-3 w-3 shrink-0" />
            {formatDateTime(task.deadline)}
          </span>
        ) : (
          <span className="text-xs text-surface-400">—</span>
        )}
      </div>

      {/* Edit via TaskCard — rendered invisible, triggered by wrapper */}
      {canEdit && (
        <div className="shrink-0">
          <TaskCard task={task} canEdit={canEdit} canDelete={canDelete} employees={employees} listMode />
        </div>
      )}
    </div>
  );
}

export default function TaskKanban({ tasks, userId, userRole, employees }: TaskKanbanProps) {
  const router = useRouter();
  const [search,         setSearch]         = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [creatorFilter,  setCreatorFilter]  = useState('');
  const [statusFilter,   setStatusFilter]   = useState('');
  const [deadlineFilter, setDeadlineFilter] = useState('');
  const [view,           setView]           = useState<ViewMode>('list');
  const [localTasks,     setLocalTasks]     = useState(tasks);

  // Sync when server re-fetches new task data
  useEffect(() => { setLocalTasks(tasks); }, [tasks]);

  // Immediately move a task to its new status section, then server-sync
  function updateTaskStatus(taskId: string, newStatus: string) {
    setLocalTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    router.refresh();
  }

  const canEdit = (_t: Task) => true;
  const canDelete = userRole !== 'employee';

  const now = new Date();
  const overdueCount = localTasks.filter(t =>
    t.deadline && t.status !== 'done' && t.status !== 'cancelled' && deadlineToUTCDate(t.deadline) < now
  ).length;

  const filtered = useMemo(() => {
    let r = localTasks;
    if (search)         r = r.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
    if (priorityFilter) r = r.filter(t => t.priority === priorityFilter);
    if (assigneeFilter) r = r.filter(t => t.assignee?.id === assigneeFilter);
    if (creatorFilter)  r = r.filter(t => t.creator?.id === creatorFilter);
    if (statusFilter)   r = r.filter(t => t.status === statusFilter);
    if (deadlineFilter) r = r.filter(t => matchesDeadlinePreset(t, deadlineFilter, now));
    return r;
  }, [localTasks, search, priorityFilter, assigneeFilter, creatorFilter, statusFilter, deadlineFilter, now]);

  const byStatus = (s: TaskStatus) => filtered.filter(t => t.status === s);
  const total    = localTasks.length;
  const active   = filtered.length;

  const hasFilter = !!(assigneeFilter || priorityFilter || creatorFilter || statusFilter || deadlineFilter || search);

  return (
    <div className="space-y-4">

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {COLUMNS.map(col => {
          const count = localTasks.filter(t => t.status === col.id).length;
          const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
          const Icon  = STAT_ICONS[col.id];
          return (
            <div
              key={col.id}
              className={cn(
                'relative rounded-2xl border border-surface-300/40 border-t-2 p-4 transition-all',
                'bg-surface-200/40 hover:bg-surface-200/70',
                col.accent
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', col.bg)}>
                  <Icon className={cn('h-5 w-5', col.iconColor)} />
                </span>
                <span className="text-xs font-semibold text-surface-500 tabular-nums">{pct}%</span>
              </div>
              <p className="text-3xl font-bold text-surface-900 leading-none tabular-nums">{count}</p>
              <p className={cn('text-xs font-semibold mt-1.5 uppercase tracking-wide', col.color)}>{col.label}</p>
              <div className="mt-3 h-1 w-full rounded-full bg-surface-300/50 overflow-hidden">
                <div
                  className={cn('h-1 rounded-full transition-all duration-500', col.dot)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-danger/10 border border-danger/25 text-danger text-xs font-medium animate-[fadeUp_0.2s_ease-out]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {overdueCount} task{overdueCount !== 1 ? 's are' : ' is'} overdue
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {hasFilter && (
            <button
              onClick={() => {
                setAssigneeFilter(''); setPriorityFilter(''); setCreatorFilter('');
                setStatusFilter(''); setDeadlineFilter(''); setSearch('');
              }}
              className="text-2xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Clear all
            </button>
          )}
          <span className="text-xs text-surface-600">
            {active !== total ? `${active} of ${total}` : `${total}`} tasks
          </span>

          {/* View toggle */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-surface-200/60 border border-surface-300/50">
            <button
              type="button"
              onClick={() => setView('list')}
              title="List view"
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                view === 'list'
                  ? 'bg-surface-100 text-surface-900 shadow-sm border border-surface-300/50'
                  : 'text-surface-500 hover:text-surface-700'
              )}
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">List</span>
            </button>
            <button
              type="button"
              onClick={() => setView('kanban')}
              title="Kanban view"
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                view === 'kanban'
                  ? 'bg-surface-100 text-surface-900 shadow-sm border border-surface-300/50'
                  : 'text-surface-500 hover:text-surface-700'
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Kanban</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Kanban board ── */}
      {view === 'kanban' && (
        <div className="kanban-board">
          {COLUMNS.map(col => {
            const cards = byStatus(col.id);
            return (
              <div key={col.id} className="kanban-col">
                <div className="kanban-col-header">
                  <span className={cn('h-2 w-2 rounded-full shrink-0', col.dot)} />
                  <span className={cn('text-xs font-semibold', col.color)}>{col.label}</span>
                  <span className={cn(
                    'flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-2xs font-bold ml-auto',
                    cards.length > 0 ? 'bg-surface-300 text-surface-700' : 'bg-surface-200/60 text-surface-500'
                  )}>
                    {cards.length}
                  </span>
                </div>
                <div className="kanban-col-body">
                  {cards.length === 0 ? (
                    <div className="flex items-center justify-center flex-1 min-h-[80px] rounded-xl border border-dashed border-surface-300/40 text-2xs text-surface-500">
                      No tasks
                    </div>
                  ) : cards.map(task => (
                    <TaskCard key={task.id} task={task} canEdit={canEdit(task)} canDelete={canDelete} employees={employees} onStatusChange={updateTaskStatus} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── List view ── */}
      {view === 'list' && (
        <div className="rounded-2xl border border-surface-300/50 bg-surface-100 overflow-hidden shadow-sm">
          {/* List header — column titles double as inline filter controls */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-200/60 border-b border-surface-300/50">
            <div className="w-5 shrink-0" />
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Task"
                className={cn(
                  'w-full bg-transparent text-2xs font-semibold uppercase tracking-wider focus:outline-none',
                  'placeholder:text-surface-500 placeholder:normal-case',
                  search ? 'text-brand-400' : 'text-surface-500'
                )}
              />
            </div>
            <div className="hidden sm:block w-32 shrink-0">
              <select
                value={assigneeFilter}
                onChange={e => setAssigneeFilter(e.target.value)}
                className={cn(
                  'w-full bg-transparent text-2xs font-semibold uppercase tracking-wider focus:outline-none cursor-pointer',
                  assigneeFilter ? 'text-brand-400' : 'text-surface-500'
                )}
              >
                <option value="" className="normal-case bg-surface-100 text-surface-900">Assigned To</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id} className="normal-case bg-surface-100 text-surface-900">{e.full_name}</option>
                ))}
              </select>
            </div>
            <div className="hidden md:block w-32 shrink-0">
              <select
                value={creatorFilter}
                onChange={e => setCreatorFilter(e.target.value)}
                className={cn(
                  'w-full bg-transparent text-2xs font-semibold uppercase tracking-wider focus:outline-none cursor-pointer',
                  creatorFilter ? 'text-brand-400' : 'text-surface-500'
                )}
              >
                <option value="" className="normal-case bg-surface-100 text-surface-900">Assigned By</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id} className="normal-case bg-surface-100 text-surface-900">{e.full_name}</option>
                ))}
              </select>
            </div>
            <div className="hidden md:block w-20 shrink-0">
              <select
                value={priorityFilter}
                onChange={e => setPriorityFilter(e.target.value)}
                className={cn(
                  'w-full bg-transparent text-2xs font-semibold uppercase tracking-wider focus:outline-none cursor-pointer',
                  priorityFilter ? 'text-brand-400' : 'text-surface-500'
                )}
              >
                <option value="" className="normal-case bg-surface-100 text-surface-900">Priority</option>
                {PRIORITIES.filter(Boolean).map(p => (
                  <option key={p} value={p} className="normal-case bg-surface-100 text-surface-900">{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="hidden lg:block w-28 shrink-0">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className={cn(
                  'w-full bg-transparent text-2xs font-semibold uppercase tracking-wider focus:outline-none cursor-pointer',
                  statusFilter ? 'text-brand-400' : 'text-surface-500'
                )}
              >
                <option value="" className="normal-case bg-surface-100 text-surface-900">Status</option>
                {STATUSES.filter(s => s.id).map(s => (
                  <option key={s.id} value={s.id} className="normal-case bg-surface-100 text-surface-900">{s.label}</option>
                ))}
              </select>
            </div>
            <div className="hidden md:block w-28 shrink-0">
              <select
                value={deadlineFilter}
                onChange={e => setDeadlineFilter(e.target.value)}
                className={cn(
                  'w-full bg-transparent text-2xs font-semibold uppercase tracking-wider text-right focus:outline-none cursor-pointer',
                  deadlineFilter ? 'text-brand-400' : 'text-surface-500'
                )}
              >
                <option value="" className="normal-case bg-surface-100 text-surface-900">Deadline</option>
                {DEADLINE_PRESETS.filter(d => d.id).map(d => (
                  <option key={d.id} value={d.id} className="normal-case bg-surface-100 text-surface-900">{d.label}</option>
                ))}
              </select>
            </div>
            <div className="w-8 shrink-0" />
          </div>

          {/* Group by status */}
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-surface-500">No tasks match your filters.</div>
          ) : (
            COLUMNS.map(col => {
              const rows = byStatus(col.id);
              if (rows.length === 0) return null;
              return (
                <div key={col.id}>
                  {/* Group header */}
                  <div className={cn('flex items-center gap-2 px-4 py-2 border-b border-surface-300/40', col.bg)}>
                    <span className={cn('h-2 w-2 rounded-full', col.dot)} />
                    <span className={cn('text-xs font-semibold', col.color)}>{col.label}</span>
                    <span className="text-2xs text-surface-500 ml-1">({rows.length})</span>
                  </div>
                  {/* Rows */}
                  {rows.map(task => (
                    <ListRow
                      key={task.id}
                      task={task}
                      canEdit={canEdit(task)}
                      canDelete={canDelete}
                      employees={employees}
                      onStatusChange={updateTaskStatus}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
