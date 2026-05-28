/**
 * WALogger — central service for two-way WhatsApp message logging.
 *
 * Design decisions:
 * - Uses `upsert` on `meta_message_id` (UNIQUE) so duplicate webhook
 *   deliveries are silently ignored for incoming messages, and status
 *   updates safely patch existing outgoing rows.
 * - Never throws — all errors are caught and console.error'd so a log
 *   failure never breaks the message processing pipeline.
 * - Resolves user_id lazily by matching wa_number → users.wa_number.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type {
  WAMessage,
  WAStatus,
  WAContact,
  WAApiResponse,
  WAMessageType,
} from '@/types/whatsapp.types';

// ── Types ────────────────────────────────────────────────────────────────

export type WaDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'received';

export interface LogIncomingParams {
  orgId:          string;
  phoneNumberId:  string;
  message:        WAMessage;
  contacts:       WAContact[];
  rawPayload:     unknown;
}

export interface LogOutgoingParams {
  orgId:          string;
  to:             string;              // recipient WA number
  messageType:    WAMessageType | 'template';
  messageText:    string | null;
  outboundPayload: unknown;           // what we sent to Meta
  apiResponse:    WAApiResponse | null;
  error?:         unknown;            // set when send failed
}

export interface UpdateStatusParams {
  status:    WAStatus;
  orgId:     string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function unixToISO(unix: string): string {
  return new Date(parseInt(unix, 10) * 1000).toISOString();
}

/**
 * Normalise a WA number to E.164 format without leading '+'.
 * Meta always sends numbers without '+' (e.g. "919876543210").
 * We store them consistently without '+' to match users.whatsapp_number.
 */
function normaliseNumber(raw: string): string {
  return raw.replace(/^\+/, '').trim();
}

function extractText(msg: WAMessage): string | null {
  switch (msg.type) {
    case 'text':        return msg.text?.body ?? null;
    case 'button':      return msg.button?.payload ?? null;
    case 'interactive':
      return msg.interactive?.button_reply?.title ??
             msg.interactive?.list_reply?.title   ?? null;
    default:            return null;
  }
}

function extractMediaFields(msg: WAMessage) {
  const media =
    msg.image    ??
    msg.document ??
    msg.audio    ??
    msg.video    ??
    msg.sticker  ?? null;

  return {
    media_id:        media?.id           ?? null,
    media_mime_type: media?.mime_type    ?? null,
    media_filename:  (msg.document as { filename?: string } | undefined)?.filename ?? null,
    media_caption:   media?.caption      ?? null,
  };
}

// ── User resolver (cached per process lifecycle) ─────────────────────────

const userCache = new Map<string, string | null>(); // waNumber → userId|null

async function resolveUserId(
  orgId:    string,
  waNumber: string
): Promise<string | null> {
  const cacheKey = `${orgId}:${waNumber}`;
  if (userCache.has(cacheKey)) return userCache.get(cacheKey)!;

  const db = createAdminClient();
  const { data } = await db
    .from('users')
    .select('id')
    .eq('organization_id', orgId)
    .eq('wa_number', waNumber)          // column name in users table
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  const userId = data?.id ?? null;
  // Cache for 5 minutes (avoid hammering DB on every message)
  userCache.set(cacheKey, userId);
  setTimeout(() => userCache.delete(cacheKey), 5 * 60 * 1000);

  return userId;
}

// ── WALogger ──────────────────────────────────────────────────────────────

