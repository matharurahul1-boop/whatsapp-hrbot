import type {
  ConversationContext,
  ClassifiedIntent,
  AgentIntent,
  SlotValues,
  SupportedLanguage,
} from './types';
import {
  getNextPendingSlot,
  mergeSlots,
  initSlots,
  buildConfirmationSummary,
  validateSlot,
  getSlotSchema,
} from './slots';
import { extractSlotValue } from './intent';
import { formatSlotQuestion } from './prompts/responses';

// ─── State Transitions ────────────────────────────────────────────────────────

export interface StateTransitionResult {
  next_context: ConversationContext;
  reply: string | null;        // null means → proceed to tool execution
  should_execute: boolean;     // true means → run the tool now
  should_confirm: boolean;     // true means → show confirmation and wait
}

/**
 * Core state machine. Given a message and current context, returns
 * the next state + what to reply (or null to proceed to tool execution).
 */
export async function processStateTransition(
  message: string,
  context: ConversationContext,
  classified: ClassifiedIntent
): Promise<StateTransitionResult> {

  // ── Case 1: User is confirming or cancelling a pending action ─────────────
  if (context.flow_state === 'CONFIRMING') {
    return handleConfirmationTurn(message, context, classified);
  }

  // ── Case 2: We are mid-flow collecting a slot ─────────────────────────────
  if (context.flow_state === 'SLOT_FILLING' && context.flow && context.pending_slot) {
    return handleSlotFillingTurn(message, context, classified);
  }

  // ── Case 3: New intent arrives (IDLE or new intent interrupts old flow) ────
  return handleNewIntent(message, context, classified);
}

// ─── Handler: New Intent ──────────────────────────────────────────────────────

async function handleNewIntent(
  _message: string,
  context: ConversationContext,
  classified: ClassifiedIntent
): Promise<StateTransitionResult> {

  const intent = classified.intent;
  const lang   = classified.language;

  // Intents that need no slots (execute immediately)
  const noSlotIntents: AgentIntent[] = [
    'LIST_TASKS', 'CHECK_LEAVE_BALANCE', 'LIST_LEAVES',
    'MY_ATTENDANCE', 'TEAM_ATTENDANCE', 'WHO_ABSENT',
    'ONBOARDING_STATUS', 'GREETING', 'HELP', 'CHECK_IN', 'CHECK_OUT',
  ];

  if (noSlotIntents.includes(intent)) {
    return {
      next_context: {
        ...context,
        flow: intent,
        flow_state: 'EXECUTING',
        module: classified.module,
        language: lang,
        turn_count: context.turn_count + 1,
        slots: {},
      },
      reply: null,
      should_execute: true,
      should_confirm: false,
    };
  }

  if (intent === 'UNKNOWN') {
    // Route through executor so Claude can give an intelligent answer
    return {
      next_context: {
        ...context,
        flow: 'UNKNOWN',
        flow_state: 'EXECUTING',
        module: 'general',
        language: lang,
        turn_count: context.turn_count + 1,
        slots: {},
      },
      reply: null,
      should_execute: true,
      should_confirm: false,
    };
  }

  // Initialize slots and merge any extracted from the current message
  const initialSlots = initSlots(intent);
  const mergedSlots  = mergeSlots(initialSlots, classified.extracted_slots);

  // Check what slot is needed next
  const nextSlot = getNextPendingSlot(intent, mergedSlots);

  if (!nextSlot) {
    // All required slots already in message — go to confirmation
    const confirmMsg = buildConfirmationSummary(intent, mergedSlots, lang);
    return {
      next_context: {
        ...context,
        flow: intent,
        flow_state: 'CONFIRMING',
        module: classified.module,
        slots: mergedSlots,
        pending_slot: null,
        confirm_message: confirmMsg,
        language: lang,
        turn_count: context.turn_count + 1,
      },
      reply: confirmMsg,
      should_execute: false,
      should_confirm: true,
    };
  }

  // Ask for the first missing slot
  const question = formatSlotQuestion(nextSlot, lang);
  return {
    next_context: {
      ...context,
      flow: intent,
      flow_state: 'SLOT_FILLING',
      module: classified.module,
      slots: mergedSlots,
      pending_slot: nextSlot.name,
      language: lang,
      turn_count: context.turn_count + 1,
    },
    reply: question,
    should_execute: false,
    should_confirm: false,
  };
}

