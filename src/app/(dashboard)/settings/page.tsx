'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  User, Building2, Bell, Shield, Phone,
  Save, Loader2, CheckCircle2, AlertCircle,
  Eye, EyeOff, Copy, Check, Bot, KeyRound, Plus, X,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { normalizeWaNumber } from '@/lib/utils/phone';
import { useToast } from '@/components/ui/Toast';

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
  const [fullName,     setFullName]     = useState('');
  const [email,        setEmail]        = useState('');
  const [waNumber,     setWaNumber]     = useState('');
  const [department,   setDepartment]   = useState('');
  const [designation,  setDesignation]  = useState('');
  const [avatarUrl,    setAvatarUrl]    = useState('');

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

  // Meta
  const [role,   setRole]   = useState('');
  const [orgId,  setOrgId]  = useState('');
  const [userId, setUserId] = useState('');
  const isAdmin = ['super_admin', 'admin'].includes(role);

  useEffect(() => { loadData(); }, []);

  // Recompute dirty state whenever a tracked field changes, comparing
  // against the snapshot taken right after load.
  useEffect(() => {
    if (loading) return;
    const current = JSON.stringify({
      fullName, waNumber, department, designation, avatarUrl,
      orgName, waPhoneId, waMsgTemplate, waTemplateLang, waTemplateVars,
    });
    setIsDirty(current !== snapshotRef.current);
  }, [loading, fullName, waNumber, department, designation, avatarUrl, orgName, waPhoneId, waMsgTemplate, waTemplateLang, waTemplateVars]);

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    setEmail(user.email ?? '');

    const { data: profile } = await supabase
      .from('users')
      .select('full_name, wa_number, department, designation, avatar_url, role, organization_id, metadata')
      .eq('id', user.id)
      .single();

    const snapshot: Record<string, string> = {};

    if (profile) {
      snapshot.fullName    = profile.full_name ?? '';
      snapshot.waNumber    = profile.wa_number ?? '';
      snapshot.department  = profile.department ?? '';
      snapshot.designation = profile.designation ?? '';
      snapshot.avatarUrl   = profile.avatar_url ?? '';

      setFullName(snapshot.fullName);
      setWaNumber(snapshot.waNumber);
      setDepartment(snapshot.department);
      setDesignation(snapshot.designation);
      setAvatarUrl(snapshot.avatarUrl);
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
        setAiBackend((org as any).settings?.ai_backend === 'claude' ? 'claude' : 'groq');
        setGroqKeysCount(org.groq_api_keys_count ?? 0);
        setGroqKeys(Array.isArray(org.groq_api_keys) && org.groq_api_keys.length > 0 ? org.groq_api_keys : ['']);
        setGroqKeysSource(org.groq_api_keys_source === 'org' ? 'org' : 'server');
      }
    }

    snapshotRef.current = JSON.stringify(snapshot);
    setIsDirty(false);

    setLoading(false);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    // Normalize wa_number: strip non-digits, and add the 91 country code if
    // the user only typed the bare 10-digit number.
    const cleanWaNumber = normalizeWaNumber(waNumber);

    const { error: err } = await supabase
      .from('users')
      .update({ full_name: fullName, wa_number: cleanWaNumber || null, department, designation, avatar_url: avatarUrl })
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
      fullName, waNumber, department, designation, avatarUrl,
      orgName, waPhoneId, waMsgTemplate, waTemplateLang, waTemplateVars,
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
          <p className="text-sm text-surface-600 mt-1">Manage your profile, organization and integrations</p>
        </div>
        <button
          type="submit"
          form="settings-main-form"
          disabled={saving || !isDirty}
          className="flex items-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition-colors shadow-glow shrink-0"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
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

      <form id="settings-main-form" onSubmit={handleSaveProfile} className="space-y-6">
        {/* ── Profile ── */}
        <Section
          title="Profile"
          description="Your personal information shown across the app"
          icon={<User className="h-4 w-4" />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name">
              <TextInput value={fullName} onChange={setFullName} placeholder="Ashish Kumar" />
            </Field>
            <Field label="Email" hint="Managed by Supabase Auth">
              <TextInput value={email} onChange={() => {}} disabled placeholder="you@company.com" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Department">
              <TextInput value={department} onChange={setDepartment} placeholder="Engineering" />
            </Field>
            <Field label="Designation">
              <TextInput value={designation} onChange={setDesignation} placeholder="Software Engineer" />
            </Field>
          </div>
          <Field label="Avatar URL" hint="Link to your profile picture">
            <TextInput value={avatarUrl} onChange={setAvatarUrl} placeholder="https://..." />
          </Field>
        </Section>

        {/* ── WhatsApp Number ── */}
        <Section
          title="WhatsApp"
          description="Your personal WhatsApp number for receiving HR notifications"
          icon={<Phone className="h-4 w-4" />}
        >
          <Field label="WhatsApp number" hint="Include country code e.g. 919876543210 (no + sign)">
            <TextInput value={waNumber} onChange={setWaNumber} placeholder="919876543210" type="tel" />
          </Field>
        </Section>

        {/* ── Organization (admin only) ── */}
        {isAdmin && (
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

        {/* ── AI Backend (admin only) ── */}
        {isAdmin && (
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
                onClick={() => setAiBackend(v => v === 'claude' ? 'groq' : 'claude')}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50',
                  aiBackend === 'claude' ? 'bg-brand-500' : 'bg-surface-300'
                )}
                aria-label="Toggle AI backend"
              >
                <span className={cn(
                  'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5',
                  aiBackend === 'claude' ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </button>
            </div>

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
        {isAdmin && (
          <Section
            title="Groq API Keys"
            description="Free-tier keys used to run the WhatsApp bot — rotate here if one expires or hits its rate limit"
            icon={<KeyRound className="h-4 w-4" />}
          >
            <p className="text-xs text-surface-600">
              {groqKeysSource === 'org'
                ? `${groqKeysCount} org-specific key${groqKeysCount === 1 ? '' : 's'} currently active.`
                : 'No org-specific keys saved yet — showing the server-default key(s) currently powering the bot. Edit and save to switch to your own.'}
            </p>
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
          </Section>
        )}

        {/* ── Role info ── */}
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
      </form>

      {/* ── Change Password ── */}
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

      {/* ── Notifications ── */}
      <Section
        title="Notifications"
        description="Manage how and when you receive alerts and reminders"
        icon={<Bell className="h-4 w-4" />}
      >
        {/* Auto-alerts (read-only) */}
        <div className="space-y-3 pb-5 border-b border-surface-300">
          <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Auto alerts</p>
          {[
            { label: 'Task assigned / completed',  channel: 'WhatsApp + In-app' },
            { label: 'Leave approved / rejected',  channel: 'WhatsApp + In-app' },
            { label: 'Daily check-in reminder',    channel: 'WhatsApp'          },
            { label: 'Onboarding updates',         channel: 'WhatsApp'          },
          ].map(n => (
            <div key={n.label} className="flex items-center justify-between py-1.5">
              <div>
                <p className="text-sm text-surface-800">{n.label}</p>
                <p className="text-xs text-surface-500">{n.channel}</p>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                Active
              </span>
            </div>
          ))}
        </div>

        {/* Task due-date reminder preferences */}
        <div className="pt-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-surface-900">Task Due Date Reminders</p>
              <p className="text-xs text-surface-500 mt-0.5">
                Get notified before a task deadline via WhatsApp and/or the in-app bell
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
    </div>
  );
}
