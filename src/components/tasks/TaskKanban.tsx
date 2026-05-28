'use client';

import { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
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

interface TaskKanbanProps {
  tasks:    Task[];
  userId:   string;
  userRole: string;
}

const PRIORITIES = ['', 'urgent', 'high', 'medium', 'low'];

export default function TaskKanban({ tasks, userId, userRole }: TaskKanbanProps) {
  const [search,         setSearch]         = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showFilters,    setShowFilters]    = useState(false);

  const canEdit = (t: Task) =>
    ['super_admin','admin','hr','manager'].includes(userRole) ||
    t.assignee?.id === userId ||
    t.created_by === userId;

  const filtered = useMemo(() => {
    let r = tasks;
    if (search)         r = r.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
    if (priorityFilter) r = r.filter(t => t.priority === priorityFilter);
    return r;
  }, [tasks, search, priorityFilter]);

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

        <Button
          variant="secondary"
          size="md"
          leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          onClick={() => setShowFilters(f => !f)}
        >
          Filter
          {priorityFilter && <Badge variant="brand" className="ml-1 h-4 px-1.5 text-2xs">{priorityFilter}</Badge>}
        </Button>

        {/* Count */}
        <span className="ml-auto text-xs text-surface-600 shrink-0">
          {active !== total ? `${active} of ${total}` : `${total}`} tasks
        </span>
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
                  <TaskCard key={task.id} task={task} canEdit={canEdit(task)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
