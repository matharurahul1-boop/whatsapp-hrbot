import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const Schema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(72)
    .regex(/[a-z]/, 'Password needs a lowercase letter')
    .regex(/[A-Z]/, 'Password needs an uppercase letter')
    .regex(/\d/, 'Password needs a number'),
});

// POST /api/auth/change-required-password — the forced first-login password
// change for a new org's founding admin (see /change-password-required and
// provision-admin.ts's forcePasswordChange). Updates the Auth password AND
// clears users.metadata.must_change_password so the dashboard layout's
// redirect gate stops firing — both steps use the admin client rather than
// relying on RLS self-update, matching how the rest of the app writes to
// the users table.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid password' }, { status: 422 });
  }

  const admin = createAdminClient();

  const { data: profile } = await admin.from('users').select('metadata').eq('id', user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { error: pwError } = await admin.auth.admin.updateUserById(user.id, { password: parsed.data.password });
  if (pwError) return NextResponse.json({ error: pwError.message }, { status: 500 });

  const restMetadata = { ...(profile.metadata as Record<string, unknown> | null) };
  delete restMetadata.must_change_password;
  const { error: metaError } = await admin.from('users').update({ metadata: restMetadata }).eq('id', user.id);
  if (metaError) return NextResponse.json({ error: metaError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
