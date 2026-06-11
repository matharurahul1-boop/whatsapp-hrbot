/**
 * Conversational response generator.
 *
 * Uses Claude Haiku to generate natural, context-aware replies instead of
 * rigid fixed-string templates. Every question, retry, and confirmation feels
 * like it was written by a real colleague who read the conversation — not a
 * form. Falls back to the existing templates if the API call fails so the bot
 * never goes silent.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AgentIntent, SlotValues, SupportedLanguage, SlotDefinition } from './types';
import { formatSlotQuestion } from './prompts/responses';
import { buildConfirmationSummary } from './slots';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Slot context labels ──────────────────────────────────────────────────────

const SLOT_GUIDE: Record<string, string> = {
  title:          'the task title (short, clear name for the task)',
  assignee:       'who to assign to — a team member name, or "me" for yourself',
  deadline:       'the due date/time — e.g. tomorrow, Friday, 25 May, today 5pm',
  priority:       'priority level — low, medium, high, or urgent',
  leave_type:     'type of leave — Casual, Sick, or Annual',
  start_date:     'start date — e.g. tomorrow, 2 June',
  end_date:       'end date, or how many days',
  reason:         'reason for the leave (optional — they can type "skip")',
  employee_name:  'the employee\'s name',
  wa_number:      'their WhatsApp number with country code, e.g. +919876543210',
  department:     'their department (optional — they can type "skip")',
  designation:    'their job title/designation (optional — they can type "skip")',
  update_field:   'which field to update — deadline, priority, assignee, or status',
  update_value:   'the new value for the field being updated',
};

// ─── Human-readable intent labels ────────────────────────────────────────────

const INTENT_LABEL: Partial<Record<AgentIntent, string>> = {
  CREATE_TASK:      'create a task',
  ASSIGN_TASK:      'reassign a task',
  COMPLETE_TASK:    'mark a task complete',
  DELETE_TASK:      'delete a task',
  UPDATE_TASK:      'update a task',
  SET_REMINDER:     'set a reminder',
  TASK_DETAILS:     'look up task details',
  APPLY_LEAVE:      'apply for leave',
  CANCEL_LEAVE:     'cancel a leave request',
  APPROVE_LEAVE:    'approve a leave request',
  REJECT_LEAVE:     'reject a leave request',
  START_ONBOARDING: 'onboard a new employee',
};

// ─── generateSlotQuestion ─────────────────────────────────────────────────────
//
// Generates a natural, context-aware question for the next slot.
// Falls back to formatSlotQuestion (the rigid template) on any error.

export async function generateSlotQuestion(opts: {
  slot:         SlotDefinition;
  intent:       AgentIntent;
  filledSlots:  SlotValues;
  userMessage:  string;
  lang:         SupportedLanguage;
  isRetry?:     boolean;
  isHesitation?: boolean;
}): Promise<string> {
  const { slot, intent, filledSlots, userMessage, lang, isRetry, isHesitation } = opts;
  const fallback = formatSlotQuestion(slot, lang);

  // Build a readable summary of what's already been collected
  const collected = Object.entries(filledSlots)
    .filter(([, v]) => v !== null && v !== undefined && v !== 'SKIP' && v !== '')
    .map(([k, v]) => `${k}: "${v}"`)
    .join(', ');

  const intentLabel = INTENT_LABEL[intent] ?? intent.replace(/_/g, ' ').toLowerCase();
  const slotGuide   = SLOT_GUIDE[slot.name] ?? `the ${slot.name.replace(/_/g, ' ')}`;

  let instruction: string;

  if (isHesitation) {
    instruction =
      `The user wants to ${intentLabel} but said they need a moment: "${userMessage}". ` +
      `Respond warmly to the hesitation, then gently re-ask for: ${slotGuide}.` +
      (collected ? ` Already collected: ${collected}.` : '');
  } else if (isRetry) {
    instruction =
      `The user wants to ${intentLabel}. ` +
      `I asked for ${slotGuide} but their reply "${userMessage}" wasn't clear. ` +
      `Politely ask again — keep it very short.` +
      (slot.hint ? ` Hint to include: ${slot.hint}.` : '');
  } else {
    instruction =
      `The user wants to ${intentLabel}.` +
      (collected ? ` Already collected: ${collected}.` : '') +
      (userMessage ? ` Their last message: "${userMessage}".` : '') +
      ` Now ask them for: ${slotGuide}.` +
      (slot.hint ? ` Hint: ${slot.hint}.` : '');
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const response = await anthropic.messages.create({
      model:       'claude-haiku-4-5-20251001',
      max_tokens:  100,
      temperature: 0.4,
      system: `You are HRBot — a smart, friendly HR assistant on WhatsApp.
Generate ONE natural reply to collect the next piece of information.

Rules:
- Maximum 1-2 short sentences
- Reference what was already provided only if it makes the question clearer
- Use *bold* for important values or field names
- No filler openers: never start with "Certainly!", "Sure!", "Of course!", "Great!"
- Be warm and direct — like a helpful colleague, not a form
- Respond in ${lang === 'hi' ? 'Hindi or Hinglish' : 'English'}
- Today: ${today}
Return ONLY the message text — no quotes, no labels.`,
      messages: [{ role: 'user', content: instruction }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    return text || fallback;
  } catch {
    return fallback;
  }
}

// ─── generateConfirmation ─────────────────────────────────────────────────────
//
// Generates a natural confirmation summary before the user says Yes/No.
// Falls back to buildConfirmationSummary on any error.

export async function generateConfirmation(opts: {
  intent:  AgentIntent;
  slots:   SlotValues;
  lang:    SupportedLanguage;
}): Promise<string> {
  const { intent, slots, lang } = opts;
  const fallback = buildConfirmationSummary(intent, slots, lang);

  const intentLabel = INTENT_LABEL[intent] ?? intent.replace(/_/g, ' ').toLowerCase();

  const details = Object.entries(slots)
    .filter(([, v]) => v !== null && v !== undefined && v !== 'SKIP' && v !== '')
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n');

  if (!details) return fallback;

  const today = new Date().toISOString().split('T')[0];

  try {
    const response = await anthropic.messages.create({
      model:       'claude-haiku-4-5-20251001',
      max_tokens:  150,
      temperature: 0.3,
      system: `You are HRBot on WhatsApp. Write a short, clear confirmation message before taking an action.

Rules:
- Start with a brief line saying what you're about to do
- List the key details clearly using *bold* for values and emojis for fields
- End with exactly: Reply *Yes* to confirm or *No* to cancel
- Max 6 lines total (shorter is better)
- WhatsApp format: *bold*, line breaks, emojis (📋 ⏰ 👤 📅 ✏️ etc.)
- Respond in ${lang === 'hi' ? 'Hindi or Hinglish' : 'English'}
- Today: ${today}
Return ONLY the message text.`,
      messages: [{
        role: 'user',
        content: `Action: ${intentLabel}\nDetails:\n${details}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    // Always ensure the standard footer is present
    if (text && !text.includes('Yes') && !text.includes('हाँ')) return fallback;
    return text || fallback;
  } catch {
    return fallback;
  }
}
