import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentUser, ConversationContext, SupportedLanguage } from './types';
import { EMPTY_CONTEXT } from './types';
export type { ConversationContext };

// ─── Memory Architecture ──────────────────────────────────────────────────────
//
// Layer 1 — Working Memory:   conversations.context_state (JSONB)
//           Scope: current multi-step flow, slot values, flow state
//           TTL: cleared when flow completes or session goes idle (30 min)
//
// Layer 2 — Short-term Memory: messages table (last 8 messages)
//           Scope: recent conversation for Claude's context window
//           TTL: sliding window, trimmed to last 8
//
// Layer 3 — Long-term Memory:  users table (profile, role, org)
//           Scope: identity, role, preferences
//           TTL: permanent (updated via onboarding/admin)

const IDLE_TIMEOUT_MS     = 30 * 60 * 1000; // 30 minutes
const CONTEXT_WINDOW_SIZE = 20;             // Last N messages for Claude

// ─── Load Full Agent Session ──────────────────────────────────────────────────

export interface AgentSession {
  user:            AgentUser;
  conversation_id: string;
  context:         ConversationContext;
  recent_messages: Array<{ role: string; content: string; created_at: string }>;
}

export async function loadSession(
  waNumber: string,
  orgId: string
): Promise<AgentSession | null> {
  const db = createAdminClient();

  // Normalise: strip leading +, spaces, dashes, parens for a bare digits string
  const bare    = waNumber.replace(/[\s+\-()]/g, '');
  // Build both candidates so we match whatever format the DB uses
  const withPlus    = `+${bare}`;
  const withoutPlus = bare;

  console.log(`[loadSession] Looking up user waNumber=${waNumber} (bare=${bare}) orgId=${orgId}`);

  // ── Layer 3: Identity ────────────────────────────────────────────────────
  // Try both +number and bare number so the lookup is format-agnostic
  const { data: userRow, error: userErr } = await db
    .from('users')
    .select('id, organization_id, full_name, role, department, designation, manager_id, employee_id, wa_number')
    .in('wa_number', [withPlus, withoutPlus])
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (userErr) console.error('[loadSession] user lookup error:', userErr.message, userErr.details);
  console.log(`[loadSession] userRow=${userRow ? userRow.id : 'null'}`);

  if (!userRow) return null;

  // Normalise waNumber to whatever format is stored in the DB for this user
  // so conversation lookups and inserts stay consistent
  const resolvedWaNumber = userRow.wa_number as string ?? waNumber;

  const user: AgentUser = {
    id:              userRow.id,
    organization_id: userRow.organization_id,
    full_name:       userRow.full_name,
    first_name:      userRow.full_name.split(' ')[0],
    role:            userRow.role,
    department:      userRow.department,
    designation:     userRow.designation,
    manager_id:      userRow.manager_id,
    employee_id:     userRow.employee_id,
    whatsapp_number: resolvedWaNumber,  // kept in AgentUser type for compatibility
  };

  // ── Get or create conversation ────────────────────────────────────────────
  console.log(`[loadSession] Getting/creating conversation for user=${user.id}`);
  const conversation = await getOrCreateConversation(db, resolvedWaNumber, orgId, user.id);
  console.log(`[loadSession] conversation=${conversation?.id ?? 'null'}`);

  // ── Layer 1: Working memory ───────────────────────────────────────────────
  const rawContext = conversation.context_state as Record<string, unknown>;
  const context    = hydrateContext(rawContext, conversation.current_module as string | null);

  // ── Layer 2: Short-term memory ────────────────────────────────────────────
  const { data: messages } = await db
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(CONTEXT_WINDOW_SIZE);

  const recent_messages = (messages ?? []).reverse();

  return { user, conversation_id: conversation.id, context, recent_messages };
}

// ─── Persist Updated Context ──────────────────────────────────────────────────

export async function saveContext(
  conversationId: string,
  context: ConversationContext
): Promise<void> {
  const db = createAdminClient();
  await db
    .from('conversations')
    .update({
      context_state:   context as unknown as Record<string, unknown>,
      current_module:  context.module,
      current_intent:  context.flow,
      last_message_at: new Date().toISOString(),
      status:          context.flow_state === 'IDLE' ? 'idle' : 'active',
    })
    .eq('id', conversationId);
}

// ─── Save Message ─────────────────────────────────────────────────────────────

