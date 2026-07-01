import type { AgentIntent, SlotDefinition, SlotValues } from './types';

// ─── Slot Schema Registry ─────────────────────────────────────────────────────
// Defines required/optional slots for every intent.
// Slots are filled left-to-right; first unfilled required slot is asked next.

const SLOT_SCHEMAS: Partial<Record<AgentIntent, SlotDefinition[]>> = {

  // ── TASK MANAGEMENT ────────────────────────────────────────────────────────

  CREATE_TASK: [
    {
      name: 'title',
      type: 'string',
      required: true,
      question_en: 'What is the task? (Give a short title)',
      question_hi: 'टास्क क्या है? (एक छोटा सा शीर्षक दें)',
      hint: 'Example: "Call client Ramesh" or "Submit report"',
    },
    {
      name: 'assignee',
      type: 'person',
      required: false,
      question_en: 'Who should I assign this to? (Name or "me")',
      question_hi: 'यह टास्क किसे सौंपना है? (नाम बताएं या "मुझे")',
    },
    {
      name: 'deadline',
      type: 'datetime',
      required: true,
      question_en: 'What is the deadline? (e.g. today 5pm, tomorrow, 25 May 3pm)',
      question_hi: 'डेडलाइन क्या है? (जैसे आज 5 बजे, कल, 25 मई 3 बजे)',
    },
    {
      name: 'priority',
      type: 'enum',
      required: true,
      question_en: 'Priority? (low / medium / high / urgent)',
      question_hi: 'प्राथमिकता? (low / medium / high / urgent)',
      enum_values: ['low', 'medium', 'high', 'urgent'],
    },
  ],

  ASSIGN_TASK: [
    {
      name: 'title',
      type: 'string',
      required: true,
      question_en: 'Which task should I assign? (Task title or ID)',
      question_hi: 'कौन सा टास्क सौंपना है?',
    },
    {
      name: 'assignee',
      type: 'person',
      required: true,
      question_en: 'Assign to whom?',
      question_hi: 'किसे सौंपना है?',
    },
  ],

  COMPLETE_TASK: [
    {
      name: 'title',
      type: 'string',
      required: true,
      question_en: 'Which task did you complete? (Title or part of it)',
      question_hi: 'कौन सा टास्क पूरा किया?',
    },
  ],

  DELETE_TASK: [
    {
      name: 'title',
      type: 'string',
      required: true,
      question_en: 'Which task do you want to delete? (Title or part of it)',
      question_hi: 'कौन सा टास्क हटाना है? (नाम या उसका हिस्सा)',
    },
  ],

  TASK_DETAILS: [
    {
      name: 'title',
      type: 'string',
      required: true,
      question_en: 'Which task do you want details for?',
      question_hi: 'किस टास्क की जानकारी चाहिए?',
    },
  ],

  UPDATE_TASK: [
    {
      name: 'title',
      type: 'string',
      required: true,
      question_en: 'Which task do you want to update?',
      question_hi: 'कौन सा टास्क अपडेट करना है?',
    },
    {
      name: 'update_field',
      type: 'enum',
      required: true,
      question_en: 'What to update? (deadline / priority / assignee / status)',
      question_hi: 'क्या अपडेट करना है? (deadline / priority / assignee / status)',
      enum_values: ['deadline', 'priority', 'assignee', 'status'],
    },
    {
      name: 'update_value',
      type: 'string',
      required: true,
      question_en: 'New value?',
      question_hi: 'नई वैल्यू क्या है?',
    },
  ],

  SET_REMINDER: [
    {
      name: 'title',
      type: 'string',
      required: true,
      question_en: 'What should I remind you about?',
      question_hi: 'किस चीज़ के लिए रिमाइंडर सेट करना है?',
    },
    {
      name: 'deadline',
      type: 'datetime',
      required: true,
      question_en: 'At what time? (e.g., today 6pm or tomorrow morning)',
      question_hi: 'कितने बजे? (जैसे आज शाम 6 बजे या कल सुबह)',
    },
  ],

  // ── LEAVE MANAGEMENT ──────────────────────────────────────────────────────

  APPLY_LEAVE: [
    {
      name: 'leave_type',
      type: 'enum',
      required: true,
      question_en: 'What type of leave? (Casual / Sick / Annual)',
      question_hi: 'किस प्रकार की छुट्टी? (Casual / Sick / Annual)',
      enum_values: ['casual', 'sick', 'annual', 'maternity'],
      hint: 'Available types: Casual, Sick, Annual, Maternity',
    },
    {
      name: 'start_date',
      type: 'date',
      required: true,
      question_en: 'From which date? (e.g. tomorrow, 25 May, 2025-05-25)',
      question_hi: 'किस तारीख से? (जैसे कल, 25 मई)',
    },
    {
      name: 'end_date',
      type: 'date',
      required: false,
      question_en: 'Until which date? (or how many days?)',
      question_hi: 'किस तारीख तक? (या कितने दिन?)',
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      question_en: 'Reason for leave? (optional, press skip to skip)',
      question_hi: 'छुट्टी का कारण? (छोड़ना हो तो "skip" लिखें)',
    },
  ],

  CANCEL_LEAVE: [
    {
      name: 'start_date',
      type: 'date',
      required: true,
      question_en: 'Which leave to cancel? (Give the start date)',
      question_hi: 'कौन सी छुट्टी रद्द करनी है? (शुरुआत की तारीख बताएं)',
    },
  ],

  APPROVE_LEAVE: [
    {
      name: 'employee_name',
      type: 'person',
      required: true,
      question_en: 'Whose leave request to approve? (Employee name)',
      question_hi: 'किसकी छुट्टी मंजूर करनी है? (कर्मचारी का नाम)',
    },
  ],

  REJECT_LEAVE: [
    {
      name: 'employee_name',
      type: 'person',
      required: true,
      question_en: 'Whose leave request to reject?',
      question_hi: 'किसकी छुट्टी अस्वीकार करनी है?',
    },
    {
      name: 'reason',
      type: 'string',
      required: false,
      question_en: 'Reason for rejection? (optional)',
      question_hi: 'अस्वीकार करने का कारण? (वैकल्पिक)',
    },
  ],

  // ── ONBOARDING ────────────────────────────────────────────────────────────

  START_ONBOARDING: [
    {
      name: 'employee_name',
      type: 'string',
      required: true,
      question_en: "New employee's full name?",
      question_hi: 'नए कर्मचारी का पूरा नाम?',
    },
    {
      name: 'wa_number',
      type: 'string',
      required: true,
      question_en: "Their WhatsApp number? (with country code, e.g. +919876543210)",
      question_hi: 'उनका WhatsApp नंबर? (country code सहित, जैसे +919876543210)',
      validation: (v) => /^\+[1-9]\d{7,14}$/.test(v.replace(/\s/g, '')),
      hint: 'Format: +919876543210 (with country code)',
    },
    {
      name: 'department',
      type: 'string',
      required: false,
      question_en: 'Which department? (optional)',
      question_hi: 'कौन सा विभाग? (वैकल्पिक)',
    },
    {
      name: 'designation',
      type: 'string',
      required: false,
      question_en: 'Designation/role title? (optional)',
      question_hi: 'पद/भूमिका? (वैकल्पिक)',
    },
  ],
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSlotSchema(intent: AgentIntent): SlotDefinition[] {
  return SLOT_SCHEMAS[intent] ?? [];
}

export function getRequiredSlots(intent: AgentIntent): SlotDefinition[] {
  return getSlotSchema(intent).filter((s) => s.required);
}

/**
 * Merges newly extracted slots into existing ones, ignoring nulls.
 */
export function mergeSlots(existing: SlotValues, incoming: SlotValues): SlotValues {
  const merged = { ...existing };
  for (const [key, val] of Object.entries(incoming)) {
    if (val !== null && val !== undefined && val !== '') {
      merged[key] = val;
    }
  }
  return merged;
}

/**
 * Returns the next unfilled required slot, then unfilled optional slots.
 * Returns null if all slots are satisfied.
 */
export function getNextPendingSlot(
  intent: AgentIntent,
  filled: SlotValues
): SlotDefinition | null {
  const schema = getSlotSchema(intent);

  // First, find unfilled required slots
  const missingRequired = schema.find(
    (s) => s.required && (filled[s.name] === null || filled[s.name] === undefined)
  );
  if (missingRequired) return missingRequired;

  return null; // All required slots filled
}

/**
 * Returns whether a slot value is valid.
 */
export function validateSlot(slot: SlotDefinition, value: string): boolean {
  if (slot.type === 'enum' && slot.enum_values) {
    return slot.enum_values.some((v) => v.toLowerCase() === value.toLowerCase().trim());
  }
  if (slot.validation) {
    return slot.validation(value);
  }
  return value.trim().length > 0;
}

/**
 * Returns all filled required slots for display in confirmation.
 */
// Human-readable labels for slot names
const SLOT_LABELS: Record<string, { en: string; hi: string; emoji: string }> = {
  title:         { en: 'Task',        hi: 'टास्क',         emoji: '📋' },
  assignee:      { en: 'Assign to',   hi: 'किसे',          emoji: '👤' },
  deadline:      { en: 'Deadline',    hi: 'डेडलाइन',       emoji: '⏰' },
  priority:      { en: 'Priority',    hi: 'प्राथमिकता',    emoji: '🎯' },
  leave_type:    { en: 'Leave type',  hi: 'छुट्टी प्रकार', emoji: '🏷️' },
  start_date:    { en: 'From',        hi: 'शुरुआत',        emoji: '📅' },
  end_date:      { en: 'Until',       hi: 'अंत',           emoji: '📅' },
  duration_days: { en: 'Duration',    hi: 'अवधि',          emoji: '📊' },
  reason:        { en: 'Reason',      hi: 'कारण',          emoji: '💬' },
  employee_name: { en: 'Employee',    hi: 'कर्मचारी',      emoji: '👤' },
  wa_number:     { en: 'WhatsApp',    hi: 'WhatsApp',      emoji: '📱' },
  department:    { en: 'Department',  hi: 'विभाग',         emoji: '🏢' },
  designation:   { en: 'Role',        hi: 'पद',            emoji: '💼' },
  update_field:  { en: 'Update',      hi: 'बदलाव',         emoji: '✏️' },
  update_value:  { en: 'New value',   hi: 'नई वैल्यू',     emoji: '🔄' },
};

export function buildConfirmationSummary(
  intent: AgentIntent,
  slots: SlotValues,
  lang: 'en' | 'hi' | 'mixed'
): string {
  const schema = getSlotSchema(intent);
  const lines: string[] = [];

  for (const slotDef of schema) {
    const val = slots[slotDef.name];
    if (val && val !== 'SKIP') {
      const meta  = SLOT_LABELS[slotDef.name];
      const label = meta ? (lang === 'hi' ? meta.hi : meta.en) : slotDef.name.replace(/_/g, ' ');
      const emoji = meta?.emoji ?? '•';
      lines.push(`${emoji} *${label}:* ${val}`);
    }
  }

  const headers: Partial<Record<AgentIntent, { en: string; hi: string }>> = {
    CREATE_TASK:      { en: '📋 *Create this task?*',           hi: '📋 *यह टास्क बनाएं?*' },
    APPLY_LEAVE:      { en: '📅 *Submit leave request?*',       hi: '📅 *छुट्टी आवेदन करें?*' },
    START_ONBOARDING: { en: '👤 *Start onboarding?*',           hi: '👤 *Onboarding शुरू करें?*' },
    ASSIGN_TASK:      { en: '📌 *Reassign this task?*',         hi: '📌 *टास्क सौंपें?*' },
    APPROVE_LEAVE:    { en: '✅ *Approve this leave?*',         hi: '✅ *छुट्टी मंजूर करें?*' },
    REJECT_LEAVE:     { en: '❌ *Reject this leave request?*',  hi: '❌ *छुट्टी अस्वीकार करें?*' },
    COMPLETE_TASK:    { en: '✅ *Mark this task complete?*',    hi: '✅ *टास्क पूरा करें?*' },
    DELETE_TASK:      { en: '🗑️ *Delete this task?*',          hi: '🗑️ *टास्क हटाएं?*' },
    UPDATE_TASK:      { en: '✏️ *Update this task?*',          hi: '✏️ *टास्क अपडेट करें?*' },
    SET_REMINDER:     { en: '⏰ *Set this reminder?*',         hi: '⏰ *रिमाइंडर सेट करें?*' },
    TASK_DETAILS:     { en: '📋 *Show details for this task?*', hi: '📋 *टास्क की जानकारी देखें?*' },
  };

  const headerObj = headers[intent];
  const header = headerObj
    ? (lang === 'hi' ? headerObj.hi : headerObj.en)
    : '✅ *Confirm action?*';

  const footer = lang === 'hi'
    ? '\n*Yes* भेजें confirm करने के लिए\n*No* भेजें cancel करने के लिए'
    : '\nReply *Yes* to confirm or *No* to cancel';

  return `${header}\n\n${lines.join('\n')}${footer}`;
}

/**
 * Build initial slot map with all slots set to null.
 */
export function initSlots(intent: AgentIntent): SlotValues {
  const schema = getSlotSchema(intent);
  return Object.fromEntries(schema.map((s) => [s.name, null]));
}
