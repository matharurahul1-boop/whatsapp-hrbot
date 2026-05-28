import Anthropic from '@anthropic-ai/sdk';
import type { ClassifiedIntent, AgentModule, AgentIntent, SupportedLanguage, SlotValues } from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Intent Classification Prompt ────────────────────────────────────────────

function buildClassifierPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  return `You are an intent classification engine for a WhatsApp HR management system.
Analyze the user message and return ONLY a JSON object — no other text.

Current date: ${today}
Current IST time: ${istTime}

## Intent Categories

### TASK module
- CREATE_TASK: create / add / make a task or todo
- ASSIGN_TASK: assign an existing task to someone
- LIST_TASKS: show / list / view tasks (pending/my/all)
- COMPLETE_TASK: mark done / complete / finish a task
- UPDATE_TASK: change deadline / priority / status / assignee of a task
- SET_REMINDER: set a reminder / remind me / yaad dilana
- DELETE_TASK: delete / remove a task
- TASK_DETAILS: show details of a specific task

### LEAVE module
- APPLY_LEAVE: apply / take / request leave / holiday / chutti
- CHECK_LEAVE_BALANCE: check leave balance / remaining leaves / kitni chutti bachi
- CANCEL_LEAVE: cancel / withdraw a leave request
- APPROVE_LEAVE: approve someone's leave (managers/HR only)
- REJECT_LEAVE: reject someone's leave (managers/HR only)
- LIST_LEAVES: show leave requests / history

### ATTENDANCE module
- CHECK_IN: checkin / attendance / present / aaya / I'm here / mark attendance / good morning
- CHECK_OUT: checkout / leaving / going home / bye / log out / jaata hoon
- MY_ATTENDANCE: my attendance / meri haaziri / attendance report
- TEAM_ATTENDANCE: team attendance / who is present / aaj kaun aaya
- WHO_ABSENT: who is absent / kaun absent hai / who didn't come

### ONBOARDING module
- START_ONBOARDING: onboard / add new employee / new joining / naya employee
- ONBOARDING_STATUS: onboarding status / joining progress / documents status
- UPLOAD_DOCUMENT: upload / send document / attach file

### GENERAL module
- GREETING: hello / hi / hey / namaskar / namaste / good morning/evening
- HELP: help / what can you do / commands / kya kar sakte ho
- UNKNOWN: anything else

## Entity Extraction Rules
- person: extract human names (first name OK), normalize to Title Case
- date: convert ALL relative dates to YYYY-MM-DD. "today"=today, "tomorrow"=tomorrow, "next monday"=calculate
- time: convert to HH:MM 24h format. "7pm"="19:00", "9am"="09:00"
- leave_type: normalize to: casual/sick/annual/maternity
- priority: normalize to: low/medium/high/urgent

## Affirmative/Negative Detection
is_affirmative: true if message is: yes, ok, sure, confirm, haan, bilkul, theek hai, done, correct, right, proceed
is_negative: true if message is: no, nahi, cancel, stop, nope, wrong, mat karo, ruko

## Output JSON Schema
{
  "module": "task|leave|attendance|onboarding|general",
  "intent": "<INTENT_NAME>",
  "confidence": 0.0-1.0,
  "language": "en|hi|mixed",
  "extracted_slots": {
    "title": "string or null",
    "assignee": "person name or null",
    "deadline": "YYYY-MM-DD HH:MM or null",
    "start_date": "YYYY-MM-DD or null",
    "end_date": "YYYY-MM-DD or null",
    "leave_type": "casual|sick|annual|maternity or null",
    "priority": "low|medium|high|urgent or null",
    "employee_name": "string or null",
    "wa_number": "string or null",
    "department": "string or null",
    "designation": "string or null",
    "reason": "string or null",
    "update_field": "string or null",
    "update_value": "string or null",
    "duration_days": "number as string or null"
  },
  "is_affirmative": true|false,
  "is_negative": true|false,
  "raw_text": "<original message>"
}`;
}

// ─── Main Classifier ──────────────────────────────────────────────────────────

