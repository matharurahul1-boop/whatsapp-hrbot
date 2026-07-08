import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject    = process.env.VAPID_SUBJECT || 'mailto:support@example.com';
  if (!publicKey || !privateKey) return;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Sends a browser push notification to every subscription registered for a
 * user. Fire-and-forget — logs errors internally and never throws, mirroring
 * the WhatsApp notify.ts helpers. Subscriptions the push service reports as
 * gone (404/410 — user revoked permission, cleared site data, etc.) are
 * deleted so we stop paying the cost of sending to them.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  ensureConfigured();
  if (!configured) return;

  const db = createAdminClient();
  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs?.length) return;

  const body = JSON.stringify(payload);

  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('[Push] send failed', err instanceof Error ? err.message : err);
      }
    }
  }));
}
