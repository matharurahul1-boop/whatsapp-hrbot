'use client';

import { useState, useMemo } from 'react';
import { Search, Users } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import EmployeeProfileDrawer from './EmployeeProfileDrawer';

interface Employee {
  id:             string;
  full_name:      string;
  email:          string;
  department:     string | null;
  designation:    string | null;
  role:           string;
  employee_id:    string | null;
  avatar_url:     string | null;
  is_active:      boolean;
  wa_number:      string | null;
  joined_at:      string | null;
  today_status:   string | null;
  manager_name:   string | null;
}

interface EmployeeGridProps {
  employees: Employee[];
  canEdit:   boolean;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  hr:          'HR',
  manager:     'Manager',
  employee:    'Employee',
};

export default function EmployeeGrid({ employees: initialEmployees, canEdit }: EmployeeGridProps) {
  const [search,     setSearch]     = useState('');
  const [dept,       setDept]       = useState('');
  const [employees,  setEmployees]  = useState(initialEmployees);
  const [selected,   setSelected]   = useState<Employee | null>(null);

  function handleUpdated(id: string, patch: Partial<Employee>) {
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  }

  const departments = useMemo(
    () => [...new Set(employees.map(e => e.department).filter(Boolean) as string[])].sort(),
    [employees]
  );

  const filtered = useMemo(() => {
    let result = employees;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.full_name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.designation?.toLowerCase().includes(q)
      );
    }
    if (dept) result = result.filter(e => e.department === dept);
    return result;
  }, [employees, search, dept]);

  if (!employees.length) {
    return (
      <div className="empty-state py-20">
        <div className="empty-state-icon"><Users className="h-5 w-5" /></div>
        <p className="empty-state-title">No employees yet</p>
        <p className="empty-state-desc">Employees will appear here after they are onboarded via WhatsApp.</p>
      </div>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <div className="flex-1 min-w-[200px] max-w-xs">
          <Input
            placeholder="Search employees…"
            leftIcon={<Search className="h-3.5 w-3.5" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {departments.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {['', ...departments].map(d => (
              <button
                key={d}
                onClick={() => setDept(d)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  dept === d
                    ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
                    : 'bg-surface-200 text-surface-700 hover:bg-surface-300'
                }`}
              >
                {d || 'All'} {!d && <span className="text-surface-500">({employees.length})</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-center text-sm text-surface-600 py-10">No employees match your search.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(emp => (
            <Card
              key={emp.id}
              hover
              className="cursor-pointer"
              onClick={() => setSelected(emp)}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <div className="relative">
                  <Avatar src={emp.avatar_url} name={emp.full_name} size="xl" />
                  {emp.today_status && (
                    <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface-100 ${
                      emp.today_status === 'present' ? 'bg-success' :
                      emp.today_status === 'on_leave' ? 'bg-info' : 'bg-surface-500'
                    }`} />
                  )}
                </div>

                <div className="min-w-0 w-full">
                  <p className="text-sm font-semibold text-surface-950 truncate">{emp.full_name}</p>
                  {emp.designation && (
                    <p className="text-xs text-surface-600 truncate mt-0.5">{emp.designation}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-center">
                  <Badge variant="default">{ROLE_LABELS[emp.role] ?? emp.role}</Badge>
                  {emp.department && (
                    <Badge variant="brand">{emp.department}</Badge>
                  )}
                  {!emp.is_active && (
                    <Badge variant="danger">Inactive</Badge>
                  )}
                </div>

                {emp.employee_id && (
                  <p className="text-2xs text-surface-500 font-mono">{emp.employee_id}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Profile drawer */}
      <EmployeeProfileDrawer
        employee={selected}
        onClose={() => setSelected(null)}
        canEdit={canEdit}
        onUpdated={patch => selected && handleUpdated(selected.id, patch)}
      />
    </>
  );
}
