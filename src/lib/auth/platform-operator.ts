import type { createAdminClient } from '@/lib/supabase/admin';
import { isAdminOrAbove } from '@/lib/rbac';

// The platform operator is the one organization (flagged
// organizations.is_platform_operator) that runs this HRBot deployment for
// multiple customers. Creating a new organization, and editing any
// existing org's creation-time settings (workspace fields, attendance
// policy), is restricted to admin/super_admin members of THAT org
// specifically — not any admin anywhere, since a customer's own admin
// having either power would let them create workspaces on your behalf or
// reach into another customer's configuration.

export interface PlatformOperatorCheck {
  allowed: boolean;
  organizationId: string | null;
}

export async function checkPlatformOperatorAdmin(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<PlatformOperatorCheck> {
  const { data: profile } = await db
    .from('users')
    .select('role, organization_id, organizations(is_platform_operator)')
    .eq('id', userId)
    .single();

  if (!profile || !isAdminOrAbove(profile.role)) {
    return { allowed: false, organizationId: profile?.organization_id ?? null };
  }

  const org = profile.organizations as { is_platform_operator?: boolean } | { is_platform_operator?: boolean }[] | null;
  const isOperator = Array.isArray(org) ? !!org[0]?.is_platform_operator : !!org?.is_platform_operator;

  return { allowed: isOperator, organizationId: profile.organization_id };
}
