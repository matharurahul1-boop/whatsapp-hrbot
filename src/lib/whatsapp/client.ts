/**
 * WhatsApp outgoing message client.
 *
 * Provider is selected automatically at runtime:
 *  • AISensy Campaign API — when AISENSY_API_KEY + AISENSY_TEXT_CAMPAIGN are both set
 *  • Meta WhatsApp Cloud API — fallback when AISensy is not fully configured
 *
 * markMessageRead and downloadMedia always use Meta Graph API directly
 * because AISensy has no equivalent endpoints for those operations.
 */

import { WALogger } from './logger';
import { aisensySend } from './aisensy';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  WAOutboundPayload,
  WAApiResponse,
  WAButtonAction,
  WAListAction,
  WAMessageType,
} from '@/types/whatsapp.types';

// ── Provider detection ────────────────────────────────────────────────────

function isAISensyConfigured(): boolean {
  return !!(process.env.AISENSY_API_KEY && process.env.AISENSY_TEXT_CAMPAIGN);
}

// ── Meta credentials ──────────────────────────────────────────────────────

interface MetaCreds {
  phoneNumberId: string;
  accessToken:   string;
}

const credsCache = new Map<string, { creds: MetaCreds; exp: number }>();
export function invalidateMetaCreds(orgId: string): void { credsCache.delete(orgId); }

async function resolveMetaCreds(orgId?: string): Promise<MetaCreds> {
  // DB token takes priority — can be updated in Supabase without redeploying Vercel.
  // Env vars are fallback only (useful for local dev / initial setup).
  if (orgId) {
    const cached = credsCache.get(orgId);
    if (cached && cached.exp > Date.now()) return cached.creds;

    try {
      const db = createAdminClient();
      const [{ data }, { data: secret }] = await Promise.all([
        db.from('organizations').select('wa_phone_number_id, wa_access_token').eq('id', orgId).single(),
        db.from('organization_secrets').select('wa_access_token').eq('organization_id', orgId).maybeSingle(),
      ]);

      const accessToken = secret?.wa_access_token ?? data?.wa_access_token;
      if (data?.wa_phone_number_id && accessToken) {
        const creds: MetaCreds = {
          phoneNumberId: data.wa_phone_number_id,
          accessToken,
        };
        credsCache.set(orgId, { creds, exp: Date.now() + 10 * 60 * 1000 }); // 10 min cache
        return creds;
      }
    } catch {
      // fall through to env vars
    }
  }

  // Fallback: env vars (local dev / orgs not yet in DB)
  const envPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const envToken   = process.env.WHATSAPP_ACCESS_TOKEN;
  if (envPhoneId && envToken) {
    return { phoneNumberId: envPhoneId, accessToken: envToken };
  }

  throw new Error(
    'WhatsApp credentials not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env.local'
  );
}

export function invalidateCredsCache(orgId: string) {
  credsCache.delete(orgId);
}

const META_API_BASE = 'https://graph.facebook.com/v20.0';

// ── Shared send options ───────────────────────────────────────────────────

interface SendOpts {
  orgId:       string;
  to:          string;
  messageType: WAMessageType | 'template';
  messageText: string | null;
}

// ── Meta send path ────────────────────────────────────────────────────────

