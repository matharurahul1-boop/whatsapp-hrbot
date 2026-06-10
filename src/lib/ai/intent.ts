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
      model: 'claude-3-5-haiku-20241022', // Fast + cheap for classification
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
  const isHindi = /[ऀ-ॿ]/.test(message);

  // ── Affirmative / Negative ─────────────────────────────────────────────────
  const isYes = /^(yes|ok|sure|haan|confirm|theek|bilkul|done|correct|yep|yup|proceed|go ahead|ha)\b/i.test(lower);
  const isNo  = /^(no|nahi|cancel|stop|nope|mat|nhi|na)\b/i.test(lower);

  // ── ATTENDANCE ─────────────────────────────────────────────────────────────
  const isCheckIn      = /\b(checkin|check.?in|present|aaya|good morning|i.?m here|mark attendance|punch in|haaziri)\b/i.test(lower);
  const isCheckOut     = /\b(checkout|check.?out|leaving|bye|jaata|going home|log.?out|punch out|done for today|signing off)\b/i.test(lower);
  const isMyAttendance = /\b(my attendance|meri haaziri|attendance report|my report)\b/i.test(lower);
  const isTeamAttend   = /\b(team attendance|who is present|who came|aaj kaun aaya)\b/i.test(lower);
  const isWhoAbsent    = /\b(who is absent|who.?s absent|absent today|kaun absent)\b/i.test(lower);

  // ── LEAVE ──────────────────────────────────────────────────────────────────
  const isLeaveBalance  = /\b(balance|remaining|how many|kitni|left)\b.*\b(leave|chutti)\b|\b(leave|chutti)\b.*\b(balance|remaining|left|kitni)\b/i.test(lower);
  const isApproveLeave  = /\b(approve)\b.*\b(leave)\b/i.test(lower);
  const isRejectLeave   = /\b(reject)\b.*\b(leave)\b/i.test(lower);
  const isCancelLeave   = /\b(cancel|withdraw)\b.*\b(leave)\b/i.test(lower);
  const isListLeaves    = /\b(list|show|history|view)\b.*\b(leave|requests)\b|\b(leave)\b.*\b(history|list|requests)\b/i.test(lower);
  const isApplyLeave    = /\b(apply|take|request|need|want|book)\b.*\b(leave|chutti|holiday|छुट्टी)\b/i.test(lower);

  // ── TASK (task OR tasks — handle both singular and plural) ────────────────
  const isCompleteTask = /\b(complete|done|finish|mark.*(done|complete)|completed|khatam)\b.*\btasks?\b|\btasks?\b.*\b(complete|done|finish|khatam)\b/i.test(lower);
  const isAssignTask   = /\b(assign|give|transfer)\b.*\btasks?\b|\btask\b.*\b(assign|give|transfer)\b/i.test(lower);
  const isDeleteTask   = /\b(delete|remove)\b.*\btasks?\b/i.test(lower);
  const isUpdateTask   = /\b(update|change|modify|edit|set)\b.*\b(task|deadline|priority|status|assignee|due date)\b/i.test(lower);
  const isTaskDetails  = /\btask\s+(details|info)\b|\b(details|info)\b.*\btask\b/i.test(lower);
  const isListTasks    = /\b(list|show|view|pending|all)\b.*\btasks?\b|\btasks?\b.*\b(list|show|pending|all)\b|\bmy\s+(pending\s+)?tasks?\b/i.test(lower);
  const isCreateTask   = /\b(create|add|make|new|bana|banao)\b.*\btasks?\b|\btasks?\b.*\b(create|add|make|new)\b/i.test(lower);
  const isReminder     = /\b(remind|reminder|yaad dilao|alert me)\b/i.test(lower);

  // ── GENERAL ────────────────────────────────────────────────────────────────
  const isHelp  = /\b(help|commands|what can you do|kya kar sakte|menu|options)\b/i.test(lower);
  const isHello = /^(hi|hello|hey|hii|namaste|namaskar|good morning|good evening|good afternoon|sup)\b/i.test(lower);

  // ── Determine intent (order matters — more specific first) ─────────────────
  let intent: AgentIntent = 'UNKNOWN';
  let module: AgentModule = 'general';

  if      (isCheckIn)       { intent = 'CHECK_IN';             module = 'attendance'; }
  else if (isCheckOut)      { intent = 'CHECK_OUT';            module = 'attendance'; }
  else if (isMyAttendance)  { intent = 'MY_ATTENDANCE';        module = 'attendance'; }
  else if (isTeamAttend)    { intent = 'TEAM_ATTENDANCE';      module = 'attendance'; }
  else if (isWhoAbsent)     { intent = 'WHO_ABSENT';           module = 'attendance'; }
  else if (isLeaveBalance)  { intent = 'CHECK_LEAVE_BALANCE';  module = 'leave';      }
  else if (isApproveLeave)  { intent = 'APPROVE_LEAVE';        module = 'leave';      }
  else if (isRejectLeave)   { intent = 'REJECT_LEAVE';         module = 'leave';      }
  else if (isCancelLeave)   { intent = 'CANCEL_LEAVE';         module = 'leave';      }
  else if (isListLeaves)    { intent = 'LIST_LEAVES';          module = 'leave';      }
  else if (isApplyLeave)    { intent = 'APPLY_LEAVE';          module = 'leave';      }
  else if (isCompleteTask)  { intent = 'COMPLETE_TASK';        module = 'task';       }
  else if (isAssignTask)    { intent = 'ASSIGN_TASK';          module = 'task';       }
  else if (isDeleteTask)    { intent = 'DELETE_TASK';          module = 'task';       }
  else if (isUpdateTask)    { intent = 'UPDATE_TASK';          module = 'task';       }
  else if (isTaskDetails)   { intent = 'TASK_DETAILS';         module = 'task';       }
  else if (isCreateTask)    { intent = 'CREATE_TASK';          module = 'task';       }
  else if (isListTasks)     { intent = 'LIST_TASKS';           module = 'task';       }
  else if (isReminder)      { intent = 'SET_REMINDER';         module = 'task';       }
  else if (isHelp)          { intent = 'HELP';                 module = 'general';    }
  else if (isHello)         { intent = 'GREETING';             module = 'general';    }

  // ── Basic slot extraction ──────────────────────────────────────────────────
  const extracted_slots: SlotValues = {};

  // Date helpers
  const today    = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const todayStr    = today.toISOString().split('T')[0];
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const monthMap: Record<string, string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  };

  // Extract deadline from the message
  if (/\btoday\b/i.test(lower))    extracted_slots.deadline = todayStr;
  if (/\btomorrow\b/i.test(lower)) extracted_slots.deadline = tomorrowStr;
  const mMatch = lower.match(/(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i);
  if (mMatch) {
    const mon = monthMap[mMatch[2].toLowerCase().slice(0,3)];
    extracted_slots.deadline = `${today.getFullYear()}-${mon}-${mMatch[1].padStart(2,'0')}`;
  }

  // Extract task title (text after "task"/"todo" trigger, before "by"/"on"/"due")
  if (intent === 'CREATE_TASK' || intent === 'SET_REMINDER') {
    const tMatch = message.match(/(?:tasks?|todos?|reminder)(?:\s+(?:to|for|called|named|titled|:))?\s+(.+?)(?:\s+(?:by|on|due|before|at)\s+|$)/i);
    if (tMatch?.[1]?.trim()) extracted_slots.title = tMatch[1].trim();
  }

  // Extract assignee name (person after "to", "for", "assign to")
  if (intent === 'ASSIGN_TASK' || intent === 'UPDATE_TASK') {
    const aMatch = message.match(/\b(?:to|for|assign to|give to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (aMatch?.[1]) extracted_slots.assignee = aMatch[1];
  }

  // Extract leave type
  if (intent === 'APPLY_LEAVE') {
    if (/\b(casual|cl)\b/i.test(lower))             extracted_slots.leave_type = 'casual';
    else if (/\b(sick|medical|sl)\b/i.test(lower))  extracted_slots.leave_type = 'sick';
    else if (/\b(annual|el|earned)\b/i.test(lower)) extracted_slots.leave_type = 'annual';
  }

  // Extract priority
  if (/\b(urgent|critical|asap)\b/i.test(lower))  extracted_slots.priority = 'urgent';
  else if (/\bhigh\b/i.test(lower))               extracted_slots.priority = 'high';
  else if (/\blow\b/i.test(lower))                extracted_slots.priority = 'low';

  return {
    module,
    intent,
    confidence: 0.6,
    extracted_slots,
    language: isHindi ? 'hi' : 'en',
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
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 80,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (!raw || raw.toLowerCase() === 'null') return null;
    return raw;
  } catch {
    // ── Keyword-based fallback: extract common slot types ourselves ──────────
    const reply = userReply.trim();
    if (!reply) return null;

    // Skip / none
    if (/^(skip|n\/a|none|no|-|na)$/i.test(reply)) return 'SKIP';

    // ── Date fields ──────────────────────────────────────────────────────────
    const dateFields = ['deadline', 'start_date', 'end_date', 'date', 'due_date'];
    if (dateFields.includes(pendingSlotName.toLowerCase())) {
      const r = reply.toLowerCase();
      const now      = new Date();
      const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
      const nextWeek = new Date(now); nextWeek.setDate(now.getDate() + 7);
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const monthMap: Record<string, string> = {
        jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
        jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
      };

      if (/\btoday\b/.test(r))      return fmt(now);
      if (/\btomorrow\b/.test(r))   return fmt(tomorrow);
      if (/\bnext.?week\b/.test(r)) return fmt(nextWeek);

      // Already ISO: 2026-06-15
      const isoM = reply.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (isoM) return isoM[1];

      // DD Month — "25 May", "15 june"
      const dmM = reply.match(/(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i);
      if (dmM) {
        const mon = monthMap[dmM[2].toLowerCase().slice(0,3)];
        return `${now.getFullYear()}-${mon}-${dmM[1].padStart(2,'0')}`;
      }

      // Month DD — "May 25", "June 15"
      const mdM = reply.match(/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})/i);
      if (mdM) {
        const mon = monthMap[mdM[1].toLowerCase().slice(0,3)];
        return `${now.getFullYear()}-${mon}-${mdM[2].padStart(2,'0')}`;
      }
    }

    // ── Priority ─────────────────────────────────────────────────────────────
    if (pendingSlotName === 'priority') {
      if (/\b(urgent|critical|asap)\b/i.test(reply)) return 'urgent';
      if (/\bhigh\b/i.test(reply))                   return 'high';
      if (/\bmedium\b/i.test(reply))                 return 'medium';
      if (/\blow\b/i.test(reply))                    return 'low';
    }

    // ── Leave type ────────────────────────────────────────────────────────────
    if (pendingSlotName === 'leave_type') {
      if (/\b(casual|cl)\b/i.test(reply))             return 'casual';
      if (/\b(sick|medical|sl)\b/i.test(reply))       return 'sick';
      if (/\b(annual|el|earned)\b/i.test(reply))      return 'annual';
      if (/\b(maternity|paternity)\b/i.test(reply))   return 'maternity';
    }

    return reply || null;
  }
}
