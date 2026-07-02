'use client';

import { useState } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, Loader2,
  MessageSquare, User, Calendar, Zap, RefreshCw,
  Bell, BellOff, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface LeaveRequest {
  id:                   string;
  created_at:           string;
  start_date:           string;
  end_date:             string;
  total_days:           number;
  reason:               string | null;
  escalated_manager_at: string | null;
  escalated_admin_at:   string | null;
  user:       { full_name: string; wa_number: string | null; department: string | null } | null;
  leave_type: { name: string; color_hex: string } | null;
  approver:   { full_name: string } | null;
}

interface EscalationResult {
  processed: number;
  actions:   number;
  results:   Array<{ leaveId: string; action: string; success: boolean; error?: string }>;
}

export default function EscalationClient({ initialLeaves }: { initialLeaves: LeaveRequest[] }) {
  const [leaves,   setLeaves]   = useState(initialLeaves);
  const [running,  setRunning]  = useState(false);
  const [result,   setResult]   = useState<EscalationResult | null>(null);
  const [error,    setError]    = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const now = Date.now();
  const HOUR = 3_600_000;

  function ageHours(created: string) {
    return (now - new Date(created).getTime()) / HOUR;
  }

  function getEscalationLevel(l: LeaveRequest) {
    const h = ageHours(l.created_at);
    if (h >= 72) return 'critical';
    if (h >= 48) return 'high';
    if (h >= 24) return 'medium';
    return 'low';
  }

  const LEVEL_CONFIG = {
    critical: { label: 'Critical (72h+)',  color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20'    },
    high:     { label: 'Overdue (48h+)',   color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
    medium:   { label: 'Pending (24h+)',   color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20'  },
    low:      { label: 'Recent (<24h)',    color: 'text-surface-600', bg: 'bg-surface-200',   border: 'border-surface-300'   },
  } as const;

  // Sort by age descending (most urgent first)
  const sorted = [...leaves].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  async function runEscalation() {
    setRunning(true);
    setResult(null);
    setError('');
    try {
      const res  = await fetch('/api/escalate-leaves', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Escalation failed');
      setResult(json);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      // Re-fetch via server reload
      window.location.reload();
    } catch {
      setRefreshing(false);
    }
  }

  const stats = {
    total:    leaves.length,
    critical: leaves.filter(l => ageHours(l.created_at) >= 72).length,
    high:     leaves.filter(l => ageHours(l.created_at) >= 48 && ageHours(l.created_at) < 72).length,
    medium:   leaves.filter(l => ageHours(l.created_at) >= 24 && ageHours(l.created_at) < 48).length,
    low:      leaves.filter(l => ageHours(l.created_at) < 24).length,
  };

  return (
    <div className="space-y-6">
      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-orange-400" />
            Auto Escalation Engine
          </h1>
          <p className="page-subtitle">
            Automatically WhatsApps managers → admins → employees when leave requests go unactioned.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            title="Refresh"
            className="p-1.5 rounded-lg text-surface-500 hover:text-surface-950 hover:bg-surface-200 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </button>
          <button
            onClick={runEscalation}
            disabled={running}
            className="btn btn-primary btn-md"
          >
            {running
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Zap      className="h-4 w-4" />}
            {running ? 'Running…' : 'Run Escalation Now'}
          </button>
        </div>
      </div>

      {/* ── Result / error banner ─────────────────────────────────────── */}
      {result && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-success/10 border border-success/20 text-success">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Escalation complete</p>
            <p className="text-xs mt-0.5 opacity-80">
              Processed {result.processed} pending leaves · {result.actions} WhatsApp messages sent
            </p>
            {result.results.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs opacity-70">
                {result.results.map((r, i) => (
                  <li key={i} className={cn('flex items-center gap-1.5', !r.success && 'text-danger')}>
                    {r.success
                      ? <CheckCircle2 className="h-3 w-3 shrink-0" />
                      : <AlertTriangle className="h-3 w-3 shrink-0" />}
                    {r.action} — {r.success ? 'sent' : r.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Pending',  value: stats.total,    color: 'text-surface-950',  icon: <Clock className="h-4 w-4" /> },
          { label: 'Critical 72h+', value: stats.critical, color: 'text-red-400',       icon: <AlertTriangle className="h-4 w-4" /> },
          { label: 'Overdue 48h+',  value: stats.high,     color: 'text-orange-400',    icon: <Bell          className="h-4 w-4" /> },
          { label: 'Pending 24h+',  value: stats.medium,   color: 'text-amber-400',     icon: <BellOff       className="h-4 w-4" /> },
        ].map(s => (
          <div key={s.label} className="glass-card p-4 flex items-center gap-3">
            <div className={cn('shrink-0', s.color)}>{s.icon}</div>
            <div>
              <p className={cn('text-2xl font-bold leading-none', s.color)}>{s.value}</p>
              <p className="text-xs text-surface-600 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-info" />
          <h3 className="text-sm font-semibold text-surface-950">Escalation Timeline</h3>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-surface-700">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
            <strong>24 h</strong> — WhatsApp reminder sent to the employee's manager (or HR)
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
            <strong>48 h</strong> — WhatsApp escalation sent to the org admin / super admin
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
            <strong>72 h</strong> — Employee notified via WhatsApp to follow up directly
          </div>
        </div>
      </div>

      {/* ── Leave table ─────────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon"><CheckCircle2 className="h-5 w-5 text-success" /></div>
            <p className="empty-state-title">All clear — no pending leaves</p>
            <p className="empty-state-desc">All leave requests have been actioned. Nothing to escalate.</p>
          </div>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-300/40">
            <h2 className="text-sm font-semibold text-surface-950">
              Pending Leave Requests ({sorted.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Leave Type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>Waiting Since</th>
                  <th>Status</th>
                  <th>Manager Notified</th>
                  <th>Admin Notified</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(leave => {
                  const level  = getEscalationLevel(leave);
                  const cfg    = LEVEL_CONFIG[level];
                  const hours  = ageHours(leave.created_at);
                  const hoursStr = hours >= 24
                    ? `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`
                    : `${Math.floor(hours)}h`;

                  return (
                    <tr key={leave.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-300/60 text-surface-700 text-xs font-semibold">
                            {leave.user?.full_name?.charAt(0) ?? '?'}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-surface-950">{leave.user?.full_name ?? '—'}</p>
                            {leave.user?.department && (
                              <p className="text-2xs text-surface-600">{leave.user.department}</p>
                            )}
                            {leave.user?.wa_number
                              ? <p className="text-2xs text-brand-400 flex items-center gap-1"><MessageSquare className="h-2.5 w-2.5" />{leave.user.wa_number}</p>
                              : <p className="text-2xs text-surface-500 italic">No WA number</p>
                            }
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className="badge text-xs"
                          style={{
                            background: (leave.leave_type?.color_hex ?? '#22c55e') + '22',
                            color:      leave.leave_type?.color_hex ?? '#22c55e',
                          }}
                        >
                          {leave.leave_type?.name ?? 'Leave'}
                        </span>
                      </td>
                      <td className="text-xs text-surface-800">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-surface-600" />
                          {leave.start_date}
                        </div>
                        <div className="text-2xs text-surface-600 mt-0.5">to {leave.end_date}</div>
                      </td>
                      <td className="text-sm font-semibold text-surface-950">{leave.total_days}</td>
                      <td>
                        <span className={cn('badge', cfg.bg, cfg.color, cfg.border, 'border text-xs')}>
                          <Clock className="h-3 w-3" />
                          {hoursStr}
                        </span>
                      </td>
                      <td>
                        <span className={cn('badge text-xs', cfg.bg, cfg.color)}>{cfg.label}</span>
                      </td>
                      <td>
                        {leave.escalated_manager_at ? (
                          <span className="badge badge-success text-xs">
                            <CheckCircle2 className="h-3 w-3" />
                            {new Date(leave.escalated_manager_at).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="badge badge-muted text-xs">
                            <BellOff className="h-3 w-3" />
                            Not sent
                          </span>
                        )}
                      </td>
                      <td>
                        {leave.escalated_admin_at ? (
                          <span className="badge badge-success text-xs">
                            <CheckCircle2 className="h-3 w-3" />
                            {new Date(leave.escalated_admin_at).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="badge badge-muted text-xs">
                            <BellOff className="h-3 w-3" />
                            Not sent
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
