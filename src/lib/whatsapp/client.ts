/**
 * WhatsApp Cloud API client.
 *
 * Every public send* function:
 *  1. Resolves credentials — org DB first, env vars as fallback
 *  2. Calls the Meta Graph API
 *  3. Logs the outgoing message to wa_logs via WALogger
 *  4. Returns the WAApiResponse (or throws on hard failure)
 */

import { WALogger } from './logger';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  WAOutboundPayload,
  WAApiResponse,
  WAButtonAction,
  WAListAction,
  WAMessageType,
} from '@/types/whatsapp.types';

const WA_API_BASE = 'https://graph.facebook.com/v20.0';

// ── Credential resolver ──────────────────────────────────────────────────

interface WACreds {
  phoneNumberId: string;
  accessToken:   string;
}

/** Cache creds per org for 10 minutes to avoid DB hit on every send */
const credsCache = new Map<string, { creds: WACreds; exp: number }>();

async function resolveCreds(orgId?: string): Promise<WACreds> {
  // 1. Try org DB credentials
  if (orgId) {
    const cached = credsCache.get(orgId);
    if (cached && cached.exp > Date.now()) return cached.creds;

    try {
      const db = createAdminClient();
      const { data } = await db
        .from('organizations')
        .select('wa_phone_number_id, wa_access_token')
        .eq('id', orgId)
        .single();

      if (data?.wa_phone_number_id && data?.wa_access_token) {
        const creds: WACreds = {
          phoneNumberId: data.wa_phone_number_id,
          accessToken:   data.wa_access_token,
        };
        credsCache.set(orgId, { creds, exp: Date.now() + 10 * 60 * 1000 });
        return creds;
      }
    } catch {
      // fall through to env vars
    }
  }

  // 2. Fallback to env vars
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp credentials not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env or org settings.');
  }

  return { phoneNumberId, accessToken };
}

/** Invalidate org creds cache (call after org settings update) */
export function invalidateCredsCache(orgId: string) {
  credsCache.delete(orgId);
}

// ── Core send (private) ──────────────────────────────────────────────────

interface SendOptions {
  orgId:       string;
  to:          string;
  messageType: WAMessageType | 'template';
  messageText: string | null;
}

