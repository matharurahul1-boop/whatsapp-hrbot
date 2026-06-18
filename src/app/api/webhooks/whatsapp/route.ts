import { NextRequest, NextResponse } from 'next/server';
import { waitUntil }                                      from '@vercel/functions';

export const maxDuration = 60;
import { verifyWebhookSignature, verifyWebhookChallenge } from '@/lib/whatsapp/verify';
import { sendText, sendButtons, markMessageRead, downloadMediaContent } from '@/lib/whatsapp/client';
import { createAdminClient }                              from '@/lib/supabase/admin';
import { runMasterAgent }                                 from '@/lib/ai/agent';
import type { WAWebhookPayload, WAMessage, WAValue }      from '@/types/whatsapp.types';

// ── GET — webhook verification challenge ─────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const challenge = verifyWebhookChallenge(
    searchParams.get('hub.mode'),
    searchParams.get('hub.verify_token'),
    searchParams.get('hub.challenge')
  );
  if (!challenge) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

// ── POST — inbound events ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const rawBody      = await req.text();
  const signature    = req.headers.get('x-hub-signature-256');
  const bridgeSecret = req.headers.get('x-bridge-secret');   // set by Supabase edge fn

  if (!verifyWebhookSignature(rawBody, signature, bridgeSecret)) {
    console.warn('[WA Webhook] ❌ Signature mismatch');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  console.log('[WA Webhook] ✅ Request verified — processing...');

  // IMPORTANT: await here so Next.js does not kill the function before
  // the DB insert completes. We still respond quickly because the DB
  // insert is fast (<100ms) and Meta allows up to 20s.
  try {
    await processWebhook(rawBody);
  } catch (err) {
    console.error('[WA Webhook] processWebhook error:', err);
  }

  return new NextResponse('OK', { status: 200 });
}

// ── Core processor ────────────────────────────────────────────────────────
async function processWebhook(rawBody: string): Promise<void> {
  let payload: WAWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error('[WA Webhook] ❌ Invalid JSON');
    return;
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;

      const value         = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      console.log(`[WA Webhook] phone_number_id = ${phoneNumberId}`);

      const org = await resolveOrg(phoneNumberId);
      if (!org) {
        console.error(`[WA Webhook] ❌ No org found for phone_number_id: ${phoneNumberId}`);
        continue;
      }
      console.log(`[WA Webhook] ✅ Org found: ${org.id}`);

      // Handle delivery status updates
      for (const status of value.statuses ?? []) {
        await updateDeliveryStatus(status.id, status.status, status.timestamp, org.id);
      }

      // Handle incoming messages
      for (const msg of value.messages ?? []) {
        await handleOneMessage(msg, value, org.id, rawBody);
      }
    }
  }
}

// ── Handle a single incoming message ─────────────────────────────────────
async function handleOneMessage(
  msg:     WAMessage,
  value:   WAValue,
  orgId:   string,
  rawBody: string
): Promise<void> {
  console.log(`[WA Webhook] Incoming message from ${msg.from}, type=${msg.type}, id=${msg.id}`);

  // 1. Dedup: check if this message_id was already processed (webhook retry guard)
  const db = createAdminClient();
  const { data: existing } = await db
    .from('wa_logs')
    .select('id')
    .eq('meta_message_id', msg.id)
    .maybeSingle();

  if (existing) {
    console.log(`[WA Webhook] ⏭️ Duplicate message ${msg.id} — skipping`);
    return;
  }

  // 2. Save to wa_logs
  await saveIncomingLog(msg, value, orgId, rawBody);

  // 3. Mark as read (non-blocking — fire and forget)
  markMessageRead(msg.id).catch(() => {});

  // 4. AI agent — use waitUntil so Vercel keeps the function alive after
  //    returning 200 OK to Meta (background tasks are otherwise killed).
  const text = extractText(msg);
  if (text?.trim()) {
    if (isPolicyQuestion(text)) {
      waitUntil(
        dispatchPolicyBot(msg.from, text, orgId).catch(err =>
          console.error('[WA PolicyBot] Error:', err)
        )
      );
    } else {
      waitUntil(
        dispatchAgent(msg.from, text, orgId).catch(err =>
          console.error('[WA Agent] Error:', err)
        )
      );
    }
  } else if (msg.type === 'audio') {
    waitUntil(
      handleAudioMessage(msg.from, msg.audio?.id ?? '', orgId).catch(err =>
        console.error('[WA Audio] Error:', err)
      )
    );
  } else if (['image','document','video','sticker'].includes(msg.type)) {
    sendText(msg.from,
      '📎 I received your file. I can only process text and voice messages.',
      orgId
    ).catch(() => {});
  }
}

