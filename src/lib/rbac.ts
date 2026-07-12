/**
 * Role-Based Access Control (RBAC) utilities
 *
 * Role hierarchy (highest → lowest):
 *   super_admin (6) › admin (5) › hr (4) › hr_assistant (3) › manager (2) › employee (1)
 *
 * hr_assistant sits below hr for every generic atLeast()-based check (task,
 * attendance, org-settings, etc. permissions) — it only gets its own
 * broader powers where explicitly coded (see the leave-approval hierarchy
 * below). Requires the 'hr_assistant' value to exist in the live
 * `user_role` Postgres enum — see
 * supabase/migrations/202607120001_add_hr_assistant_role.sql.
 *
 * Use these helpers in every API route and executor tool so permissions
 * are defined in one place and never drift.
 */

export type UserRole = 'super_admin' | 'admin' | 'hr' | 'hr_assistant' | 'manager' | 'employee';

const RANK: Record<UserRole, number> = {
  super_admin:  6,
  admin:        5,
  hr:           4,
  hr_assistant: 3,
  manager:      2,
  employee:     1,
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
  'department', 'designation', 'manager_id', 'joined_at', 'onboarding_status', 'work_mode',
]);

/** Fields only Admin+ can change (role promotion, deactivation). */
export const ADMIN_PROFILE_WRITABLE = new Set<string>(['role', 'is_active']);

// ── Role display labels (used in UI/bot replies) ──────────────────────────────

export const ROLE_LABEL: Record<string, string> = {
  super_admin:  'Super Admin',
  admin:        'Admin',
  hr:           'HR',
  hr_assistant: 'HR Assistant',
  manager:      'Manager',
  employee:     'Employee',
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
  ],
  hr_assistant: [
    '(all manager commands)',
    'approve/reject leave for employees and managers',
  ],
  hr: [
    '(all hr_assistant commands)',
    'approve/reject leave for hr_assistant',
    'onboarding status',
    'start onboarding for [name]',
  ],
  admin: ['(all hr commands)', 'approve/reject leave for hr', 'org-wide reports'],
} as const;

// ── Leave approval hierarchy ──────────────────────────────────────────────────
//
// Who may approve/reject a leave request depends on the APPLICANT's own
// role, not a flat "manager+" rule: approving is always strictly above the
// applicant's own rank, so nobody approves their own tier's leave.
//   employee / manager  → hr_assistant, hr, admin, super_admin
//   hr_assistant        → hr, admin, super_admin
//   hr                  → admin, super_admin
//   admin / super_admin → can't apply for leave at all (see canApplyForLeave)
const LEAVE_APPROVER_MIN_RANK: Partial<Record<UserRole, UserRole>> = {
  employee:     'hr_assistant',
  manager:      'hr_assistant',
  hr_assistant: 'hr',
  hr:           'admin',
};

/** True if `approverRole` may approve/reject a leave request filed by someone with `applicantRole`. */
export function canApproveLeaveFor(approverRole: string, applicantRole: string): boolean {
  const minRole = LEAVE_APPROVER_MIN_RANK[applicantRole as UserRole];
  if (!minRole) return false; // admin/super_admin leave doesn't exist — they can't apply
  return atLeast(approverRole, minRole);
}

/** True if `role` is allowed to apply for its own leave — everyone except admin/super_admin. */
export function canApplyForLeave(role: string): boolean {
  return !isAdminOrAbove(role);
}
