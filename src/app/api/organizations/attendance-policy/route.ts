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
 *
 * Optional ?orgId= (GET) / body.orgId (PATCH) targets a DIFFERENT org's
 * policy — only honored for admin/super_admin members of the
 * platform-operator org (see src/lib/auth/platform-operator.ts); anyone
 * else is scoped to their own org regardless of what's passed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { isAdminOrAbove }            from '@/lib/rbac';
import { checkPlatformOperatorAdmin } from '@/lib/auth/platform-operator';
import { AttendancePolicySchema as Schema } from '@/lib/validation/attendance-policy-schema';

async function resolveContext(targetOrgId?: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) } as const;
  if (!isAdminOrAbove(profile.role)) return { error: NextResponse.json({ error: 'Only admins can manage the attendance policy' }, { status: 403 }) } as const;

  if (targetOrgId && targetOrgId !== profile.organization_id) {
    const { allowed } = await checkPlatformOperatorAdmin(db, user.id);
    if (!allowed) {
      return { error: NextResponse.json({ error: "Only the platform operator org can edit another organization's attendance policy" }, { status: 403 }) } as const;
    }
    return { db, orgId: targetOrgId, userId: user.id } as const;
  }

  return { db, orgId: profile.organization_id, userId: user.id } as const;
}

export async function GET(req: NextRequest) {
  const ctx = await resolveContext(req.nextUrl.searchParams.get('orgId'));
  if ('error' in ctx) return ctx.error;

  const { data, error } = await ctx.db
    .from('attendance_policies').select('*').eq('organization_id', ctx.orgId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? null });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { orgId: targetOrgId, ...policyBody } = body ?? {};

  const ctx = await resolveContext(targetOrgId);
  if ('error' in ctx) return ctx.error;

  const parsed = Schema.safeParse(policyBody);
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
