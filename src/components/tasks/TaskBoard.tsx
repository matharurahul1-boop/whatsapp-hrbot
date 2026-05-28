'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/date';
import type { TaskStatus, TaskPriority } from '@/types/database.types';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  source: string;
  assigned_to: { full_name: string; avatar_url: string | null } | null;
  assigned_by: { full_name: string } | null;
}

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: 'pending',     label: 'Pending',     color: 'bg-yellow-50 border-yellow-200' },
  { key: 'in_progress', label: 'In Progress', color: 'bg-blue-50 border-blue-200' },
  { key: 'completed',   label: 'Completed',   color: 'bg-green-50 border-green-200' },
];

const priorityColors: Record<TaskPriority, string> = {
  low:    'badge-slate',
  medium: 'badge-blue',
  high:   'badge-yellow',
  urgent: 'badge-red',
};

export default function TaskBoard({
  initialTasks,
  orgId,
  userId,
  role,
}: {
  initialTasks: Task[];
  orgId: string;
  userId: string;
  role: string;
}) {
  const [tasks] = useState(initialTasks);
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');

  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'pending', 'in_progress', 'completed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium transition-colors',
              filter === f
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ')}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-400 self-center">{filtered.length} tasks</span>
      </div>

      {/* Task list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-slate-400">No tasks found</p>
            <p className="text-slate-300 text-sm mt-1">Send a WhatsApp message to create tasks via AI</p>
          </div>
        ) : (
          filtered.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';

  return (
    <div className="card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn('badge', priorityColors[task.priority])}>{task.priority}</span>
            {task.source === 'whatsapp' && (
              <span className="badge badge-green text-xs">via WhatsApp</span>
            )}
          </div>
          <h3 className="font-semibold text-slate-900 truncate">{task.title}</h3>
          {task.description && (
            <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{task.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            {task.assigned_to && (
              <span>Assigned to: <strong className="text-slate-600">{task.assigned_to.full_name}</strong></span>
            )}
            {task.due_date && (
              <span className={isOverdue ? 'text-red-500 font-medium' : ''}>
                Due: {formatDate(task.due_date)}
              </span>
            )}
          </div>
        </div>

        <StatusBadge status={task.status} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, string> = {
    pending:     'badge-yellow',
    in_progress: 'badge-blue',
    completed:   'badge-green',
    cancelled:   'badge-slate',
  };
  return <span className={cn('badge whitespace-nowrap', map[status])}>{status.replace('_', ' ')}</span>;
}