// ── Save incoming message to wa_logs ─────────────────────────────────────
async function saveIncomingLog(
  msg:     WAMessage,
  value:   WAValue,
  orgId:   string,
  rawBody: string
): Promise<void> {
  const db       = createAdminClient();
  const contacts = value.contacts ?? [];
  const waNumber = msg.from.replace(/^\+/, '');

  // Resolve user
  const { data: userRow } = await db
    .from('users')
    .select('id')
    .eq('organization_id', orgId)
    .eq('wa_number', waNumber)
    .maybeSingle();

  const contactName = contacts.find(c => c.wa_id === msg.from)?.profile?.name ?? null;

  const row = {
    organization_id:     orgId,
    user_id:             userRow?.id ?? null,
    wa_number:           waNumber,
    contact_name:        contactName,
    meta_message_id:     msg.id,
    direction:           'incoming' as const,
    message_type:        msg.type,
    message_text:        extractText(msg),
    media_id:            (msg.image ?? msg.document ?? msg.audio ?? msg.video ?? msg.sticker)?.id ?? null,
    location_lat:        msg.location?.latitude  ?? null,
    location_lng:        msg.location?.longitude ?? null,
    reaction_emoji:      msg.reaction?.emoji     ?? null,
    reply_to_message_id: msg.context?.message_id ?? null,
    delivery_status:     'received' as const,
    wa_timestamp:        new Date(parseInt(msg.timestamp) * 1000).toISOString(),
    raw_webhook_payload: JSON.parse(rawBody),
  };

  console.log('[WA Webhook] Inserting wa_log row:', JSON.stringify({
    meta_message_id: row.meta_message_id,
    wa_number:       row.wa_number,
    direction:       row.direction,
    message_text:    row.message_text,
    orgId,
  }));

  const { error } = await db
    .from('wa_logs')
    .insert(row);

  if (error) {
    console.error('[WA Webhook] ❌ wa_logs insert FAILED:', error.code, error.message, error.details);
  } else {
    console.log(`[WA Webhook] ✅ wa_logs saved — ${waNumber} → "${row.message_text}"`);
  }
}

// ── Update delivery status ────────────────────────────────────────────────
async function updateDeliveryStatus(
  messageId:  string,
  status:     string,
  timestamp:  string,
  orgId:      string
): Promise<void> {
  const db = createAdminClient();
  const ts = new Date(parseInt(timestamp) * 1000).toISOString();

  const patch: Record<string, unknown> = { delivery_status: status };
  if (status === 'delivered') patch.delivered_at = ts;
  if (status === 'read')      patch.read_at      = ts;
  if (status === 'sent')      patch.sent_at      = ts;
  if (status === 'failed')    patch.failed_at    = ts;

  const { error } = await db
    .from('wa_logs')
    .update(patch)
    .eq('meta_message_id', messageId)
    .eq('organization_id', orgId);

  if (error) console.error('[WA Webhook] Status update error:', error.message);
  else console.log(`[WA Webhook] ✅ Status updated: ${messageId} → ${status}`);
}

// ── AI agent dispatch ─────────────────────────────────────────────────────
async function dispatchAgent(from: string, text: string, orgId: string): Promise<void> {
  const n8nUrl = process.env.N8N_WEBHOOK_URL;

  if (n8nUrl) {
    // ── n8n AI agent path ────────────────────────────────────────────────
    try {
      console.log(`[WA Agent] Forwarding to n8n: from=${from}, orgId=${orgId}`);

      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 29_000); // 29s — stay under Meta's 30s window

      const n8nRes = await fetch(n8nUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from, message: text, org_id: orgId }),
        signal:  controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!n8nRes.ok) {
        const errBody = await n8nRes.text().catch(() => '');
        console.error(`[WA Agent] n8n responded ${n8nRes.status}: ${errBody}`);
        throw new Error(`n8n HTTP ${n8nRes.status}`);
      }

      const json = await n8nRes.json().catch(() => null);
      const reply: string | undefined =
        json?.reply   ??   // { reply: "..." }
        json?.output  ??   // { output: "..." }  — AI Agent node default
        json?.text    ??   // { text: "..." }
        json?.message ??   // { message: "..." }
        (typeof json === 'string' ? json : undefined);

      if (!reply) {
        console.error('[WA Agent] n8n response had no reply field:', JSON.stringify(json));
        throw new Error('n8n returned no reply');
      }

      console.log(`[WA Agent] n8n reply for ${from}: "${reply.slice(0, 80)}…"`);
      const confirmButtons = json?.confirmButtons;
      if (Array.isArray(confirmButtons) && confirmButtons.length > 0) {
        await sendButtons(from, reply, confirmButtons, orgId);
      } else {
        await sendText(from, reply, orgId);
      }

    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      console.error(`[WA Agent] n8n ${isTimeout ? 'timed out' : 'error'} for ${from}:`, err);
      await sendText(
        from,
        isTimeout
          ? '⏱️ I\'m taking too long to respond. Please try again in a moment.'
          : '⚠️ Something went wrong. Please try again.',
        orgId
      ).catch(() => {});
    }

  } else {
    // ── Fallback: local Claude agent ─────────────────────────────────────
    try {
      const result = await runMasterAgent(text, from, orgId);
      await sendText(from, result.reply, orgId);
    } catch (err) {
      console.error(`[WA Agent] Error for ${from}:`, err);
      await sendText(from, '⚠️ Something went wrong. Please try again.', orgId).catch(() => {});
    }
  }
}

