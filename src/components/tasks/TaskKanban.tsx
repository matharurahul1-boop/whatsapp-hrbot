'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  LayoutGrid, List, Clock, AlertTriangle, CheckCircle2,
  Circle, PlayCircle, XCircle, MoreHorizontal, Loader2, ChevronDown, Check, X,
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

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
];
const STATUS_OPTIONS = [
  { value: 'todo',        label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done',        label: 'Done' },
  { value: 'cancelled',   label: 'Cancelled' },
];
const DEADLINE_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today',   label: 'Due Today' },
  { value: 'week',    label: 'Due This Week' },
  { value: 'none',    label: 'No Deadline' },
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

/* ── Multi-select header filter dropdown (Assigned To/By, Priority, Status,
   Deadline) — checkboxes so more than one value can be picked at once. ── */
// Popover height budget used for the auto-flip decision below — matches
// max-h-56 (14rem = 224px) plus a little chrome (padding/shadow room).
const POPOVER_HEIGHT_BUDGET = 240;

function MultiSelectDropdown({
  label, options, selected, onChange, align = 'left',
}: {
  label:    string;
  options:  { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  align?:   'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  // Rendered via a portal (see below) so the popover can never be clipped by
  // the table's `overflow-hidden` — position is computed from the trigger's
  // actual screen coordinates instead of relying on CSS `absolute` inside a
  // clipped ancestor. Flips to open upward when there isn't enough room
  // below (e.g. the table is short or the row is near the bottom).
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null);
  const triggerRef  = useRef<HTMLButtonElement>(null);
  const popoverRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Scrolling (the table body, or the page) would leave a `position:
    // fixed` popover visually detached from its trigger — closing is
    // simpler and safer than tracking every scrollable ancestor.
    function onScrollOrResize() { setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  function handleTriggerClick() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < POPOVER_HEIGHT_BUDGET && rect.top > spaceBelow;
      const horizontal = align === 'right' ? { right: window.innerWidth - rect.right } : { left: rect.left };
      setPos(openUpward
        ? { bottom: window.innerHeight - rect.top + 6, ...horizontal }
        : { top: rect.bottom + 6, ...horizontal });
    }
    setOpen(o => !o);
  }

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  }

  const displayText = selected.length === 0
    ? label
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label ?? label)
      : `${selected.length} selected`;

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold uppercase tracking-wider transition-colors',
          'focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
          selected.length > 0
            ? 'border-brand-500/40 bg-brand-500/10 text-brand-400'
            // surface-600 (not -500) — -500 is the "muted element" shade
            // (~2.4:1 contrast), too low for readable label text; -600 is
            // this codebase's established fix for exactly this (~5.2:1).
            : 'border-surface-300/40 bg-surface-100/60 text-surface-600 hover:border-surface-300/70 hover:text-surface-700'
        )}
      >
        <span className="truncate">{displayText}</span>
        {selected.length > 0 ? (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); onChange([]); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onChange([]); } }}
            className="shrink-0 rounded-full p-0.5 hover:bg-brand-500/20 transition-colors"
            aria-label={`Clear ${label} filter`}
          >
            <X className="h-3 w-3" />
          </span>
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform" />
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', ...pos }}
          className="z-50 w-48 rounded-xl border border-surface-300/50 bg-surface-100 shadow-xl shadow-black/30 overflow-hidden animate-[fadeUp_0.15s_ease-out]"
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map(opt => {
              const checked = selected.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-xs normal-case transition-colors',
                    checked ? 'bg-brand-500/10 text-brand-400' : 'text-surface-700 hover:bg-surface-200/60 hover:text-surface-900'
                  )}
                >
                  <span className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border shrink-0',
                    checked ? 'bg-brand-500 border-brand-500' : 'border-surface-400'
                  )}>
                    {checked && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="flex-1 text-left truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
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
      <div className="flex items-center gap-1.5 w-36 shrink-0">
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
      <div className="flex items-center gap-1.5 w-36 shrink-0">
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
      <div className="flex items-center gap-1.5 w-28 shrink-0">
        <span className={cn('h-2 w-2 rounded-full shrink-0', pri.dot)} />
        <span className={cn('text-xs font-medium capitalize', pri.text)}>{task.priority}</span>
      </div>

      {/* Status */}
      <div className="w-32 shrink-0">
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold', stCfg.pill)}>
          {stCfg.icon}
          {stCfg.label}
        </span>
      </div>

      {/* Deadline */}
      <div className="w-32 shrink-0 text-right">
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
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [creatorFilter,  setCreatorFilter]  = useState<string[]>([]);
  const [statusFilter,   setStatusFilter]   = useState<string[]>([]);
  const [deadlineFilter, setDeadlineFilter] = useState<string[]>([]);
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
    if (search)               r = r.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
    if (priorityFilter.length) r = r.filter(t => priorityFilter.includes(t.priority));
    if (assigneeFilter.length) r = r.filter(t => !!t.assignee && assigneeFilter.includes(t.assignee.id));
    if (creatorFilter.length)  r = r.filter(t => !!t.creator && creatorFilter.includes(t.creator.id));
    if (statusFilter.length)   r = r.filter(t => statusFilter.includes(t.status));
    if (deadlineFilter.length) r = r.filter(t => deadlineFilter.some(preset => matchesDeadlinePreset(t, preset, now)));
    return r;
  }, [localTasks, search, priorityFilter, assigneeFilter, creatorFilter, statusFilter, deadlineFilter, now]);

  const byStatus = (s: TaskStatus) => filtered.filter(t => t.status === s);
  const total    = localTasks.length;
  const active   = filtered.length;

  const hasFilter = !!(assigneeFilter.length || priorityFilter.length || creatorFilter.length || statusFilter.length || deadlineFilter.length || search);

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
                setAssigneeFilter([]); setPriorityFilter([]); setCreatorFilter([]);
                setStatusFilter([]); setDeadlineFilter([]); setSearch('');
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
          {/* All columns always render (no breakpoint-hidden columns) — on
              narrow screens the row content is simply wider than the
              viewport and this wrapper scrolls horizontally instead of
              silently dropping columns. */}
          <div className="overflow-x-auto">
          <div className="min-w-[900px]">
          {/* List header — column titles double as inline filter controls */}
          <div className="flex items-center gap-2 px-4 py-3 bg-surface-200/60 border-b border-surface-300/50">
            <div className="w-5 shrink-0" />
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Task"
                className={cn(
                  // normal-case for the typed value — only the empty-state
                  // placeholder should render uppercase to match the other
                  // column headers; a bare `uppercase` class here would
                  // visually (not just cosmetically) transform whatever the
                  // user types, e.g. "tes" rendering as "TES".
                  'w-full rounded-lg border px-2.5 py-2 text-xs font-semibold normal-case tracking-wider transition-colors',
                  search && 'pr-7',
                  // surface-600 (not -500) — -500 is the "muted element"
                  // shade (~2.4:1 contrast), too low for readable label
                  // text; -600 is this codebase's established fix (~5.2:1).
                  'placeholder:text-surface-600 placeholder:uppercase',
                  // The app-wide :focus-visible rule (globals.css) adds its
                  // own ring + ring-offset on top of any element's own
                  // border, which doubled up with this input's border-color
                  // focus state into a visible outer box. This input already
                  // has its own focus treatment, so cancel the global ring
                  // here instead of fighting it with a border color alone.
                  'focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                  search
                    ? 'border-brand-500/40 bg-brand-500/10 text-brand-400'
                    : 'border-surface-300/40 bg-surface-100/60 text-surface-600 hover:border-surface-300/70 hover:text-surface-700 focus:border-brand-500/40'
                )}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-brand-400 hover:bg-brand-500/20 transition-colors"
                  aria-label="Clear Task filter"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="w-36 shrink-0">
              <MultiSelectDropdown
                label="Assigned To"
                options={employees.map(e => ({ value: e.id, label: e.full_name }))}
                selected={assigneeFilter}
                onChange={setAssigneeFilter}
              />
            </div>
            <div className="w-36 shrink-0">
              <MultiSelectDropdown
                label="Assigned By"
                options={employees.map(e => ({ value: e.id, label: e.full_name }))}
                selected={creatorFilter}
                onChange={setCreatorFilter}
              />
            </div>
            <div className="w-28 shrink-0">
              <MultiSelectDropdown
                label="Priority"
                options={PRIORITY_OPTIONS}
                selected={priorityFilter}
                onChange={setPriorityFilter}
              />
            </div>
            <div className="w-32 shrink-0">
              <MultiSelectDropdown
                label="Status"
                options={STATUS_OPTIONS}
                selected={statusFilter}
                onChange={setStatusFilter}
              />
            </div>
            <div className="w-32 shrink-0">
              <MultiSelectDropdown
                label="Deadline"
                options={DEADLINE_OPTIONS}
                selected={deadlineFilter}
                onChange={setDeadlineFilter}
                align="right"
              />
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
          </div>
        </div>
      )}
    </div>
  );
}
