'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Building2, Bell, Shield, Phone,
  Save, Loader2, CheckCircle2, AlertCircle,
  Eye, EyeOff, Copy, Check, Bot, KeyRound, Plus, X,
  CalendarDays, RefreshCw, MessageSquare, ChevronDown, ChevronUp, CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { normalizeWaNumber } from '@/lib/utils/phone';
import { useToast } from '@/components/ui/Toast';
import { REALTIME_PAGES, type RealtimePage } from '@/lib/utils/realtime-settings';
import { NOTIFICATION_TYPES, NOTIFICATION_GROUPS, NOTIFICATION_GROUP_LABEL, type NotificationGroup } from '@/lib/utils/notification-settings';
import { AttendancePolicyWizard } from '@/components/settings/AttendancePolicyWizard';

const REALTIME_PAGE_LABEL: Record<RealtimePage, string> = {
  leave: 'Leave', tasks: 'Tasks', attendance: 'Attendance',
  team: 'Team', dashboard: 'Dashboard', escalation: 'Escalation',
};

// Re-enabled 2026-07-11 at the org's request (was hard-disabled 2026-07-10).
// Keep in sync with the matching flag in src/lib/ai/agent.ts, which is what
// actually enforces this on the backend (this flag only locks the UI so it
// can't show a selection that wouldn't take effect).
const GROQ_BACKEND_ENABLED = true;

// ── Leave Policy types ──────────────────────────────────────────────────────
interface LeaveTypeRow {
  id: string; name: string; default_days: number; color: string;
  carry_forward: boolean; requires_approval: boolean; is_active: boolean;
}
interface PolicyRow {
  leave_type_id: string; role: string; work_mode: 'wfo' | 'wfh'; default_days: number;
}
const APPLICANT_ROLES = ['employee', 'manager', 'hr_assistant', 'hr'] as const;
const APPLICANT_ROLE_LABEL: Record<string, string> = {
  employee: 'Employee', manager: 'Manager', hr_assistant: 'HR Assistant', hr: 'HR',
};

// ── Section filter (jump-to dropdown) ───────────────────────────────────────
// `requires` gates which sections show up in the dropdown per role, mirroring
// each section's own isAdmin/isHrOrAbove guard below — kept as a single
// source of truth so the two never drift out of sync.
const SETTINGS_SECTIONS = [
  { id: 'whatsapp',      label: 'WhatsApp',              requires: 'all'   },
  { id: 'permissions',   label: 'Permissions',            requires: 'all'   },
  { id: 'password',      label: 'Change Password',        requires: 'all'   },
  { id: 'leave-policy',  label: 'Leave Policy',           requires: 'hr'    },
  { id: 'attendance-policy', label: 'Attendance Policy',  requires: 'admin' },
  { id: 'ai-assistant',  label: 'AI Assistant',           requires: 'admin' },
  { id: 'groq-keys',     label: 'Groq API Keys',          requires: 'admin' },
  { id: 'live-updates',  label: 'Live Updates',           requires: 'admin' },
  { id: 'wa-messages',   label: 'WhatsApp Messages',      requires: 'all'   },
  { id: 'notifications', label: 'In-App Notifications',   requires: 'all'   },
  { id: 'organization',  label: 'Organization',           requires: 'admin' },
] as const;
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

// ── tiny helpers ─────────────────────────────────────────────────────────────
function Section({ title, description, icon, children }: {
  title: string; description: string;
  icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-surface-300 bg-surface-100 overflow-hidden">
      <div className="flex items-start gap-4 p-6 border-b border-surface-300">
        <div className="h-9 w-9 rounded-lg bg-brand-500/10 flex items-center justify-center text-brand-500 shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-surface-950">{title}</h3>
          <p className="text-xs text-surface-600 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-surface-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-surface-500 mt-1">{hint}</p>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, disabled, type = 'text' }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2.5 text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

function NotificationToggleRow({ label, enabled, editable, saving, onToggle }: {
  label: string; enabled: boolean; editable: boolean; saving: boolean; onToggle: () => void;
}) {
  if (!editable) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <p className="text-sm text-surface-800">{label}</p>
        <span className={cn(
          'text-xs font-medium px-2 py-0.5 rounded-full border',
          enabled ? 'bg-success/10 text-success border-success/20' : 'bg-surface-200 text-surface-500 border-surface-300'
        )}>
          {enabled ? 'Active' : 'Off'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between py-1.5 gap-4">
      <p className="text-sm text-surface-800">{label}</p>
      <div className="flex items-center gap-2 shrink-0">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />}
        <button
          type="button"
          onClick={onToggle}
          disabled={saving}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50',
            enabled ? 'bg-brand-500' : 'bg-surface-300',
            saving && 'opacity-50 cursor-not-allowed'
          )}
          aria-label={`Toggle ${label}`}
        >
          <span className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform mt-0.5',
            enabled ? 'translate-x-4' : 'translate-x-0.5'
          )} />
        </button>
      </div>
    </div>
  );
}