// ── Policy Bot keywords ───────────────────────────────────────────────────
const POLICY_KEYWORDS = [
  'policy', 'holiday', 'benefit', 'rule', 'regulation',
  'dress code', 'work from home', 'wfh', 'salary', 'appraisal',
  'conduct', 'hr policy', 'annual leave', 'sick leave',
  'maternity', 'paternity', 'notice period', 'probation', 'gratuity',
  'leave policy', 'attendance policy',
];

// Phrases that indicate the message is a question, not a command
const QUESTION_PATTERNS = [
  '?', 'what is', 'what are', "what's", 'how does', 'how do', 'how many',
  'how much', 'when is', 'when does', 'can i', 'can we', 'do we have',
  'is there', 'tell me about', 'explain', 'what happens',
];

function isPolicyQuestion(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Must look like a question — not just a command containing a keyword
  const hasQuestionPattern = lower.endsWith('?') || QUESTION_PATTERNS.some(p => lower.includes(p));
  if (!hasQuestionPattern) return false;
  // And must reference a policy topic
  return POLICY_KEYWORDS.some(kw => lower.includes(kw));
}

async function dispatchPolicyBot(from: string, question: string, orgId: string): Promise<void> {
  try {
    console.log(`[WA PolicyBot] Answering policy question from ${from}`);
    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const secret  = process.env.POLICY_SECRET ?? process.env.ESCALATION_SECRET ?? '';

    const res = await fetch(`${baseUrl}/api/policy/ask`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-policy-secret': secret,
      },
      body: JSON.stringify({ question, orgId }),
    });

    const json = await res.json();
    const answer = json.answer ?? '❓ Sorry, I could not find an answer in our policy documents. Please contact HR directly.';
    await sendText(from, answer, orgId);
  } catch (err) {
    console.error(`[WA PolicyBot] Error for ${from}:`, err);
    await sendText(from, '❓ I had trouble looking up that policy. Please contact HR directly.', orgId).catch(() => {});
  }
}

// ── Audio transcription via Groq Whisper ──────────────────────────────────

async function transcribeAudio(mediaId: string, orgId: string): Promise<string | null> {
  const { buffer, mimeType } = await downloadMediaContent(mediaId, orgId);

  const ext = mimeType.startsWith('audio/ogg')  ? '.ogg'
             : mimeType.startsWith('audio/mp4')  ? '.m4a'
             : mimeType.startsWith('audio/mpeg') ? '.mp3'
             : mimeType.startsWith('audio/wav')  ? '.wav'
             : '.ogg';

  const tryKey = async (apiKey: string): Promise<string | null | 'rate_limited'> => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), `audio${ext}`);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'en');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    });

    if (res.status === 429) return 'rate_limited';
    if (!res.ok) throw new Error(`Groq Whisper ${res.status}: ${await res.text()}`);

    const data = await res.json();
    return (data.text as string)?.trim() || null;
  };

  const gk1 = process.env.GROQ_API_KEY;
  const gk2 = process.env.GROQ_API_KEY_2;

  if (gk1) {
    const r = await tryKey(gk1);
    if (r !== 'rate_limited') return r;
    console.warn('[WA Audio] GK1 rate-limited, trying GK2');
  }
  if (gk2) {
    const r = await tryKey(gk2);
    if (r !== 'rate_limited') return r;
    console.warn('[WA Audio] GK2 also rate-limited');
  }

  throw new Error('All Groq keys rate-limited for Whisper');
}

async function handleAudioMessage(from: string, mediaId: string, orgId: string): Promise<void> {
  if (!mediaId) {
    await sendText(from, '❌ Could not read your voice message. Please try again.', orgId).catch(() => {});
    return;
  }

  console.log(`[WA Audio] Transcribing ${mediaId} for ${from}`);

  let transcript: string | null;
  try {
    transcript = await transcribeAudio(mediaId, orgId);
  } catch (err) {
    console.error('[WA Audio] Transcription failed:', err);
    await sendText(from, '❌ Could not transcribe your voice message. Please send a text message instead.', orgId).catch(() => {});
    return;
  }

  if (!transcript) {
    await sendText(from, '❌ Your voice message was empty or unclear. Please try again.', orgId).catch(() => {});
    return;
  }

  console.log(`[WA Audio] Transcript for ${from}: "${transcript.slice(0, 100)}"`);

  // Echo a short confirmation so the user knows what was heard
  const preview = transcript.length > 120 ? transcript.slice(0, 120) + '…' : transcript;
  await sendText(from, `🎙️ Heard: "${preview}"`, orgId).catch(() => {});

  await dispatchAgent(from, transcript, orgId);
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function resolveOrg(phoneNumberId: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from('organizations')
    .select('id, wa_access_token')
    .eq('wa_phone_number_id', phoneNumberId)
    .limit(1)
    .maybeSingle();                    // never throws on 0 or multiple rows
  if (error) console.error('[WA Webhook] resolveOrg error:', error.message);
  return data;
}

function extractText(msg: WAMessage): string | null {
  if (msg.type === 'text')        return msg.text?.body ?? null;
  if (msg.type === 'button')      return msg.button?.payload ?? null;
  if (msg.type === 'interactive')
    return msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null;
  return null;
}
