'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, SlidersHorizontal, X, ChevronDown, Users, Check } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import TaskCard from './TaskCard';
import { cn } from '@/lib/utils/cn';

type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

const COLUMNS: { id: TaskStatus; label: string; color: string; dot: string }[] = [
  { id: 'todo',        label: 'To Do',       color: 'text-surface-700', dot: 'bg-surface-500'  },
  { id: 'in_progress', label: 'In Progress',  color: 'text-info',        dot: 'bg-info'         },
  { id: 'done',        label: 'Done',         color: 'text-success',     dot: 'bg-success'      },
  { id: 'cancelled',   label: 'Cancelled',    color: 'text-danger',      dot: 'bg-danger'       },
];

interface Task {
  id:          string;
  title:       string;
  status:      string;
  priority:    string;
  deadline:    string | null;
  description: string | null;
  assignee: { id: string; full_name: string; avatar_url: string | null; } | null;
  created_by: string;
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
            {/* All employees option */}
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

            {/* Divider */}
            <div className="mx-3 my-1 border-t border-surface-300/30" />

            {/* Employee list */}
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

export default function TaskKanban({ tasks, userId, userRole, employees }: TaskKanbanProps) {
  const [search,          setSearch]          = useState('');
  const [priorityFilter,  setPriorityFilter]  = useState('');
  const [assigneeFilter,  setAssigneeFilter]  = useState('');
  const [showFilters,     setShowFilters]     = useState(false);

  const isManager = ['super_admin', 'admin', 'hr', 'manager'].includes(userRole);

  const canEdit = (t: Task) =>
    ['super_admin','admin','hr','manager'].includes(userRole) ||
    t.assignee?.id === userId ||
    t.created_by === userId;

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

  return (
    <div className="space-y-4">
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
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-surface-500 hover:text-surface-900 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : undefined}
          />
        </div>

        {/* Employee dropdown — managers/admins only */}
        {isManager && employees.length > 0 && (
          <EmployeeDropdown
            employees={employees}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
          />
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

        {/* Count + clear filters */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {(assigneeFilter || priorityFilter || search) && (
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
      <div className="kanban-board">
        {COLUMNS.map(col => {
          const cards = byStatus(col.id);
          return (
            <div key={col.id} className="kanban-col">
              {/* Col header */}
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

              {/* Col body */}
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
    </div>
  );
}
