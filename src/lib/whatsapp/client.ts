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

// Meta template parameters may not contain newlines and are meant to be
// short — flatten multi-line free-form bodies down to one line so they
// survive being dropped into a pre-approved template's {{n}} placeholder.
function flattenForTemplate(text: string): string {
  return text.replace(/\s*\n+\s*/g, ' ').trim();
}

function buildTemplateVars(varsCount: number | null | undefined, name: string, body: string, orgName: string): string[] {
  const flatBody = flattenForTemplate(body);
  if (varsCount === 3) return [name, flatBody, orgName];
  if (varsCount === 2) return [name, flatBody];
  return [flatBody];
}

interface OrgTemplateConfig {
  wa_message_template: string | null;
  wa_template_lang:    string | null;
  wa_template_variables: number | null;
  name: string | null;
}

// wa_template_variables was added by a migration that (as of this writing)
// hasn't been run in every environment yet — selecting it alongside the
// other columns then fails the *entire* query (PGRST204), silently
// disabling template fallback. Retry without it and default to 2 vars
// (name + message), which matches every template this app currently ships,
// rather than let the whole org lookup come back empty.
async function fetchOrgTemplateConfig(orgId: string): Promise<OrgTemplateConfig | null> {
  const db = createAdminClient();
  const full = await db
    .from('organizations')
    .select('wa_message_template, wa_template_lang, wa_template_variables, name')
    .eq('id', orgId)
    .maybeSingle();
  if (!full.error) return full.data;

  const partial = await db
    .from('organizations')
    .select('wa_message_template, wa_template_lang, name')
    .eq('id', orgId)
    .maybeSingle();
  return partial.data ? { ...partial.data, wa_template_variables: 2 } : null;
}

// ── Template fallback for automated sends ─────────────────────────────────
//
// A brand-new recipient (e.g. a just-created employee's welcome message)
// has by definition never messaged the business number, so they're always
// outside Meta's 24-hour free-form window — the very first automated
// message to anyone always failed silently before this existed. The manual
// "send from WA Logs" admin action already retried via the org's configured
// pre-approved template on a 131047/131021 failure; this brings the same
// behavior to every automated sendText/sendTextRedacted call.
async function sendMetaWithTemplateFallback(
  payload:       WAOutboundPayload,
  opts:          SendOpts,
  body:          string,
  recipientName: string = '',
): Promise<WAApiResponse> {
  try {
    return await sendViaMeta(payload, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('131047') && !msg.includes('131021')) throw err;

    const org = await fetchOrgTemplateConfig(opts.orgId);
    if (!org?.wa_message_template) throw err;

    const vars = buildTemplateVars(org.wa_template_variables, recipientName, body, org.name ?? '');

    console.log(`[WA] Free-form failed (24h window) — retrying via template "${org.wa_message_template}"`);
    return sendTemplate(opts.to, org.wa_message_template, vars, org.wa_template_lang || 'en', opts.orgId);
  }
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

  return sendMetaWithTemplateFallback(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'text',
      text:              { body: safeBody },
    },
    { orgId, to, messageType: 'text', messageText: safeBody },
    safeBody,
  );
}

/**
 * Same as sendText, but the wa_logs row records `logText` instead of the
 * real message body. Use this for messages containing secrets (e.g. a
 * temporary password) that must reach the recipient on WhatsApp but should
 * never be visible to anyone browsing the WA Logs dashboard.
 */
export async function sendTextRedacted(
  to:      string,
  body:    string,
  logText: string,
  orgId:   string = ''
): Promise<WAApiResponse> {
  const safeBody = body.length > WA_TEXT_MAX
    ? body.slice(0, WA_TEXT_MAX - 3) + '…'
    : body;

  if (isAISensyConfigured()) {
    return sendViaAISensy({
      orgId, to,
      messageType:    'text',
      messageText:    logText,
      campaignName:   process.env.AISENSY_TEXT_CAMPAIGN!,
      templateParams: [safeBody],
    });
  }

  return sendMetaWithTemplateFallback(
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'text',
      text:              { body: safeBody },
    },
    { orgId, to, messageType: 'text', messageText: logText },
    safeBody,
  );
}

// Meta accepts (200 + message id) a free-form send to a recipient outside
// the 24h session window surprisingly often, only reporting the delivery
// failure later via the async status webhook — by which point our own code
// already returned "success" and sendMetaWithTemplateFallback's synchronous
// catch never fires. The only reliable fix is to know *in advance* whether
// the recipient is inside the window and skip the risky free-form attempt
// entirely when they aren't, rather than reactively retrying after the
// fact. This checks their most recent inbound message.
async function isWithin24hWindow(to: string, orgId: string): Promise<boolean> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from('wa_logs')
      .select('created_at')
      .eq('wa_number', to)
      .eq('organization_id', orgId)
      .eq('direction', 'incoming')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return false;
    return Date.now() - new Date(data.created_at).getTime() < 24 * 60 * 60 * 1000;
  } catch {
    // Unknown state — assume within-window so we at least attempt free-form
    // rather than forcing every send through the template path on an error.
    return true;
  }
}

/**
 * Every automated/business-initiated WhatsApp send (task and leave
 * notifications, reminders, onboarding, broadcasts — anything that isn't a
 * direct reply to something the recipient just said) should go through this
 * instead of sendText/sendTextRedacted. If the recipient is outside the 24h
 * window (or has never messaged the business number at all), it goes
 * straight to the org's pre-approved template instead of gambling on
 * free-form text silently failing. Falls back to best-effort free-form when
 * no template is configured for the org.
 */
export async function sendSmartText(
  to:            string,
  body:          string,
  orgId:         string,
  recipientName: string,
  logText?:      string,
): Promise<WAApiResponse> {
  const withinWindow = await isWithin24hWindow(to, orgId);
  if (withinWindow) {
    return logText ? sendTextRedacted(to, body, logText, orgId) : sendText(to, body, orgId);
  }

  const org = await fetchOrgTemplateConfig(orgId);
  if (org?.wa_message_template) {
    const vars = buildTemplateVars(org.wa_template_variables, recipientName, body, org.name ?? '');
    return sendTemplate(to, org.wa_message_template, vars, org.wa_template_lang || 'en', orgId, logText);
  }

  return logText ? sendTextRedacted(to, body, logText, orgId) : sendText(to, body, orgId);
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
  orgId:        string = '',
  logText?:     string,
): Promise<WAApiResponse> {
  const messageText = logText ?? variables[0] ?? `[Template: ${templateName}]`;

  if (isAISensyConfigured()) {
    return sendViaAISensy({
      orgId, to,
      messageType:    'text',
      messageText,
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
    { orgId, to, messageType: 'text', messageText }
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