// ─── Handler: Slot Filling Turn ───────────────────────────────────────────────

async function handleSlotFillingTurn(
  message: string,
  context: ConversationContext,
  classified: ClassifiedIntent
): Promise<StateTransitionResult> {

  const intent      = context.flow!;
  const lang        = context.language;
  const pendingName = context.pending_slot!;
  const schema      = getSlotSchema(intent);
  const slotDef     = schema.find((s) => s.name === pendingName);

  if (!slotDef) {
    // Schema changed — reset
    return resetFlow(context, lang);
  }

  // Extract slot value from user reply
  const contextStr = `Flow: ${intent}, Collecting: ${pendingName}`;
  const extracted  = await extractSlotValue(pendingName, message, contextStr);

  // Handle explicit skip for optional slots
  if (extracted === 'SKIP' || message.toLowerCase().trim() === 'skip') {
    // Skip this optional slot and move to next
    const newSlots = { ...context.slots, [pendingName]: 'SKIP' };
    return advanceToNextSlotOrConfirm(intent, newSlots, context, lang);
  }

  // Validate
  if (!extracted) {
    const retries = context.retry_count + 1;
    if (retries >= 3) {
      // Give up on this optional slot, or fail on required
      if (!slotDef.required) {
        const newSlots = { ...context.slots, [pendingName]: null };
        return advanceToNextSlotOrConfirm(intent, newSlots, context, lang);
      }
      return resetFlow(context, lang, lang === 'hi'
        ? `माफ़ करें, यह जानकारी नहीं मिल पाई। कृपया नए सिरे से कोशिश करें।`
        : `Sorry, I couldn't understand that. Let's start over — what would you like to do?`
      );
    }

    const hint = retries >= 2 && slotDef.hint
      ? `\n💡 ${slotDef.hint}`
      : '';

    return {
      next_context: { ...context, retry_count: retries },
      reply: (lang === 'hi' ? `समझ नहीं पाया। ` : `Hmm, I didn't catch that. `) +
        formatSlotQuestion(slotDef, lang) + hint,
      should_execute: false,
      should_confirm: false,
    };
  }

  // Validate against enum / custom validation
  if (!validateSlot(slotDef, extracted)) {
    const options = slotDef.enum_values?.join(' / ') ?? '';
    return {
      next_context: { ...context, retry_count: context.retry_count + 1 },
      reply: lang === 'hi'
        ? `"${extracted}" सही नहीं है। ${options ? `विकल्प: ${options}` : ''}`
        : `"${extracted}" isn't valid. ${options ? `Options: ${options}` : ''} Please try again.`,
      should_execute: false,
      should_confirm: false,
    };
  }

  // Slot filled successfully
  const newSlots = mergeSlots(context.slots, { [pendingName]: extracted });

  // Also merge any other slots extracted from this message
  const additionalSlots = mergeSlots(newSlots, classified.extracted_slots);

  return advanceToNextSlotOrConfirm(intent, additionalSlots, context, lang);
}

// ─── Handler: Confirmation Turn ───────────────────────────────────────────────

