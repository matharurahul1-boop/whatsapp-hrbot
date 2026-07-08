import { NextRequest, NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog }   from '@/lib/utils/audit';
import { notifyAccountCreated } from '@/lib/whatsapp/notify';
import {
  isEmployee, isManager, isManagerOrAbove, isHrOrAbove, isAdminOrAbove, isSuperAdmin,
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

const CreateAccountSchema = z.object({
  full_name:   z.string().min(1).max(100),
  email:       z.string().email(),
  wa_number:   z.string().min(6).max(20),
  password:    z.string().min(6).max(72),
  role:        z.enum(['super_admin','admin','hr','manager','employee']).default('employee'),
  department:  z.string().min(1).max(100),
  designation: z.string().min(1).max(100),
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
  const page       = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const limit      = Math.min(Math.max(1, parseInt(searchParams.get('limit') ?? '50') || 50), 100);
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

// ── POST /api/employees ───────────────────────────────────────────────────────
// Admin/HR creates an account directly on behalf of someone else (as opposed
// to the self-signup /join flow). Creates the Supabase auth user with the
// given password, seeds their profile + leave balances, and sends the new
// user their login credentials over WhatsApp.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = CreateAccountSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  if (!isHrOrAbove(profile.role)) {
    return NextResponse.json({ error: 'Only HR and above can create accounts for others' }, { status: 403 });
  }

  const { full_name, email, wa_number, password, role, department, designation } = parsed.data;

  // Prevent privilege escalation — creating a higher-privileged account than
  // your own requires being at that level yourself.
  if (role === 'super_admin' && !isSuperAdmin(profile.role)) {
    return NextResponse.json({ error: 'Only a super admin can create another super admin' }, { status: 403 });
  }
  if (role === 'admin' && !isAdminOrAbove(profile.role)) {
    return NextResponse.json({ error: 'Only an admin or above can create an admin account' }, { status: 403 });
  }

  const cleanWaNumber = wa_number.replace(/\D/g, '');
  if (cleanWaNumber.length < 6) {
    return NextResponse.json({ error: 'Enter a valid WhatsApp number' }, { status: 422 });
  }

  // Reject duplicates up front with a clear message rather than surfacing a
  // raw Postgres/Auth error to the admin.
  const { data: existingWa } = await db
    .from('users').select('id')
    .eq('organization_id', profile.organization_id).eq('wa_number', cleanWaNumber)
    .maybeSingle();
  if (existingWa) {
    return NextResponse.json({ error: 'That WhatsApp number is already linked to a team member' }, { status: 409 });
  }

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email:         email.trim(),
    password,
    email_confirm: true, // admin is vouching for this account — skip email verification
    user_metadata: { full_name: full_name.trim() },
  });
  if (createErr || !created?.user) {
    const message = createErr?.message?.includes('already been registered')
      ? 'That email address already has an account'
      : (createErr?.message ?? 'Failed to create the account');
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const newUserId = created.user.id;

  const { data: newProfile, error: profileErr } = await db.from('users').insert({
    id:              newUserId,
    organization_id: profile.organization_id,
    full_name:       full_name.trim(),
    email:           email.trim(),
    wa_number:       cleanWaNumber,
    role,
    department:      department?.trim() || null,
    designation:     designation?.trim() || null,
    is_active:       true,
    joined_at:       new Date().toISOString(),
  }).select().single();

  if (profileErr) {
    // Roll back the orphaned auth user so a failed creation doesn't leave a
    // login-able account with no organization profile behind.
    await db.auth.admin.deleteUser(newUserId).catch(() => {});
    return NextResponse.json({ error: `Failed to create profile: ${profileErr.message}` }, { status: 500 });
  }

  // Seed leave balances, same defaults as the self-signup /join flow.
  const currentYear = new Date().getFullYear();
  const { data: leaveTypes } = await db
    .from('leave_types')
    .select('id, default_days')
    .eq('organization_id', profile.organization_id)
    .eq('is_active', true);

  if (leaveTypes && leaveTypes.length > 0) {
    try {
      await db.from('leave_balances').insert(
        leaveTypes.map(lt => ({
          employee_id:     newUserId,
          organization_id: profile.organization_id,
          leave_type_id:   lt.id,
          entitled_days:   lt.default_days,
          used_days:       0,
          carried_over:    0,
          year:            currentYear,
        }))
      );
    } catch { /* non-critical — account already exists */ }
  }

  await writeAuditLog({
    org_id: profile.organization_id, actor_id: user.id,
    action: 'CREATE', table_name: 'users', record_id: newUserId,
    new_data: { full_name, email, role, department, designation },
  });

  const { data: org } = await db.from('organizations').select('name').eq('id', profile.organization_id).single();
  notifyAccountCreated({
    orgId:        profile.organization_id,
    waNumber:     cleanWaNumber,
    employeeName: full_name.trim(),
    companyName:  org?.name ?? 'your company',
    email:        email.trim(),
    password,
    loginUrl:     `${req.nextUrl.origin}/login`,
  }).catch(() => {});

  return NextResponse.json({ data: newProfile }, { status: 201 });
}
