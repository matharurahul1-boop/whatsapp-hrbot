import { classifyIntent } from './intent';
import { processStateTransition } from './state-machine';
import { executeTool } from './executor';
import { loadSession, saveContext, saveMessage, buildContextString, resetContext } from './memory';
import { evaluateRecovery, logAgentError, buildOfflineReply } from './recovery';
import { sendText } from '@/lib/whatsapp/client';
import { EMPTY_CONTEXT } from './types';
import type { AgentTurn, ConversationContext } from './types';
import type { StateTransitionResult } from './state-machine';

// ─── Master Agent Entry Point ─────────────────────────────────────────────────
//
// Flow:
//  1. Load session (user + conversation + context + recent messages)
//  2. Classify intent from user message
//  3. Run state machine (IDLE → SLOT_FILLING → CONFIRMING → EXECUTING)
//  4. If executing → run tool → get result
//  5. Persist new context
//  6. Return reply for WhatsApp
//
// This is called once per inbound WhatsApp message.

export async function runMasterAgent(
  message: string,
  waNumber: string,
  orgId: string
): Promise<AgentTurn> {
  const start = Date.now();

  // ── Step 1: Load session ─────────────────────────────────────────────────
  let session;
  try {
    session = await loadSession(waNumber, orgId);
  } catch (sessionErr) {
    console.error('[Agent] loadSession threw:', sessionErr);
    return {
      reply: `⚠️ I had trouble loading your session. Please try again in a moment.`,
      new_context: EMPTY_CONTEXT,
    };
  }

  if (!session) {
    return {
      reply: `I couldn't find your account linked to this WhatsApp number.\nPlease contact your HR or admin to register.`,
      new_context: EMPTY_CONTEXT,
    };
  }

  const { user, conversation_id, context, recent_messages } = session;

  // Save inbound message
  await saveMessage(conversation_id, orgId, 'user', 'inbound', message).catch(() => {});

  try {
    // ── Step 2: Classify intent ────────────────────────────────────────────
    // Pass the current flow state so the classifier knows whether we're mid-slot-filling,
    // awaiting confirmation, etc. — critical for context-aware intent decisions.
    const recentCtx   = buildContextString(recent_messages, context);
    const classified  = await classifyIntent(message, recentCtx);

    // Update language from latest message
    const currentLang  = classified.language !== 'en' ? classified.language : context.language;
    const workingCtx: ConversationContext = { ...context, language: currentLang };

    // ── Step 3: State machine transition ───────────────────────────────────
    const transition = await processStateTransition(message, workingCtx, classified);

    // Resolve reference phrases like "the last task" / "the one you created"
    // to the actual task title before showing confirmation or moving to next slot
    const resolved   = await resolveLastTaskRef(transition, user.id, orgId);
    let finalContext  = resolved.next_context;
    let reply         = resolved.reply;

    // ── Step 4: Execute tool if ready ──────────────────────────────────────
    if (resolved.should_execute || finalContext.flow_state === 'EXECUTING') {
      const toolResult = await executeTool({
        intent:          finalContext.flow!,
        slots:           { ...finalContext.slots, _lang: currentLang },
        org_id:          orgId,
        user_id:         user.id,
        user_role:       user.role,
        user_name:       user.full_name,
        user_department: user.department,
        manager_id:      user.manager_id,
        raw_message:     message,
      });

      reply = toolResult.reply;

      // Send notifications to other users (async, non-blocking)
      if (toolResult.notify?.length) {
        sendUserNotifications(toolResult.notify, orgId).catch(() => {});
      }

      // Reset flow after execution
      finalContext = {
        ...EMPTY_CONTEXT,
        language:    currentLang,
        turn_count:  0,
      };
    }

    // ── Step 5: Persist context ─────────────────────────────────────────────
    await saveContext(conversation_id, finalContext).catch(() => {});

    // Save outbound reply
    const finalReply = reply ?? 'What else can I help you with?';
    await saveMessage(conversation_id, orgId, 'assistant', 'outbound', finalReply, {
      latency_ms: Date.now() - start,
    }).catch(() => {});

    return {
      reply: finalReply,
      new_context: finalContext,
      debug: { latency_ms: Date.now() - start, intent: classified.intent, flow_state: finalContext.flow_state },
    };

  } catch (err: unknown) {
    // ── Error recovery ─────────────────────────────────────────────────────
    await logAgentError(orgId, conversation_id, err, context).catch(() => {});

    const recovery = evaluateRecovery(context, err instanceof Error ? err : new Error(String(err)));

    if (recovery.new_context) {
      await saveContext(conversation_id, recovery.new_context).catch(() => {});
    }

    const errReply = recovery.reply ?? buildOfflineReply(message, context.language);
    await saveMessage(conversation_id, orgId, 'assistant', 'outbound', errReply).catch(() => {});

    return {
      reply:       errReply,
      new_context: recovery.new_context ?? context,
    };
  }
}

// ─── Resolve "last task" references ──────────────────────────────────────────
//
// Detects phrases like "the one you lastly created", "my last task", "the last
// one" in the title slot and replaces them with the actual most-recently-created
// task title from the database.  Runs AFTER the state machine so we have the
// full resolved slot set and can regenerate the confirmation if needed.

const LAST_TASK_RE =
  /\b(last(?:ly)?|recent(?:ly)?|previous(?:ly)?|the one (?:you|i)|just created|latest|the last (?:one|task)|previous (?:one|task)|my (?:last|recent|latest) task)\b/i;

async function resolveLastTaskRef(
  transition: StateTransitionResult,
  userId: string,
  orgId: string
): Promise<StateTransitionResult> {
  const titleVal = transition.next_context.slots?.title as string | null | undefined;
  if (!titleVal || !LAST_TASK_RE.test(titleVal)) return transition;

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const db = createAdminClient();

    // Most recently created task by this user
    const { data: lastTask } = await db
      .from('tasks')
      .select('title')
      .eq('organization_id', orgId)
      .eq('created_by', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastTask?.title) return transition;

    const resolvedSlots = { ...transition.next_context.slots, title: lastTask.title };

    let reply          = transition.reply;
    let confirmMessage = transition.next_context.confirm_message;

    // If we just moved to CONFIRMING, regenerate the message with the real title
    if (transition.should_confirm) {
      const { generateConfirmation } = await import('./conversation');
      const newConfirm = await generateConfirmation({
        intent: transition.next_context.flow!,
        slots:  resolvedSlots,
        lang:   transition.next_context.language,
      });
      reply          = newConfirm;
      confirmMessage = newConfirm;
    }

    return {
      ...transition,
      reply,
      next_context: {
        ...transition.next_context,
        slots:           resolvedSlots,
        confirm_message: confirmMessage,
      },
    };
  } catch {
    return transition;
  }
}

// ─── Send Notifications to Other Users ───────────────────────────────────────

async function sendUserNotifications(
  notifications: Array<{ user_id: string; message: string }>,
  orgId: string
): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();

  for (const notif of notifications) {
    try {
      const { data: user } = await db
        .from('users')
        .select('wa_number')
        .eq('id', notif.user_id)
        .eq('organization_id', orgId)   // org isolation: never notify across orgs
        .single();

      if (user?.wa_number) {
        await sendText(user.wa_number, notif.message);
      }

      // Also save to notifications table
      await db.from('notifications').insert({
        organization_id: orgId,
        user_id:         notif.user_id,
        type:            'agent_notification',
        title:           'HRBot Notification',
        body:            notif.message,
        channel:         'whatsapp',
        status:          'sent',
        sent_at:         new Date().toISOString(),
      });
    } catch {
      // Don't fail main flow if notification fails
    }
  }
}
