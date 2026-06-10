import { NextRequest, NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog }   from '@/lib/utils/audit';
import {
  isEmployee, isManager, isManagerOrAbove, isHrOrAbove, isAdminOrAbove,
  EMPLOYEE_PROFILE_WRITABLE, HR_PROFILE_WRITABLE, ADMIN_PROFILE_WRITABLE,
} from '@/lib/rbac';
import { z } from 'zod';

const UpdateProfileSchema = z.object({
  full_name:   z.string().min(1).max(100).optional(),
  department:  z.string().max(100).optional(),
  designation: z.string().max(100).optional(),
  avatar_url:  z.string().url().optional(),
  wa_number:   z.string().max(20).optional(),
  manager_id:  z.string().uuid().nullable().optional(),
  joined_at:   z.string().datetime().optional(),
  is_active:   z.boolean().optional(),
  role:        z.enum(['super_admin','admin','hr','manager','employee']).optional(),
});

// ── GET /api/employees ────────────────────────────────────────────────────────
// employee  → limited directory (name, dept, designation, avatar — no PII)
// manager   → full profiles of their direct reports; limited view of everyone else
// hr/admin  → full org directory
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const search     = searchParams.get('q');
  const department = searchParams.get('department');
  const role       = searchParams.get('role');
  const isActive   = searchParams.get('is_active');
  const page       = parseInt(searchParams.get('page') ?? '1');
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100);
  const offset     = (page - 1) * limit;

  // ── HR+: full directory via analytics view ─────────────────────────────────
  if (isHrOrAbove(profile.role)) {
    let query = db
      .from('v_employee_directory')
      .select('*', { count: 'exact' })
      .eq('organization_id', profile.organization_id)
      .order('full_name')
      .range(offset, offset + limit - 1);

    if (search)     query = query.ilike('full_name', `%${search}%`);
    if (department) query = query.eq('department', department);
    if (role)       query = query.eq('role', role);
    if (isActive !== null && isActive !== undefined) query = query.eq('is_active', isActive === 'true');

    const { data, error, count } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, total: count, page, limit });
  }

  // ── Manager: full profile for direct reports, limited for everyone else ─────
  if (isManager(profile.role)) {
    // Fetch direct reports (full data)
    let reportQuery = db
      .from('v_employee_directory')
      .select('*', { count: 'exact' })
      .eq('organization_id', profile.organization_id)
      .eq('manager_id', user.id)
      .order('full_name')
      .range(offset, offset + limit - 1);

    if (search)     reportQuery = reportQuery.ilike('full_name', `%${search}%`);
    if (department) reportQuery = reportQuery.eq('department', department);

    const { data: reports, count } = await reportQuery;
    return NextResponse.json({ data: reports ?? [], total: count, page, limit, scope: 'team' });
  }

  // ── Employee: limited directory — no PII (no email, no wa_number) ──────────
  let query = db
    .from('users')
    .select('id, full_name, avatar_url, department, designation, role, is_active', { count: 'exact' })
    .eq('organization_id', profile.organization_id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('full_name')
    .range(offset, offset + limit - 1);

  if (search)     query = query.ilike('full_name', `%${search}%`);
  if (department) query = query.eq('department', department);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, total: count, page, limit, scope: 'directory' });
}

// ── PATCH /api/employees ──────────────────────────────────────────────────────
// employee  → update own profile (name, avatar, wa_number only)
// manager   → update direct reports' profile (dept, designation, manager_id)
// hr        → update any employee's basic profile fields
// admin+    → update everything (role, is_active)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { target_id, ...updateFields } = body as { target_id?: string } & Record<string, unknown>;

  const parsed = UpdateProfileSchema.safeParse(updateFields);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const targetId = target_id ?? user.id;
  const isSelf   = targetId === user.id;

  // ── Field-level RBAC ───────────────────────────────────────────────────────
  const attemptedFields = Object.keys(parsed.data) as (keyof typeof parsed.data)[];

  if (isSelf) {
    // Everyone can update their own basic profile fields
    const forbidden = attemptedFields.filter(f => !EMPLOYEE_PROFILE_WRITABLE.has(f) && !HR_PROFILE_WRITABLE.has(f) && !ADMIN_PROFILE_WRITABLE.has(f));
    // Just ensure they aren't trying to change their own role/is_active without admin rights
    const adminOnly = attemptedFields.filter(f => ADMIN_PROFILE_WRITABLE.has(f));
    if (adminOnly.length > 0 && !isAdminOrAbove(profile.role)) {
      return NextResponse.json({ error: `Only admins can change: ${adminOnly.join(', ')}` }, { status: 403 });
    }
    const hrOnly = attemptedFields.filter(f => HR_PROFILE_WRITABLE.has(f));
    if (hrOnly.length > 0 && !isHrOrAbove(profile.role)) {
      return NextResponse.json({ error: `Only HR and above can change: ${hrOnly.join(', ')}` }, { status: 403 });
    }
  } else {
    // Updating someone else's profile
    if (!isManagerOrAbove(profile.role)) {
      return NextResponse.json({ error: 'Forbidden — cannot update other employees\' profiles' }, { status: 403 });
    }

    // Admin-only fields
    const adminOnly = attemptedFields.filter(f => ADMIN_PROFILE_WRITABLE.has(f));
    if (adminOnly.length > 0 && !isAdminOrAbove(profile.role)) {
      return NextResponse.json({ error: `Only admins can change: ${adminOnly.join(', ')}` }, { status: 403 });
    }

    // Manager can only update direct reports
    if (isManager(profile.role)) {
      const { data: reportCheck } = await db
        .from('users').select('id')
        .eq('id', targetId).eq('manager_id', user.id)
        .eq('organization_id', profile.organization_id).maybeSingle();
      if (!reportCheck) {
        return NextResponse.json({ error: 'Managers can only update their direct reports' }, { status: 403 });
      }
      // Managers cannot change admin-only or HR-only fields
      const forbidden = attemptedFields.filter(f => !HR_PROFILE_WRITABLE.has(f) && !EMPLOYEE_PROFILE_WRITABLE.has(f));
      if (forbidden.length > 0) {
        return NextResponse.json({ error: `Managers cannot change: ${forbidden.join(', ')}` }, { status: 403 });
      }
    }
  }

  // Verify target belongs to same org
  const { data: target } = await db
    .from('users').select('id, organization_id')
    .eq('id', targetId).single();
  if (!target || target.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  const { data: updated, error } = await db
    .from('users')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', targetId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    org_id: profile.organization_id, actor_id: user.id,
    action: 'UPDATE', table_name: 'users', record_id: targetId, new_data: updated,
  });

  return NextResponse.json({ data: updated });
}
