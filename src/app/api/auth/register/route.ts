import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
import { PublicRegistrationSchema, provisionAdminWorkspace } from '@/lib/auth/provision-admin';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`register:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many registration attempts. Try again later.' }, { status: 429 });
  }

  const parsed = PublicRegistrationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid registration details' }, { status: 422 });
  }

  const { email, password, ...workspace } = parsed.data;
  const admin = createAdminClient();
  const publicAuth = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let userId: string | null = null;

  try {
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

    const result = await provisionAdminWorkspace({ id: userId, email }, workspace);
    await admin.auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } });
    return NextResponse.json(
      { ok: true, orgId: result.orgId, emailConfirmationRequired: !data.session },
      { status: 201 },
    );
  } catch (error) {
    if (userId) await admin.auth.admin.deleteUser(userId);
    console.error('[register]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Registration failed' },
      { status: 500 },
    );
  }
}
