import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkPlatformOperatorAdmin } from '@/lib/auth/platform-operator';

// GET /api/organizations — lists every organization on the platform, for the
// platform-operator console (Settings-adjacent /organizations page).
// Restricted to admin/super_admin members of the platform-operator org
// specifically — any other org's admin has no reason to see every other
// customer on the platform.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { allowed } = await checkPlatformOperatorAdmin(db, user.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Only the platform operator org can view all organizations' }, { status: 403 });
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
