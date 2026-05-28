import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/utils/audit';
import { z } from 'zod';

const UpdateProfileSchema = z.object({
  full_name:   z.string().min(1).max(100).optional(),
  department:  z.string().max(100).optional(),
  designation: z.string().max(100).optional(),
  avatar_url:  z.string().url().optional(),
  manager_id:  z.string().uuid().nullable().optional(),
  is_active:   z.boolean().optional(),
  role:        z.enum(['super_admin','admin','hr','manager','employee']).optional(),
});

// GET /api/employees — employee directory (HR+ and managers)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // Employees cannot browse directory
  if (profile.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const search     = searchParams.get('q');
  const department = searchParams.get('department');
  const role       = searchParams.get('role');
  const isActive   = searchParams.get('is_active');
  const page       = parseInt(searchParams.get('page') ?? '1');
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100);
  const offset     = (page - 1) * limit;

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

// PATCH /api/employees — update own profile (or admin updates any)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { target_id, ...updateFields } = body as { target_id?: string } & Record<string, unknown>;

  const parsed = UpdateProfileSchema.safeParse(updateFields);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const targetId = target_id ?? user.id;

  // Only admins/HR can update other users; only admins can change role/is_active
  if (targetId !== user.id && !['super_admin','admin','hr'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if ((parsed.data.role || parsed.data.is_active !== undefined) && !['super_admin','admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only admins can change role or active status' }, { status: 403 });
  }

  // Verify target belongs to same org
  const { data: target } = await db.from('users').select('id, organization_id').eq('id', targetId).single();
  if (!target || target.organization_id !== profile.organization_id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: updated, error } = await db
    .from('users')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', targetId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({ org_id: profile.organization_id, actor_id: user.id, action: 'UPDATE', table_name: 'users', record_id: targetId, new_data: updated });

  return NextResponse.json({ data: updated });
}
