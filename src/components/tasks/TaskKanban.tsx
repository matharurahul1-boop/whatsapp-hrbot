'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, SlidersHorizontal, X, ChevronDown, Users, Check,
  LayoutGrid, List, Clock, AlertTriangle, CheckCircle2,
  Circle, PlayCircle, XCircle, MoreHorizontal, Loader2,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function EmployeeDropdown({
  employees, value, onChange,
}: { employees: Employee[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = employees.find(e => e.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 h-9 px-3 rounded-xl border text-xs font-medium transition-all',
          'bg-surface-200/60 border-surface-300/50 text-surface-700 hover:bg-surface-300/60 hover:text-surface-900',
          open && 'bg-surface-300/60 border-surface-400/50',
          value && 'border-brand-500/40 bg-brand-500/10 text-brand-400'
        )}
      >
        {selected ? (
          <>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/20 text-2xs font-bold text-brand-400 shrink-0">
              {initials(selected.full_name)}
            </span>
            <span className="max-w-[100px] truncate">{selected.full_name}</span>
          </>
        ) : (
          <>
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>All Employees</span>
          </>
        )}
        <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-52 rounded-xl border border-surface-300/50 bg-surface-100 shadow-xl shadow-black/30 overflow-hidden animate-[fadeUp_0.15s_ease-out]">
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors',
                !value ? 'bg-brand-500/10 text-brand-400' : 'text-surface-700 hover:bg-surface-200/60 hover:text-surface-900'
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-300/60 shrink-0">
                <Users className="h-3 w-3" />
              </span>
              <span className="flex-1 text-left">All Employees</span>
              {!value && <Check className="h-3 w-3 shrink-0" />}
            </button>
            <div className="mx-3 my-1 border-t border-surface-300/30" />
            {employees.map(emp => (
              <button
                key={emp.id}
                type="button"
                onClick={() => { onChange(emp.id); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors',
                  value === emp.id ? 'bg-brand-500/10 text-brand-400' : 'text-surface-700 hover:bg-surface-200/60 hover:text-surface-900'
                )}
              >
                <span className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-2xs font-bold shrink-0',
                  value === emp.id ? 'bg-brand-500/20 text-brand-400' : 'bg-surface-300/80 text-surface-600'
                )}>
                  {initials(emp.full_name)}
                </span>
                <span className="flex-1 text-left truncate">{emp.full_name}</span>
                {value === emp.id && <Check className="h-3 w-3 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
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
            {formatDateTime(task.deadline)} IST
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
  const [showFilters,    setShowFilters]    = useState(false);
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
    return r;
  }, [localTasks, search, priorityFilter, assigneeFilter]);

  const byStatus = (s: TaskStatus) => filtered.filter(t => t.status === s);
  const total    = localTasks.length;
  const active   = filtered.length;

  const hasFilter = !!(assigneeFilter || priorityFilter || search);

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
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        {/* Search — full width on mobile so placeholder is visible */}
        <div className="basis-full sm:basis-auto sm:flex-1 sm:min-w-[160px] sm:max-w-xs">
          <Input
            placeholder="Search tasks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            leftIcon={<Search className="h-3.5 w-3.5" />}
            rightIcon={search ? (
              <button type="button" onClick={() => setSearch('')} className="text-surface-500 hover:text-surface-900 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : undefined}
          />
        </div>

        {/* Employee dropdown — managers only */}
        {employees.length > 0 && (
          <EmployeeDropdown employees={employees} value={assigneeFilter} onChange={setAssigneeFilter} />
        )}

        <Button
          variant="secondary"
          size="md"
          leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          onClick={() => setShowFilters(f => !f)}
        >
          Filter
          {priorityFilter && <Badge variant="brand" className="ml-1 h-4 px-1.5 text-2xs">{priorityFilter}</Badge>}
        </Button>

        {/* Count + clear + view toggle */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {hasFilter && (
            <button
              onClick={() => { setAssigneeFilter(''); setPriorityFilter(''); setSearch(''); }}
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

      {/* ── Filter bar ── */}
      {showFilters && (
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-surface-200/40 border border-surface-300/50 animate-[fadeUp_0.2s_ease-out]">
          <span className="text-xs text-surface-600 font-semibold">Priority:</span>
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                priorityFilter === p
                  ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
                  : 'bg-surface-200 text-surface-700 hover:bg-surface-300 border border-transparent'
              )}
            >
              {p ? p.charAt(0).toUpperCase() + p.slice(1) : 'All'}
            </button>
          ))}
        </div>
      )}

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
          {/* List header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-200/60 border-b border-surface-300/50">
            <div className="w-5 shrink-0" />
            <div className="flex-1 text-2xs font-semibold text-surface-500 uppercase tracking-wider">Task</div>
            <div className="hidden sm:block  w-32 shrink-0 text-2xs font-semibold text-surface-500 uppercase tracking-wider">Assigned To</div>
            <div className="hidden md:block  w-32 shrink-0 text-2xs font-semibold text-surface-500 uppercase tracking-wider">Assigned By</div>
            <div className="hidden md:block  w-20 shrink-0 text-2xs font-semibold text-surface-500 uppercase tracking-wider">Priority</div>
            <div className="hidden lg:block  w-28 shrink-0 text-2xs font-semibold text-surface-500 uppercase tracking-wider">Status</div>
            <div className="hidden md:block  w-28 shrink-0 text-2xs font-semibold text-surface-500 uppercase tracking-wider text-right">Deadline</div>
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
