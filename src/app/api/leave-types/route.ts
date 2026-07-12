import { NextRequest, NextResponse } from 'next/server';
import { createClient }      from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog }     from '@/lib/utils/audit';
import { isHrOrAbove }       from '@/lib/rbac';
import { z } from 'zod';

const CreateSchema = z.object({
  name:              z.string().min(1).max(60),
  default_days:      z.number().min(0).max(365),
  color:             z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3b82f6'),
  carry_forward:     z.boolean().default(false),
  requires_approval: z.boolean().default(true),
});

const UpdateSchema = z.object({
  id:                z.string().uuid(),
  name:              z.string().min(1).max(60).optional(),
  default_days:      z.number().min(0).max(365).optional(),
  color:             z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  carry_forward:     z.boolean().optional(),
  requires_approval: z.boolean().optional(),
  is_active:         z.boolean().optional(),
});

async function getProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  return profile ? { user, profile, db } : null;
}

// GET /api/leave-types — list every leave type for the org (active + inactive)
export async function GET() {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await ctx.db
    .from('leave_types')
    .select('id, name, default_days, color, carry_forward, requires_approval, is_active')
    .eq('organization_id', ctx.profile.organization_id)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST /api/leave-types — create a new leave type (HR+)
export async function POST(req: NextRequest) {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isHrOrAbove(ctx.profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can manage leave types' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const { data, error } = await ctx.db.from('leave_types').insert({
    organization_id: ctx.profile.organization_id,
    ...parsed.data,
    is_active: true,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    org_id: ctx.profile.organization_id, actor_id: ctx.user.id,
    action: 'CREATE', table_name: 'leave_types', record_id: data.id, new_data: data,
  });

  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/leave-types — update name/color/default_days/flags, or deactivate (HR+)
export async function PATCH(req: NextRequest) {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isHrOrAbove(ctx.profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can manage leave types' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  const { id, ...fields } = parsed.data;

  const { data: existing } = await ctx.db.from('leave_types').select('id')
    .eq('id', id).eq('organization_id', ctx.profile.organization_id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 });

  const { data, error } = await ctx.db.from('leave_types').update(fields).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    org_id: ctx.profile.organization_id, actor_id: ctx.user.id,
    action: 'UPDATE', table_name: 'leave_types', record_id: id, new_data: data,
  });

  return NextResponse.json({ data });
}

// DELETE /api/leave-types?id=<uuid> — remove a leave type (HR+).
// Hard-deletes when nothing references it yet; if leave_requests or
// leave_balances already exist for it, deactivates instead so history and
// balances stay intact rather than failing outright or cascading deletes.
export async function DELETE(req: NextRequest) {
  const ctx = await getProfile();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isHrOrAbove(ctx.profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can manage leave types' }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 422 });

  const { data: existing } = await ctx.db.from('leave_types').select('id, name')
    .eq('id', id).eq('organization_id', ctx.profile.organization_id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 });

  const [{ count: requestCount }, { count: balanceCount }] = await Promise.all([
    ctx.db.from('leave_requests').select('id', { count: 'exact', head: true }).eq('leave_type_id', id),
    ctx.db.from('leave_balances').select('id', { count: 'exact', head: true }).eq('leave_type_id', id),
  ]);

  if ((requestCount ?? 0) > 0 || (balanceCount ?? 0) > 0) {
    const { error } = await ctx.db.from('leave_types').update({ is_active: false }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog({
      org_id: ctx.profile.organization_id, actor_id: ctx.user.id,
      action: 'UPDATE', table_name: 'leave_types', record_id: id, new_data: { is_active: false },
    });

    return NextResponse.json({ deactivated: true, message: `"${existing.name}" has existing leave records, so it was deactivated instead of deleted.` });
  }

  const { error } = await ctx.db.from('leave_types').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    org_id: ctx.profile.organization_id, actor_id: ctx.user.id,
    action: 'DELETE', table_name: 'leave_types', record_id: id, old_data: existing,
  });

  return NextResponse.json({ deactivated: false });
}
