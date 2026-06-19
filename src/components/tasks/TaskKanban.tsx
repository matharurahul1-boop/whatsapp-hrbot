'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
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
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/date';

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
type ViewMode   = 'kanban' | 'list';

const COLUMNS: { id: TaskStatus; label: string; color: string; dot: string; bg: string }[] = [
  { id: 'todo',        label: 'To Do',       color: 'text-surface-700', dot: 'bg-surface-500', bg: 'bg-surface-300/40'  },
  { id: 'in_progress', label: 'In Progress',  color: 'text-info',        dot: 'bg-info',        bg: 'bg-info/10'         },
  { id: 'done',        label: 'Done',         color: 'text-success',     dot: 'bg-success',     bg: 'bg-success/10'      },
  { id: 'cancelled',   label: 'Cancelled',    color: 'text-danger',      dot: 'bg-danger',      bg: 'bg-danger/10'       },
];

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
  assignee:    { id: string; full_name: string; avatar_url: string | null } | null;
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
  task, canEdit, employees, onRefresh,
}: { task: Task; canEdit: boolean; employees: Employee[]; onRefresh: () => void }) {
  const [status,   setStatus]   = useState<TaskStatus>(task.status as TaskStatus);
  const [updating, setUpdating] = useState(false);

  const overdue = task.deadline && status !== 'done' && status !== 'cancelled' && new Date(task.deadline) < new Date();
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
    setUpdating(false);
    onRefresh();
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
        <p className={cn(
          'text-sm font-medium text-surface-900 truncate',
          (status === 'done' || status === 'cancelled') && 'line-through text-surface-500 opacity-70'
        )}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-surface-500 truncate mt-0.5">{task.description}</p>
        )}
      </div>

      {/* Assignee */}
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
            {formatDate(task.deadline)}
          </span>
        ) : (
          <span className="text-xs text-surface-400">—</span>
        )}
      </div>

      {/* Edit via TaskCard — rendered invisible, triggered by wrapper */}
      {canEdit && (
        <div className="shrink-0">
          <TaskCard task={task} canEdit={canEdit} employees={employees} listMode />
        </div>
      )}
    </div>
  );
}

export default function TaskKanban({ tasks, userId, userRole, employees }: TaskKanbanProps) {
  const [search,         setSearch]         = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [showFilters,    setShowFilters]    = useState(false);
  const [view,           setView]           = useState<ViewMode>('kanban');
  const [, forceRefresh] = useState(0);

  const isManager = ['super_admin', 'admin', 'hr', 'manager'].includes(userRole);

  const canEdit = (t: Task) =>
    ['super_admin','admin','hr','manager'].includes(userRole) ||
    t.assignee?.id === userId ||
    t.created_by === userId;

  const now = new Date();
  const overdueCount = tasks.filter(t =>
    t.deadline && t.status !== 'done' && t.status !== 'cancelled' && new Date(t.deadline) < now
  ).length;

  const filtered = useMemo(() => {
    let r = tasks;
    if (search)         r = r.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
    if (priorityFilter) r = r.filter(t => t.priority === priorityFilter);
    if (assigneeFilter) r = r.filter(t => t.assignee?.id === assigneeFilter);
    return r;
  }, [tasks, search, priorityFilter, assigneeFilter]);

  const byStatus = (s: TaskStatus) => filtered.filter(t => t.status === s);
  const total    = tasks.length;
  const active   = filtered.length;

  const hasFilter = !!(assigneeFilter || priorityFilter || search);

  return (
    <div className="space-y-4">

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {COLUMNS.map(col => {
          const count = tasks.filter(t => t.status === col.id).length;
          return (
            <button
              key={col.id}
              type="button"
              onClick={() => {
                // clicking a stat chip filters by that status — no dedicated filter yet, show in kanban
              }}
              className={cn(
                'flex items-center gap-3 p-3 rounded-2xl border transition-all text-left',
                'bg-surface-200/40 border-surface-300/40 hover:border-surface-400/60 hover:bg-surface-200/70'
              )}
            >
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl shrink-0', col.bg)}>
                <span className={cn('h-2.5 w-2.5 rounded-full', col.dot)} />
              </span>
              <div>
                <p className="text-xl font-bold text-surface-900 leading-none">{count}</p>
                <p className={cn('text-xs font-medium mt-0.5', col.color)}>{col.label}</p>
              </div>
            </button>
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
        {/* Search */}
        <div className="flex-1 min-w-[180px] max-w-xs">
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
        {isManager && employees.length > 0 && (
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
                    <TaskCard key={task.id} task={task} canEdit={canEdit(task)} employees={employees} />
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
            <div className="hidden sm:block  w-32 shrink-0 text-2xs font-semibold text-surface-500 uppercase tracking-wider">Assignee</div>
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
                      employees={employees}
                      onRefresh={() => forceRefresh(n => n + 1)}
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
