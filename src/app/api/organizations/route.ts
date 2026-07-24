import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin } from '@/lib/rbac';

// GET /api/organizations — lists every organization on the platform, for the
// platform-operator console (Settings-adjacent /organizations page). Every
// other cross-org view in this app (e.g. WA Logs "see every conversation")
// is already super_admin-only, not admin — this follows the same line:
// a plain admin stays scoped to their own org everywhere else, so seeing
// every OTHER customer's org here would be a new cross-tenant leak, not a
// continuation of an existing pattern.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('role').eq('id', user.id).single();
  if (!profile || !isSuperAdmin(profile.role)) {
    return NextResponse.json({ error: 'Only super admins can view all organizations' }, { status: 403 });
  }

  const { data: orgs, error } = await db
    .from('organizations')
    .select('id, name, plan, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: users } = await db
    .from('users')
    .select('organization_id, is_active');
  const countsByOrg = new Map<string, { total: number; active: number }>();
  for (const u of users ?? []) {
    const c = countsByOrg.get(u.organization_id) ?? { total: 0, active: 0 };
    c.total += 1;
    if (u.is_active) c.active += 1;
    countsByOrg.set(u.organization_id, c);
  }

  const data = (orgs ?? []).map(org => ({
    ...org,
    total_users: countsByOrg.get(org.id)?.total ?? 0,
    active_users: countsByOrg.get(org.id)?.active ?? 0,
  }));

  return NextResponse.json({ data });
}