export const WALogger = {

  /**
   * Log an INCOMING message from a Meta webhook payload.
   * Safe to call multiple times with the same message (idempotent via upsert).
   */
  async logIncoming({
    orgId,
    message,
    contacts,
    rawPayload,
  }: LogIncomingParams): Promise<void> {
    try {
      const waNumber   = normaliseNumber(message.from);
      const userId     = await resolveUserId(orgId, waNumber);
      const contactName = contacts.find(c => c.wa_id === message.from)?.profile?.name ?? null;
      const mediaFields = extractMediaFields(message);

      const db = createAdminClient();
      const { error } = await db.from('wa_logs').upsert(
        {
          organization_id:     orgId,
          user_id:             userId,
          wa_number:           waNumber,
          contact_name:        contactName,
          meta_message_id:     message.id,
          direction:           'incoming',
          message_type:        message.type,
          message_text:        extractText(message),
          ...mediaFields,
          location_lat:        message.location?.latitude  ?? null,
          location_lng:        message.location?.longitude ?? null,
          location_name:       message.location?.name      ?? null,
          reaction_emoji:      message.reaction?.emoji     ?? null,
          reply_to_message_id: message.context?.message_id ?? null,
          delivery_status:     'received',
          wa_timestamp:        unixToISO(message.timestamp),
          raw_webhook_payload: rawPayload as object,
        },
        {
          onConflict:           'meta_message_id',
          ignoreDuplicates:     true,   // silently skip if already logged
        }
      );

      if (error) {
        console.error('[WALogger.logIncoming] ❌ DB error:', error.message, { msgId: message.id });
      } else {
        console.log(`[WALogger.logIncoming] ✅ Saved to wa_logs — msgId: ${message.id}, from: ${waNumber}`);
      }
    } catch (err) {
      console.error('[WALogger.logIncoming] ❌ Unexpected error:', err);
    }
  },

  /**
   * Log an OUTGOING message we sent via the Meta API.
   * Call this AFTER the API call so you have the wamid.
   * On API failure, pass error= and apiResponse=null — still logged
   * with status='failed'.
   */
  async logOutgoing({
    orgId,
    to,
    messageType,
    messageText,
    outboundPayload,
    apiResponse,
    error,
  }: LogOutgoingParams): Promise<void> {
    try {
      const waNumber = normaliseNumber(to);
      const wamid    = apiResponse?.messages?.[0]?.id;

      // If we didn't get a wamid (send failed before Meta accepted),
      // generate a synthetic ID so the UNIQUE constraint still works.
      const metaMessageId = wamid ?? `local_${Date.now()}_${waNumber}`;

      const userId = await resolveUserId(orgId, waNumber);
      const db     = createAdminClient();

      const failureInfo = error
        ? {
            delivery_status: 'failed' as WaDeliveryStatus,
            failed_at:       new Date().toISOString(),
            failure_reason:  error instanceof Error ? error.message : String(error),
          }
        : {
            delivery_status: 'sent' as WaDeliveryStatus,
            sent_at:         new Date().toISOString(),
          };

      const { error: dbErr } = await db.from('wa_logs').insert({
        organization_id:     orgId,
        user_id:             userId,
        wa_number:           waNumber,
        meta_message_id:     metaMessageId,
        direction:           'outgoing',
        message_type:        messageType,
        message_text:        messageText,
        raw_webhook_payload: outboundPayload as object,
        api_response:        (apiResponse ?? null) as object | null,
        wa_timestamp:        new Date().toISOString(),
        ...failureInfo,
      });

      if (dbErr) {
        console.error('[WALogger.logOutgoing] DB error:', dbErr.message, { to, wamid });
      }
    } catch (err) {
      console.error('[WALogger.logOutgoing] Unexpected error:', err);
    }
  },

  /**
   * Update an existing outgoing log row with delivery/read/failed status.
   * Called when Meta fires status webhook events.
   * Uses upsert so a status event that arrives before the send-log
   * (race condition) still gets recorded.
   */
  async updateDeliveryStatus({ status, orgId }: UpdateStatusParams): Promise<void> {
    try {
      const db         = createAdminClient();
      const ts         = unixToISO(status.timestamp);
      const waNumber   = normaliseNumber(status.recipient_id);

      let patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

      switch (status.status) {
        case 'sent':
          patch = { ...patch, delivery_status: 'sent',      sent_at:       ts };
          break;
        case 'delivered':
          patch = { ...patch, delivery_status: 'delivered', delivered_at:  ts };
          break;
        case 'read':
          patch = { ...patch, delivery_status: 'read',      read_at:       ts };
          break;
        case 'failed': {
          const firstError = status.errors?.[0];
          patch = {
            ...patch,
            delivery_status: 'failed',
            failed_at:       ts,
            failure_code:    firstError?.code    ?? null,
            failure_reason:  firstError?.title   ?? firstError?.message ?? null,
          };
          break;
        }
      }

      // Try UPDATE first (normal case: row already exists from logOutgoing)
      const { error: updateErr, count } = await db
        .from('wa_logs')
        .update(patch)
        .eq('meta_message_id', status.id)
        .eq('organization_id', orgId);

      if (updateErr) {
        console.error('[WALogger.updateDeliveryStatus] Update error:', updateErr.message);
        return;
      }

      // If no row matched (status arrived before send log — rare race),
      // insert a placeholder so we don't lose the event.
      if ((count ?? 0) === 0) {
        const userId = await resolveUserId(orgId, waNumber);
        await db.from('wa_logs').insert({
          organization_id:  orgId,
          user_id:          userId,
          wa_number:        waNumber,
          meta_message_id:  status.id,
          direction:        'outgoing',
          message_type:     'unknown',
          delivery_status:  status.status,
          wa_timestamp:     ts,
          ...patch,
        }).throwOnError();
      }
    } catch (err) {
      console.error('[WALogger.updateDeliveryStatus] Unexpected error:', err);
    }
  },

  /**
   * Invalidate the user cache for a specific number.
   * Call this after onboarding a new user so the next message
   * immediately resolves to the correct user_id.
   */
  invalidateUserCache(orgId: string, waNumber: string): void {
    userCache.delete(`${orgId}:${normaliseNumber(waNumber)}`);
  },
};
