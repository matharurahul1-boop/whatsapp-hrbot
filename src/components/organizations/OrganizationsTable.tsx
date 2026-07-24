'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface OrgRow {
  id: string;
  name: string;
  plan: string;
  created_at: string;
  total_users: number;
  active_users: number;
}

const PLAN_STYLE: Record<string, string> = {
  free:       'bg-surface-200 text-surface-700 border-surface-300',
  pro:        'bg-brand-500/10 text-brand-500 border-brand-500/30',
  enterprise: 'bg-success/10 text-success border-success/30',
};

export function OrganizationsTable() {
  const [orgs,    setOrgs]    = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    fetch('/api/organizations')
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setOrgs(d.data ?? []); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load organizations'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-surface-500 py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
      </div>
    );
  }
  if (!orgs.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <Building2 className="h-8 w-8 text-surface-400" />
        <p className="text-sm text-surface-600">No organizations yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-surface-300/80 bg-surface-100 overflow-hidden">
      <div className="table-wrap overflow-x-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="border-b border-surface-300 text-left text-xs font-semibold text-surface-600 uppercase tracking-wide">
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(org => (
              <tr key={org.id} className="border-b border-surface-300 last:border-0 hover:bg-surface-200/40">
                <td className="px-4 py-3 font-medium text-surface-950">{org.name}</td>
                <td className="px-4 py-3">
                  <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', PLAN_STYLE[org.plan] ?? PLAN_STYLE.free)}>
                    {org.plan}
                  </span>
                </td>
                <td className="px-4 py-3 text-surface-700">{org.active_users} active / {org.total_users} total</td>
                <td className="px-4 py-3 text-surface-500">{new Date(org.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
