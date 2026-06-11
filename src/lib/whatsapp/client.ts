/**
 * WhatsApp outgoing message client — powered by AISensy Campaign API.
 *
 * Every public send* function:
 *  1. Resolves the AISensy API key (env var or org DB)
 *  2. Calls the AISensy Campaign API via aisensySend()
 *  3. Logs the outgoing message to wa_logs via WALogger
 *  4. Returns a WAApiResponse (or throws on hard failure)
 *
 * markMessageRead and downloadMedia still hit Meta's Graph API directly
 * because AISensy has no equivalent endpoints for those operations.
 */

import { WALogger } from './logger';
import { aisensySend } from './aisensy';
import type {
  WAApiResponse,
  WAListAction,
  WAMessageType,
} from '@/types/whatsapp.types';

// ── AISensy credential resolver ──────────────────────────────────────────

function resolveApiKey(): string {
  const key = process.env.AISENSY_API_KEY;
  if (!key) {
    throw new Error(
      'AISensy not configured. Add AISENSY_API_KEY to .env.local and restart the dev server.'
    );
  }
  return key;
}

// ── Meta Graph API (read receipts + incoming-media download only) ────────

const META_API_BASE = 'https://graph.facebook.com/v20.0';

function resolveMetaCreds() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error(
      'Meta credentials not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env.local'
    );
  }
  return { phoneNumberId, accessToken };
}

// ── Core send (private) ───────────────────────────────────────────────────

interface SendOpts {
  orgId:           string;
  to:              string;
  userName?:       string;
  messageType:     WAMessageType | 'template';
  messageText:     string | null;
  campaignName:    string;
  templateParams?: string[];
  mediaUrl?:       string;
  mediaFilename?:  string;
}

async function sendViaCampaign(opts: SendOpts): Promise<WAApiResponse> {
  const apiKey = resolveApiKey();

  let apiResponse: WAApiResponse | null = null;
  let sendError:   unknown;

  try {
    const result = await aisensySend({
      apiKey,
      campaignName: opts.campaignName,
      destination:  opts.to,
      userName:     opts.userName ?? 'User',
      source:       'api',
      ...(opts.templateParams?.length && { templateParams: opts.templateParams }),
      ...(opts.mediaUrl && {
        media: { url: opts.mediaUrl, filename: opts.mediaFilename },
      }),
    });
    apiResponse = result as WAApiResponse;
    console.log(`[AISensy] ✅ Campaign "${opts.campaignName}" sent to ${opts.to}`);
  } catch (err) {
    sendError = err;
    console.error(
      `[AISensy] ❌ Send failed to ${opts.to}:`,
      err instanceof Error ? err.message : err
    );
  }

  await WALogger.logOutgoing({
    orgId:           opts.orgId,
    to:              opts.to,
    messageType:     opts.messageType,
    messageText:     opts.messageText,
    // Store AISensy payload shape in the log column (JSON)
    outboundPayload: {
      campaignName: opts.campaignName,
      destination:  opts.to,
      templateParams: opts.templateParams,
    } as unknown as Parameters<typeof WALogger.logOutgoing>[0]['outboundPayload'],
    apiResponse,
    error: sendError,
  });

  if (sendError) throw sendError;
  return apiResponse!;
}

// ── Text campaign helper ─────────────────────────────────────────────────

