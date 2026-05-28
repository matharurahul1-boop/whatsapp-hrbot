import type { ConversationContext, SupportedLanguage } from './types';
import { EMPTY_CONTEXT } from './types';
import { createAdminClient } from '@/lib/supabase/admin';

// ─── Error Recovery Strategy ──────────────────────────────────────────────────
//
// Level 1 — Slot validation failure: ask again (up to 3 retries)
// Level 2 — Tool execution failure: graceful error + reset flow
// Level 3 — Claude API failure: fallback keyword response
// Level 4 — DB failure: log + notify admin + user-facing message
// Level 5 — Repeated confusion (>5 turns without action): offer restart

const MAX_FLOW_TURNS = 10; // Max turns before auto-reset
const MAX_RETRIES    = 3;  // Max retries per slot

export interface RecoveryDecision {
  action: 'continue' | 'reset' | 'escalate' | 'clarify';
  reply?: string;
  new_context?: ConversationContext;
}

/**
 * Evaluates whether to reset, continue, or escalate based on context.
 */
export function evaluateRecovery(
  context: ConversationContext,
  error?: Error
): RecoveryDecision {
  const lang = context.language;

  // Too many turns without completing — force reset
  if (context.turn_count >= MAX_FLOW_TURNS) {
    return {
      action:      'reset',
      reply:       buildResetMessage(lang, 'timeout'),
      new_context: { ...EMPTY_CONTEXT, language: lang },
    };
  }

  // Retry limit on current slot
  if (context.retry_count >= MAX_RETRIES) {
    if (context.flow_state === 'SLOT_FILLING') {
      return {
        action:      'reset',
        reply:       buildResetMessage(lang, 'retry_exceeded'),
        new_context: { ...EMPTY_CONTEXT, language: lang },
      };
    }
  }

  // DB/API error
  if (error) {
    const isDBError = error.message.includes('duplicate') || error.message.includes('foreign key');
    if (isDBError) {
      return {
        action: 'escalate',
        reply:  buildEscalateMessage(lang),
      };
    }
    return {
      action:      'reset',
      reply:       buildResetMessage(lang, 'tool_error'),
      new_context: { ...EMPTY_CONTEXT, language: lang },
    };
  }

  return { action: 'continue' };
}

/**
 * Logs an error to the DB for admin review.
 */
export async function logAgentError(
  orgId: string,
  conversationId: string,
  error: unknown,
  context: ConversationContext
): Promise<void> {
  const db = createAdminClient();
  try {
    await db.from('n8n_workflow_logs').insert({
      organization_id: orgId,
      workflow_name:   'ai_agent_error',
      trigger_source:  'whatsapp',
      input_payload:   { conversation_id: conversationId, context },
      status:          'failed',
      error_message:   error instanceof Error ? error.message : String(error),
      started_at:      new Date().toISOString(),
      completed_at:    new Date().toISOString(),
    });
  } catch {
    // Silent — don't throw inside error handler
  }
}

/**
 * Auto-recovery reply when Claude API is unavailable.
 * Uses keyword-only matching — no AI call needed.
 */
export function buildOfflineReply(message: string, lang: SupportedLanguage): string {
  const lower = message.toLowerCase();

  if (/checkin|check in|present|haaziri/.test(lower)) {
    return lang === 'hi'
      ? `माफ़ करना, अभी सर्वर धीमा है। कृपया 1 मिनट बाद "checkin" दोबारा भेजें।`
      : `Sorry, I'm a bit slow right now. Please send "checkin" again in 1 minute.`;
  }
  if (/checkout|check out|leaving/.test(lower)) {
    return lang === 'hi'
      ? `सर्वर धीमा है। "checkout" 1 मिनट में दोबारा भेजें।`
      : `I'm slow right now. Please resend "checkout" in 1 minute.`;
  }

  return lang === 'hi'
    ? `माफ़ करना, अभी तकनीकी समस्या है। कृपया 1-2 मिनट बाद दोबारा कोशिश करें।`
    : `Sorry, I'm experiencing a technical issue. Please try again in 1-2 minutes.`;
}

// ─── Message Builders ─────────────────────────────────────────────────────────

function buildResetMessage(lang: SupportedLanguage, reason: 'timeout' | 'retry_exceeded' | 'tool_error'): string {
  if (lang === 'hi') {
    switch (reason) {
      case 'timeout':
        return `बहुत देर हो गई, फिर से शुरू करते हैं। बताइए, मैं आपकी क्या मदद कर सकता हूं?`;
      case 'retry_exceeded':
        return `माफ़ करें, जानकारी नहीं मिल पाई। नए सिरे से बताइए क्या करना है।`;
      case 'tool_error':
        return `कुछ तकनीकी समस्या आई। कृपया दोबारा कोशिश करें।`;
    }
  }
  switch (reason) {
    case 'timeout':
      return `Let's start fresh. What would you like to do?`;
    case 'retry_exceeded':
      return `I couldn't get the information I needed. Let's try again — what do you need help with?`;
    case 'tool_error':
      return `Something went wrong. Please try again.`;
  }
}

function buildEscalateMessage(lang: SupportedLanguage): string {
  return lang === 'hi'
    ? `एक समस्या आई जो मैं अकेले ठीक नहीं कर सकता। आपके admin को सूचित कर दिया गया है। कृपया उनसे संपर्क करें।`
    : `I ran into an issue that needs admin attention. Your admin has been notified. Please contact them directly.`;
}
