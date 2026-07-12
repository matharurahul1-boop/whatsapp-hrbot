import { NextRequest, NextResponse } from 'next/server';
import { createClient }      from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog }     from '@/lib/utils/audit';
import { isHrOrAbove }       from '@/lib/rbac';
import { z } from 'zod';

const UpsertSchema = z.object({
  employee_id:   z.string().uuid(),
  leave_type_id: z.string().uuid(),
  entitled_days: z.number().min(0).max(365),
  year:          z.number().int().min(2020).max(2100).default(new Date().getFullYear()),
});

async function getProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  return profile ? { user, profile, db } : null;
}

// GET /api/employees/leave-balances?employee_id=<uuid>&year=2026 — one
// employee's current entitlement/usage per leave type (HR+)
export async function GET(req: NextRequest) {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isHrOrAbove(ctx.profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can view leave balances here' }, { status: 403 });
  }

  const employeeId = req.nextUrl.searchParams.get('employee_id');
  const year = parseInt(req.nextUrl.searchParams.get('year') ?? '') || new Date().getFullYear();
  if (!employeeId) return NextResponse.json({ error: 'employee_id is required' }, { status: 422 });

  const { data: target } = await ctx.db.from('users').select('id, organization_id')
    .eq('id', employeeId).eq('organization_id', ctx.profile.organization_id).maybeSingle();
  if (!target) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const { data, error } = await ctx.db
    .from('leave_balances')
    .select('id, leave_type_id, entitled_days, used_days, carried_over, remaining_days, leave_type:leave_types(name, color)')
    .eq('employee_id', employeeId)
    .eq('year', year);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// PATCH /api/employees/leave-balances — override one employee's entitled_days
// for a specific leave type/year (creates the row if it doesn't exist yet, HR+)
export async function PATCH(req: NextRequest) {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isHrOrAbove(ctx.profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can override leave balances' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const { data: target } = await ctx.db.from('users').select('id')
    .eq('id', parsed.data.employee_id).eq('organization_id', ctx.profile.organization_id).maybeSingle();
  if (!target) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const { data: lt } = await ctx.db.from('leave_types').select('id')
    .eq('id', parsed.data.leave_type_id).eq('organization_id', ctx.profile.organization_id).maybeSingle();
  if (!lt) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 });

  const { data, error } = await ctx.db.from('leave_balances').upsert({
    employee_id:      parsed.data.employee_id,
    organization_id:  ctx.profile.organization_id,
    leave_type_id:    parsed.data.leave_type_id,
    year:             parsed.data.year,
    entitled_days:    parsed.data.entitled_days,
  }, { onConflict: 'employee_id,leave_type_id,year' }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    org_id: ctx.profile.organization_id, actor_id: ctx.user.id,
    action: 'UPDATE', table_name: 'leave_balances', record_id: data.id, new_data: data,
  });

  return NextResponse.json({ data });
}
