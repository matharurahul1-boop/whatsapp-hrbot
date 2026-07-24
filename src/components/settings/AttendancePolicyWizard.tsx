'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, ChevronLeft, ChevronRight, Pencil, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useToast } from '@/components/ui/Toast';
import type { AttendancePolicy } from '@/lib/utils/attendance-policy-shared';
import { ATTENDANCE_POLICY_DEFAULTS, composeAttendancePolicySummary } from '@/lib/utils/attendance-policy-shared';
import { AttendancePolicySteps, ATTENDANCE_STAGE_TITLES, StepShell } from './AttendancePolicySteps';

// Settings-page wrapper: fetches/saves the org's attendance policy via the
// API. The New Organization flow (src/components/organizations) uses the
// same AttendancePolicySteps but collects state locally instead, submitting
// it together with org creation — see NewOrganizationForm.tsx.
export function AttendancePolicyWizard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [policy, setPolicy]   = useState<AttendancePolicy>(ATTENDANCE_POLICY_DEFAULTS);
  const [editing, setEditing] = useState(false);
  const [step, setStep]       = useState(0); // 0..8 stages, 9 = summary/confirm

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/organizations/attendance-policy');
      const json = await res.json();
      if (json.data) {
        setPolicy({ ...ATTENDANCE_POLICY_DEFAULTS, ...json.data });
        setEditing(false);
      } else {
        setPolicy(ATTENDANCE_POLICY_DEFAULTS);
        setEditing(true); // never configured — go straight into the wizard
      }
    } catch {
      toast('Failed to load attendance policy', 'error');
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof AttendancePolicy>(key: K, value: AttendancePolicy[K]) {
    setPolicy(p => ({ ...p, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const summary_text = composeAttendancePolicySummary(policy);
      const res = await fetch('/api/organizations/attendance-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...policy, summary_text, is_configured: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');
      setPolicy({ ...ATTENDANCE_POLICY_DEFAULTS, ...json.data });
      setEditing(false);
      setStep(0);
      toast('Attendance policy saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save attendance policy', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-surface-500 py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  // ── Already configured, not editing: show the summary card ──────────
  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{policy.summary_text ?? composeAttendancePolicySummary(policy)}</p>
        </div>
        <button
          type="button"
          onClick={() => { setStep(0); setEditing(true); }}
          className="flex items-center gap-2 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit attendance policy
        </button>
      </div>
    );
  }

  const totalSteps = ATTENDANCE_STAGE_TITLES.length + 1; // + confirmation step

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-brand-500' : 'bg-surface-300')} />
        ))}
      </div>
      <p className="text-xs text-surface-500">Step {step + 1} of {totalSteps}</p>

      {step < ATTENDANCE_STAGE_TITLES.length && (
        <AttendancePolicySteps policy={policy} set={set} step={step} />
      )}

      {step === ATTENDANCE_STAGE_TITLES.length && (
        <StepShell title="Review & confirm" sub="Catch any misunderstandings before this goes live — nothing is saved until you confirm.">
          <div className="rounded-lg border border-surface-300 bg-surface-200/50 px-4 py-3 text-sm text-surface-800 leading-relaxed">
            {composeAttendancePolicySummary(policy)}
          </div>
        </StepShell>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-surface-300">
        <button
          type="button"
          onClick={() => step === 0 ? setEditing(policy.is_configured ? false : true) : setStep(s => s - 1)}
          disabled={step === 0 && !policy.is_configured}
          className="flex items-center gap-1.5 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 disabled:opacity-40 disabled:cursor-not-allowed text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> {step === 0 ? 'Cancel' : 'Back'}
        </button>

        {step < totalSteps - 1 ? (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 transition-colors shadow-glow"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Confirm & save policy'}
          </button>
        )}
      </div>
    </div>
  );
}
