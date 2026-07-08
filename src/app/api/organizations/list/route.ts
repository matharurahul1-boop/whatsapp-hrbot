import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/organizations/list — public endpoint powering the generic "pick
// your organization" step on /join when someone arrives without a
// pre-filled invite link (?org=...&role=...).
export async function GET() {
  const db = createAdminClient();

  // Only list organizations that actually have at least one active employee.
  // Test/abandoned orgs from onboarding trials would otherwise sit in the
  // dropdown indistinguishable from a real workspace by name alone.
  const { data: activeUsers } = await db.from('users').select('organization_id').eq('is_active', true);
  const activeOrgIds = [...new Set((activeUsers ?? []).map(u => u.organization_id))];
  if (!activeOrgIds.length) return NextResponse.json({ organizations: [] });

  const { data, error } = await db
    .from('organizations')
    .select('id, name')
    .in('id', activeOrgIds)
    .order('name');

  if (error) return NextResponse.json({ error: 'Failed to load organizations' }, { status: 500 });

  return NextResponse.json({ organizations: data ?? [] });
}
