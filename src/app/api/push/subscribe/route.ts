import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth:   z.string().min(1),
  }),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = SubscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { endpoint, keys } = parsed.data;

  const db = createAdminClient();
  const row = {
    user_id:    user.id,
    endpoint,
    p256dh:     keys.p256dh,
    auth:       keys.auth,
    user_agent: req.headers.get('user-agent') ?? null,
  };

  // Conflict target is (user_id, endpoint), not endpoint alone — an endpoint
  // is tied to the browser/device, not to who's logged in, so a shared or
  // reused browser can hold one subscription row per user, not just the
  // most recent login (see migration 018). Falls back to the old endpoint-only
  // conflict target if that migration hasn't run yet, rather than failing
  // subscribe outright with "no unique constraint matches".
  let { error } = await db.from('push_subscriptions').upsert(row, { onConflict: 'user_id,endpoint' });
  if (error?.message.includes('no unique or exclusion constraint')) {
    ({ error } = await db.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' }));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const UnsubscribeSchema = z.object({ endpoint: z.string().url() });

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = UnsubscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = createAdminClient();
  await db.from('push_subscriptions')
    .delete()
    .eq('endpoint', parsed.data.endpoint)
    .eq('user_id', user.id);

  return NextResponse.json({ ok: true });
}
