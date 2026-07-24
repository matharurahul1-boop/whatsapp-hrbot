/**
 * GET/PATCH /api/organizations/attendance-policy
 * Org-wide attendance policy — working days, shift timing, grace period,
 * half-day rules, capture method, WFH, overtime, regularization, holidays,
 * and escalation preferences. One row per org (see the
 * 202607241400_attendance_policy.sql migration). Admin-only, like the rest
 * of organization-level settings.
 *
 * GET returns `{ data: null }` for an org that hasn't run the wizard yet —
 * callers (both this settings UI and attendance execution code) must treat
 * that the same as "no policy configured," not an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { isAdminOrAbove }            from '@/lib/rbac';
import { z } from 'zod';

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

const Schema = z.object({
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

  summary_text:                   z.string().max(4000).optional(),
  is_configured:                  z.boolean().optional(),
});

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) } as const;
  if (!isAdminOrAbove(profile.role)) return { error: NextResponse.json({ error: 'Only admins can manage the attendance policy' }, { status: 403 }) } as const;

  return { db, orgId: profile.organization_id, userId: user.id } as const;
}

export async function GET() {
  const ctx = await requireAdmin();
  if ('error' in ctx) return ctx.error;

  const { data, error } = await ctx.db
    .from('attendance_policies').select('*').eq('organization_id', ctx.orgId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? null });
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireAdmin();
  if ('error' in ctx) return ctx.error;

  const body   = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    const msg = firstError ? `${firstError.path.join('.') || 'field'}: ${firstError.message}` : 'Invalid request data';
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const { error } = await ctx.db
    .from('attendance_policies')
    .upsert({
      organization_id: ctx.orgId,
      ...parsed.data,
      ...(parsed.data.is_configured && { configured_by: ctx.userId }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data, error: reloadError } = await ctx.db
    .from('attendance_policies').select('*').eq('organization_id', ctx.orgId).single();
  if (reloadError) return NextResponse.json({ error: reloadError.message }, { status: 500 });

  return NextResponse.json({ data });
}