async function sendViaMeta(
  payload: WAOutboundPayload,
  opts:    SendOpts
): Promise<WAApiResponse> {
  const creds = await resolveMetaCreds(opts.orgId);

  let apiResponse: WAApiResponse | null = null;
  let sendError:   unknown;

  // One retry on transient 5xx errors from Meta
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${META_API_BASE}/${creds.phoneNumberId}/messages`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));

      if (res.status >= 500 && attempt === 0) {
        console.warn(`[Meta WA] 5xx on attempt 1 — retrying once`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (!res.ok) {
        const code = body?.error?.code;
        const msg  = body?.error?.message ?? JSON.stringify(body);
        let friendly = msg;
        if (code === 131047) friendly = '24-hour window expired — the recipient must message you first.';
        if (code === 131026) friendly = 'Recipient phone number is not a valid WhatsApp account.';
        if (code === 131021) friendly = 'Recipient is not in your WhatsApp test contacts.';
        if (code === 131000) friendly = 'Unknown error from WhatsApp API.';
        if (code === 131008) friendly = 'Required parameter missing in API call.';
        if (code === 131009) friendly = 'Invalid parameter value in API call.';
        throw new Error(`WA API ${res.status} (code ${code}): ${friendly}`);
      }

      apiResponse = body as WAApiResponse;
      console.log(`[Meta WA] ✅ Sent — wamid: ${apiResponse?.messages?.[0]?.id}, to: ${opts.to}`);
      sendError = undefined;
      break;
    } catch (err) {
      sendError = err;
      if (attempt === 0 && err instanceof Error && err.message.includes('5xx')) continue;
      console.error(`[Meta WA] ❌ Failed to ${opts.to}:`, err instanceof Error ? err.message : err);
      break;
    }
  }

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

// ── AISensy send path ─────────────────────────────────────────────────────

interface AISensySendOpts extends SendOpts {
  campaignName:    string;
  templateParams?: string[];
  mediaUrl?:       string;
  mediaFilename?:  string;
}

async function sendViaAISensy(opts: AISensySendOpts): Promise<WAApiResponse> {
  const apiKey = process.env.AISENSY_API_KEY!;

  let apiResponse: WAApiResponse | null = null;
  let sendError:   unknown;

  try {
    const result = await aisensySend({
      apiKey,
      campaignName: opts.campaignName,
      destination:  opts.to,
      userName:     'User',
      source:       'api',
      ...(opts.templateParams?.length && { templateParams: opts.templateParams }),
      ...(opts.mediaUrl && { media: { url: opts.mediaUrl, filename: opts.mediaFilename } }),
    });
    apiResponse = result as WAApiResponse;
    console.log(`[AISensy] ✅ Campaign "${opts.campaignName}" sent to ${opts.to}`);
  } catch (err) {
    sendError = err;
    console.error(`[AISensy] ❌ Failed to ${opts.to}:`, err instanceof Error ? err.message : err);
  }

  await WALogger.logOutgoing({
    orgId:           opts.orgId,
    to:              opts.to,
    messageType:     opts.messageType,
    messageText:     opts.messageText,
    outboundPayload: {
      campaignName:   opts.campaignName,
      destination:    opts.to,
      templateParams: opts.templateParams,
    } as unknown as WAOutboundPayload,
    apiResponse,
    error: sendError,
  });

  if (sendError) throw sendError;
  return apiResponse!;
}

// ── Public API ────────────────────────────────────────────────────────────

const WA_TEXT_MAX = 4096;

export async function sendText(
  to:    string,
  body:  string,
  orgId: string = ''
): Promise<WAApiResponse> {
  // WhatsApp max text body is 4096 characters
  const safeBody = body.length > WA_TEXT_MAX
    ? body.slice(0, WA_TEXT_MAX - 3) + '…'
    : body;

  if (isAISensyConfigured()) {
    return sendViaAISensy({
      orgId, to,
      messageType:    'text',
      messageText:    safeBody,
      campaignName:   process.env.AISENSY_TEXT_CAMPAIGN!,
      templateParams: [safeBody],
    });
  }

  return sendViaMeta(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'text',
      text:              { body: safeBody },
    },
    { orgId, to, messageType: 'text', messageText: safeBody }
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
  // WhatsApp allows max 3 quick-reply buttons
  const safeButtons = buttons.slice(0, 3);

  if (isAISensyConfigured()) {
    const lines = [
      ...(headerText ? [headerText] : []),
      bodyText,
      '',
      ...safeButtons.map((b, i) => `${i + 1}. ${b.title}`),
    ];
    return sendViaAISensy({
      orgId, to,
      messageType:    'interactive',
      messageText:    bodyText,
      campaignName:   process.env.AISENSY_TEXT_CAMPAIGN!,
      templateParams: [lines.join('\n')],
    });
  }

  const action: WAButtonAction = {
    buttons: safeButtons.map(b => ({
      type:  'reply',
      reply: { id: b.id, title: b.title.slice(0, 20) },
    })),
  };
  return sendViaMeta(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'interactive',
      interactive: {
        type:                          'button',
        ...(headerText && { header: { type: 'text', text: headerText } }),
        body:                          { text: bodyText },
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
  if (isAISensyConfigured()) {
    const items = sections.flatMap(s =>
      s.rows.map(r => `• ${r.title}${r.description ? ` — ${r.description}` : ''}`)
    );
    const lines = [...(headerText ? [headerText] : []), bodyText, '', ...items];
    return sendViaAISensy({
      orgId, to,
      messageType:    'interactive',
      messageText:    bodyText,
      campaignName:   process.env.AISENSY_TEXT_CAMPAIGN!,
      templateParams: [lines.join('\n')],
    });
  }

  return sendViaMeta(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'interactive',
      interactive: {
        type:                          'list',
        ...(headerText && { header: { type: 'text', text: headerText } }),
        body:                          { text: bodyText },
        action:                        { button: buttonLabel, sections },
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
  if (isAISensyConfigured()) {
    const campaign =
      process.env.AISENSY_DOC_CAMPAIGN ?? process.env.AISENSY_TEXT_CAMPAIGN!;
    return sendViaAISensy({
      orgId, to,
      messageType:    'document',
      messageText:    caption ?? filename ?? null,
      campaignName:   campaign,
      mediaUrl:       fileUrl,
      mediaFilename:  filename,
      ...(caption && { templateParams: [caption] }),
    });
  }

  return sendViaMeta(
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

export async function sendTemplate(
  to:           string,
  templateName: string,
  variables:    string[],
  langCode:     string = 'en',
  orgId:        string = ''
): Promise<WAApiResponse> {
  if (isAISensyConfigured()) {
    return sendViaAISensy({
      orgId, to,
      messageType:    'text',
      messageText:    variables[0] ?? `[Template: ${templateName}]`,
      campaignName:   templateName,
      templateParams: variables,
    });
  }

  const components = variables.length > 0
    ? [{ type: 'body', parameters: variables.map(v => ({ type: 'text', text: v })) }]
    : [];

  return sendViaMeta(
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
    { orgId, to, messageType: 'text', messageText: variables[0] ?? `[Template: ${templateName}]` }
  );
}

// ── Meta-direct operations (always use Meta — no AISensy equivalent) ──────

export async function downloadMedia(
  mediaId: string,
  orgId?:  string
): Promise<{ url: string; mime_type: string }> {
  const { accessToken } = await resolveMetaCreds(orgId);
  const res = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to get media URL for: ${mediaId}`);
  return res.json();
}

export async function downloadMediaContent(
  mediaId: string,
  orgId?: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const { accessToken } = await resolveMetaCreds(orgId);

  const urlRes = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!urlRes.ok) throw new Error(`Failed to get media URL for: ${mediaId}`);
  const { url, mime_type } = await urlRes.json() as { url: string; mime_type: string };

  const contentRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!contentRes.ok) throw new Error(`Failed to download media: ${contentRes.status}`);

  return { buffer: await contentRes.arrayBuffer(), mimeType: mime_type };
}

export async function markMessageRead(messageId: string, orgId?: string): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await resolveMetaCreds(orgId);
    await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
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
