'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, SelectNative } from '@/components/ui/Input';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const REMINDER_OPTS = [
  { value: '1_hour',  label: '1 h before'  },
  { value: '2_hours', label: '2 h before'  },
  { value: '4_hours', label: '4 h before'  },
  { value: '1_day',   label: '1 day before' },
] as const;

interface Employee {
  id:        string;
  full_name: string;
}

interface CreateTaskModalProps {
  employees: Employee[];
}

const PRIORITIES = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export default function CreateTaskModal({ employees }: CreateTaskModalProps) {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    title:       '',
    description: '',
    assignee_id: '',
    deadline:    '',
    due_time:    '',
    priority:    'medium',
    reminders:   ['1_hour'] as string[],
  });

  function set(field: string, value: string) {
    if (field === 'deadline') {
      setForm(f => ({
        ...f,
        deadline: value,
        due_time: value ? (f.due_time || '17:00') : '',
      }));
    } else {
      setForm(f => ({ ...f, [field]: value }));
    }
    setErrors(e => ({ ...e, [field]: '' }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Title is required';
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        title:     form.title.trim(),
        priority:  form.priority,
        reminders: form.reminders,
      };
      if (form.description) body.description = form.description;
      if (form.assignee_id) body.assignee_id = form.assignee_id;
      if (form.deadline) {
        body.deadline = form.deadline;
        if (form.due_time) body.due_time = form.due_time;
      }

      const res = await fetch('/api/tasks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrors({ _global: data.error ?? 'Failed to create task' });
        return;
      }

      setOpen(false);
      setForm({ title: '', description: '', assignee_id: '', deadline: '', due_time: '', priority: 'medium', reminders: ['1_hour'] });
      setErrors({});
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        size="md"
        leftIcon={<Plus className="h-4 w-4" />}
        onClick={() => setOpen(true)}
      >
        New Task
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <DialogBody className="space-y-4">
              {errors._global && (
                <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{errors._global}</p>
              )}

              <Input
                label="Title *"
                placeholder="e.g. Review Q4 report"
                value={form.title}
                onChange={e => set('title', e.target.value)}
                error={errors.title}
                autoFocus
              />

              <Textarea
                label="Description"
                placeholder="Optional details…"
                value={form.description}
                onChange={e => set('description', e.target.value)}
                rows={3}
              />

              <div className="grid grid-cols-2 gap-4">
                <SelectNative
                  label="Assign to"
                  value={form.assignee_id}
                  onChange={e => set('assignee_id', e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                  ))}
                </SelectNative>

                <SelectNative
                  label="Priority"
                  value={form.priority}
                  onChange={e => set('priority', e.target.value)}
                  options={PRIORITIES}
                />
              </div>

              <Input
                label="Deadline"
                type="date"
                value={form.deadline}
                onChange={e => set('deadline', e.target.value)}
              />
              {form.deadline && (
                <Input
                  label="Due Time"
                  type="time"
                  value={form.due_time}
                  onChange={e => set('due_time', e.target.value)}
                />
              )}

              <div>
                <label className="block text-xs font-medium text-surface-700 mb-1.5">
                  Reminders <span className="text-surface-400 font-normal">(select one or more)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_OPTS.map(opt => {
                    const active = form.reminders.includes(opt.value);
                    return (
                      <button key={opt.value} type="button"
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
                      >{opt.label}</button>
                    );
                  })}
                </div>
                {form.deadline && form.reminders.length > 0 && (
                  <p className="text-[11px] text-surface-400 mt-1.5">
                    Sent via your channel preference in Settings → Notifications
                  </p>
                )}
              </div>
            </DialogBody>

            <DialogFooter>
              <Button variant="ghost" size="md" type="button" onClick={() => setOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button variant="primary" size="md" type="submit" loading={loading}>
                Create Task
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
