import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AdminWorkspaceSchema, provisionAdminWorkspace } from '@/lib/auth/provision-admin';

// Completes older accounts created before the atomic registration flow existed.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const parsed = AdminWorkspaceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid workspace details' },
        { status: 422 },
      );
    }

    const result = await provisionAdminWorkspace(
      { id: user.id, email: user.email },
      parsed.data,
    );
    return NextResponse.json({ ok: true, orgId: result.orgId });
  } catch (error) {
    console.error('[setup]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Setup failed' },
      { status: 500 },
    );
  }
}
