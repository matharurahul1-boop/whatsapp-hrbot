'use client';

import { useEffect, useState } from 'react';
import { X, Mail, Phone, Building2, Calendar, User2, Hash, Pencil, Check, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatDate } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';

interface Employee {
  id:           string;
  full_name:    string;
  email:        string;
  department:   string | null;
  designation:  string | null;
  role:         string;
  employee_id:  string | null;
  avatar_url:   string | null;
  is_active:    boolean;
  wa_number:    string | null;
  joined_at:    string | null;
  today_status: string | null;
  manager_name: string | null;
}

interface DrawerProps {
  employee:  Employee | null;
  onClose:   () => void;
  canEdit:   boolean;
  onUpdated?: (updated: Partial<Employee>) => void;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin', hr: 'HR',
  manager: 'Manager', employee: 'Employee',
};

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-surface-500 shrink-0">{icon}</span>
      <div>
        <p className="text-2xs text-surface-600 uppercase tracking-wide font-medium">{label}</p>
        <p className="text-sm text-surface-900 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function InfoRowEmpty({ icon, label, value, placeholder }: {
  icon: React.ReactNode; label: string; value: string | null; placeholder?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-surface-500 shrink-0">{icon}</span>
      <div>
        <p className="text-2xs text-surface-600 uppercase tracking-wide font-medium">{label}</p>
        <p className={cn('text-sm mt-0.5', value ? 'text-surface-900' : 'text-surface-400 italic')}>
          {value ?? placeholder ?? '—'}
        </p>
      </div>
    </div>
  );
}

interface EditFormState {
  full_name:   string;
  wa_number:   string;
  department:  string;
  designation: string;
  role:        string;
  is_active:   boolean;
}

export default function EmployeeProfileDrawer({ employee, onClose, canEdit, onUpdated }: DrawerProps) {
  const [editing, setEditing]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState<string | null>(null);
  const [form,    setForm]      = useState<EditFormState>({
    full_name: '', wa_number: '', department: '', designation: '', role: 'employee', is_active: true,
  });

  // Reset edit state when employee changes
  useEffect(() => {
    setEditing(false);
    setError(null);
    if (employee) {
      setForm({
        full_name:   employee.full_name   ?? '',
        wa_number:   employee.wa_number   ?? '',
        department:  employee.department  ?? '',
        designation: employee.designation ?? '',
        role:        employee.role        ?? 'employee',
        is_active:   employee.is_active   ?? true,
      });
    }
  }, [employee]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setEditing(false); onClose(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleSave() {
    if (!employee) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        target_id:   employee.id,
        full_name:   form.full_name   || undefined,
        wa_number:   form.wa_number   || null,
        department:  form.department  || null,
        designation: form.designation || null,
        role:        form.role,
        is_active:   form.is_active,
      };

      const res = await fetch('/api/employees', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Update failed');

      setEditing(false);
      onUpdated?.({
        full_name:   form.full_name   || employee.full_name,
        wa_number:   form.wa_number   || null,
        department:  form.department  || null,
        designation: form.designation || null,
        role:        form.role,
        is_active:   form.is_active,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200',
          employee ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => { setEditing(false); onClose(); }}
      />

      {/* Drawer */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-full sm:w-96 flex flex-col bg-surface-100 border-l border-surface-300 shadow-modal',
          'transition-transform duration-250 ease-out',
          employee ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-300 shrink-0">
          <span className="text-sm font-semibold text-surface-950">Employee Profile</span>
          <div className="flex items-center gap-2">
            {canEdit && !editing && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(false); onClose(); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {employee && (
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {/* Avatar + name */}
            <div className="flex flex-col items-center gap-3 px-5 py-6 border-b border-surface-300">
              <Avatar src={employee.avatar_url} name={employee.full_name} size="xl" />
              <div className="text-center">
                <p className="text-base font-bold text-surface-950">{employee.full_name}</p>
                {employee.designation && (
                  <p className="text-sm text-surface-600 mt-0.5">{employee.designation}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                <Badge variant="brand">{ROLE_LABELS[employee.role] ?? employee.role}</Badge>
                {!employee.is_active && <Badge variant="danger">Inactive</Badge>}
                {employee.today_status === 'present'  && <Badge variant="success" dot>Present today</Badge>}
                {employee.today_status === 'on_leave' && <Badge variant="info"    dot>On leave</Badge>}
              </div>
            </div>

            {/* ── VIEW MODE ─────────────────────────────────────────────────── */}
            {!editing && (
              <div className="px-5 py-5 space-y-4">
                <InfoRow      icon={<Mail      className="h-4 w-4" />} label="Email"       value={employee.email} />
                <InfoRowEmpty icon={<Phone     className="h-4 w-4" />} label="WhatsApp"    value={employee.wa_number} placeholder="Not set — notifications won't be sent" />
                <InfoRow      icon={<Building2 className="h-4 w-4" />} label="Department"  value={employee.department} />
                <InfoRow      icon={<User2     className="h-4 w-4" />} label="Manager"     value={employee.manager_name} />
                <InfoRow      icon={<Hash      className="h-4 w-4" />} label="Employee ID" value={employee.employee_id} />
                <InfoRow      icon={<Calendar  className="h-4 w-4" />} label="Joined"      value={employee.joined_at ? formatDate(employee.joined_at) : null} />
              </div>
            )}

            {/* ── EDIT MODE ─────────────────────────────────────────────────── */}
            {editing && (
              <div className="px-5 py-5 space-y-4">
                {error && (
                  <div className="rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-2xs text-surface-600 uppercase tracking-wide font-medium mb-1">Full Name</label>
                  <Input
                    value={form.full_name}
                    onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="Full name"
                  />
                </div>

                <div>
                  <label className="block text-2xs text-surface-600 uppercase tracking-wide font-medium mb-1">
                    WhatsApp Number
                    <span className="ml-1 text-brand-400 normal-case font-normal">(required for notifications)</span>
                  </label>
                  <Input
                    value={form.wa_number}
                    onChange={e => setForm(f => ({ ...f, wa_number: e.target.value.replace(/[\s+\-()]/g, '') }))}
                    placeholder="e.g. 917058444808"
                  />
                  <p className="mt-1 text-2xs text-surface-500">Country code + number, no spaces or + (e.g. 917058444808)</p>
                </div>

                <div>
                  <label className="block text-2xs text-surface-600 uppercase tracking-wide font-medium mb-1">Department</label>
                  <Input
                    value={form.department}
                    onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                    placeholder="e.g. Engineering"
                  />
                </div>

                <div>
                  <label className="block text-2xs text-surface-600 uppercase tracking-wide font-medium mb-1">Designation</label>
                  <Input
                    value={form.designation}
                    onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                    placeholder="e.g. Senior Developer"
                  />
                </div>

                <div>
                  <label className="block text-2xs text-surface-600 uppercase tracking-wide font-medium mb-1">Role</label>
                  <select
                    value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 bg-surface-200 px-3 py-2 text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  >
                    {['employee','manager','hr','admin','super_admin'].map(r => (
                      <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    id="is_active"
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="h-4 w-4 rounded border-surface-400 text-brand-500"
                  />
                  <label htmlFor="is_active" className="text-sm text-surface-900 cursor-pointer">
                    Active employee
                  </label>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 gap-1.5"
                  >
                    {saving
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                      : <><Check className="h-3.5 w-3.5" /> Save changes</>
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setEditing(false); setError(null); }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
