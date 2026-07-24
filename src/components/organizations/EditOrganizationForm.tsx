'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, AlertCircle, CheckCircle2, Building2, Clock3 } from 'lucide-react';
import { AttendancePolicyWizard } from '@/components/settings/AttendancePolicyWizard';

const inputCls = 'w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2.5 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500';

export function EditOrganizationForm({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState('');
  const [saved,  setSaved]    = useState(false);

  const [name,         setName]         = useState(orgName);
  const [companySize,  setCompanySize]  = useState('1-10');
  const [workdayStart, setWorkdayStart] = useState('09:00');
  const [workdayEnd,   setWorkdayEnd]   = useState('18:00');

  useEffect(() => {
    fetch(`/api/organizations/${orgId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setName(d.data.name);
        setCompanySize(d.data.companySize);
        setWorkdayStart(d.data.workdayStart);
        setWorkdayEnd(d.data.workdayEnd);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load organization'))
      .finally(() => setLoading(false));
  }, [orgId]);

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, companySize, workdayStart, workdayEnd }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-surface-500 py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="rounded-xl border border-surface-300 bg-surface-100 overflow-hidden">
        <div className="flex items-start gap-4 p-6 border-b border-surface-300">
          <div className="h-9 w-9 rounded-lg bg-brand-500/10 flex items-center justify-center text-brand-500 shrink-0">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-950">Workspace</h3>
            <p className="text-xs text-surface-600 mt-0.5">The fields set when this org was created</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="label">Company / organisation</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className="label">Company size</label>
              <select value={companySize} onChange={e => setCompanySize(e.target.value)} className={inputCls}>
                <option value="1-10">1–10 employees</option>
                <option value="11-50">11–50 employees</option>
                <option value="51-200">51–200 employees</option>
                <option value="201-500">201–500 employees</option>
                <option value="501+">501+ employees</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="label">Workday starts</label>
              <div className="relative">
                <Clock3 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input type="time" value={workdayStart} onChange={e => setWorkdayStart(e.target.value)} className={`${inputCls} pl-9`} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="label">Workday ends</label>
              <div className="relative">
                <Clock3 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500 pointer-events-none" />
                <input type="time" value={workdayEnd} onChange={e => setWorkdayEnd(e.target.value)} className={`${inputCls} pl-9`} />
              </div>
            </div>
          </div>
          {saved && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Saved
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-brand-gradient text-white text-sm font-semibold px-5 py-2.5 transition-all shadow-glow-sm hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save workspace'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-surface-300 bg-surface-100 overflow-hidden">
        <div className="flex items-start gap-4 p-6 border-b border-surface-300">
          <div className="h-9 w-9 rounded-lg bg-brand-500/10 flex items-center justify-center text-brand-500 shrink-0">
            <Clock3 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-950">Attendance Policy</h3>
            <p className="text-xs text-surface-600 mt-0.5">Working days, shift timing, grace period, and more for this org</p>
          </div>
        </div>
        <div className="p-6">
          <AttendancePolicyWizard targetOrgId={orgId} />
        </div>
      </div>
    </div>
  );
}
