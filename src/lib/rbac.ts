/**
 * Role-Based Access Control (RBAC) utilities
 *
 * Role hierarchy (highest → lowest):
 *   super_admin (5) › admin (4) › hr (3) › manager (2) › employee (1)
 *
 * Use these helpers in every API route and executor tool so permissions
 * are defined in one place and never drift.
 */

export type UserRole = 'super_admin' | 'admin' | 'hr' | 'manager' | 'employee';

const RANK: Record<UserRole, number> = {
  super_admin: 5,
  admin:       4,
  hr:          3,
  manager:     2,
  employee:    1,
};

/** Numeric rank for a role string (0 if unknown/missing). */
export function roleRank(role: string): number {
  return RANK[role as UserRole] ?? 0;
}

/** True if `role` is at or above `minimum` in the hierarchy. */
export function atLeast(role: string, minimum: UserRole): boolean {
  return roleRank(role) >= roleRank(minimum);
}

// ── Convenience role guards ───────────────────────────────────────────────────

export const isEmployee       = (r: string): boolean => r === 'employee';
export const isManager        = (r: string): boolean => r === 'manager';
export const isManagerOrAbove = (r: string): boolean => atLeast(r, 'manager');
export const isHrOrAbove      = (r: string): boolean => atLeast(r, 'hr');
export const isAdminOrAbove   = (r: string): boolean => atLeast(r, 'admin');
export const isSuperAdmin     = (r: string): boolean => r === 'super_admin';

// ── Task field-level permissions ──────────────────────────────────────────────

/**
 * Task fields an employee is allowed to update on their own/assigned task.
 * Anything else requires manager+.
 */
export const EMPLOYEE_TASK_WRITABLE = new Set<string>(['status', 'description']);

/**
 * Task fields that require manager+ to change.
 * Employees get a 403 if they attempt any of these.
 */
export const MANAGER_TASK_FIELDS = new Set<string>([
  'priority', 'assignee_id', 'deadline', 'title', 'tags',
]);

// ── Profile field-level permissions ──────────────────────────────────────────

/** Fields an employee can update on their OWN profile only. */
export const EMPLOYEE_PROFILE_WRITABLE = new Set<string>([
  'full_name', 'avatar_url', 'wa_number',
]);

/** Fields only HR+ can update on another employee's profile. */
export const HR_PROFILE_WRITABLE = new Set<string>([
  'department', 'designation', 'manager_id', 'joined_at',
]);

/** Fields only Admin+ can change (role promotion, deactivation). */
export const ADMIN_PROFILE_WRITABLE = new Set<string>(['role', 'is_active']);

// ── Role display labels (used in UI/bot replies) ──────────────────────────────

export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  hr:          'HR',
  manager:     'Manager',
  employee:    'Employee',
};

// ── Permission summary (used for bot help text) ───────────────────────────────

/** Commands the bot allows per role tier. */
export const BOT_PERMISSIONS = {
  employee: [
    'checkin / checkout',
    'my tasks',
    'create task [title]',
    'complete task [title]',
    'apply leave',
    'my leave balance',
    'cancel leave',
    'my attendance',
    'help',
  ],
  manager: [
    '(all employee commands)',
    'assign task [title] to [name]',
    'team tasks',
    'who is absent',
    'approve/reject leave for [name]',
  ],
  hr: [
    '(all manager commands)',
    'onboarding status',
    'start onboarding for [name]',
  ],
  admin: ['(all hr commands)', 'org-wide reports'],
} as const;
