'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, X, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Input, SelectNative } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SelectOrCustom } from '@/components/ui/SelectOrCustom';
import { ROLE_LABEL, isAdminOrAbove, isSuperAdmin, type UserRole } from '@/lib/rbac';
import { DEPARTMENT_OPTIONS, JOB_TITLE_OPTIONS } from '@/lib/constants/org-fields';
import { useToast } from '@/components/ui/Toast';

const ALL_ROLES: UserRole[] = ['employee', 'manager', 'hr_assistant', 'hr', 'admin', 'super_admin'];

interface FormState {
  full_name: string;
  wa_number: string;
  email: string;
  role: UserRole;
  department: string;
  designation: string;
  password: string;
  confirm_password: string;
}

const EMPTY: FormState = {
  full_name: '', wa_number: '', email: '', role: 'employee',
  department: '', designation: '', password: '', confirm_password: '',
};

export default function CreateAccountModal({ actorRole }: { actorRole: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Only offer roles the acting user is actually allowed to assign — mirrors
  // the API's escalation checks (only admin+ can create an admin, only a
  // super admin can create another super admin), avoiding a confusing
  // 403 round-trip. Assumes this component only renders for hr+ actors,
  // since that's the page-level gate for showing "Create Account" at all.
  const assignableRoles = ALL_ROLES.filter(r => {
    if (r === 'super_admin') return isSuperAdmin(actorRole);
    if (r === 'admin')       return isAdminOrAbove(actorRole);
    return true;
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function close() {
    if (loading) return;
    setOpen(false);
    setForm(EMPTY);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (form.password !== form.confirm_password) { setError('Passwords do not match'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name:   form.full_name.trim(),
          wa_number:   form.wa_number.trim(),
          email:       form.email.trim(),
          role:        form.role,
          department:  form.department.trim(),
          designation: form.designation.trim(),
          password:    form.password,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof json.error === 'string'
          ? json.error
          : json.error?.fieldErrors
            ? Object.values(json.error.fieldErrors).flat().join(', ') || 'Account creation failed'
            : 'Account creation failed';
        setError(message);
        toast(message, 'error');
        setLoading(false);
        return;
      }

      setLoading(false);
      toast(`Account created for ${form.full_name.trim()}.`);
      close();
      router.refresh();
    } catch {
      setError('Account creation failed — please check your connection and try again');
      toast('Account creation failed — please check your connection and try again', 'error');
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg bg-brand-gradient text-white text-sm font-semibold px-4 h-9 shadow-glow-sm transition-all hover:opacity-90 active:scale-[0.98] shrink-0"
      >
        <UserPlus className="h-4 w-4" />
        <span className="hidden sm:inline">Create Account</span>
        <span className="sm:hidden">Create</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-surface-100 border border-surface-300 shadow-modal animate-[scaleIn_0.15s_ease-out] max-h-[90dvh] flex flex-col">
            <div className="flex items-start justify-between px-5 py-4 border-b border-surface-300 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-surface-950">Create team account</h2>
                <p className="text-xs text-surface-600 mt-0.5">The account is added to your organization and a welcome message is sent to WhatsApp.</p>
              </div>
              <button onClick={close} className="flex h-7 w-7 items-center justify-center rounded-lg text-surface-600 hover:text-surface-950 hover:bg-surface-300 transition-colors shrink-0 ml-3">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-4 space-y-4">
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-3 text-sm text-danger">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="label">Full name</label>
                  <Input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Test Account" required autoFocus />
                </div>
                <div className="space-y-1.5">
                  <label className="label">WhatsApp number</label>
                  <Input value={form.wa_number} onChange={e => set('wa_number', e.target.value)} placeholder="9876543210" required />
                </div>
                <div className="space-y-1.5">
                  <label className="label">Email address</label>
                  <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@company.com" required autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <label className="label">Role</label>
                  <SelectNative value={form.role} onChange={e => set('role', e.target.value as UserRole)}>
                    {assignableRoles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </SelectNative>
                </div>
                <div className="space-y-1.5">
                  <label className="label">Department</label>
                  <SelectOrCustom
                    value={form.department} onChange={v => set('department', v)}
                    options={DEPARTMENT_OPTIONS} placeholder="Select department" required
                    className="input"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">Job title</label>
                  <SelectOrCustom
                    value={form.designation} onChange={v => set('designation', v)}
                    options={JOB_TITLE_OPTIONS} placeholder="Select job title" required
                    className="input"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="label">Initial password</label>
                  <div className="relative">
                    <Input type={showPw ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min. 6 characters" required minLength={6} autoComplete="new-password" className="pr-10" />
                    <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-950 transition-colors">
                      {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="label">Confirm password</label>
                  <Input type={showPw ? 'text' : 'password'} value={form.confirm_password} onChange={e => set('confirm_password', e.target.value)} placeholder="Repeat password" required minLength={6} autoComplete="new-password" />
                </div>
              </div>
              <p className="text-2xs text-surface-500">The password is not included in WhatsApp logs. Share it securely or reset it when needed.</p>
            </form>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-300 shrink-0">
              <Button type="button" variant="ghost" size="md" onClick={close} disabled={loading}>Cancel</Button>
              <Button type="submit" variant="primary" size="md" loading={loading} leftIcon={<UserPlus className="h-4 w-4" />} onClick={handleSubmit}>
                Create Account
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
