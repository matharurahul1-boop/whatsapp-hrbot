'use client';

import { useState, useCallback, useTransition } from 'react';
import {
  MessageSquare, ArrowDownLeft, ArrowUpRight,
  CheckCheck, Clock, XCircle, Search, RefreshCw,
  Filter, X, AlertTriangle,
} from 'lucide-react';
import { Avatar }                 from '@/components/ui/Avatar';
import { Badge }                  from '@/components/ui/Badge';
import { Button }                 from '@/components/ui/Button';
import { Input }                  from '@/components/ui/Input';
import { formatDateTime }         from '@/lib/utils/date';
import { cn }                     from '@/lib/utils/cn';

// ── Types ─────────────────────────────────────────────────────────────────

interface WaLog {
  id:              string;
  wa_number:       string;
  contact_name:    string | null;
  direction:       'incoming' | 'outgoing';
  message_type:    string;
  message_text:    string | null;
  delivery_status: string;
  wa_timestamp:    string | null;
  created_at:      string;
  user: {
    id:         string;
    full_name:  string;
    avatar_url: string | null;
    department: string | null;
  } | null;
}

interface Stats {
  total_messages: number;
  incoming_count: number;
  outgoing_count: number;
  unique_numbers: number;
  failed_count:   number;
  today_messages: number;
}

interface Props {
  initialLogs: WaLog[];
  totalCount:  number;
  stats:       Stats | null;
  orgId:       string;
}

// ── Status config ─────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  received:  { label: 'Received',  color: 'bg-success/10  text-success',  icon: <CheckCheck className="h-3 w-3" /> },
  sent:      { label: 'Sent',      color: 'bg-info/10     text-info',     icon: <CheckCheck className="h-3 w-3" /> },
  delivered: { label: 'Delivered', color: 'bg-brand-500/10 text-brand-400', icon: <CheckCheck className="h-3 w-3" /> },
  read:      { label: 'Read',      color: 'bg-violet-500/10 text-violet-400', icon: <CheckCheck className="h-3 w-3" /> },
  failed:    { label: 'Failed',    color: 'bg-danger/10   text-danger',   icon: <XCircle    className="h-3 w-3" /> },
  pending:   { label: 'Pending',   color: 'bg-warning/10  text-warning',  icon: <Clock      className="h-3 w-3" /> },
};

// ── Main component ────────────────────────────────────────────────────────

