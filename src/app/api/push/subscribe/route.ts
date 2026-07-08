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
  const { error } = await db.from('push_subscriptions').upsert(
    {
      user_id:    user.id,
      endpoint,
      p256dh:     keys.p256dh,
      auth:       keys.auth,
      user_agent: req.headers.get('user-agent') ?? null,
    },
    { onConflict: 'endpoint' },
  );

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