function handleConfirmationTurn(
  message: string,
  context: ConversationContext,
  classified: ClassifiedIntent
): StateTransitionResult {

  const lang = context.language;

  if (classified.is_affirmative) {
    return {
      next_context: { ...context, flow_state: 'EXECUTING' },
      reply: null,
      should_execute: true,
      should_confirm: false,
    };
  }

  if (classified.is_negative) {
    return resetFlow(context, lang, lang === 'hi'
      ? 'ठीक है, रद्द कर दिया। मैं और किस चीज़ में मदद कर सकता हूं?'
      : 'Got it, cancelled. What else can I help you with?'
    );
  }

  // Detect correction intent — user wants to change or re-enter something
  const correctionRe = /\b(change|wrong|different|edit|didn't give|that's not|not right|incorrect|mistake|modify|redo|restart|actually|wait)\b/i;
  if (context.flow && correctionRe.test(message)) {
    const freshSlots = initSlots(context.flow);
    const nextSlot   = getNextPendingSlot(context.flow, freshSlots);
    if (nextSlot) {
      return {
        next_context: {
          ...context,
          flow_state:      'SLOT_FILLING',
          slots:           freshSlots,
          pending_slot:    nextSlot.name,
          confirm_message: null,
          retry_count:     0,
        },
        reply: lang === 'hi'
          ? `ठीक है, फिर से शुरू करते हैं। ${formatSlotQuestion(nextSlot, lang)}`
          : `No problem, let's redo that. ${formatSlotQuestion(nextSlot, lang)}`,
        should_execute: false,
        should_confirm: false,
      };
    }
  }

  // Ambiguous — resend the confirmation as-is (it already contains the reply footer)
  return {
    next_context: context,
    reply: lang === 'hi'
      ? `कृपया *Yes* या *No* में जवाब दें।\n\n${context.confirm_message}`
      : context.confirm_message ?? `Please reply *Yes* to confirm or *No* to cancel.`,
    should_execute: false,
    should_confirm: false,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function advanceToNextSlotOrConfirm(
  intent: AgentIntent,
  slots: SlotValues,
  context: ConversationContext,
  lang: SupportedLanguage
): StateTransitionResult {

  const nextSlot = getNextPendingSlot(intent, slots);

  if (nextSlot) {
    return {
      next_context: {
        ...context,
        slots,
        pending_slot: nextSlot.name,
        flow_state: 'SLOT_FILLING',
        retry_count: 0,
      },
      reply: formatSlotQuestion(nextSlot, lang),
      should_execute: false,
      should_confirm: false,
    };
  }

  // All required slots done → confirmation
  const confirmMsg = buildConfirmationSummary(intent, slots, lang);
  return {
    next_context: {
      ...context,
      slots,
      pending_slot: null,
      flow_state: 'CONFIRMING',
      confirm_message: confirmMsg,
      retry_count: 0,
    },
    reply: confirmMsg,
    should_execute: false,
    should_confirm: true,
  };
}

function resetFlow(
  context: ConversationContext,
  lang: SupportedLanguage,
  message?: string
): StateTransitionResult {
  return {
    next_context: {
      ...context,
      flow: null,
      flow_state: 'IDLE',
      module: null,
      slots: {},
      pending_slot: null,
      confirm_payload: null,
      confirm_message: null,
      retry_count: 0,
      error_context: null,
    },
    reply: message ?? (lang === 'hi'
      ? 'कुछ तकनीकी समस्या आई। कृपया दोबारा कोशिश करें।'
      : 'Something went wrong. Please try again.'),
    should_execute: false,
    should_confirm: false,
  };
}

function buildUnknownReply(lang: SupportedLanguage): string {
  if (lang === 'hi') {
    return `समझ नहीं पाया। मैं इनमें मदद कर सकता हूं:\n\n` +
      `• *टास्क* — बनाना, असाइन करना, पूरा करना\n` +
      `• *छुट्टी* — आवेदन, बैलेंस, अनुमोदन\n` +
      `• *हाजिरी* — चेक-इन, चेक-आउट\n` +
      `• *ऑनबोर्डिंग* — नया कर्मचारी जोड़ें\n\n` +
      `"help" लिखें पूरी जानकारी के लिए।`;
  }
  return `I didn't understand that. Here's what I can help with:\n\n` +
    `• *Tasks* — create, assign, complete\n` +
    `• *Leave* — apply, balance, approvals\n` +
    `• *Attendance* — check-in, check-out, reports\n` +
    `• *Onboarding* — add new employee\n\n` +
    `Type *help* for full commands.`;
}