function textCampaign(): string {
  const c = process.env.AISENSY_TEXT_CAMPAIGN;
  if (!c) {
    throw new Error(
      'AISENSY_TEXT_CAMPAIGN is not set. Create a WhatsApp template with body "{{1}}" ' +
      'in your AISensy dashboard, then set its campaign name in .env.local.'
    );
  }
  return c;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Send a free-form text message (requires an active 24-hour session or
 * a template campaign that accepts a single {{1}} body variable).
 *
 * Set AISENSY_TEXT_CAMPAIGN to the name of a campaign whose template body
 * is exactly "{{1}}" so the message body becomes the template variable.
 */
export async function sendText(
  to:    string,
  body:  string,
  orgId: string = ''
): Promise<WAApiResponse> {
  return sendViaCampaign({
    orgId, to,
    messageType:    'text',
    messageText:    body,
    campaignName:   textCampaign(),
    templateParams: [body],
  });
}

/**
 * Send an interactive button message.
 *
 * AISensy Campaign API does not support inline interactive messages;
 * the button options are appended to the body text as a numbered list
 * and sent via the text campaign.
 */
export async function sendButtons(
  to:          string,
  bodyText:    string,
  buttons:     Array<{ id: string; title: string }>,
  orgId:       string = '',
  headerText?: string,
  _footerText?: string
): Promise<WAApiResponse> {
  const lines = [
    ...(headerText ? [headerText] : []),
    bodyText,
    '',
    ...buttons.map((b, i) => `${i + 1}. ${b.title}`),
  ];
  return sendViaCampaign({
    orgId, to,
    messageType:    'interactive',
    messageText:    bodyText,
    campaignName:   textCampaign(),
    templateParams: [lines.join('\n')],
  });
}

/**
 * Send an interactive list message.
 *
 * Same AISensy limitation as sendButtons — options are flattened to text.
 */
export async function sendList(
  to:          string,
  bodyText:    string,
  _buttonLabel: string,
  sections:    WAListAction['sections'],
  orgId:       string = '',
  headerText?: string
): Promise<WAApiResponse> {
  const items = sections.flatMap(s =>
    s.rows.map(r => `• ${r.title}${r.description ? ` — ${r.description}` : ''}`)
  );
  const lines = [
    ...(headerText ? [headerText] : []),
    bodyText,
    '',
    ...items,
  ];
  return sendViaCampaign({
    orgId, to,
    messageType:    'interactive',
    messageText:    bodyText,
    campaignName:   textCampaign(),
    templateParams: [lines.join('\n')],
  });
}

/**
 * Send a document/PDF attachment.
 *
 * Set AISENSY_DOC_CAMPAIGN to a campaign that accepts a media document.
 * Falls back to AISENSY_TEXT_CAMPAIGN if not set.
 */
export async function sendDocument(
  to:        string,
  fileUrl:   string,
  orgId:     string = '',
  caption?:  string,
  filename?: string
): Promise<WAApiResponse> {
  const campaign =
    process.env.AISENSY_DOC_CAMPAIGN ?? process.env.AISENSY_TEXT_CAMPAIGN;
  if (!campaign) {
    throw new Error(
      'Set AISENSY_DOC_CAMPAIGN (or AISENSY_TEXT_CAMPAIGN) in .env.local for document sending.'
    );
  }
  return sendViaCampaign({
    orgId, to,
    messageType:    'document',
    messageText:    caption ?? filename ?? null,
    campaignName:   campaign,
    mediaUrl:       fileUrl,
    mediaFilename:  filename,
    ...(caption && { templateParams: [caption] }),
  });
}

/**
 * Send a pre-approved WhatsApp template campaign.
 * The templateName must match a campaign name in your AISensy dashboard.
 */
export async function sendTemplate(
  to:           string,
  templateName: string,
  variables:    string[],
  _langCode:    string = 'en',
  orgId:        string = ''
): Promise<WAApiResponse> {
  return sendViaCampaign({
    orgId, to,
    messageType:    'text',
    messageText:    variables[0] ?? `[Template: ${templateName}]`,
    campaignName:   templateName,
    templateParams: variables,
  });
}

// ── Meta-direct operations (no AISensy equivalent) ───────────────────────

/** Download incoming media from Meta's CDN (AISensy webhooks still come from Meta). */
export async function downloadMedia(
  mediaId: string
): Promise<{ url: string; mime_type: string }> {
  const { accessToken } = resolveMetaCreds();
  const res = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to get media URL for: ${mediaId}`);
  return res.json();
}

/** Send a read receipt back to Meta (AISensy has no read-receipt API). */
export async function markMessageRead(messageId: string, _orgId?: string): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = resolveMetaCreds();
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

/** No-op — AISensy uses a global API key, no per-org credential cache. */
export function invalidateCredsCache(_orgId: string) {}
