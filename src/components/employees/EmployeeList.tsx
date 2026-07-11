'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import type { UserRole, OnboardingStatus } from '@/types/database.types';

interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  department: string | null;
  designation: string | null;
  employee_id: string | null;
  onboarding_status: OnboardingStatus;
  is_active: boolean;
  whatsapp_number: string | null;
  avatar_url: string | null;
}

const roleColors: Record<UserRole, string> = {
  super_admin:  'badge-red',
  admin:        'badge-red',
  hr:           'badge-blue',
  hr_assistant: 'badge-blue',
  manager:      'badge-yellow',
  employee:     'badge-slate',
};

const onboardColors: Record<OnboardingStatus, string> = {
  pending:     'badge-yellow',
  in_progress: 'badge-blue',
  completed:   'badge-green',
};

export default function EmployeeList({
  employees,
  role,
}: {
  employees: Employee[];
  role: UserRole;
}) {
  const [search, setSearch] = useState('');

  const filtered = employees.filter(
    (e) =>
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase()) ||
      (e.department ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          className="input max-w-sm"
          placeholder="Search by name, email, department..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-slate-400 self-center ml-auto">{filtered.length} employees</span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Employee</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">ID</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Department</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Onboarding</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">WhatsApp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    No employees found
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => {
                  const initials = emp.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
                  return (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-brand-700">
                            {initials}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{emp.full_name}</p>
                            <p className="text-xs text-slate-400">{emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{emp.employee_id ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{emp.department ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', roleColors[emp.role])}>{emp.role.replace('_', ' ')}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', onboardColors[emp.onboarding_status])}>
                          {emp.onboarding_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', emp.is_active ? 'badge-green' : 'badge-slate')}>
                          {emp.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {emp.whatsapp_number ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
