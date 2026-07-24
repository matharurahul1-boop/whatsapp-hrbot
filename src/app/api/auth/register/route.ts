import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { distributedRateLimit } from '@/lib/rate-limit';
import { isAdminOrAbove } from '@/lib/rbac';
import { PublicRegistrationSchema, provisionAdminWorkspace } from '@/lib/auth/provision-admin';

// Creating a new organization is an admin/super_admin-only action performed
// from inside the app (Settings → New Organization), not public self-signup —
// this endpoint used to be reachable from a Sign Up tab on the login page
// with no auth at all; that tab is gone and this check is what actually
// closes the gap, not just hiding the button.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user: caller } } = await supabase.auth.getUser();
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: callerProfile } = await admin
    .from('users').select('role').eq('id', caller.id).single();
  if (!callerProfile || !isAdminOrAbove(callerProfile.role)) {
    return NextResponse.json({ error: 'Only admins can create a new organization' }, { status: 403 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!await distributedRateLimit(`register:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many registration attempts. Try again later.' }, { status: 429 });
  }

  const parsed = PublicRegistrationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid registration details' }, { status: 422 });
  }

  const { email, password, ...workspace } = parsed.data;
  const publicAuth = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let userId: string | null = null;

  try {
    // Check the users table directly rather than relying solely on
    // Supabase's identities-length-0 signal for "already registered" —
    // that check has an edge case that let a real employee's account get
    // silently replaced instead of rejected.
    const { data: existingProfile } = await admin
      .from('users').select('id').ilike('email', email).maybeSingle();
    if (existingProfile) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please sign in.' },
        { status: 409 },
      );
    }

    const { data, error } = await publicAuth.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: workspace.fullName },
        emailRedirectTo: `${req.nextUrl.origin}/login`,
      },
    });
    if (error || !data.user) {
      const duplicate = /already|registered|exists/i.test(error?.message ?? '');
      return NextResponse.json(
        { error: duplicate ? 'An account with this email already exists. Please sign in.' : error?.message ?? 'Could not create account' },
        { status: duplicate ? 409 : 400 },
      );
    }
    if (data.user.identities?.length === 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please sign in.' },
        { status: 409 },
      );
    }
    userId = data.user.id;

    const result = await provisionAdminWorkspace({ id: userId, email }, workspace, { forcePasswordChange: true });
    await admin.auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } });
    return NextResponse.json(
      { ok: true, orgId: result.orgId, emailConfirmationRequired: !data.session },
      { status: 201 },
    );
  } catch (error) {
    if (userId) await admin.auth.admin.deleteUser(userId);
    console.error('[register]', error);
    const message = error instanceof Error ? error.message : 'Registration failed';
    const isDuplicateOrg = /workspace named .* already exists/i.test(message);
    return NextResponse.json({ error: message }, { status: isDuplicateOrg ? 409 : 500 });
  }
}
