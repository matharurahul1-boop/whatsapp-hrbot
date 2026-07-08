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
import { loadSession, saveContext }                       from '@/lib/ai/memory';
import { EMPTY_CONTEXT }                                  from '@/lib/ai/types';
import type { SupportedLanguage }                         from '@/lib/ai/types';
import type { WAWebhookPayload, WAMessage, WAValue }      from '@/types/whatsapp.types';
import { distributedRateLimit }                           from '@/lib/rate-limit';

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
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 1_000_000) return new NextResponse('Payload Too Large', { status: 413 });
  const rawBody      = await req.text();
  if (rawBody.length > 1_000_000) return new NextResponse('Payload Too Large', { status: 413 });
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
    if (from) {
      const localAllowed = await distributedRateLimit(`wa:${from}`, 20, 60_000);
      const db = createAdminClient();
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await db.from('wa_logs').select('id', { count: 'exact', head: true })
        .eq('wa_number', from.replace(/^\+/, '')).eq('direction', 'incoming').gte('created_at', since);
      if (!localAllowed || (count ?? 0) >= 20) {
        console.warn(`[WA Webhook] ⚠️ Rate limited: ${from}`);
        // A non-2xx response makes Meta retry the same webhook and can amplify
        // a flood. Acknowledge valid signed events while intentionally dropping
        // over-limit messages.
        return new NextResponse('OK', { status: 200 });
      }
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
        await updateDeliveryStatus(status.id, status.status, status.timestamp, org.id, status.errors?.[0]);
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
  // Validate message ID — guard against malformed/missing/oversized IDs
  if (!msg.id || typeof msg.id !== 'string' || msg.id.length > 128) {
    console.warn('[WA Webhook] ⚠️ Invalid or missing message ID — skipping', msg.id);
    return;
  }

  console.log(`[WA Webhook] Incoming message from ${msg.from}, type=${msg.type}, id=${msg.id}`);

  // 1. Fast in-process dedup by message ID (handles same-instance Meta retries without a DB hit)
  const msgFlightKey = `mid:${msg.id}`;
  if (inFlight.has(msgFlightKey)) {
    console.log(`[WA Webhook] ⏭️ In-flight duplicate ${msg.id} — skipping`);
    return;
  }
  inFlight.add(msgFlightKey);
  setTimeout(() => inFlight.delete(msgFlightKey), 30_000);

  // 2. Persistent dedup: check DB for cross-instance retries
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

  // 2. Save to wa_logs (returns false = duplicate caught by DB unique constraint → skip dispatch)
  const isNew = await saveIncomingLog(msg, value, orgId, rawBody);
  if (!isNew) return;

  // 3. Mark as read (non-blocking — fire and forget)
  markMessageRead(msg.id).catch(() => {});

  // 4. AI agent — use waitUntil so Vercel keeps the function alive after
  //    returning 200 OK to Meta (background tasks are otherwise killed).
  const rawText   = extractText(msg);
  const text      = rawText?.replace(/\0/g, '').trim().slice(0, 4000) ?? null;
  const isAudio   = msg.type === 'audio';
  const flightKey = `${orgId}:${msg.from}`;

  if (text?.trim() || isAudio) {
    waitUntil((async () => {
      // Concurrency guard applies to both text AND audio messages.
      // Prevents a rapid second message from the same sender interleaving
      // with the first (e.g. two quick voice notes creating duplicate tasks).
      if (inFlight.has(flightKey)) {
        const deadline = Date.now() + 12_000;
        while (inFlight.has(flightKey) && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (inFlight.has(flightKey)) {
          console.warn(`[WA] Sender queue wait timed out; processing without dropping message: ${flightKey}`);
        }
      }
      inFlight.add(flightKey);
      try {
        if (isAudio) {
          await handleAudioMessage(msg.from, msg.audio?.id ?? '', orgId);
        } else {
          // Check if sender is mid-audio-correction flow before normal dispatch
          const handledByAudioFlow = await handleAudioFlow(msg.from, text!, orgId);
          if (!handledByAudioFlow) {
            if (isPolicyQuestion(text!)) {
              await dispatchPolicyBot(msg.from, text!, orgId);
            } else {
              await dispatchAgent(msg.from, text!, orgId);
            }
          }
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
// Returns true  = row inserted (new message, proceed with agent dispatch).
// Returns false = duplicate (DB unique constraint on meta_message_id fired,
//                meaning another Vercel instance already processed this message).
// To enable the full distributed dedup, run this migration in Supabase:
//   ALTER TABLE wa_logs ADD CONSTRAINT wa_logs_meta_message_id_unique UNIQUE (meta_message_id);
async function saveIncomingLog(
  msg:     WAMessage,
  value:   WAValue,
  orgId:   string,
  rawBody: string
): Promise<boolean> {
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
    if (error.code === '23505') {
      // unique_violation — DB constraint stopped a cross-instance duplicate
      console.log(`[WA Webhook] ⏭️ DB unique constraint: duplicate ${msg.id} — skipping`);
      return false;
    }
    console.error('[WA Webhook] ❌ wa_logs insert FAILED:', error.code, error.message, error.details);
  } else {
    console.log(`[WA Webhook] ✅ wa_logs saved — ${waNumber} → "${row.message_text}"`);
  }
  return true;
}

// ── Update delivery status ────────────────────────────────────────────────
async function updateDeliveryStatus(
  messageId:  string,
  status:     string,
  timestamp:  string,
  orgId:      string,
  error?:     { code: number; title: string; message?: string; error_data?: { details: string } },
): Promise<void> {
  const db = createAdminClient();
  const ts = new Date(parseInt(timestamp) * 1000).toISOString();

  const patch: Record<string, unknown> = { delivery_status: status };
  if (status === 'delivered') patch.delivered_at = ts;
  if (status === 'read')      patch.read_at      = ts;
  if (status === 'sent')      patch.sent_at      = ts;
  if (status === 'failed') {
    patch.failed_at = ts;
    if (error) {
      patch.failure_code   = error.code;
      patch.failure_reason = error.error_data?.details ?? error.message ?? error.title;
    }
  }

  const { error: dbError } = await db
    .from('wa_logs')
    .update(patch)
    .eq('meta_message_id', messageId)
    .eq('organization_id', orgId);

  if (dbError) console.error('[WA Webhook] Status update error:', dbError.message);
  else console.log(`[WA Webhook] ✅ Status updated: ${messageId} → ${status}${error ? ` (${error.code}: ${error.title})` : ''}`);
}

// ── Confirmation-aware reply sender ──────────────────────────────────────
// When the agent reply ends with "Go ahead? (Yes / No)", strip that suffix
// and deliver the message as WhatsApp interactive buttons instead of text.
// Button IDs "yes" / "no" already match isYes / isNo regex in agent.ts, so
// the context-state shortcircuit handles button taps with zero extra code.
//
// Also handles [[SHOW_OPTIONS:field:taskTitle]] sentinels from agent.ts:
// these are converted to WhatsApp list/button interactive messages so the
// user can pick a value (priority / status / assignee) without typing.
const CONFIRM_SUFFIX_RE  = /\s*\(Yes\s*\/\s*No\)\s*$/i;
const SENTINEL_OPTS_RE   = /^\[\[SHOW_OPTIONS:(\w+):(.+)\]\]$/;
const FIELD_PICKER_RE    = /What would you like to update on \*([^*]+)\*/i;
// CREATE task "Edit details" → "Current details: ... What would you like to change?"
const EDIT_PICKER_RE     = /^Current details:\n([\s\S]+?)\n\nWhat would you like to change\?/;

function looksLikeInternalReasoning(text: string): boolean {
  const head = text.trim().slice(0, 500);
  return /^(?:the user (?:says|wrote|typed|asked)|according to (?:the )?rules|we need to|i need to (?:parse|analyze|check)|let me (?:analyze|reason|parse)|analysis:|reasoning:)/i.test(head)
    || /(?:call|use)\s+[a-z_]+\s*\([^)]*\).*\btool\b/i.test(head)
    || /"tool_calls"\s*:|"function"\s*:\s*\{\s*"name"/i.test(head);
}

async function sendAgentReply(to: string, text: string, orgId: string): Promise<void> {
  if (looksLikeInternalReasoning(text)) {
    console.error('[sendAgentReply] Blocked internal model reasoning from user-facing output');
    text = '⚠️ I could not complete that request safely. Please try again in a shorter sentence.';
  }
  // ── Field-options interactive message ─────────────────────────────────
  const sentinelMatch = SENTINEL_OPTS_RE.exec(text);
  if (sentinelMatch) {
    const fieldType = sentinelMatch[1];
    const taskTitle = sentinelMatch[2];

    if (fieldType === 'priority') {
      await sendList(
        to,
        `What priority for *${taskTitle}*?`,
        'Select priority',
        [{ title: 'Priority', rows: [
          { id: 'low',    title: '🟢 Low',    description: 'Flexible timeline'   },
          { id: 'medium', title: '🟡 Medium',  description: 'Standard priority'  },
          { id: 'high',   title: '🔴 High',    description: 'Needs prompt action' },
          { id: 'urgent', title: '🚨 Urgent',  description: 'Critical — do now'  },
        ]}],
        orgId,
      ).catch(async () => {
        // Fallback: 3-button (drop urgent — WhatsApp max 3)
        await sendButtons(to, `What priority for *${taskTitle}*?`, [
          { id: 'low',    title: '🟢 Low'   },
          { id: 'medium', title: '🟡 Medium' },
          { id: 'high',   title: '🔴 High'  },
        ], orgId).catch(async () => {
          await sendText(to, `What priority for *${taskTitle}*?\n\nReply: *low* / *medium* / *high* / *urgent*`, orgId);
        });
      });

    } else if (fieldType === 'status') {
      await sendButtons(
        to,
        `What status for *${taskTitle}*?`,
        [
          { id: 'todo',        title: '📋 Todo'        },
          { id: 'in_progress', title: '⏳ In Progress'  },
          { id: 'done',        title: '✅ Done'         },
        ],
        orgId,
      ).catch(async () => {
        await sendText(to, `What status for *${taskTitle}*?\n\nReply: *todo* / *in_progress* / *done*`, orgId);
      });

    } else if (fieldType === 'assignee') {
      const db = createAdminClient();
      const { data: users } = await db
        .from('users')
        .select('full_name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('full_name')
        .limit(10);
      const rows = ((users ?? []) as { full_name: string }[]).map(u => ({
        id:    u.full_name,
        title: u.full_name,
      }));
      if (rows.length === 0) {
        await sendText(to, `Who should *${taskTitle}* be assigned to?`, orgId);
      } else {
        await sendList(
          to,
          `Who should *${taskTitle}* be assigned to?`,
          'Select teammate',
          [{ title: 'Team Members', rows }],
          orgId,
        ).catch(async () => {
          const names = rows.map(r => `• ${r.title}`).join('\n');
          await sendText(to, `Who should *${taskTitle}* be assigned to?\n\n${names}\n\nReply with their name.`, orgId);
        });
      }

    } else if (fieldType === 'deadline_date') {
      // Compute next 9 days in IST (UTC+5:30) dynamically; row 10 = custom text entry
      const istOffMs = (5 * 60 + 30) * 60000;
      const WDAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const dateRows = Array.from({ length: 9 }, (_, i) => {
        const t   = new Date(Date.now() + istOffMs + i * 86400000);
        const y   = t.getUTCFullYear();
        const mo  = String(t.getUTCMonth() + 1).padStart(2, '0');
        const day = String(t.getUTCDate()).padStart(2, '0');
        const iso = `${y}-${mo}-${day}`;
        const lbl = `${WDAYS[t.getUTCDay()]}, ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
        return { id: iso, title: lbl, description: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : '' };
      });
      const allDateRows = [
        ...dateRows,
        { id: 'custom_date', title: '📅 Custom date', description: 'Type any date' },
      ];
      await sendList(
        to,
        `📅 Select deadline date for *${taskTitle}*\n\nOr just type a date: _"15 Jul 3pm"_`,
        'Pick date',
        [{ title: 'Upcoming', rows: allDateRows }],
        orgId,
        'Deadline date',
      ).catch(async () => {
        // Fallback: 3 buttons for today/tomorrow/day-after
        const [d0, d1, d2] = dateRows;
        await sendButtons(to, `📅 Select deadline date for *${taskTitle}*:`, [
          { id: d0.id, title: d0.title },
          { id: d1.id, title: d1.title },
          { id: d2.id, title: d2.title },
        ], orgId).catch(async () => {
          await sendText(to, `📅 What date for *${taskTitle}*?\n\nReply with a date, e.g. _"10 Jul 2026 3pm"_`, orgId);
        });
      });

    } else if (fieldType === 'deadline_time') {
      await sendList(
        to,
        `⏰ What time on that day?\n\nOr type any time: _"2:30pm"_, _"14:30"_`,
        'Pick time',
        [{ title: 'Time', rows: [
          { id: '09:00', title: '9:00 AM',  description: 'Morning'      },
          { id: '11:00', title: '11:00 AM', description: ''             },
          { id: '12:00', title: '12:00 PM', description: 'Noon'         },
          { id: '13:00', title: '1:00 PM',  description: ''             },
          { id: '14:00', title: '2:00 PM',  description: ''             },
          { id: '15:00', title: '3:00 PM',  description: ''             },
          { id: '16:00', title: '4:00 PM',  description: ''             },
          { id: '17:00', title: '5:00 PM',  description: 'End of day'   },
          { id: '18:00', title: '6:00 PM',  description: 'Evening'      },
          { id: 'custom_time', title: '✏️ Custom time', description: 'Type any time' },
        ]}],
        orgId,
        'Deadline time',
      ).catch(async () => {
        await sendButtons(to, `⏰ What time? Or type any time below`, [
          { id: '09:00', title: '9:00 AM'  },
          { id: '13:00', title: '1:00 PM'  },
          { id: '17:00', title: '5:00 PM'  },
        ], orgId).catch(async () => {
          await sendText(to, `⏰ What time? Reply with e.g. _"9am"_, _"2pm"_, _"17:00"_`, orgId);
        });
      });
    }
    return;
  }

  // ── "What would you like to update on *X*?" → interactive field buttons ──
  const fieldPickerMatch = FIELD_PICKER_RE.exec(text);
  if (fieldPickerMatch) {
    const taskTitle = fieldPickerMatch[1];
    console.log(`[sendAgentReply] Field picker: task="${taskTitle}"`);
    // Try sendList first; fall back to 3-button pick (priority/status/assignee are
    // the constrained fields — deadline + title are free-text so type-them hints suffice)
    await sendList(
      to,
      `What would you like to update on *${taskTitle}*?\n\n📅 Deadline or 📝 Title — just type the field name`,
      'Select field',
      [{ title: 'Fields', rows: [
        { id: 'priority', title: '🎯 Priority',  description: 'Low / Medium / High / Urgent' },
        { id: 'status',   title: '✅ Status',    description: 'Todo / In Progress / Done'   },
        { id: 'assignee', title: '👤 Assignee',  description: 'Reassign to a team member'   },
        { id: 'deadline', title: '📅 Deadline',  description: 'Change due date & time'       },
        { id: 'title',    title: '📝 Title',     description: 'Rename the task'              },
      ]}],
      orgId,
    ).catch(async (listErr) => {
      console.error('[sendAgentReply] sendList failed, trying sendButtons:', listErr instanceof Error ? listErr.message : listErr);
      await sendButtons(
        to,
        `What would you like to update on *${taskTitle}*?\n\n📅 Deadline or 📝 Title — just type the field name`,
        [
          { id: 'priority', title: '🎯 Priority' },
          { id: 'status',   title: '✅ Status'   },
          { id: 'assignee', title: '👤 Assignee' },
        ],
        orgId,
      ).catch(async () => {
        await sendText(to, `What would you like to update on *${taskTitle}*?\n\nReply with: *priority* / *status* / *assignee* / *deadline* / *title*`, orgId);
      });
    });
    return;
  }

  // ── CREATE task "Edit details" → "Current details: …\n\nWhat would you like to change?" ──
  const editPickerMatch = EDIT_PICKER_RE.exec(text);
  if (editPickerMatch) {
    const detailsText = editPickerMatch[1].trim();
    const bodyText = `${detailsText}\n\nWhat would you like to change?`.slice(0, 900);
    console.log('[sendAgentReply] Edit picker triggered');
    await sendList(
      to,
      bodyText,
      'Select field',
      [{ title: 'Fields', rows: [
        { id: 'priority', title: '🎯 Priority',  description: 'Low / Medium / High / Urgent' },
        { id: 'assignee', title: '👤 Assignee',  description: 'Reassign to a team member'   },
        { id: 'deadline', title: '📅 Deadline',  description: 'Change due date & time'       },
        { id: 'title',    title: '📝 Title',     description: 'Rename the task'              },
      ]}],
      orgId,
      'Current details',
    ).catch(async (listErr) => {
      console.error('[sendAgentReply] Edit picker sendList failed, trying sendButtons:', listErr instanceof Error ? listErr.message : listErr);
      await sendButtons(
        to,
        bodyText.length > 1024 ? bodyText.slice(0, 1021) + '…' : bodyText,
        [
          { id: 'priority', title: '🎯 Priority' },
          { id: 'assignee', title: '👤 Assignee' },
          { id: 'deadline', title: '📅 Deadline' },
        ],
        orgId,
      ).catch(async () => {
        await sendText(to, text, orgId);
      });
    });
    return;
  }

  // ── Confirmation prompt → interactive Yes/No buttons ──────────────────
  if (CONFIRM_SUFFIX_RE.test(text)) {
    const body = text.replace(CONFIRM_SUFFIX_RE, '').trimEnd();
    const isTaskAction = /I'll (?:create task|update\b)/i.test(body);
    const buttons = isTaskAction
      ? [
          { id: 'yes',  title: '✅ Yes, proceed' },
          { id: 'edit', title: '✏️ Edit details'  },
          { id: 'no',   title: '❌ No, cancel'    },
        ]
      : [
          { id: 'yes', title: '✅ Yes, proceed' },
          { id: 'no',  title: '❌ No, cancel'   },
        ];
    await sendButtons(
      to,
      body.length > 1024 ? body.slice(0, 1021) + '…' : body,
      buttons,
      orgId
    );
  } else {
    await sendText(to, text, orgId);
  }
}

// ── AI agent dispatch ─────────────────────────────────────────────────────
async function dispatchAgent(from: string, text: string, orgId: string): Promise<void> {
  try {
    console.log(`[WA Agent] → local Groq agent: from=${from}`);
    const result = await runMasterAgent(text, from, orgId);
    await sendAgentReply(from, result.reply, orgId);
  } catch (err) {
    console.error(`[WA Agent] error for ${from}:`, err);
    await sendText(from, '⚠️ Something went wrong. Please try again.', orgId).catch(() => {});
  }
}

// ── Audio correction flow ─────────────────────────────────────────────────
//
// After audio is transcribed and shown with Yes/No, "No" opens a guided
// field-correction flow: pick which part is wrong → type new value →
// corrected transcript re-confirmed. Works for tasks, leave, attendance, etc.

type AudioField = { id: string; title: string; description: string };

function getFieldsForTranscript(transcript: string): AudioField[] {
  const t = transcript.toLowerCase();

  if (/\b(check.?out|leaving|done for today|signing off|nikal|ja raha)\b/i.test(t)) {
    return [
      { id: 'date', title: 'Date',  description: 'Which date to check out' },
      { id: 'time', title: 'Time',  description: 'What time to record'     },
    ];
  }
  if (/\b(check.?in|aaya|office|reached|arrived|mark attendance|log attendance)\b/i.test(t)) {
    return [
      { id: 'date', title: 'Date',  description: 'Which date to check in' },
      { id: 'time', title: 'Time',  description: 'What time to record'    },
    ];
  }
  if (/\b(leave|sick|holiday|vacation|day off|casual|earned|maternity|paternity)\b/i.test(t)) {
    return [
      { id: 'leave_type', title: 'Leave Type', description: 'Sick, Casual, Earned…' },
      { id: 'start_date', title: 'Start Date', description: 'When leave starts'     },
      { id: 'end_date',   title: 'End Date',   description: 'When leave ends'       },
      { id: 'reason',     title: 'Reason',     description: 'Reason for leave'      },
    ];
  }
  // Default: task fields
  return [
    { id: 'title',       title: 'Title',       description: 'Task name'          },
    { id: 'priority',    title: 'Priority',    description: 'High, Medium, Low'  },
    { id: 'deadline',    title: 'Deadline',    description: 'Due date and time'  },
    { id: 'assign_to',   title: 'Assign To',   description: 'Person to assign'   },
    { id: 'description', title: 'Description', description: 'Task details'       },
  ];
}

function fieldPrompt(field: string): string {
  switch (field.toLowerCase().replace(/_/g, ' ')) {
    case 'title':       return '📝 What should the title be?';
    case 'priority':    return '🔴 What priority? Reply *High*, *Medium*, or *Low*.';
    case 'deadline':    return '📅 What should the deadline be? (e.g. "tomorrow 3pm", "next Friday")';
    case 'assign to':   return '👤 Who should it be assigned to?';
    case 'description': return '💬 What should the description be?';
    case 'leave type':  return '🏖️ What type of leave? (Sick, Casual, Earned, etc.)';
    case 'start date':  return '📅 What\'s the start date?';
    case 'end date':    return '📅 What\'s the end date?';
    case 'reason':      return '📝 What\'s the reason for leave?';
    case 'date':        return '📅 Which date? (e.g. "today", "tomorrow")';
    case 'time':        return '⏰ What time?';
    default:            return `What should the ${field} be?`;
  }
}

async function showFieldSelection(
  from: string,
  conversationId: string,
  transcript: string,
  language: SupportedLanguage,
  orgId: string,
): Promise<void> {
  const fields = getFieldsForTranscript(transcript);

  await saveContext(conversationId, {
    ...EMPTY_CONTEXT,
    language,
    flow_state:         'AUDIO_FIELD_SELECT',
    pending_transcript: transcript,
  }).catch(() => {});

  if (fields.length <= 3) {
    await sendButtons(
      from,
      '✏️ What part needs to change?',
      fields.map(f => ({ id: f.id, title: f.title })),
      orgId,
    ).catch(async () => {
      // Fallback: plain text list
      const list = fields.map((f, i) => `${i + 1}. ${f.title}`).join('\n');
      await sendText(from, `✏️ What part needs to change?\n\n${list}\n\nReply with the number or name.`, orgId).catch(() => {});
    });
  } else {
    await sendList(
      from,
      '✏️ What part needs to change?',
      'Select field',
      [{ title: 'Fields', rows: fields.map(f => ({ id: f.id, title: f.title, description: f.description })) }],
      orgId,
    ).catch(async () => {
      const list = fields.map((f, i) => `${i + 1}. ${f.title} — ${f.description}`).join('\n');
      await sendText(from, `✏️ What part needs to change?\n\n${list}\n\nReply with the number or name.`, orgId).catch(() => {});
    });
  }
}

// Main audio-flow dispatcher — called instead of dispatchAgent when in an audio flow state.
async function handleAudioFlow(
  from: string,
  text: string,
  orgId: string,
): Promise<boolean> {
  // Load session to check flow state (cheap indexed query)
  const session = await loadSession(from, orgId).catch(() => null);
  if (!session) return false;

  const { conversation_id, context } = session;
  const { flow_state, pending_transcript, pending_slot, language } = context;

  // ── AUDIO_CONFIRM: user tapped Yes or No on the transcript preview ────────
  if (flow_state === 'AUDIO_CONFIRM') {
    const transcript = pending_transcript ?? '';
    const YES_RE = /^(yes|yeah|yep|sure|ok|okay|go\s*ahead|proceed|confirm|haan|haa|theek\s*hai|bilkul|kar\s*(do|dein?)|let'?s\s*do\s*it|sounds?\s*good|audio_yes)\s*[!.]*$/i;
    const NO_RE  = /^(no|nahi|nope|cancel|stop|mat\s*karo|band\s*karo|back|audio_no)\s*[!.]*$/i;

    if (YES_RE.test(text.trim())) {
      console.log(`[AudioFlow] AUDIO_CONFIRM YES → dispatching transcript`);
      await saveContext(conversation_id, { ...EMPTY_CONTEXT, language }).catch(() => {});
      if (isPolicyQuestion(transcript)) {
        await dispatchPolicyBot(from, transcript, orgId);
      } else {
        await dispatchAgent(from, transcript, orgId);
      }
      return true;
    }

    if (NO_RE.test(text.trim())) {
      console.log(`[AudioFlow] AUDIO_CONFIRM NO → showing field selection`);
      await showFieldSelection(from, conversation_id, transcript, language, orgId);
      return true;
    }

    // User typed something else — clear audio confirm and process as new message
    console.log(`[AudioFlow] AUDIO_CONFIRM: unrecognised reply ("${text}") — clearing state`);
    await saveContext(conversation_id, { ...EMPTY_CONTEXT, language }).catch(() => {});
    return false; // fall through to normal dispatch
  }

  // ── AUDIO_FIELD_SELECT: user chose which field to change ──────────────────
  if (flow_state === 'AUDIO_FIELD_SELECT') {
    // text is the title from list_reply or button_reply (e.g. "Title", "Priority")
    // Also accept number responses for the plain-text fallback
    const fields   = getFieldsForTranscript(pending_transcript ?? '');
    const numMatch = /^(\d+)$/.exec(text.trim());
    let   field    = text.trim();
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1;
      field = fields[idx]?.title ?? field;
    }

    console.log(`[AudioFlow] AUDIO_FIELD_SELECT → field: "${field}"`);
    await saveContext(conversation_id, {
      ...EMPTY_CONTEXT,
      language,
      flow_state:         'AUDIO_FIELD_VALUE',
      pending_transcript: pending_transcript,
      pending_slot:       field,
    }).catch(() => {});

    // Priority and assignee are constrained choices — reuse the same
    // interactive list/button pickers the update-task flow already has,
    // instead of asking the user to type a free-text answer.
    const fieldKey = field.toLowerCase().replace(/_/g, ' ');
    const sentinelFieldType = fieldKey === 'priority' ? 'priority' : fieldKey === 'assign to' ? 'assignee' : null;
    if (sentinelFieldType) {
      await sendAgentReply(from, `[[SHOW_OPTIONS:${sentinelFieldType}:this task]]`, orgId).catch(() => {});
    } else {
      await sendText(from, fieldPrompt(field), orgId).catch(() => {});
    }
    return true;
  }

  // ── AUDIO_FIELD_VALUE: user typed the new value ───────────────────────────
  if (flow_state === 'AUDIO_FIELD_VALUE') {
    const field      = pending_slot ?? 'field';
    const transcript = pending_transcript ?? '';
    const corrected  = `${transcript} [CORRECTION: Change ${field} to "${text}"]`;

    console.log(`[AudioFlow] AUDIO_FIELD_VALUE field="${field}" value="${text}" → re-dispatching`);
    await saveContext(conversation_id, { ...EMPTY_CONTEXT, language }).catch(() => {});
    await dispatchAgent(from, corrected, orgId);
    return true;
  }

  return false; // not in an audio flow state
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

  // Use plain audio/ogg for the blob — some Groq key setups reject the full
  // "audio/ogg; codecs=opus" MIME type that WhatsApp sends.
  const blobType = mimeType.split(';')[0].trim();

  const tryKey = async (apiKey: string): Promise<string | null | 'skip'> => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: blobType }), `audio${ext}`);
    form.append('model', 'whisper-large-v3-turbo');

    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body:    form,
      });
    } catch (netErr) {
      console.warn('[WA Audio] Network error reaching Groq Whisper:', netErr);
      return 'skip';
    }

    if (res.status === 429 || res.status >= 500) {
      console.warn(`[WA Audio] Groq Whisper key returned ${res.status} — trying next`);
      return 'skip';
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)');
      console.error(`[WA Audio] Groq Whisper ${res.status} error: ${body}`);
      return 'skip'; // try other keys in case this one is misconfigured
    }

    const data = await res.json();
    return (data.text as string)?.trim() || null;
  };

  // GROQ_API_KEY may be comma-separated (legacy format) — split it the same
  // way as GROQ_KEYS in agent.ts so individual keys are used correctly.
  const groqKeys = [
    ...(process.env.GROQ_API_KEY ?? '').split(',').map(k => k.trim()),
    process.env.GROQ_API_KEY_2,  process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,  process.env.GROQ_API_KEY_5,
    process.env.GROQ_API_KEY_6,  process.env.GROQ_API_KEY_7,
    process.env.GROQ_API_KEY_8,  process.env.GROQ_API_KEY_9,
    process.env.GROQ_API_KEY_10,
  ].filter(Boolean) as string[];

  console.log(`[WA Audio] Trying ${groqKeys.length} keys, mimeType=${mimeType}, blobType=${blobType}, ext=${ext}, size=${buffer.byteLength}b`);

  for (let i = 0; i < groqKeys.length; i++) {
    const r = await tryKey(groqKeys[i]);
    if (r !== 'skip') return r;
    console.warn(`[WA Audio] Key ${i + 1}/${groqKeys.length} skipped`);
  }

  throw new Error('All Groq Whisper keys exhausted');
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

  // Save AUDIO_CONFIRM state so the agent knows to process the transcript on "Yes"
  const session = await loadSession(from, orgId).catch(() => null);
  if (session) {
    await saveContext(session.conversation_id, {
      ...EMPTY_CONTEXT,
      language:           session.context.language,
      flow_state:         'AUDIO_CONFIRM',
      pending_transcript: transcript,
    }).catch(() => {});
  }

  // Show transcript preview + Yes / No buttons
  const preview  = transcript.length > 900 ? transcript.slice(0, 900) + '…' : transcript;
  const bodyText = `🎙️ I heard:\n\n"${preview}"\n\nShall I go ahead?`;

  await sendButtons(
    from,
    bodyText,
    [
      { id: 'audio_yes', title: 'Yes' },
      { id: 'audio_no',  title: 'No'  },
    ],
    orgId
  ).catch(async () => {
    // Fallback: if interactive buttons fail (e.g. AISensy), send plain text
    await sendText(from, `${bodyText}\n\nReply *Yes* or *No*`, orgId).catch(() => {});
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function resolveOrg(phoneNumberId: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from('organizations')
    .select('id')
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