export async function classifyIntent(
  message: string,
  recentContext: string = ''
): Promise<ClassifiedIntent> {
  const userContent = recentContext.trim()
    ? `Previous context:\n${recentContext}\n\nCurrent message: "${message}"`
    : `Message: "${message}"`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', // Fast + cheap for classification
      max_tokens: 400,
      temperature: 0,
      system: buildClassifierPrompt(),
      messages: [{ role: 'user', content: userContent }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      module: (parsed.module ?? 'general') as AgentModule,
      intent: (parsed.intent ?? 'UNKNOWN') as AgentIntent,
      confidence: parsed.confidence ?? 0,
      extracted_slots: sanitizeSlots(parsed.extracted_slots ?? {}),
      language: (parsed.language ?? 'en') as SupportedLanguage,
      is_affirmative: Boolean(parsed.is_affirmative),
      is_negative: Boolean(parsed.is_negative),
      raw_text: message,
    };
  } catch {
    return fallbackClassification(message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeSlots(raw: Record<string, unknown>): SlotValues {
  const result: SlotValues = {};
  for (const [k, v] of Object.entries(raw)) {
    result[k] = typeof v === 'string' && v !== 'null' && v !== '' ? v : null;
  }
  return result;
}

function fallbackClassification(message: string): ClassifiedIntent {
  const lower = message.toLowerCase().trim();

  // Simple keyword fallbacks for resilience
  const isCheckIn  = /\b(checkin|check in|present|aaya|attendance|good morning|haaziri)\b/i.test(lower);
  const isCheckOut = /\b(checkout|check out|leaving|bye|jaata|going home)\b/i.test(lower);
  const isTask     = /\b(task|kaam|assign|create task|todo)\b/i.test(lower);
  const isLeave    = /\b(leave|chutti|holiday|छुट्टी)\b/i.test(lower);
  const isRemind   = /\b(remind|reminder|yaad)\b/i.test(lower);
  const isHello    = /^(hi|hello|hey|hii|namaste|namaskar|good morning|good evening)\b/i.test(lower);
  const isYes      = /^(yes|ok|sure|haan|confirm|theek|bilkul|done|correct)\b/i.test(lower);
  const isNo       = /^(no|nahi|cancel|stop|nope|mat)\b/i.test(lower);

  let intent: AgentIntent = 'UNKNOWN';
  let module: AgentModule = 'general';

  if (isCheckIn)  { intent = 'CHECK_IN';  module = 'attendance'; }
  else if (isCheckOut) { intent = 'CHECK_OUT'; module = 'attendance'; }
  else if (isTask)  { intent = 'CREATE_TASK'; module = 'task'; }
  else if (isLeave) { intent = 'APPLY_LEAVE'; module = 'leave'; }
  else if (isRemind) { intent = 'SET_REMINDER'; module = 'task'; }
  else if (isHello) { intent = 'GREETING';   module = 'general'; }

  return {
    module,
    intent,
    confidence: 0.5,
    extracted_slots: {},
    language: /[ऀ-ॿ]/.test(message) ? 'hi' : 'en',
    is_affirmative: isYes,
    is_negative: isNo,
    raw_text: message,
  };
}

// ─── Slot Extraction from Follow-up ──────────────────────────────────────────
// When we're in SLOT_FILLING mode and asking for a specific slot,
// we extract just that slot value from the user's reply.

export async function extractSlotValue(
  pendingSlotName: string,
  userReply: string,
  context: string
): Promise<string | null> {
  const today = new Date().toISOString().split('T')[0];

  const prompt = `Extract the value for field "${pendingSlotName}" from the user message.
Today is ${today}.
Context: ${context}
User said: "${userReply}"

Rules:
- For date fields: convert to YYYY-MM-DD. Handle "today", "tomorrow", "next week", "25 May", etc.
- For datetime: convert to "YYYY-MM-DD HH:MM". "today 7pm" → "${today} 19:00"
- For person names: return Title Case name as given
- For leave_type: normalize to casual/sick/annual/maternity
- For priority: normalize to low/medium/high/urgent
- If user says "skip" or "no reason" for optional fields: return "SKIP"
- If the value cannot be extracted: return null

Return ONLY the extracted value as a plain string, or the word null.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (!raw || raw.toLowerCase() === 'null') return null;
    return raw;
  } catch {
    return userReply.trim() || null;
  }
}
