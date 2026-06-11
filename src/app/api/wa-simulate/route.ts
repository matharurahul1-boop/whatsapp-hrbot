/**
 * POST /api/wa-simulate
 *
 * Simulates the logged-in user sending a WhatsApp message TO the business number
 * (i.e. direction = 'incoming' from their wa_number).
 *
 * Flow:
 *   1. Creates an INCOMING wa_log entry (as if the user messaged from their phone)
 *   2. Dispatches the AI agent (n8n or local) with that text
 *   3. Waits up to 12 s for the agent's reply log to appear
 *   4. Returns { incoming: logRow, reply: logRow | null }
 *
 * Used by WAInterface when the user sends a message in THEIR OWN conversation tab,
 * so it feels like a real WhatsApp chat with the bot instead of the admin sending
 * a message FROM the business TO the user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';

const LOG_SELECT = `
  id, wa_number, contact_name, direction, message_type,
  message_text, delivery_status, wa_timestamp, created_at,
  user:users!wa_logs_user_id_fkey(id, full_name, avatar_url)
`;

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role, wa_number, full_name')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const userWaNumber = profile.wa_number?.replace(/[\s+\-()]/g, '') ?? null;
  if (!userWaNumber) {
    return NextResponse.json({ error: 'No wa_number configured in your profile' }, { status: 400 });
  }

  const body    = await req.json();
  const message = (body.message as string)?.trim();
  // Always use the authenticated user's org — never trust orgId from the request body
  const orgId   = profile.organization_id;

  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  // ── 1. Create INCOMING log (simulates user messaging from their phone) ───
  const incomingId = `sim_${Date.now()}_${userWaNumber}`;
  const now        = new Date().toISOString();

  const { data: incomingLog, error: logErr } = await db
    .from('wa_logs')
    .insert({
      organization_id:     orgId,
      user_id:             user.id,
      wa_number:           userWaNumber,
      contact_name:        profile.full_name ?? null,
      meta_message_id:     incomingId,
      direction:           'incoming',
      message_type:        'text',
      message_text:        message,
      delivery_status:     'received',
      wa_timestamp:        now,
      raw_webhook_payload: { simulated: true, source: 'portal', userId: user.id },
    })
    .select(LOG_SELECT)
    .single();

  if (logErr) {
    console.error('[wa-simulate] Failed to create incoming log:', logErr.message);
    return NextResponse.json({ error: 'Failed to log message' }, { status: 500 });
  }

  // ── 2. Dispatch AI agent (non-blocking start, but we'll poll for reply) ──
  const agentPromise = dispatchAgent(userWaNumber, message, orgId, user.id);

  // ── 3. Wait up to 12 s for the agent's reply to appear in wa_logs ────────
  let replyLog = null;
  const pollEnd = Date.now() + 12_000;

  // Wait for agent to finish first (up to 10 s)
  await Promise.race([
    agentPromise,
    new Promise(resolve => setTimeout(resolve, 10_000)),
  ]);

  // Small settling pause then poll once
  await new Promise(r => setTimeout(r, 400));

  while (Date.now() < pollEnd) {
    const { data: rows } = await db
      .from('wa_logs')
      .select(LOG_SELECT)
      .eq('organization_id', orgId)
      .eq('wa_number', userWaNumber)
      .eq('direction', 'outgoing')
      .gt('created_at', now)                        // only rows created AFTER we sent
      .order('created_at', { ascending: false })
      .limit(1);

    if (rows && rows.length > 0) {
      replyLog = rows[0];
      break;
    }
    await new Promise(r => setTimeout(r, 600));
  }

  return NextResponse.json({ incoming: incomingLog, reply: replyLog });
}

// ── AI agent dispatcher (mirrors webhook route logic) ─────────────────────

async function dispatchAgent(
  from: string, text: string, orgId: string, userId: string
): Promise<void> {
  const n8nUrl = process.env.N8N_WEBHOOK_URL;

  if (n8nUrl) {
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 9_500);

      const n8nRes = await fetch(n8nUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from: `+${from}`, message: text, org_id: orgId }),
        signal:  controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!n8nRes.ok) throw new Error(`n8n HTTP ${n8nRes.status}`);

      const json  = await n8nRes.json().catch(() => null);
      const reply = json?.reply ?? json?.output ?? json?.text ?? json?.message;
      if (!reply) throw new Error('n8n returned no reply');

      await logSimulatedReply(from, orgId, userId, reply);
    } catch (err) {
      console.error('[wa-simulate] n8n error:', err);
      await runLocalAgent(from, text, orgId, userId);
    }
  } else {
    await runLocalAgent(from, text, orgId, userId);
  }
}

// Write the bot reply directly to wa_logs without touching the WhatsApp API.
// The simulate poller reads wa_logs — no real send is needed for local testing.
async function logSimulatedReply(
  from: string, orgId: string, userId: string, replyText: string
): Promise<void> {
  const db = createAdminClient();
  await db.from('wa_logs').insert({
    organization_id: orgId,
    user_id:         userId,
    wa_number:       from,
    meta_message_id: `sim_out_${Date.now()}_${from}`,
    direction:       'outgoing',
    message_type:    'text',
    message_text:    replyText,
    delivery_status: 'sent',
    wa_timestamp:    new Date().toISOString(),
    sent_at:         new Date().toISOString(),
  });
}

async function runLocalAgent(
  from: string, text: string, orgId: string, userId: string
): Promise<void> {
  try {
    const { runMasterAgent } = await import('@/lib/ai/agent');
    const result = await runMasterAgent(text, `+${from}`, orgId);
    await logSimulatedReply(from, orgId, userId, result.reply);
  } catch (err) {
    console.error('[wa-simulate] Local agent error:', err);
    try {
      await logSimulatedReply(from, orgId, userId, '⚠️ Agent unavailable. Please try again.');
    } catch { /* ignore */ }
  }
}
