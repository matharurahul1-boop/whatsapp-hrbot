'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, LogIn, LogOut, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils/cn';

interface CheckInRecord {
  id:             string;
  status:         string;
  check_in_time:  string | null;
  check_out_time: string | null;
  total_hours:    number | null;
}

interface CheckInWidgetProps {
  todayRecord: CheckInRecord | null;
  firstName:   string;
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function CheckInWidget({ todayRecord, firstName }: CheckInWidgetProps) {
  const router  = useRouter();
  const now     = useNow();
  const [loading, setLoading] = useState(false);
  const [record, setRecord]   = useState<CheckInRecord | null>(todayRecord);

  const checkedIn  = !!record?.check_in_time;
  const checkedOut = !!record?.check_out_time;

  // Live elapsed time since check-in
  const elapsed = checkedIn && !checkedOut && record?.check_in_time
    ? Math.floor((now.getTime() - new Date(record.check_in_time).getTime()) / 60000)
    : null;

  async function handleCheckIn() {
    setLoading(true);
    try {
      const res  = await fetch('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json();
      if (res.ok) { setRecord(json.data); router.refresh(); }
    } finally { setLoading(false); }
  }

  async function handleCheckOut() {
    setLoading(true);
    try {
      const res  = await fetch('/api/attendance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json();
      if (res.ok) { setRecord(json.data); router.refresh(); }
    } finally { setLoading(false); }
  }

  return (
    <Card className={cn(
      'relative overflow-hidden',
      checkedIn && !checkedOut && 'border-brand-500/20 border-glow'
    )}>
      {/* Glow bg when active */}
      {checkedIn && !checkedOut && (
        <div className="absolute inset-0 bg-brand-gradient opacity-[0.03] pointer-events-none" />
      )}

      <div className="flex items-start justify-between gap-4 relative">
        <div>
          <p className="text-xs font-semibold text-surface-600 uppercase tracking-wider">Today&apos;s Attendance</p>
          <p className="text-sm text-surface-950 mt-1">
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>

          <div className="flex items-baseline gap-3 mt-3">
            <span className="text-3xl font-bold tabular text-surface-950">
              {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          {/* Status row */}
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-surface-600">
            <span className="flex items-center gap-1.5">
              <LogIn className="h-3.5 w-3.5" />
              In: <strong className="text-surface-900">{formatTime(record?.check_in_time ?? null)}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              Out: <strong className="text-surface-900">{formatTime(record?.check_out_time ?? null)}</strong>
            </span>
            {record?.total_hours && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <strong className="text-surface-900">{record.total_hours}h</strong>
              </span>
            )}
          </div>

          {elapsed !== null && (
            <p className="text-xs text-brand-400 mt-1.5">
              Working for {Math.floor(elapsed / 60)}h {elapsed % 60}m
            </p>
          )}
        </div>

        {/* Action button */}
        <div className="shrink-0">
          {checkedOut ? (
            <div className="flex flex-col items-center gap-1">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <span className="text-2xs text-success font-medium">Done</span>
            </div>
          ) : checkedIn ? (
            <Button variant="secondary" size="md" loading={loading} onClick={handleCheckOut} leftIcon={<LogOut className="h-4 w-4" />}>
              Check Out
            </Button>
          ) : (
            <Button variant="primary" size="md" loading={loading} onClick={handleCheckIn} leftIcon={<LogIn className="h-4 w-4" />}>
              Check In
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