export async function saveMessage(
  conversationId: string,
  orgId: string,
  role: 'user' | 'assistant' | 'system',
  direction: 'inbound' | 'outbound',
  content: string,
  extras: Record<string, unknown> = {}
): Promise<void> {
  const db = createAdminClient();
  await db.from('messages').insert({
    conversation_id: conversationId,
    organization_id: orgId,
    direction,
    role,
    content,
    ...extras,
  });
}

// ─── Reset Context ────────────────────────────────────────────────────────────

export async function resetContext(
  conversationId: string,
  lang: SupportedLanguage = 'en'
): Promise<void> {
  const db = createAdminClient();
  const fresh: ConversationContext = { ...EMPTY_CONTEXT, language: lang };
  await db
    .from('conversations')
    .update({
      context_state:  fresh as unknown as Record<string, unknown>,
      current_module: null,
      current_intent: null,
    })
    .eq('id', conversationId);
}

// ─── Build Recent Context String (for Claude) ─────────────────────────────────
//
// Includes the conversation flow state so the classifier knows whether we're
// mid-flow (collecting slots, awaiting confirmation) or idle. Without this,
// the classifier has no idea it's currently asking for a specific slot and
// makes incorrect intent decisions.

export function buildContextString(
  messages: Array<{ role: string; content: string }>,
  state?: ConversationContext
): string {
  const chatLines = messages
    .slice(-5)
    .map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
    .join('\n');

  if (!state || state.flow_state === 'IDLE') return chatLines;

  // Summarise the bot's current state so the classifier knows what's happening
  const parts: string[] = [`State: ${state.flow_state}`];
  if (state.flow)         parts.push(`intent=${state.flow}`);
  if (state.pending_slot) parts.push(`awaiting_slot=${state.pending_slot}`);

  const filled = Object.entries(state.slots ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');
  if (filled) parts.push(`collected={${filled}}`);

  return `[${parts.join(' | ')}]\n${chatLines}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateConversation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  waNumber: string,
  orgId: string,
  userId: string
) {
  const idleThreshold = new Date(Date.now() - IDLE_TIMEOUT_MS).toISOString();

  // Use maybeSingle() — never throws on 0 rows
  const { data: existing } = await db
    .from('conversations')
    .select('*')
    .eq('wa_number', waNumber)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .gte('last_message_at', idleThreshold)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  // Also check for ANY conversation (idle/closed) for this number, to resume
  const { data: any_existing } = await db
    .from('conversations')
    .select('*')
    .eq('wa_number', waNumber)
    .eq('organization_id', orgId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (any_existing) {
    // Re-activate it
    const { data: reactivated } = await db
      .from('conversations')
      .update({ status: 'active', last_message_at: new Date().toISOString() })
      .eq('id', any_existing.id)
      .select()
      .maybeSingle();
    if (reactivated) return reactivated;
  }

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      organization_id: orgId,
      user_id:         userId,
      wa_number:       waNumber,
      channel:         'whatsapp',
      status:          'active',
      context_state:   EMPTY_CONTEXT,
      last_message_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error('[Memory] Failed to create conversation:', error.message, error.details ?? '');
    throw new Error(`Failed to create conversation: ${error.message}`);
  }
  if (!created) throw new Error('Conversation insert returned no data');
  return created;
}

function hydrateContext(
  raw: Record<string, unknown>,
  currentModule: string | null
): ConversationContext {
  if (!raw || !raw.flow_state) {
    return { ...EMPTY_CONTEXT };
  }

  return {
    flow:            (raw.flow as ConversationContext['flow']) ?? null,
    flow_state:      (raw.flow_state as ConversationContext['flow_state']) ?? 'IDLE',
    module:          (raw.module as ConversationContext['module']) ?? null,
    slots:           (raw.slots as Record<string, string | null>) ?? {},
    pending_slot:    (raw.pending_slot as string | null) ?? null,
    confirm_payload: (raw.confirm_payload as Record<string, unknown> | null) ?? null,
    confirm_message: (raw.confirm_message as string | null) ?? null,
    retry_count:     (raw.retry_count as number) ?? 0,
    error_context:   (raw.error_context as string | null) ?? null,
    language:        (raw.language as SupportedLanguage) ?? 'en',
    turn_count:      (raw.turn_count as number) ?? 0,
  };
}