function NotificationTypeGroupList({ channel, toggles, editable, savingKey, onToggle }: {
  channel: 'whatsapp' | 'in_app';
  toggles: Record<string, boolean>;
  editable: boolean;
  savingKey: string | null;
  onToggle: (key: string, next: boolean) => void;
}) {
  const types = NOTIFICATION_TYPES.filter(t => t.channel === channel || t.channel === 'both');
  return (
    <div className="space-y-5">
      {NOTIFICATION_GROUPS.map((group: NotificationGroup) => {
        const groupTypes = types.filter(t => t.group === group);
        if (!groupTypes.length) return null;
        return (
          <div key={group} className="space-y-1">
            <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">
              {NOTIFICATION_GROUP_LABEL[group]}
            </p>
            {groupTypes.map(t => (
              <NotificationToggleRow
                key={t.key}
                label={t.label}
                enabled={toggles[t.key] !== false}
                editable={editable}
                saving={savingKey === t.key}
                onToggle={() => onToggle(t.key, !(toggles[t.key] !== false))}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const supabase = createClient();
  const router   = useRouter();
  const { toast } = useToast();

  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [saved,   setSaved]     = useState(false);
  const [error,   setError]     = useState('');

  // Profile fields
  const [waNumber,     setWaNumber]     = useState('');

  // Org fields (admin only)
  const [orgName,       setOrgName]       = useState('');
  const [waPhoneId,     setWaPhoneId]     = useState('');
  const [waToken,       setWaToken]       = useState('');
  const [waTokenConfigured, setWaTokenConfigured] = useState(false);
  const [showToken,     setShowToken]     = useState(false);
  const [copiedToken,   setCopiedToken]   = useState(false);
  const [waMsgTemplate,   setWaMsgTemplate]   = useState('hrbot_message');
  const [waTemplateLang,  setWaTemplateLang]  = useState('en');
  const [waTemplateVars,  setWaTemplateVars]  = useState('3');

  // Groq API keys (admin only) — one input box per key, joined into a
  // comma-separated string when saved (that's the format the API stores)
  const [groqKeys,        setGroqKeys]        = useState<string[]>(['']);
  const [groqKeysCount,   setGroqKeysCount]   = useState(0);
  const [groqKeysSource,  setGroqKeysSource]  = useState<'org' | 'server'>('server');
  const [visibleGroqKeys, setVisibleGroqKeys] = useState<Set<number>>(new Set());
  const [groqKeysExpanded, setGroqKeysExpanded] = useState(false);
  const [savingGroq,      setSavingGroq]      = useState(false);
  const [groqSaved,       setGroqSaved]       = useState(false);
  const [groqError,       setGroqError]       = useState('');

  // Snapshot of the main form's loaded values, used to enable "Save changes"
  // only once something has actually been edited.
  const snapshotRef = useRef('');
  const [isDirty, setIsDirty] = useState(false);

  // Password
  const [newPw,        setNewPw]        = useState('');
  const [showPw,       setShowPw]       = useState(false);
  const [savingPw,     setSavingPw]     = useState(false);
  const [pwSaved,      setPwSaved]      = useState(false);
  const [pwError,      setPwError]      = useState('');

  // Task reminder preferences
  const [remindersEnabled,  setRemindersEnabled]  = useState(true);
  const [savingReminders,   setSavingReminders]   = useState(false);
  const [remindersSaved,    setRemindersSaved]    = useState(false);

  // AI backend toggle (admin only)
  const [aiBackend,   setAiBackend]   = useState<'groq' | 'claude'>('groq');
  const [savingAi,    setSavingAi]    = useState(false);
  const [aiSaved,     setAiSaved]     = useState(false);

  // Realtime dashboard auto-refresh toggle (admin only) — per-page on/off for
  // the postgres_changes subscriptions that auto-refresh Leave/Tasks/Attendance/
  // Team/Dashboard/Escalation pages.
  const [realtimePages,   setRealtimePages]   = useState<Record<RealtimePage, boolean>>(
    Object.fromEntries(REALTIME_PAGES.map(p => [p, true])) as Record<RealtimePage, boolean>
  );
  const [savingRealtimePage, setSavingRealtimePage] = useState<string | null>(null);

  // Per-notification-type on/off (admin only) — org-wide master switches,
  // stored in organizations.settings.notification_toggles. Independent of
  // the personal Task Due Date Reminders preference below, which is a
  // per-user opt-out layered on top of whichever of these are on.
  const [notificationToggles, setNotificationToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIFICATION_TYPES.map(t => [t.key, true]))
  );
  const [savingNotifType, setSavingNotifType] = useState<string | null>(null);

  // Leave Policy (HR+) — leave types themselves, plus a role x work_mode
  // entitlement override matrix. Self-contained, same pattern as AI
  // Backend/Groq Keys above (own load + own inline save actions rather than
  // participating in the shared isDirty/handleSaveProfile flow).
  const [leaveTypes,      setLeaveTypes]      = useState<LeaveTypeRow[]>([]);
  const [loadingLeaveTypes, setLoadingLeaveTypes] = useState(false);
  const [savingTypeId,    setSavingTypeId]    = useState<string | null>(null);
  const [addingType,      setAddingType]      = useState(false);
  const [newType,         setNewType]         = useState({ name: '', default_days: '10', color: '#3b82f6' });
  const [policyMatrix,    setPolicyMatrix]    = useState<PolicyRow[]>([]);
  const [selectedTypeId,  setSelectedTypeId]  = useState('');
  const [savingCell,      setSavingCell]      = useState<string | null>(null); // `${role}:${work_mode}`

  // Meta
  const [role,   setRole]   = useState('');
  const [orgId,  setOrgId]  = useState('');
  const [userId, setUserId] = useState('');
  const isAdmin     = ['super_admin', 'admin'].includes(role);
  const isHrOrAbove = ['super_admin', 'admin', 'hr'].includes(role);

  // Jump-to section dropdown — defaults to WhatsApp since every role can see
  // it (unlike the admin/HR-only sections further down the list).
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('whatsapp');
  const availableSections = SETTINGS_SECTIONS.filter(s =>
    s.requires === 'all' || (s.requires === 'hr' && isHrOrAbove) || (s.requires === 'admin' && isAdmin)
  );

  useEffect(() => { loadData(); }, []);

  // Fires once role is known and confirmed HR+ — mirrors the org-settings
  // fetch in loadData(), just gated on a role check that only resolves
  // after the initial load, so it's a separate effect rather than inline.
  useEffect(() => {
    if (!loading && isHrOrAbove && leaveTypes.length === 0 && !loadingLeaveTypes) {
      loadLeavePolicy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isHrOrAbove]);

  // Recompute dirty state whenever a tracked field changes, comparing
  // against the snapshot taken right after load.
  useEffect(() => {
    if (loading) return;
    const current = JSON.stringify({
      waNumber, orgName, waPhoneId, waMsgTemplate, waTemplateLang, waTemplateVars,
    });
    setIsDirty(current !== snapshotRef.current);
  }, [loading, waNumber, orgName, waPhoneId, waMsgTemplate, waTemplateLang, waTemplateVars]);

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: profile } = await supabase
      .from('users')
      .select('wa_number, role, organization_id, metadata')
      .eq('id', user.id)
      .single();

    const snapshot: Record<string, string> = {};

    if (profile) {
      snapshot.waNumber = profile.wa_number ?? '';

      setWaNumber(snapshot.waNumber);
      setRole(profile.role ?? '');
      setOrgId(profile.organization_id ?? '');

      const prefs = (profile as any).metadata?.task_reminders;
      if (prefs) {
        setRemindersEnabled(prefs.enabled ?? true);
      }
    }

    if (profile?.organization_id) {
      const response = await fetch('/api/organizations/settings');
      const org = response.ok ? (await response.json()).data : null;

      if (org) {
        snapshot.orgName        = org.name ?? '';
        snapshot.waPhoneId      = org.wa_phone_number_id ?? '';
        snapshot.waMsgTemplate  = org.wa_message_template ?? '';
        snapshot.waTemplateLang = org.wa_template_lang ?? 'en';
        snapshot.waTemplateVars = String(org.wa_template_variables ?? 2);

        setOrgName(snapshot.orgName);
        setWaPhoneId(snapshot.waPhoneId);
        setWaToken('');
        setWaTokenConfigured(!!org.wa_access_token_configured);
        setWaMsgTemplate(snapshot.waMsgTemplate);
        setWaTemplateLang(snapshot.waTemplateLang);
        setWaTemplateVars(snapshot.waTemplateVars);
        setAiBackend(GROQ_BACKEND_ENABLED ? ((org as any).settings?.ai_backend === 'claude' ? 'claude' : 'groq') : 'claude');
        {
          const savedPages = (org as any).settings?.realtime_refresh_pages ?? {};
          setRealtimePages(Object.fromEntries(
            REALTIME_PAGES.map(p => [p, savedPages[p] !== false])
          ) as Record<RealtimePage, boolean>);
        }
        {
          const savedToggles = (org as any).settings?.notification_toggles ?? {};
          setNotificationToggles(Object.fromEntries(
            NOTIFICATION_TYPES.map(t => [t.key, savedToggles[t.key] !== false])
          ));
        }
        setGroqKeysCount(org.groq_api_keys_count ?? 0);
        setGroqKeys(Array.isArray(org.groq_api_keys) && org.groq_api_keys.length > 0 ? org.groq_api_keys : ['']);
        setGroqKeysSource(org.groq_api_keys_source === 'org' ? 'org' : 'server');
      }
    }

    snapshotRef.current = JSON.stringify(snapshot);
    setIsDirty(false);

    setLoading(false);
  }

  async function handleSaveProfile(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError('');

    // Normalize wa_number: strip non-digits, and add the 91 country code if
    // the user only typed the bare 10-digit number.
    const cleanWaNumber = normalizeWaNumber(waNumber);

    const { error: err } = await supabase
      .from('users')
      .update({ wa_number: cleanWaNumber || null })
      .eq('id', userId);

    if (err) { setError(err.message); toast(err.message, 'error'); setSaving(false); return; }

    if (isAdmin && orgId) {
      const orgRes = await fetch('/api/organizations/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                  orgName,
          wa_phone_number_id:    waPhoneId,
          wa_access_token:       waToken || undefined,
          wa_message_template:   waMsgTemplate.trim() || null,
          wa_template_lang:      waTemplateLang.trim() || 'en',
          wa_template_variables: parseInt(waTemplateVars) || 2,
        }),
      });
      if (!orgRes.ok) {
        const orgErr = await orgRes.json().catch(() => ({}));
        const errMsg = typeof orgErr.error === 'string'
          ? orgErr.error
          : 'Failed to save organisation settings';
        setError(errMsg);
        toast(errMsg, 'error');
        setSaving(false);
        return;
      }
    }

    // Re-snapshot so the Save button disables again, and refresh server data
    // (header avatar, sidebar name, etc.) so the change is visible immediately
    // instead of only after a manual reload.
    snapshotRef.current = JSON.stringify({
      waNumber, orgName, waPhoneId, waMsgTemplate, waTemplateLang, waTemplateVars,
    });
    setIsDirty(false);
    setWaToken('');
    if (isAdmin && orgId) setWaTokenConfigured(prev => prev || !!waToken);
    router.refresh();

    setSaving(false);
    setSaved(true);
    toast('Profile saved.');
    setTimeout(() => setSaved(false), 3000);
  }

  function addGroqKeyField() {
    setGroqKeys(keys => [...keys, '']);
  }

  function updateGroqKeyField(index: number, value: string) {
    setGroqKeys(keys => keys.map((k, i) => (i === index ? value : k)));
  }

  function removeGroqKeyField(index: number) {
    setGroqKeys(keys => keys.filter((_, i) => i !== index));
    setVisibleGroqKeys(visible => {
      const next = new Set<number>();
      visible.forEach(i => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  }

  function toggleGroqKeyVisibility(index: number) {
    setVisibleGroqKeys(visible => {
      const next = new Set(visible);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function saveGroqKeys() {
    const filled = groqKeys.map(k => k.trim()).filter(Boolean);
    setSavingGroq(true);
    setGroqError('');
    try {
      const res = await fetch('/api/organizations/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ groq_api_keys: filled.join(',') }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const msg = typeof json.error === 'string' ? json.error : 'Failed to save Groq keys';
        setGroqError(msg);
        toast(msg, 'error');
        return;
      }
      setGroqKeysCount(filled.length);
      setGroqKeys(filled.length > 0 ? filled : ['']);
      setGroqKeysSource(filled.length > 0 ? 'org' : 'server');
      setGroqSaved(true);
      toast('Groq keys saved.');
      setTimeout(() => setGroqSaved(false), 2500);
    } finally {
      setSavingGroq(false);
    }
  }

  async function loadLeavePolicy() {
    setLoadingLeaveTypes(true);
    try {
      const [typesRes, policyRes] = await Promise.all([
        fetch('/api/leave-types'),
        fetch('/api/leave-policy'),
      ]);
      if (typesRes.ok) {
        const { data } = await typesRes.json();
        setLeaveTypes(data ?? []);
        if (data?.length && !selectedTypeId) setSelectedTypeId(data[0].id);
      }
      if (policyRes.ok) {
        const { data } = await policyRes.json();
        setPolicyMatrix(data ?? []);
      }
    } finally {
      setLoadingLeaveTypes(false);
    }
  }

  async function saveLeaveType(id: string, fields: Partial<LeaveTypeRow>) {
    setSavingTypeId(id);
    try {
      const res = await fetch('/api/leave-types', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...fields }),
      });
      const json = await res.json();
      if (!res.ok) { toast(typeof json.error === 'string' ? json.error : 'Failed to save leave type', 'error'); return; }
      setLeaveTypes(types => types.map(t => t.id === id ? { ...t, ...fields } : t));
      toast('Leave type saved.');
    } finally {
      setSavingTypeId(null);
    }
  }

  async function createLeaveType() {
    if (!newType.name.trim()) return;
    setSavingTypeId('__new__');
    try {
      const res = await fetch('/api/leave-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newType.name.trim(),
          default_days: parseFloat(newType.default_days) || 0,
          color: newType.color,
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast(typeof json.error === 'string' ? json.error : 'Failed to create leave type', 'error'); return; }
      setLeaveTypes(types => [...types, json.data]);
      setNewType({ name: '', default_days: '10', color: '#3b82f6' });
      setAddingType(false);
      toast('Leave type created.');
    } finally {
      setSavingTypeId(null);
    }
  }

  function policyCellValue(role: string, workMode: 'wfo' | 'wfh'): number | null {
    const row = policyMatrix.find(p => p.leave_type_id === selectedTypeId && p.role === role && p.work_mode === workMode);
    return row?.default_days ?? null;
  }

  async function savePolicyCell(role: string, workMode: 'wfo' | 'wfh', value: string) {
    const days = value.trim() === '' ? null : parseFloat(value);
    if (days === null || isNaN(days)) return;
    const key = `${role}:${workMode}`;
    setSavingCell(key);
    try {
      const res = await fetch('/api/leave-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave_type_id: selectedTypeId, role, work_mode: workMode, default_days: days }),
      });
      const json = await res.json();
      if (!res.ok) { toast(typeof json.error === 'string' ? json.error : 'Failed to save', 'error'); return; }
      setPolicyMatrix(rows => {
        const idx = rows.findIndex(r => r.leave_type_id === selectedTypeId && r.role === role && r.work_mode === workMode);
        if (idx === -1) return [...rows, { leave_type_id: selectedTypeId, role, work_mode: workMode, default_days: days }];
        const next = [...rows];
        next[idx] = { ...next[idx], default_days: days };
        return next;
      });
    } finally {
      setSavingCell(null);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw.length < 6) { setPwError('Password must be at least 6 characters'); return; }
    setSavingPw(true);
    setPwError('');

    const { error: err } = await supabase.auth.updateUser({ password: newPw });
    if (err) { setPwError(err.message); toast(err.message, 'error'); setSavingPw(false); return; }

    setNewPw('');
    setSavingPw(false);
    setPwSaved(true);
    toast('Password updated.');
    setTimeout(() => setPwSaved(false), 3000);
  }

  function copyToken() {
    navigator.clipboard.writeText(waToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

  async function saveAiBackend() {
    setSavingAi(true);
    try {
      const res = await fetch('/api/organizations/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ai_backend: aiBackend }),
      });
      if (res.ok) {
        setAiSaved(true);
        toast('AI backend updated.');
        setTimeout(() => setAiSaved(false), 2500);
      } else {
        toast('Failed to save AI backend.', 'error');
      }
    } finally {
      setSavingAi(false);
    }
  }

  async function saveRealtimePage(page: RealtimePage, next: boolean) {
    setRealtimePages(pages => ({ ...pages, [page]: next }));
    setSavingRealtimePage(page);
    try {
      const res = await fetch('/api/organizations/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ realtime_refresh_pages: { [page]: next } }),
      });
      if (res.ok) {
        toast(`${REALTIME_PAGE_LABEL[page]} live updates turned ${next ? 'on' : 'off'}.`);
      } else {
        setRealtimePages(pages => ({ ...pages, [page]: !next }));
        toast('Failed to save live updates setting.', 'error');
      }
    } finally {
      setSavingRealtimePage(null);
    }
  }

  async function saveNotificationToggle(key: string, next: boolean) {
    setNotificationToggles(toggles => ({ ...toggles, [key]: next }));
    setSavingNotifType(key);
    try {
      const res = await fetch('/api/organizations/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ notification_toggles: { [key]: next } }),
      });
      if (res.ok) {
        const label = NOTIFICATION_TYPES.find(t => t.key === key)?.label ?? key;
        toast(`${label} turned ${next ? 'on' : 'off'}.`);
      } else {
        setNotificationToggles(toggles => ({ ...toggles, [key]: !next }));
        toast('Failed to save notification setting.', 'error');
      }
    } finally {
      setSavingNotifType(null);
    }
  }

  async function saveReminders() {
    setSavingReminders(true);
    try {
      const { data: current } = await supabase.from('users').select('metadata').eq('id', userId).single();
      const merged = {
        ...((current as any)?.metadata ?? {}),
        task_reminders: { enabled: remindersEnabled },
      };
      await supabase.from('users').update({ metadata: merged }).eq('id', userId);
      setRemindersSaved(true);
      toast('Reminder settings saved.');
      setTimeout(() => setRemindersSaved(false), 2500);
    } finally {
      setSavingReminders(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
      {/* Header — Save Changes stays pinned top-right while scrolling */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-surface-50/95 backdrop-blur-sm border-b border-surface-300/60 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-950">Settings</h1>
          <p className="text-sm text-surface-600 mt-1">Manage your WhatsApp number, organization and integrations</p>
        </div>
        <button
          type="button"
          onClick={() => handleSaveProfile()}
          disabled={saving || !isDirty}
          className="flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors shadow-glow shrink-0"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Jump to section */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-surface-600 shrink-0">Jump to</label>
        <select
          value={activeSection}
          onChange={e => setActiveSection(e.target.value as SettingsSectionId)}
          className="rounded-lg border border-surface-300 bg-surface-0 px-3 py-2 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
        >
          {availableSections.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Success / Error banners */}
      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Settings saved successfully!
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* ── WhatsApp Number ── */}
        {activeSection === 'whatsapp' && (
        <Section
          title="WhatsApp"
          description="Your personal WhatsApp number for receiving HR notifications"
          icon={<Phone className="h-4 w-4" />}
        >
          <Field label="WhatsApp number" hint="Include country code e.g. 919876543210 (no + sign)">
            <TextInput value={waNumber} onChange={setWaNumber} placeholder="919876543210" type="tel" />
          </Field>
        </Section>
        )}

        {/* ── Role info ── */}
        {activeSection === 'permissions' && (
        <Section
          title="Permissions"
          description="Your current role and access level"
          icon={<Shield className="h-4 w-4" />}
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-400 capitalize">
              {role.replace('_', ' ')}
            </span>
            <span className="text-xs text-surface-600">
              {role === 'super_admin' || role === 'admin'
                ? 'Full access to all features including organization settings'
                : role === 'hr'
                ? 'Can manage employees, leave and onboarding'
                : role === 'manager'
                ? 'Can manage team tasks, attendance and approve leave'
                : 'Access to your own tasks, leave and attendance'}
            </span>
          </div>
        </Section>
        )}

        {/* ── Change Password ── */}
        {activeSection === 'password' && (
        <Section
          title="Change Password"
          description="Update your Supabase Auth password"
          icon={<Shield className="h-4 w-4" />}
        >
          <form onSubmit={handleChangePassword} className="space-y-4">
            {pwError && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" /> {pwError}
              </div>
            )}
            {pwSaved && (
              <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2.5 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Password updated successfully!
              </div>
            )}
            <Field label="New password" hint="Minimum 6 characters">
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-surface-300 bg-surface-0 pl-3 pr-10 py-2.5 text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
                />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-800">
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </Field>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingPw || !newPw}
                className="flex items-center gap-2 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 disabled:opacity-50 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
              >
                {savingPw ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {savingPw ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </Section>
        )}

        {/* ── Leave Policy (HR+) ── */}
        {isHrOrAbove && activeSection === 'leave-policy' && (
          <Section
            title="Leave Policy"
            description="Manage leave types and how many days each role gets, by work mode"
            icon={<CalendarDays className="h-4 w-4" />}
          >
            {loadingLeaveTypes ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
              </div>
            ) : (
              <>
                {/* Leave types */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Leave Types</p>
                  {leaveTypes.map(lt => (
                    <div key={lt.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-300 bg-surface-0 px-3 py-2.5">
                      <input
                        type="color"
                        value={lt.color}
                        onChange={e => saveLeaveType(lt.id, { color: e.target.value })}
                        className="h-7 w-7 rounded cursor-pointer border border-surface-300 shrink-0"
                        title="Color"
                      />
                      <input
                        type="text"
                        defaultValue={lt.name}
                        onBlur={e => e.target.value.trim() && e.target.value !== lt.name && saveLeaveType(lt.id, { name: e.target.value.trim() })}
                        className="flex-1 min-w-[100px] rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                      />
                      <input
                        type="number" min="0" step="0.5"
                        defaultValue={lt.default_days}
                        onBlur={e => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v !== lt.default_days) saveLeaveType(lt.id, { default_days: v });
                        }}
                        className="w-20 rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                        title="Default days/year"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-surface-700 shrink-0">
                        <input
                          type="checkbox" checked={lt.requires_approval}
                          onChange={e => saveLeaveType(lt.id, { requires_approval: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-surface-400 text-brand-500"
                        />
                        Requires approval
                      </label>
                      <button
                        type="button"
                        onClick={() => saveLeaveType(lt.id, { is_active: !lt.is_active })}
                        className={cn(
                          'text-xs font-medium px-2 py-1 rounded-full border shrink-0 transition-colors',
                          lt.is_active
                            ? 'border-success/20 bg-success/10 text-success'
                            : 'border-surface-300 bg-surface-200 text-surface-500'
                        )}
                      >
                        {lt.is_active ? 'Active' : 'Inactive'}
                      </button>
                      {savingTypeId === lt.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500 shrink-0" />}
                    </div>
                  ))}

                  {addingType ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-brand-500/40 bg-brand-500/5 px-3 py-2.5">
                      <input
                        type="color" value={newType.color}
                        onChange={e => setNewType(t => ({ ...t, color: e.target.value }))}
                        className="h-7 w-7 rounded cursor-pointer border border-surface-300 shrink-0"
                      />
                      <input
                        type="text" placeholder="Leave type name" value={newType.name}
                        onChange={e => setNewType(t => ({ ...t, name: e.target.value }))}
                        className="flex-1 min-w-[100px] rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                      />
                      <input
                        type="number" min="0" step="0.5" placeholder="Days" value={newType.default_days}
                        onChange={e => setNewType(t => ({ ...t, default_days: e.target.value }))}
                        className="w-20 rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                      />
                      <button
                        type="button"
                        onClick={() => { setAddingType(false); setNewType({ name: '', default_days: '10', color: '#3b82f6' }); }}
                        className="text-sm font-medium text-surface-600 hover:text-surface-900 px-3 py-1.5 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={createLeaveType}
                        disabled={!newType.name.trim() || savingTypeId === '__new__'}
                        className="flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-1.5 transition-colors"
                      >
                        {savingTypeId === '__new__' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingType(true)}
                      className="flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-400 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add leave type
                    </button>
                  )}
                </div>

                {/* Entitlement matrix — role x work mode, per leave type */}
                {leaveTypes.length > 0 && (
                  <div className="pt-2 border-t border-surface-300 space-y-3">
                    <div className="flex items-center justify-between gap-3 pt-4">
                      <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Entitlement by Role &amp; Work Mode</p>
                      <select
                        value={selectedTypeId}
                        onChange={e => setSelectedTypeId(e.target.value)}
                        className="rounded-lg border border-surface-300 bg-surface-0 px-2.5 py-1.5 text-xs text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                      >
                        {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
                      </select>
                    </div>

                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Role</th>
                            <th>WFO (days/year)</th>
                            <th>WFH (days/year)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {APPLICANT_ROLES.map(r => (
                            <tr key={r}>
                              <td className="text-sm text-surface-900">{APPLICANT_ROLE_LABEL[r]}</td>
                              {(['wfo', 'wfh'] as const).map(mode => {
                                const current = policyCellValue(r, mode);
                                const fallback = leaveTypes.find(t => t.id === selectedTypeId)?.default_days ?? 0;
                                return (
                                  <td key={mode}>
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="number" min="0" step="0.5"
                                        defaultValue={current ?? ''}
                                        key={`${selectedTypeId}-${r}-${mode}-${current}`}
                                        placeholder={String(fallback)}
                                        onBlur={e => savePolicyCell(r, mode, e.target.value)}
                                        className="w-20 rounded-lg border border-surface-300 bg-surface-0 px-2 py-1.5 text-sm text-surface-950 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                      />
                                      {savingCell === `${r}:${mode}` && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-surface-500">
                      Blank = falls back to this leave type&apos;s default ({leaveTypes.find(t => t.id === selectedTypeId)?.default_days ?? 0} days/year, shown as placeholder). Applies to newly created employees — existing balances aren&apos;t changed retroactively.
                    </p>
                  </div>
                )}
              </>
            )}
          </Section>
        )}

        {/* ── Attendance Policy (admin only) ── */}
        {isAdmin && activeSection === 'attendance-policy' && (
          <Section
            title="Attendance Policy"
            description="Working days, shift timing, grace period, and how attendance is captured & enforced org-wide"
            icon={<CalendarClock className="h-4 w-4" />}
          >
            <AttendancePolicyWizard />
          </Section>
        )}

        {/* ── AI Backend (admin only) ── */}
        {isAdmin && activeSection === 'ai-assistant' && (
          <Section
            title="AI Assistant"
            description="Choose which AI model powers the WhatsApp HR bot"
            icon={<Bot className="h-4 w-4" />}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-surface-900">
                  {aiBackend === 'claude' ? 'Claude Haiku 4.5' : 'Groq Llama 3.3 70B'}
                </p>
                <p className="text-xs text-surface-500 mt-0.5">
                  {aiBackend === 'claude'
                    ? 'Paid — uses Anthropic credits (~$0.01 / message)'
                    : 'Free tier — ideal for testing (30 req/min limit)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => GROQ_BACKEND_ENABLED && setAiBackend(v => v === 'claude' ? 'groq' : 'claude')}
                disabled={!GROQ_BACKEND_ENABLED}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50',
                  aiBackend === 'claude' ? 'bg-brand-500' : 'bg-surface-300',
                  !GROQ_BACKEND_ENABLED && 'opacity-50 cursor-not-allowed'
                )}
                aria-label="Toggle AI backend"
              >
                <span className={cn(
                  'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5',
                  aiBackend === 'claude' ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </button>
            </div>

            {!GROQ_BACKEND_ENABLED && (
              <p className="text-xs text-surface-500 bg-surface-200/60 border border-surface-300 rounded-lg px-3 py-2">
                🔒 The free Groq option is currently disabled — this org runs on Claude only.
              </p>
            )}

            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-200/60 px-3 py-2.5 text-xs text-surface-500">
              <span className={cn('font-medium', aiBackend === 'groq' ? 'text-surface-900' : '')}>
                Free (Groq)
              </span>
              <span className="text-surface-400">←  toggle  →</span>
              <span className={cn('font-medium', aiBackend === 'claude' ? 'text-brand-500' : '')}>
                Paid (Claude)
              </span>
            </div>

            {aiBackend === 'claude' && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚡ Claude is active — Anthropic credits will be charged for every WhatsApp message the bot handles.
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveAiBackend}
                disabled={savingAi}
                className="flex items-center gap-2 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 disabled:opacity-50 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
              >
                {savingAi
                  ? <Loader2     className="h-3.5 w-3.5 animate-spin" />
                  : aiSaved
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    : <Save         className="h-3.5 w-3.5" />}
                {savingAi ? 'Saving…' : aiSaved ? 'Saved!' : 'Save AI settings'}
              </button>
            </div>
          </Section>
        )}

        {/* ── Groq API keys (admin only) ── */}
        {isAdmin && activeSection === 'groq-keys' && (
          <Section
            title="Groq API Keys"
            description="Free-tier keys used to run the WhatsApp bot — rotate here if one expires or hits its rate limit"
            icon={<KeyRound className="h-4 w-4" />}
          >
            <button
              type="button"
              onClick={() => setGroqKeysExpanded(v => !v)}
              className="w-full flex items-center justify-between gap-3 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 px-3.5 py-2.5 text-left transition-colors"
            >
              <span className="flex items-center gap-2 text-xs text-surface-600">
                <KeyRound className="h-3.5 w-3.5 text-surface-500 shrink-0" />
                {groqKeysSource === 'org'
                  ? `${groqKeysCount} org-specific key${groqKeysCount === 1 ? '' : 's'} currently active`
                  : `${groqKeys.filter(k => k.trim()).length} server-default key${groqKeys.filter(k => k.trim()).length === 1 ? '' : 's'} currently powering the bot`}
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-brand-500 shrink-0">
                {groqKeysExpanded ? 'Hide' : 'Manage keys'}
                {groqKeysExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            </button>

            {groqKeysExpanded && (
              <>
                {groqKeysSource !== 'org' && (
                  <p className="text-xs text-surface-500">
                    No org-specific keys saved yet — showing the server-default key(s). Edit and save to switch to your own.
                  </p>
                )}
                {groqError && (
                  <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {groqError}
                  </div>
                )}
                <Field label="Groq API keys" hint="Replaces the entire list — include every key you want active, not just the new one.">
                  <div className="space-y-2">
                    {groqKeys.map((key, i) => (
                      <div key={i} className="relative flex items-center gap-2">
                        <div className="relative flex-1">
                          <input
                            type={visibleGroqKeys.has(i) ? 'text' : 'password'}
                            autoComplete="off"
                            data-lpignore="true"
                            value={key}
                            onChange={e => updateGroqKeyField(i, e.target.value)}
                            placeholder={`key-${i + 1}...`}
                            className="w-full rounded-lg border border-surface-300 bg-surface-0 pl-3 pr-10 py-2.5 text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 font-mono"
                          />
                          <button type="button" onClick={() => toggleGroqKeyVisibility(i)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-surface-500 hover:text-surface-800 transition-colors">
                            {visibleGroqKeys.has(i) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        {groqKeys.length > 1 && (
                          <button type="button" onClick={() => removeGroqKeyField(i)}
                            className="p-2 rounded-lg text-surface-500 hover:text-danger hover:bg-danger/10 transition-colors shrink-0">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addGroqKeyField}
                      className="flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-400 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Groq API key
                    </button>
                  </div>
                </Field>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={saveGroqKeys}
                    disabled={savingGroq || groqKeys.every(k => !k.trim())}
                    className="flex items-center gap-2 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 disabled:opacity-50 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
                  >
                    {savingGroq
                      ? <Loader2     className="h-3.5 w-3.5 animate-spin" />
                      : groqSaved
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        : <Save         className="h-3.5 w-3.5" />}
                    {savingGroq ? 'Saving…' : groqSaved ? 'Saved!' : 'Save Groq keys'}
                  </button>
                </div>
              </>
            )}
          </Section>
        )}

        {/* ── Live page updates (admin only) ── */}
        {isAdmin && activeSection === 'live-updates' && (
          <Section
            title="Live Updates"
            description="Auto-refresh each page the moment its data changes — set per page"
            icon={<RefreshCw className="h-4 w-4" />}
          >
            <div className="space-y-1">
              {REALTIME_PAGES.map(page => {
                const on = realtimePages[page];
                const saving = savingRealtimePage === page;
                return (
                  <div key={page} className="flex items-center justify-between gap-4 rounded-lg px-1 py-2">
                    <div>
                      <p className="text-sm font-medium text-surface-900">{REALTIME_PAGE_LABEL[page]}</p>
                      <p className="text-xs text-surface-500 mt-0.5">
                        {on ? 'Refreshes automatically when data changes' : 'Needs a manual refresh to see new data'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => saveRealtimePage(page, !on)}
                      disabled={saving}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50',
                        on ? 'bg-brand-500' : 'bg-surface-300',
                        saving && 'opacity-50 cursor-not-allowed'
                      )}
                      aria-label={`Toggle live updates for ${REALTIME_PAGE_LABEL[page]}`}
                    >
                      <span className={cn(
                        'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5',
                        on ? 'translate-x-5' : 'translate-x-0.5'
                      )} />
                    </button>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

      </div>

      {/* ── WhatsApp Messages ── */}
      {activeSection === 'wa-messages' && (
      <Section
        title="WhatsApp Messages"
        description={isAdmin
          ? 'Turn automatic WhatsApp alerts on or off, org-wide'
          : 'Automatic alerts the bot sends over WhatsApp'}
        icon={<MessageSquare className="h-4 w-4" />}
      >
        <NotificationTypeGroupList
          channel="whatsapp"
          toggles={notificationToggles}
          editable={isAdmin}
          savingKey={savingNotifType}
          onToggle={saveNotificationToggle}
        />
      </Section>
      )}

      {/* ── In-App Notifications ── */}
      {activeSection === 'notifications' && (
      <Section
        title="In-App Notifications"
        description="Manage alerts shown in the dashboard's notification bell"
        icon={<Bell className="h-4 w-4" />}
      >
        {/* Auto-alerts also mirrored in-app */}
        <div className="pb-5 border-b border-surface-300">
          <NotificationTypeGroupList
            channel="in_app"
            toggles={notificationToggles}
            editable={isAdmin}
            savingKey={savingNotifType}
            onToggle={saveNotificationToggle}
          />
        </div>

        {/* Task due-date reminder preferences */}
        <div className="pt-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-surface-900">Task Due Date Reminders</p>
              <p className="text-xs text-surface-500 mt-0.5">
                Get notified before a task deadline via WhatsApp and/or the in-app bell
                {isAdmin && ' — your personal opt-out, on top of the org-wide "Task deadline reminder" switch above.'}
              </p>
            </div>
            {/* Toggle switch */}
            <button
              type="button"
              onClick={() => setRemindersEnabled(v => !v)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50',
                remindersEnabled ? 'bg-brand-500' : 'bg-surface-300'
              )}
              aria-label="Toggle reminders"
            >
              <span className={cn(
                'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5',
                remindersEnabled ? 'translate-x-5' : 'translate-x-0.5'
              )} />
            </button>
          </div>

          {remindersEnabled && (
            <p className="text-xs text-surface-500 bg-surface-200/60 rounded-lg px-3 py-2.5">
              Reminders fire via <strong className="text-surface-700">WhatsApp + in-app bell</strong>. Timing (1 hr, 2 hrs, 4 hrs, 1 day, 2 days before) is set per task when you create or edit a task.
            </p>
          )}

          <button
            type="button"
            onClick={saveReminders}
            disabled={savingReminders}
            className="flex items-center gap-2 rounded-lg border border-surface-300 bg-surface-0 hover:bg-surface-200 disabled:opacity-50 text-surface-800 text-sm font-medium px-4 py-2 transition-colors"
          >
            {savingReminders
              ? <Loader2    className="h-3.5 w-3.5 animate-spin" />
              : remindersSaved
                ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                : <Save         className="h-3.5 w-3.5" />}
            {savingReminders ? 'Saving…' : remindersSaved ? 'Saved!' : 'Save reminder settings'}
          </button>
        </div>
      </Section>
      )}

      {/* ── Organization (admin only) ── */}
      {isAdmin && activeSection === 'organization' && (
        <Section
          title="Organization"
          description="Company name and WhatsApp Business API configuration"
          icon={<Building2 className="h-4 w-4" />}
        >
          <Field label="Company name">
            <TextInput value={orgName} onChange={setOrgName} placeholder="Acme Corp" />
          </Field>
          <Field label="WhatsApp Phone Number ID" hint="From Meta Business → WhatsApp → Getting Started">
            <TextInput value={waPhoneId} onChange={setWaPhoneId} placeholder="1069159539605344" />
          </Field>
          <Field
            label="WhatsApp Access Token"
            hint={waTokenConfigured ? 'A token is already configured — leave blank to keep it, or enter a new one to replace it.' : undefined}
          >
            <div className="relative">
              <input
                type="text"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                value={waToken}
                onChange={e => setWaToken(e.target.value)}
                placeholder={waTokenConfigured ? '•••••••••••••••• (configured)' : 'EAAHBaq2...'}
                style={showToken ? undefined : { WebkitTextSecurity: 'disc' } as React.CSSProperties}
                className="w-full rounded-lg border border-surface-300 bg-surface-0 pl-3 pr-20 py-2.5 text-sm text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 font-mono"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button type="button" onClick={copyToken}
                  className="p-1.5 rounded text-surface-500 hover:text-surface-800 transition-colors">
                  {copiedToken ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => setShowToken(s => !s)}
                  className="p-1.5 rounded text-surface-500 hover:text-surface-800 transition-colors">
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </Field>

          {/* ── Message Template (bypass 24h window) ── */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-amber-800">📋 Message Template — Send to Anyone</p>
              <p className="text-xs text-amber-700 mt-1">
                A pre-approved Meta template lets you message <strong>any WhatsApp number</strong> without the 24-hour restriction.
                Pick one of the templates below, create it in Meta Business Manager, then enter the name here.
              </p>
            </div>

            {/* Template preview */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">Template body (create this in Meta)</p>
              <div
                className="rounded-lg border border-amber-300 bg-white p-4 text-sm leading-relaxed whitespace-pre-line"
                style={{ fontFamily: 'inherit', color: '#1a1a1a' }}
              >
                {`📢 *Important Announcement*\n\nDear {{1}},\n\n{{2}}\n\nStay connected with us for more updates.\n\n- {{3}} HR Team`}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-amber-100 border border-amber-200 px-3 py-2 text-center">
                  <p className="font-bold text-amber-900 font-mono">{'{{1}}'}</p>
                  <p className="text-amber-700 mt-0.5">Contact Name</p>
                </div>
                <div className="rounded-lg bg-amber-100 border border-amber-200 px-3 py-2 text-center">
                  <p className="font-bold text-amber-900 font-mono">{'{{2}}'}</p>
                  <p className="text-amber-700 mt-0.5">Your Message</p>
                </div>
                <div className="rounded-lg bg-amber-100 border border-amber-200 px-3 py-2 text-center">
                  <p className="font-bold text-amber-900 font-mono">{'{{3}}'}</p>
                  <p className="text-amber-700 mt-0.5">Organization Name</p>
                </div>
              </div>
            </div>

            {/* Manual fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="col-span-1">
                <Field label="Template name" hint="Must match exactly in Meta">
                  <TextInput value={waMsgTemplate} onChange={setWaMsgTemplate} placeholder="hrbot_message" />
                </Field>
              </div>
              <div>
                <Field label="Language code" hint="e.g. en, hi, en_US">
                  <TextInput value={waTemplateLang} onChange={setWaTemplateLang} placeholder="en" />
                </Field>
              </div>
              <div>
                <Field label="Variables" hint="How many {{x}} in body">
                  <select
                    value={waTemplateVars}
                    onChange={e => setWaTemplateVars(e.target.value)}
                    className="w-full rounded-lg border border-surface-300 bg-surface-0 px-3 py-2.5 text-sm text-surface-950 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                  >
                    <option value="1">1 — message only</option>
                    <option value="2">2 — name + message</option>
                    <option value="3">3 — name + message + org</option>
                  </select>
                </Field>
              </div>
            </div>

            <p className="text-[11px] text-amber-600">
              💡 When sending from WA Logs, free-form is tried first. If the 24h window expired, it auto-retries with this template — the recipient sees your exact message.
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}