async function sendMessage(
  payload: WAOutboundPayload,
  opts:    SendOptions
): Promise<WAApiResponse> {
  let creds: WACreds;
  try {
    creds = await resolveCreds(opts.orgId);
  } catch (err) {
    throw err;
  }

  let apiResponse: WAApiResponse | null = null;
  let sendError:   unknown              = undefined;

  try {
    const res = await fetch(`${WA_API_BASE}/${creds.phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Extract Meta's error details for better UX
      const metaError = responseBody?.error;
      const code      = metaError?.code;
      const msg       = metaError?.message ?? JSON.stringify(responseBody);

      // Known error codes with friendly messages
      let friendly = msg;
      if (code === 131047) friendly = '24-hour window expired — the recipient must message you first before you can send them a free-form message.';
      if (code === 131026) friendly = 'Message failed — recipient phone number is not a valid WhatsApp account.';
      if (code === 131000) friendly = 'Message failed — unknown error from WhatsApp API.';
      if (code === 131008) friendly = 'Required parameter missing in API call.';
      if (code === 131009) friendly = 'Invalid parameter value in API call.';
      if (code === 131021) friendly = 'Recipient is not in your WhatsApp Business test contacts. Add them in Meta Business → WhatsApp → Settings → Test numbers.';

      throw new Error(`WA API ${res.status} (code ${code}): ${friendly}`);
    }

    apiResponse = responseBody as WAApiResponse;
    console.log(`[WA Client] ✅ Message sent — wamid: ${apiResponse?.messages?.[0]?.id}, to: ${opts.to}`);

  } catch (err) {
    sendError = err;
    console.error(`[WA Client] ❌ Send failed to ${opts.to}:`, err instanceof Error ? err.message : err);
  }

  // Always log — even failures are recorded
  await WALogger.logOutgoing({
    orgId:           opts.orgId,
    to:              opts.to,
    messageType:     opts.messageType,
    messageText:     opts.messageText,
    outboundPayload: payload,
    apiResponse,
    error:           sendError,
  });

  if (sendError) throw sendError;
  return apiResponse!;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function sendText(
  to:    string,
  body:  string,
  orgId: string = ''
): Promise<WAApiResponse> {
  return sendMessage(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'text',
      text:              { body },
    },
    { orgId, to, messageType: 'text', messageText: body }
  );
}

export async function sendButtons(
  to:          string,
  bodyText:    string,
  buttons:     Array<{ id: string; title: string }>,
  orgId:       string = '',
  headerText?: string,
  footerText?: string
): Promise<WAApiResponse> {
  const action: WAButtonAction = {
    buttons: buttons.map(b => ({
      type:  'reply',
      reply: { id: b.id, title: b.title.slice(0, 20) },
    })),
  };

  return sendMessage(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'interactive',
      interactive: {
        type:                        'button',
        ...(headerText && { header: { type: 'text', text: headerText } }),
        body:                        { text: bodyText },
        ...(footerText && { footer: { text: footerText } }),
        action,
      },
    },
    { orgId, to, messageType: 'interactive', messageText: bodyText }
  );
}

export async function sendList(
  to:          string,
  bodyText:    string,
  buttonLabel: string,
  sections:    WAListAction['sections'],
  orgId:       string = '',
  headerText?: string
): Promise<WAApiResponse> {
  return sendMessage(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'interactive',
      interactive: {
        type:                        'list',
        ...(headerText && { header: { type: 'text', text: headerText } }),
        body:                        { text: bodyText },
        action:                      { button: buttonLabel, sections },
      },
    },
    { orgId, to, messageType: 'interactive', messageText: bodyText }
  );
}

export async function sendDocument(
  to:        string,
  fileUrl:   string,
  orgId:     string = '',
  caption?:  string,
  filename?: string
): Promise<WAApiResponse> {
  return sendMessage(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'document',
      document:          { link: fileUrl, caption, filename },
    },
    { orgId, to, messageType: 'document', messageText: caption ?? filename ?? null }
  );
}

/**
 * Send a pre-approved WhatsApp template message.
 * Templates bypass the 24-hour window — can be sent to ANY number at ANY time.
 *
 * @param to           - Recipient WA number (e.g. "919876543210")
 * @param templateName - Approved template name in Meta Business Manager
 * @param variables    - Values for {{1}}, {{2}} ... in the template body
 * @param langCode     - Template language code (default "en")
 * @param orgId        - For credential + log lookup
 */
export async function sendTemplate(
  to:           string,
  templateName: string,
  variables:    string[],
  langCode:     string = 'en',
  orgId:        string = ''
): Promise<WAApiResponse> {
  const components = variables.length > 0
    ? [{
        type:       'body',
        parameters: variables.map(v => ({ type: 'text', text: v })),
      }]
    : [];

  return sendMessage(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'template',
      template: {
        name:       templateName,
        language:   { code: langCode },
        components,
      },
    } as unknown as WAOutboundPayload,
    {
      orgId,
      to,
      messageType: 'text',
      messageText: variables[0] ?? `[Template: ${templateName}]`,
    }
  );
}

export async function downloadMedia(
  mediaId: string
): Promise<{ url: string; mime_type: string }> {
  const { accessToken } = await resolveCreds();
  const res = await fetch(`${WA_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to get media URL for: ${mediaId}`);
  return res.json();
}

export async function markMessageRead(messageId: string, orgId?: string): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await resolveCreds(orgId);
    await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status:            'read',
        message_id:        messageId,
      }),
    });
  } catch {
    // Read receipts are fire-and-forget
  }
}
