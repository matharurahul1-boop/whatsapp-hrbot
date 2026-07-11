import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isHrOrAbove } from '@/lib/rbac';
import { signInvite, type InviteRole } from '@/lib/utils/invite-token';
import { z } from 'zod';

const InviteSchema = z.object({
  role: z.enum(['employee', 'manager', 'hr_assistant', 'hr']),
});

// POST /api/organizations/invite — mint a signed invite link for the
// caller's own organization. The org always comes from the caller's
// session, never from the request body, so an HR/admin user can only ever
// generate invites for their own workspace.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !isHrOrAbove(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = InviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const role: InviteRole = parsed.data.role;

  const token = signInvite(profile.organization_id, role);
  return NextResponse.json({ token });
}
