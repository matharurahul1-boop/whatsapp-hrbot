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

interface LeaveType {
  id:   string;
  name: string;
}

interface ApplyLeaveModalProps {
  leaveTypes: LeaveType[];
}

export default function ApplyLeaveModal({ leaveTypes }: ApplyLeaveModalProps) {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [form, setForm] = useState({
    leave_type_id: '',
    start_date:    '',
    end_date:      '',
    reason:        '',
  });

  const duration = form.start_date && form.end_date
    ? Math.max(0,
        Math.round(
          (new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / 86_400_000
        ) + 1
      )
    : null;

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.leave_type_id) { setError('Please select a leave type'); return; }
    if (!form.start_date)    { setError('Please select a start date'); return; }
    if (!form.end_date)      { setError('Please select an end date'); return; }
    if (form.end_date < form.start_date) { setError('End date must be after start date'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/leave', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to apply for leave'); return; }

      setOpen(false);
      setForm({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
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
        Apply for Leave
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Apply for Leave</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              {error && (
                <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>
              )}

              <SelectNative
                label="Leave Type *"
                value={form.leave_type_id}
                onChange={e => set('leave_type_id', e.target.value)}
              >
                <option value="">Select type…</option>
                {leaveTypes.map(lt => (
                  <option key={lt.id} value={lt.id}>{lt.name}</option>
                ))}
              </SelectNative>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Start Date *"
                  type="date"
                  value={form.start_date}
                  onChange={e => set('start_date', e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
                <Input
                  label="End Date *"
                  type="date"
                  value={form.end_date}
                  onChange={e => set('end_date', e.target.value)}
                  min={form.start_date || new Date().toISOString().split('T')[0]}
                />
              </div>

              {duration !== null && duration > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-brand-500/10 border border-brand-500/20 px-3 py-2">
                  <span className="text-sm text-brand-400 font-medium">
                    {duration} day{duration !== 1 ? 's' : ''} of leave
                  </span>
                </div>
              )}

              <Textarea
                label="Reason (optional)"
                placeholder="Briefly describe the reason…"
                value={form.reason}
                onChange={e => set('reason', e.target.value)}
                rows={3}
              />
            </DialogBody>

            <DialogFooter>
              <Button variant="ghost" size="md" type="button" onClick={() => setOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button variant="primary" size="md" type="submit" loading={loading}>
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
