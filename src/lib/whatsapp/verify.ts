/**
 * WhatsApp webhook security helpers.
 *
 * Two separate secrets:
 *  - WHATSAPP_APP_SECRET       → signs every POST body  (HMAC-SHA256)
 *  - WHATSAPP_WEBHOOK_VERIFY_TOKEN → challenge handshake (plain string)
 *
 * Meta docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */

import crypto from 'crypto';

/**
 * Verify the x-hub-signature-256 header on incoming POST webhook events.
 * Uses the App Secret (not the verify token).
 */
export function verifyWebhookSignature(
  rawBody:         string,
  signature:       string | null,
  bridgeSecret?:   string | null   // from X-Bridge-Secret header (edge function forwards)
): boolean {

  // ── Internal bridge: Supabase Edge Function forwarding ───────────────
  // The edge function is the public-facing webhook. It forwards the raw
  // payload to us with a shared secret instead of the Meta HMAC.
  const internalSecret = process.env.INTERNAL_BRIDGE_SECRET;
  if (internalSecret && bridgeSecret === internalSecret) {
    console.log('[WA Webhook] ✅ Internal bridge request accepted');
    return true;
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;

  // ── Development mode: skip verification entirely ─────────────────────
  if (!appSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[WA Webhook] WHATSAPP_APP_SECRET is not set — rejecting all requests');
      return false;
    }
    console.warn('[WA Webhook] DEV MODE — signature check skipped');
    return true;
  }

  // ── Production: HMAC-SHA256 signature check ───────────────────────────
  if (!signature) return false;

  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf-8')
    .digest('hex');

  const received = signature.replace(/^sha256=/, '');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHex, 'hex'),
      Buffer.from(received,    'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Respond to Meta's GET challenge during webhook subscription setup.
 * Uses the plain verify token (not the app secret).
 */
export function verifyWebhookChallenge(
  mode:      string | null,
  token:     string | null,
  challenge: string | null
): string | null {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error('[WA Webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set');
    return null;
  }

  if (mode === 'subscribe' && token === verifyToken) {
    return challenge;
  }
  return null;
}
