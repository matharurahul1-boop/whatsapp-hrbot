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
import { AttendancePolicySchema as Schema } from '@/lib/validation/attendance-policy-schema';

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
