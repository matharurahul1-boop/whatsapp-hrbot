import { NextRequest, NextResponse } from 'next/server';
import { createClient }      from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog }     from '@/lib/utils/audit';
import { isHrOrAbove }       from '@/lib/rbac';
import { z } from 'zod';

// admin/super_admin never apply for leave (see canApplyForLeave in rbac.ts),
// so they're excluded from the entitlement matrix — there's nothing to set.
const APPLICANT_ROLES = ['employee', 'manager', 'hr_assistant', 'hr'] as const;
const WORK_MODES = ['wfo', 'wfh'] as const;

const UpsertSchema = z.object({
  leave_type_id: z.string().uuid(),
  role:          z.enum(APPLICANT_ROLES),
  work_mode:     z.enum(WORK_MODES),
  default_days:  z.number().min(0).max(365),
});

async function getProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  return profile ? { user, profile, db } : null;
}

// GET /api/leave-policy — the full role x work_mode override matrix for the org (HR+)
export async function GET() {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isHrOrAbove(ctx.profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can view leave policy' }, { status: 403 });
  }

  const { data, error } = await ctx.db
    .from('leave_policy_defaults')
    .select('id, leave_type_id, role, work_mode, default_days')
    .eq('organization_id', ctx.profile.organization_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, applicant_roles: APPLICANT_ROLES, work_modes: WORK_MODES });
}

// PATCH /api/leave-policy — upsert one (leave_type, role, work_mode) -> days rule (HR+)
export async function PATCH(req: NextRequest) {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isHrOrAbove(ctx.profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can manage leave policy' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const { data: lt } = await ctx.db.from('leave_types').select('id')
    .eq('id', parsed.data.leave_type_id).eq('organization_id', ctx.profile.organization_id).maybeSingle();
  if (!lt) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 });

  const { data, error } = await ctx.db.from('leave_policy_defaults').upsert({
    organization_id: ctx.profile.organization_id,
    ...parsed.data,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,leave_type_id,role,work_mode' }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    org_id: ctx.profile.organization_id, actor_id: ctx.user.id,
    action: 'UPDATE', table_name: 'leave_policy_defaults', record_id: data.id, new_data: data,
  });

  return NextResponse.json({ data });
}
