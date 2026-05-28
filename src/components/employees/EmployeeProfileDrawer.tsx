'use client';

import { useEffect } from 'react';
import { X, Mail, Phone, Building2, Calendar, User2, Hash } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
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
  employee: Employee | null;
  onClose:  () => void;
  canEdit:  boolean;
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

export default function EmployeeProfileDrawer({ employee, onClose, canEdit }: DrawerProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200',
          employee ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-80 flex flex-col bg-surface-100 border-l border-surface-300 shadow-modal',
          'transition-transform duration-250 ease-out',
          employee ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-300 shrink-0">
          <span className="text-sm font-semibold text-surface-950">Employee Profile</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
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
                {employee.today_status === 'present' && <Badge variant="success" dot>Present today</Badge>}
                {employee.today_status === 'on_leave' && <Badge variant="info" dot>On leave</Badge>}
              </div>
            </div>

            {/* Info */}
            <div className="px-5 py-5 space-y-4">
              <InfoRow icon={<Mail className="h-4 w-4" />}     label="Email"      value={employee.email} />
              <InfoRow icon={<Phone className="h-4 w-4" />}    label="WhatsApp"   value={employee.wa_number} />
              <InfoRow icon={<Building2 className="h-4 w-4" />} label="Department" value={employee.department} />
              <InfoRow icon={<User2 className="h-4 w-4" />}    label="Manager"    value={employee.manager_name} />
              <InfoRow icon={<Hash className="h-4 w-4" />}     label="Employee ID" value={employee.employee_id} />
              <InfoRow icon={<Calendar className="h-4 w-4" />} label="Joined"     value={employee.joined_at ? formatDate(employee.joined_at) : null} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
