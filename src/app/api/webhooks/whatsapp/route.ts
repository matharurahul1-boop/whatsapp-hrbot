import { NextRequest, NextResponse } from 'next/server';
import { waitUntil }                                      from '@vercel/functions';

export const maxDuration = 60;

// Best-effort per-instance concurrency guard.
// Prevents a rapid second message from the same sender from interleaving
// with the first while the AI is still processing it.
// (Not distributed — only effective within one warm Vercel instance.)
const inFlight = new Set<string>();
import { verifyWebhookSignature, verifyWebhookChallenge } from '@/lib/whatsapp/verify';
import { sendText, sendButtons, sendList, markMessageRead, downloadMediaContent } from '@/lib/whatsapp/client';
import { createAdminClient }                              from '@/lib/supabase/admin';
import { runMasterAgent }                                 from '@/lib/ai/agent';
import type { WAWebhookPayload, WAMessage, WAValue }      from '@/types/whatsapp.types';
import { rateLimit }                                      from '@/lib/rate-limit';

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

  // Per-sender rate limit: 20 messages / minute to prevent abuse
  try {
    const body   = JSON.parse(rawBody);
    const from   = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from as string | undefined;
    if (from && !rateLimit(from, 20, 60_000)) {
      console.warn(`[WA Webhook] ⚠️ Rate limited: ${from}`);
      return new NextResponse('Too Many Requests', { status: 429 });
    }
  } catch { /* non-message events (status updates) skip rate limit */ }

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
  const text      = extractText(msg);
  const isAudio   = msg.type === 'audio';
  const flightKey = `${orgId}:${msg.from}`;

  if (text?.trim() || isAudio) {
    waitUntil((async () => {
      // Concurrency guard applies to both text AND audio messages.
      // Prevents a rapid second message from the same sender interleaving
      // with the first (e.g. two quick voice notes creating duplicate tasks).
      if (inFlight.has(flightKey)) {
        await new Promise(r => setTimeout(r, 4_000));
        if (inFlight.has(flightKey)) {
          await sendText(msg.from, '⏳ Still working on your previous message — just a moment!', orgId).catch(() => {});
          return;
        }
      }
      inFlight.add(flightKey);
      try {
        if (isAudio) {
          await handleAudioMessage(msg.from, msg.audio?.id ?? '', orgId);
        } else if (isPolicyQuestion(text!)) {
          await dispatchPolicyBot(msg.from, text!, orgId);
        } else {
          await dispatchAgent(msg.from, text!, orgId);
        }
      } catch (err) {
        console.error('[WA] Dispatch error:', err);
      } finally {
        inFlight.delete(flightKey);
      }
    })());
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
// Standalone branch: all messages processed by the local Groq agent directly.
// No n8n dependency. To re-enable n8n, merge from the `main` branch.
async function dispatchAgent(from: string, text: string, orgId: string): Promise<void> {
  try {
    console.log(`[WA Agent] → local Groq agent: from=${from}`);
    const result = await runMasterAgent(text, from, orgId);
    await sendText(from, result.reply, orgId);
  } catch (err) {
    console.error(`[WA Agent] error for ${from}:`, err);
    await sendText(from, '⚠️ Something went wrong. Please try again.', orgId).catch(() => {});
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
    // VERCEL_URL is set automatically on Vercel (without https://)
    const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
    const baseUrl   = process.env.NEXTAUTH_URL ?? vercelUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const secret    = process.env.POLICY_SECRET ?? process.env.ESCALATION_SECRET ?? '';

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
    // 'auto' lets Whisper detect Hindi, Hinglish, and English automatically

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

  // Rotate through all 10 Groq keys for Whisper (same keys used by n8n AI Agent)
  const groqKeys = [
    process.env.GROQ_API_KEY,   process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6,
    process.env.GROQ_API_KEY_7, process.env.GROQ_API_KEY_8,
    process.env.GROQ_API_KEY_9, process.env.GROQ_API_KEY_10,
  ].filter(Boolean) as string[];

  for (let i = 0; i < groqKeys.length; i++) {
    const r = await tryKey(groqKeys[i]);
    if (r !== 'rate_limited') return r;
    console.warn(`[WA Audio] Key ${i + 1} rate-limited for Whisper — trying next`);
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

  // Route transcribed audio the same way as text: policy questions → policy bot
  if (isPolicyQuestion(transcript)) {
    await dispatchPolicyBot(from, transcript, orgId);
  } else {
    await dispatchAgent(from, transcript, orgId);
  }
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
    return msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id ?? null;
  return null;
}