export default function WALogsClient({ initialLogs, totalCount, stats, orgId }: Props) {
  const [logs,       setLogs]       = useState<WaLog[]>(initialLogs);
  const [count,      setCount]      = useState(totalCount);
  const [offset,     setOffset]     = useState(0);
  const [direction,  setDirection]  = useState('all');
  const [status,     setStatus]     = useState('all');
  const [search,     setSearch]     = useState('');
  const [waFilter,   setWaFilter]   = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [isPending,  startTransition] = useTransition();

  const LIMIT = 50;

  // ── Fetch logs ────────────────────────────────────────────
  const fetchLogs = useCallback(async (params: {
    offsetVal?:   number;
    dirVal?:      string;
    statusVal?:   string;
    searchVal?:   string;
    waFilterVal?: string;
    append?:      boolean;
  } = {}) => {
    const {
      offsetVal   = 0,
      dirVal      = direction,
      statusVal   = status,
      searchVal   = search,
      waFilterVal = waFilter,
      append      = false,
    } = params;

    const sp = new URLSearchParams({
      limit:  String(LIMIT),
      offset: String(offsetVal),
    });
    if (dirVal    !== 'all') sp.set('direction',  dirVal);
    if (statusVal !== 'all') sp.set('status',     statusVal);
    if (searchVal)           sp.set('search',     searchVal);
    if (waFilterVal)         sp.set('wa_number',  waFilterVal);

    startTransition(async () => {
      try {
        const res  = await fetch(`/api/wa-logs?${sp}`);
        const json = await res.json();
        setLogs(prev => append ? [...prev, ...(json.data ?? [])] : (json.data ?? []));
        setCount(json.count ?? 0);
        setOffset(offsetVal);
      } catch (err) {
        console.error('Failed to fetch WA logs:', err);
      }
    });
  }, [direction, status, search, waFilter]);

  function applyFilter() {
    fetchLogs({ offsetVal: 0, dirVal: direction, statusVal: status, searchVal: search });
  }

  function loadMore() {
    fetchLogs({ offsetVal: offset + LIMIT, append: true });
  }

  function clearFilters() {
    setDirection('all');
    setStatus('all');
    setSearch('');
    setWaFilter('');
    fetchLogs({ offsetVal: 0, dirVal: 'all', statusVal: 'all', searchVal: '', waFilterVal: '' });
  }

  const hasActiveFilters = direction !== 'all' || status !== 'all' || search || waFilter;

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto animate-fade-up space-y-6">

      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">WhatsApp Logs</h1>
          <p className="page-subtitle">{count.toLocaleString()} message{count !== 1 ? 's' : ''} total</p>
        </div>
        <Button
          variant="secondary"
          size="md"
          leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />}
          onClick={() => fetchLogs({ offsetVal: 0 })}
          disabled={isPending}
        >
          Refresh
        </Button>
      </div>

      {/* ── Stats row ── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total',    value: stats.total_messages, color: 'text-surface-950' },
            { label: 'Incoming', value: stats.incoming_count, color: 'text-cyan-400'    },
            { label: 'Outgoing', value: stats.outgoing_count, color: 'text-violet-400'  },
            { label: 'Contacts', value: stats.unique_numbers, color: 'text-brand-400'   },
            { label: 'Failed',   value: stats.failed_count,   color: 'text-danger'      },
            { label: 'Today',    value: stats.today_messages, color: 'text-success'     },
          ].map(s => (
            <div key={s.label} className="card p-4 text-center">
              <p className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</p>
              <p className="text-xs text-surface-600 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] max-w-xs">
          <Input
            placeholder="Search messages…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyFilter()}
            leftIcon={<Search className="h-3.5 w-3.5" />}
          />
        </div>

        <Button
          variant="secondary"
          size="md"
          leftIcon={<Filter className="h-3.5 w-3.5" />}
          onClick={() => setShowFilter(f => !f)}
        >
          Filters
          {hasActiveFilters && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-white text-2xs font-bold ml-1">
              !
            </span>
          )}
        </Button>

        {hasActiveFilters && (
          <Button variant="ghost" size="md" leftIcon={<X className="h-3.5 w-3.5" />} onClick={clearFilters}>
            Clear
          </Button>
        )}

        <span className="ml-auto text-xs text-surface-600 shrink-0">
          Showing {logs.length} of {count}
        </span>
      </div>

      {/* ── Filter panel ── */}
      {showFilter && (
        <div className="card p-4 space-y-4 animate-[fadeUp_0.2s_ease-out]">
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Direction */}
            <div className="space-y-1.5">
              <p className="label">Direction</p>
              <div className="flex gap-2">
                {['all', 'incoming', 'outgoing'].map(d => (
                  <button
                    key={d}
                    onClick={() => setDirection(d)}
                    className={cn(
                      'flex-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                      direction === d
                        ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                        : 'bg-surface-200 text-surface-700 border-transparent hover:bg-surface-300'
                    )}
                  >
                    {d === 'all' ? 'All' : d === 'incoming' ? '↓ In' : '↑ Out'}
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <p className="label">Status</p>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="input"
              >
                <option value="all">All statuses</option>
                {Object.entries(STATUS_CFG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            {/* WA number */}
            <div className="space-y-1.5">
              <p className="label">WA Number</p>
              <Input
                placeholder="e.g. 919876543210"
                value={waFilter}
                onChange={e => setWaFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="md" onClick={applyFilter} loading={isPending}>
              Apply Filters
            </Button>
          </div>
        </div>
      )}

      {/* ── Logs table ── */}
      {logs.length === 0 ? (
        <div className="empty-state py-20">
          <div className="empty-state-icon"><MessageSquare className="h-5 w-5" /></div>
          <p className="empty-state-title">No messages found</p>
          <p className="empty-state-desc">
            {hasActiveFilters
              ? 'Try adjusting your filters.'
              : 'Messages will appear here as employees interact via WhatsApp.'}
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>WA Number</th>
                  <th className="hidden md:table-cell">Type</th>
                  <th>Message</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th className="hidden lg:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const statusCfg = STATUS_CFG[log.delivery_status] ?? STATUS_CFG.pending;
                  const isIncoming = log.direction === 'incoming';

                  return (
                    <tr key={log.id} className={cn(log.delivery_status === 'failed' && 'bg-danger/[0.03]')}>
                      {/* Contact */}
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            src={log.user?.avatar_url}
                            name={log.user?.full_name ?? log.contact_name ?? log.wa_number}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-surface-900 truncate max-w-[100px]">
                              {log.user?.full_name ?? log.contact_name ?? 'Unknown'}
                            </p>
                            {log.user?.department && (
                              <p className="text-2xs text-surface-600 truncate">{log.user.department}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* WA Number */}
                      <td>
                        <span className="font-mono text-xs text-surface-700">+{log.wa_number}</span>
                      </td>

                      {/* Type */}
                      <td className="hidden md:table-cell">
                        <Badge variant="default" className="capitalize">
                          {log.message_type}
                        </Badge>
                      </td>

                      {/* Message text */}
                      <td className="max-w-[220px]">
                        {log.message_text ? (
                          <p
                            className="text-xs text-surface-800 truncate"
                            title={log.message_text}
                          >
                            {log.message_text}
                          </p>
                        ) : (
                          <span className="text-xs text-surface-500 italic">
                            [{log.message_type}]
                          </span>
                        )}
                      </td>

                      {/* Direction */}
                      <td>
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold',
                          isIncoming
                            ? 'bg-cyan-500/10  text-cyan-400'
                            : 'bg-violet-500/10 text-violet-400'
                        )}>
                          {isIncoming
                            ? <ArrowDownLeft className="h-3 w-3" />
                            : <ArrowUpRight  className="h-3 w-3" />}
                          {isIncoming ? 'In' : 'Out'}
                        </span>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold',
                          statusCfg.color
                        )}>
                          {statusCfg.icon}
                          {statusCfg.label}
                        </span>
                        {log.delivery_status === 'failed' && (
                          <AlertTriangle className="h-3 w-3 text-danger ml-1 inline" />
                        )}
                      </td>

                      {/* Time */}
                      <td className="hidden lg:table-cell text-xs text-surface-600 whitespace-nowrap">
                        {formatDateTime(log.wa_timestamp ?? log.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {logs.length < count && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                size="md"
                onClick={loadMore}
                loading={isPending}
              >
                Load more ({count - logs.length} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
