import { z } from 'zod';

// Shared between /api/organizations/attendance-policy (editing an existing
// org's policy from Settings) and provision-admin.ts (setting the policy
// during org creation) — one schema, so the two flows can never drift.

const ShiftSchema = z.object({
  name:  z.string().min(1).max(60),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end:   z.string().regex(/^\d{2}:\d{2}$/),
});

const GeoFenceSchema = z.object({
  name:      z.string().min(1).max(100),
  lat:       z.number(),
  lng:       z.number(),
  radius_m:  z.number().int().min(10).max(5000),
});

const HolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(120),
});

export const AttendancePolicySchema = z.object({
  working_days_type:              z.enum(['5', '5.5', '6', 'rotational']).optional(),
  weekly_offs:                    z.array(z.string()).optional(),
  shift_type:                     z.enum(['single', 'multiple_fixed', 'rotational']).optional(),
  shifts:                         z.array(ShiftSchema).min(1).optional(),
  shift_assignment_method:        z.enum(['manager_assigned', 'self_select', 'roster_based']).nullable().optional(),

  is_flexible_hours:              z.boolean().optional(),
  flexible_window_start:          z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  flexible_window_end:            z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  full_day_hours:                 z.number().min(1).max(24).optional(),

  grace_period_enabled:           z.boolean().optional(),
  grace_minutes:                  z.number().int().min(0).max(180).optional(),
  late_allowed_per_month:         z.number().int().min(0).max(60).optional(),
  late_violation_action:          z.enum(['half_day', 'lop', 'flag', 'manager_discretion']).optional(),

  half_day_threshold_hours:       z.number().min(0).max(24).optional(),
  early_leave_tracked_separately: z.boolean().optional(),
  early_leave_threshold_minutes:  z.number().int().min(0).max(480).nullable().optional(),

  capture_methods:                z.array(z.enum(['biometric', 'mobile_gps', 'selfie', 'web', 'ip_restricted'])).optional(),
  geo_fence_locations:            z.array(GeoFenceSchema).optional(),
  has_field_employees:            z.boolean().optional(),
  field_employees_separate_policy: z.boolean().optional(),
  wfh_enabled:                    z.boolean().optional(),
  wfh_requires_approval:          z.boolean().optional(),
  wfh_counts_as_attendance:       z.boolean().optional(),

  overtime_enabled:               z.boolean().optional(),
  overtime_threshold_hours:       z.number().min(0).max(24).nullable().optional(),
  overtime_requires_preapproval:  z.boolean().optional(),

  regularization_enabled:         z.boolean().optional(),
  regularization_monthly_limit:   z.number().int().min(0).max(31).optional(),
  regularization_approver_role:   z.string().min(1).max(30).optional(),

  holidays:                       z.array(HolidaySchema).optional(),
  auto_sync_leave_attendance:     z.boolean().optional(),

  escalation_notify:              z.enum(['manager', 'hr', 'both']).optional(),
  escalation_frequency:           z.enum(['realtime', 'weekly', 'monthly']).optional(),
  employee_dashboard_visible:     z.boolean().optional(),
  employee_dashboard_detail:      z.enum(['summary', 'detailed']).optional(),

  summary_text:                   z.string().max(4000).optional(),
  is_configured:                  z.boolean().optional(),
});

export type AttendancePolicyPatch = z.infer<typeof AttendancePolicySchema>;
