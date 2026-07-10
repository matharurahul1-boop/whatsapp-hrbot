import Anthropic                from '@anthropic-ai/sdk';
import { GoogleGenerativeAI }  from '@google/generative-ai';
import OpenAI                  from 'openai';
import Groq                    from 'groq-sdk';
import { loadSession, saveMessage, saveContext } from './memory';
import { sendSmartText }       from '@/lib/whatsapp/client';
import { parseDeadlineString, formatDateTime } from '@/lib/utils/date';
import { EMPTY_CONTEXT }       from './types';
import type { AgentTurn, AgentUser, ConversationContext, SupportedLanguage, ToolResult } from './types';
import { normalizeCommandText, quickTaskListArgs, resolveTaskListPronoun } from './routing';

// ── AI backend ────────────────────────────────────────────────────────────────
// Controlled at runtime via organizations.settings.ai_backend (set from /settings page).
// 'groq'   → Groq Llama 3.3 70B (free tier)
// 'claude' → Claude Haiku 4.5   (paid — platform.claude.com credits)
// Default  → 'groq' (safe/free until explicitly switched to 'claude')
// Fallback → OpenRouter free tier (if the chosen primary fails)

// Per-org in-memory cache (60 s TTL). Serverless-safe: stale entries are simply
// re-fetched on the next request after expiry.
const _backendCache = new Map<string, { v: 'groq' | 'claude'; t: number }>();

// Hard-disabled 2026-07-10 at the org's request — only paid Claude should
// run the conversational backend now. Flip back to true to re-enable the
// free Groq option; nothing else in this file needs to change to do so.
// Keep in sync with the matching flag in
// src/app/(dashboard)/settings/page.tsx, which locks the UI toggle to match.
const GROQ_BACKEND_ENABLED = false;

async function resolveBackend(orgId: string): Promise<'groq' | 'claude'> {
  if (!GROQ_BACKEND_ENABLED) return 'claude';
  const hit = _backendCache.get(orgId);
  if (hit && Date.now() < hit.t) return hit.v;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { data } = await createAdminClient()
      .from('organizations').select('settings').eq('id', orgId).single();
    const v: 'groq' | 'claude' =
      (data?.settings as Record<string, string> | null)?.ai_backend === 'claude' ? 'claude' : 'groq';
    _backendCache.set(orgId, { v, t: Date.now() + 60_000 });
    return v;
  } catch {
    return 'groq';
  }
}

// Rotate across every configured free-tier key. GROQ_API_KEY may also contain
// a comma-separated list for backwards compatibility.
const GROQ_KEYS = [
  ...(process.env.GROQ_API_KEY ?? '').split(','),
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
  process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
  process.env.GROQ_API_KEY_8,
  process.env.GROQ_API_KEY_9,
  process.env.GROQ_API_KEY_10,
].map(k => k?.trim()).filter((k): k is string => Boolean(k));
const groqClients  = GROQ_KEYS.map(k => new Groq({ apiKey: k }));

// Per-org Groq key override, set from the Settings page and stored in
// organization_secrets (never the client-readable organizations row).
// Falls back to the env-var-configured clients above when an org hasn't
// set any of its own — same 60s cache pattern as resolveBackend.
const _groqClientsCache = new Map<string, { clients: Groq[]; t: number }>();

async function resolveGroqClients(orgId: string): Promise<Groq[]> {
  const hit = _groqClientsCache.get(orgId);
  if (hit && Date.now() < hit.t) return hit.clients;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { data } = await createAdminClient()
      .from('organization_secrets').select('groq_api_keys').eq('organization_id', orgId).maybeSingle();
    const keys = (data?.groq_api_keys ?? '').split(',').map((k: string) => k.trim()).filter(Boolean);
    const clients = keys.length > 0 ? keys.map((k: string) => new Groq({ apiKey: k })) : groqClients;
    _groqClientsCache.set(orgId, { clients, t: Date.now() + 60_000 });
    return clients;
  } catch {
    return groqClients;
  }
}

// Fisher-Yates shuffle — used to pick a random key order per request so load
// spreads randomly across all configured keys, and a 429/failure falls back
// to a random remaining key rather than the next one in a fixed sequence.
function shuffledIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
const genAI     = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
const openai    = new OpenAI({
  apiKey:  process.env.OPENROUTER_API_KEY || 'not-configured',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'https://handysolver.com', 'X-Title': 'HRBot' },
});

const AI_MODEL_GROQ   = 'llama-3.3-70b-versatile';
const AI_MODEL_CLAUDE = 'claude-haiku-4-5-20251001';
const AI_MODEL_GEMINI = 'gemini-2.0-flash';
const AI_MODEL_OR     = 'openrouter/free';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// ─── Deterministic quick-router ───────────────────────────────────────────────
//
// For crystal-clear short patterns, bypass the AI entirely.
// This guarantees correct behaviour regardless of model quality.
// Only read-only tools here — action tools (check_in, create_task etc.)
// still go through Groq so confirmation prompts are preserved.

const QUICK_ROUTES: Array<{ re: RegExp; tool: string }> = [
  { re: /^(hi+|hey+|hello+|good\s*(morning|afternoon|evening|night)|namaste|namaskar|hlo+|hii+|greetings?|start|shuru)\s*[!.]*$/i,           tool: 'daily_briefing'      },
  { re: /^(today'?s?\s*(summary|briefing|update|status)|briefing|morning\s*update|daily\s*(brief|update|status)|what'?s?\s*up)\s*[!.?]*$/i,  tool: 'daily_briefing'      },
  // list_tasks intentionally excluded — AI handles all task-listing phrasings
  // so it can correctly pass assignee_name="mine" for self-queries.
  { re: /^(leave\s*balance|my\s*leave\s*balance|leaves?\s*left|check\s*leave|how\s*many\s*leaves?)$/i,                                        tool: 'check_leave_balance' },
  { re: /^(my\s*attendance|attendance\s*report|show\s*attendance|attendance|my\s*check\s*in\s*history)$/i,                                     tool: 'my_attendance'       },
  { re: /^(list\s*leaves?|my\s*leaves?|leave\s*requests?|leaves?|my\s*leave\s*history)$/i,                                                    tool: 'list_leaves'         },
  { re: /^(team\s*attendance|who\s*(is\s*)?absent|absent\s*today|who\s*checked\s*in|attendance\s*today)$/i,                                    tool: 'team_attendance'     },
  { re: /^(list\s*(all\s*)?users?|team\s*members?|employees?|all\s*employees?|who\s*is\s*in\s*(the\s*)?team|give\s*me\s*(the\s*)?list\s*of\s*users?|show\s*(me\s*)?(all\s*)?users?|get\s*(all\s*)?users?)$/i, tool: 'list_users' },
  { re: /^(my\s*profile|my\s*info|profile|show\s*my\s*profile|who\s*am\s*i|my\s*details?|meri\s*profile)$/i,                                   tool: 'my_profile'          },
  { re: /^(task\s*stats?|task\s*summary|task\s*report|pending\s*count|how\s*many\s*tasks?|task\s*overview)$/i,                                  tool: 'task_stats'          },
  { re: /^(pending\s*leaves?|leave\s*requests?\s*pending|who\s*has\s*pending\s*leave|pending\s*approvals?)$/i,                                  tool: 'pending_leaves'      },
  { re: /^(leave\s*types?|types?\s*of\s*leave|what\s*leaves?\s*(do\s*we\s*have|are\s*available)|available\s*leaves?)$/i,                       tool: 'list_leave_types'    },
  { re: /^(help|\?|commands?|what\s*can\s*(you|u)\s*do|options?)$/i,                                                                           tool: 'help'                },
];

function quickRoute(message: string): string | null {
  const t = normalizeCommandText(message).replace(/[?.!,;]+$/, '');
  for (const { re, tool } of QUICK_ROUTES) {
    if (re.test(t)) return tool;
  }
  return null;
}

// ─── Confirmation helpers ─────────────────────────────────────────────────────
//
// When the AI's last message ended with "Go ahead? (Yes / No)" and the user's
// reply is any form of "yes" or "proceed", we inject an explicit instruction so
// the model executes the pending tool instead of starting over.

const YES_RE = /^(yes|yeah|yep|sure|ok|okay|go\s*ahead|proceed|confirm|create\s*(the\s*)?task|create\s*it|do\s*it|haan|haa|theek\s*hai|bilkul|kar\s*(do|dein?)|let['']?s\s*do\s*it|sounds?\s*good)\s*[!.]*$/i;
const NO_RE  = /^(no|nahi|nope|cancel|stop|don['']?t|mat\s*karo|band\s*karo|ruk\s*jao|ruko|back)\s*[!.]*$/i;

// Tools that must NEVER execute directly — always require a user confirmation first.
const CONFIRM_BEFORE_EXEC = new Set([
  'create_task', 'update_task', 'complete_task', 'delete_task', 'assign_task',
  'apply_leave', 'approve_leave', 'reject_leave', 'cancel_leave',
  'check_in', 'check_out', 'set_reminder', 'configure_reminders',
  'add_task_note', 'start_onboarding',
]);

// Read-only tools whose DB output must reach the user untouched. Feeding these
// results back into another model round-trip lets the model paraphrase (and
// sometimes hallucinate, e.g. reporting "no tasks found" over a non-empty
// result) — so we short-circuit and return the tool output directly.
const VERBATIM_TOOLS = new Set([
  'daily_briefing', 'list_tasks', 'get_task_details', 'check_leave_balance',
  'list_leaves', 'my_attendance', 'team_attendance', 'list_users',
  'pending_leaves', 'list_leave_types', 'my_profile', 'task_stats',
  'onboarding_status',
]);

function isYes(msg: string): boolean { return YES_RE.test(msg.trim()); }
function isNo (msg: string): boolean { return NO_RE.test(msg.trim()); }

// A narrower, unanchored-at-end version of YES_RE for compound replies like
// "Yes and it's mahima's task" — confirming a pending action *and* immediately
// supplying the next request in the same message. isYes() requires the whole
// message to be just an affirmative, so compound replies like this used to
// fall through, silently discard the pending confirmation, and only act on
// the trailing text. Deliberately narrower than YES_RE (drops ambiguous
// phrases like "do it"/"sounds good" that could legitimately start an
// unrelated sentence) to avoid misfiring on ordinary messages.
const LEADING_YES_RE = /^(?:yes|yeah|yep|sure|ok|okay|go\s*ahead|proceed|confirm|haan|haa|theek\s*hai|bilkul)\b[\s,!.:;-]*(?:and\s+|but\s+)?/i;
function splitLeadingYes(msg: string): string | null {
  const trimmed = msg.trim();
  const m = trimmed.match(LEADING_YES_RE);
  if (!m) return null;
  const remainder = trimmed.slice(m[0].length).trim();
  return remainder.length > 0 ? remainder : null;
}

function lastBotMessage(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return history[i].content ?? '';
  }
  return '';
}

function isPendingConfirmation(history: ChatMessage[]): boolean {
  const last = lastBotMessage(history);
  return last.toLowerCase().includes('go ahead') || last.includes('(Yes / No)') || last.includes('(yes / no)');
}

// ─── Natural-date → YYYY-MM-DD ────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  jan:'01', january:'01', feb:'02', february:'02', mar:'03', march:'03',
  apr:'04', april:'04',  may:'05',  jun:'06',     june:'06', jul:'07',
  july:'07', aug:'08',  august:'08', sep:'09',    september:'09', oct:'10',
  october:'10', nov:'11', november:'11', dec:'12', december:'12',
};

// Return current time as IST wall-clock Date.
// On Vercel (UTC process), new Date() gives UTC — this corrects it to IST.
function istNowDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function naturalDateToISO(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // Use IST wall-clock for all relative date calculations
  const now  = istNowDate();
  const yr   = now.getFullYear();
  const nowM = now.getMonth();  // 0-indexed
  const nowD = now.getDate();

  // Relative keywords
  if (/\btoday\b/i.test(t)) return ymd(now);
  if (/\bday after tomorrow\b/i.test(t)) {
    const d = new Date(now); d.setDate(d.getDate() + 2);
    return ymd(d);
  }
  if (/\btomorrow\b/i.test(t)) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    return ymd(d);
  }
  // "in N days"
  const inDays = t.match(/\bin\s+(\d+)\s+days?\b/i);
  if (inDays) {
    const d = new Date(now); d.setDate(d.getDate() + parseInt(inDays[1]));
    return ymd(d);
  }
  // "next week"
  if (/\bnext\s+week\b/i.test(t)) {
    const d = new Date(now); d.setDate(d.getDate() + 7);
    return ymd(d);
  }
  // "end of month"
  if (/\bend\s+of\s+month\b/i.test(t)) {
    const d = new Date(yr, nowM + 1, 0);
    return ymd(d);
  }
  // "next Monday/Tuesday/..." or bare day name
  const DAY_MAP: Record<string,number> = { sun:0,sunday:0,mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6 };
  const dayM = t.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i);
  if (dayM) {
    const target = DAY_MAP[dayM[2].toLowerCase()];
    if (target !== undefined) {
      const d = new Date(now);
      const diff = ((target - d.getDay()) + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return ymd(d);
    }
  }

  // Pick year: if month/day is in the past use next year
  function pickYear(mo: string, day: string): number {
    const mIdx = parseInt(mo) - 1; // 0-indexed
    if (mIdx < nowM || (mIdx === nowM && parseInt(day) < nowD)) return yr + 1;
    return yr;
  }

  // "17th June" or "17 June 2026"
  let m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/i);
  if (m) {
    const mo = MONTH_MAP[m[2].toLowerCase()];
    if (mo) {
      const useYr = m[3] ? parseInt(m[3]) : pickYear(mo, m[1]);
      return `${useYr}-${mo}-${m[1].padStart(2,'0')}`;
    }
  }
  // "June 17" or "June 17th 2026"
  m = t.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/i);
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    if (mo) {
      const useYr = m[3] ? parseInt(m[3]) : pickYear(mo, m[2]);
      return `${useYr}-${mo}-${m[2].padStart(2,'0')}`;
    }
  }
  return null;
}

/** Extract a time component from natural text → "HH:MM" (24h) or null */
function extractTimeFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t))     return '12:00';
  if (/\bmidnight\b/.test(t)) return '00:00';
  // "5pm", "5:30pm", "5:30 pm"
  const m12 = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m12) {
    let h = parseInt(m12[1]);
    const min = m12[2] ? parseInt(m12[2]) : 0;
    if (m12[3].toLowerCase() === 'pm' && h !== 12) h += 12;
    if (m12[3].toLowerCase() === 'am' && h === 12) h = 0;
    return `${h.toString().padStart(2,'0')}:${min.toString().padStart(2,'0')}`;
  }
  // "17:00" (no am/pm suffix)
  const m24 = t.match(/\b(\d{1,2}):(\d{2})\b(?!\s*[ap]m)/i);
  if (m24) return `${m24[1].padStart(2,'0')}:${m24[2]}`;
  return null;
}

// ─── Parse confirmation message → { tool, args } ─────────────────────────────
//
// Extracts the pending action from a "Go ahead? (Yes / No)" bot message.
// Used both for (a) storing in context_state after Groq confirms, and
// (b) direct tool execution when user says "yes".

interface ConfirmationParsed {
  tool: string;
  args: Record<string, string>;
}

function parseConfirmationMessage(lastMsg: string): ConfirmationParsed | null {
  const lower = lastMsg.toLowerCase();

  // CREATE_TASK: "I'll create task *Title* ... Go ahead?"
  if (/i.?ll\s+create\s+task/i.test(lastMsg)) {
    const titleM = lastMsg.match(/create\s+task\s+\*([^*]+)\*/i);
    if (!titleM) return null;
    const args: Record<string, string> = { title: titleM[1].trim() };
    // "for *Tushar*" — extract assignee when creating on behalf of someone.
    // Skip self-referential words ("you", "me", "yourself") — those mean self-assignment.
    const assigneeM = lastMsg.match(/\bfor\s+\*([^*]+)\*/i);
    const priorityM = lastMsg.match(/with\s+\*([^*]+)\*\s+priority/i);
    const deadlineM = lastMsg.match(/due\s+\*([^*]+)\*/i);
    if (assigneeM && !/^(you|me|yourself|myself|self|i)$/i.test(assigneeM[1].trim())) {
      args.assignee = assigneeM[1].trim();
    }
    if (priorityM) args.priority = priorityM[1].trim().toLowerCase();
    const descriptionM = lastMsg.match(/Description:\s*["“]([^"”]*)["”]/i);
    if (descriptionM) args.description = descriptionM[1].trim();
    if (deadlineM) {
      const raw  = deadlineM[1];
      const iso  = naturalDateToISO(raw);
      const time = extractTimeFromText(raw);
      if (iso) args.deadline = time ? `${iso} ${time}` : `${iso} 17:00`;
    }
    return { tool: 'create_task', args };
  }

  // CHECK_IN — matches "check-in", "check in", "checked in", "mark your attendance as checked in"
  if (/check[- ]?in\b|checked[\s-]+in|mark\s+your\s+attendance\s+as\s+checked[\s-]+in/i.test(lastMsg) &&
      !/check[- ]?out|checked[\s-]+out/i.test(lastMsg)) {
    return { tool: 'check_in', args: {} };
  }

  // CHECK_OUT — matches "check-out", "check out", "checked out", "mark your attendance as checked out"
  if (/check[- ]?out\b|checked[\s-]+out|mark\s+your\s+attendance\s+as\s+checked[\s-]+out/i.test(lastMsg)) {
    return { tool: 'check_out', args: {} };
  }

  // COMPLETE_TASK — "mark *Title* as complete/done" OR "Mark *Title* complete"
  const completeM = lastMsg.match(/mark\s+\*([^*]+)\*\s+(?:as\s+)?(?:complet\w*|done)/i)
    ?? lastMsg.match(/\*([^*]+)\*\s+(?:as\s+)?(?:complet\w*|done)/i);
  if (completeM) return { tool: 'complete_task', args: { task_title: completeM[1].trim() } };

  // DELETE_TASK — "delete task *Title*" OR "delete *Title*"
  const deleteM = lastMsg.match(/delete\s+(?:task\s+)?\*([^*]+)\*/i);
  if (deleteM) return { tool: 'delete_task', args: { task_title: deleteM[1].trim() } };

  // ASSIGN_TASK — "assign *Task* to *Person*"
  const assignM = lastMsg.match(/assign\s+\*([^*]+)\*\s+to\s+\*([^*]+)\*/i);
  if (assignM) return { tool: 'assign_task', args: { task_title: assignM[1].trim(), assignee: assignM[2].trim() } };

  // UPDATE_TASK — "update *Title* — set [its] *field* / field to *value*"
  const updateM = lastMsg.match(/update\s+\*([^*]+)\*[\s—–\-]+set\s+(?:its\s+)?(?:\*([^*]+)\*|(\w+))\s+to\s+\*([^*]+)\*(?:\s+and\s+\*([^*]+)\*\s+to\s+\*([^*]+)\*)?/i);
  if (updateM) {
    const args: Record<string, string> = {
      task_title:   updateM[1].trim(),
      update_field: (updateM[2] ?? updateM[3] ?? '').trim().toLowerCase(),
      update_value: updateM[4].trim(),
    };
    if (updateM[5] && updateM[6]) {
      args.update_field_2 = updateM[5].trim().toLowerCase();
      args.update_value_2 = updateM[6].trim();
    }
    return { tool: 'update_task', args };
  }

  // APPLY_LEAVE — "apply *type* leave" OR "Apply for *type* leave" (bold or plain type)
  const leaveM = lastMsg.match(/apply\s+(?:for\s+)?\*?(casual|sick|annual|maternity)\*?\s+leave/i);
  if (leaveM) {
    const startM = lastMsg.match(/from\s+\*([^*]+)\*/i) ?? lastMsg.match(/\bfrom\s+([\w\s,]+?)(?:\s+(?:to|for|\()|$)/i);
    const endM   = lastMsg.match(/to\s+\*([^*]+)\*/i);
    const durM   = lastMsg.match(/for\s+\*?(\d+)\*?\s+days?/i);
    if (startM) {
      const args: Record<string, string> = {
        leave_type: leaveM[1].toLowerCase(),
        start_date: naturalDateToISO(startM[1].trim()) ?? startM[1].trim(),
      };
      if (endM)  args.end_date      = naturalDateToISO(endM[1].trim()) ?? endM[1].trim();
      if (durM)  args.duration_days = durM[1];
      return { tool: 'apply_leave', args };
    }
  }

  // APPROVE LEAVE — "approve *Name*'s leave" OR "approve leave for *Name*"
  const approveM = lastMsg.match(/approve\s+(?:leave\s+for\s+)?\*([^*]+)\*['']?s?\s*(?:leave)?/i)
    ?? lastMsg.match(/approve\s+\*([^*]+)\*['']?s?\s+leave/i);
  if (approveM) return { tool: 'approve_leave', args: { employee_name: approveM[1].trim() } };

  // REJECT LEAVE — "reject *Name*'s leave" OR "reject leave for *Name*"
  const rejectM = lastMsg.match(/reject\s+(?:leave\s+for\s+)?\*([^*]+)\*['']?s?\s*(?:leave)?/i)
    ?? lastMsg.match(/reject\s+\*([^*]+)\*['']?s?\s+leave/i);
  if (rejectM) return { tool: 'reject_leave', args: { employee_name: rejectM[1].trim() } };

  // CANCEL LEAVE
  const cancelLeaveM = lastMsg.match(/cancel\s+(?:your\s+)?leave\s+(?:on|from|for|starting)?\s*\*([^*]+)\*/i);
  if (cancelLeaveM) {
    const iso = naturalDateToISO(cancelLeaveM[1].trim());
    return { tool: 'cancel_leave', args: { start_date: iso ?? cancelLeaveM[1].trim() } };
  }

  // SET_REMINDER — "set a reminder for *message* at *time*"
  const reminderMsgM  = lastMsg.match(/reminder[^*]*\*([^*]+)\*/i);
  const reminderTimeM = lastMsg.match(/(?:at|on)\s+\*([^*]+)\*/i);
  if (reminderMsgM && reminderTimeM) {
    return { tool: 'set_reminder', args: { message: reminderMsgM[1].trim(), remind_at: reminderTimeM[1].trim() } };
  }

  // ADD_TASK_NOTE — confirmation format: "I'll add a note to *Task*: "preview…". Go ahead?"
  // Pattern matches: add [a] note to *<title>*[: ]"<note>"
  const noteM = lastMsg.match(/add\s+(?:a\s+)?note\s+to\s+\*([^*]+)\*[^"]*"([^"]+)"/i);
  if (noteM) {
    return { tool: 'add_task_note', args: { task_title: noteM[1].trim(), note: noteM[2].replace(/…$/, '').trim() } };
  }

  // START_ONBOARDING — "I'll start onboarding for *Name* — +91..., Dept (Designation). Go ahead?"
  const onboardM = lastMsg.match(/start\s+onboarding\s+for\s+\*([^*]+)\*\s*[—\-]+\s*([+\d]+)/i);
  if (onboardM) {
    return { tool: 'start_onboarding', args: { employee_name: onboardM[1].trim(), wa_number: onboardM[2].trim() } };
  }

  return null;
}

const PRIORITY_CANONICAL: Record<string, string> = {
  urgent: 'urgent', critical: 'urgent', asap: 'urgent', top: 'urgent', highest: 'urgent',
  high: 'high', hi: 'high',
  medium: 'medium', med: 'medium', normal: 'medium', moderate: 'medium',
  low: 'low', lo: 'low', minor: 'low',
};

const STATUS_CANONICAL: Record<string, string> = {
  todo: 'todo', 'to do': 'todo', pending: 'todo', open: 'todo', new: 'todo', 'not started': 'todo',
  in_progress: 'in_progress', 'in progress': 'in_progress', wip: 'in_progress',
  ongoing: 'in_progress', underway: 'in_progress', started: 'in_progress', doing: 'in_progress',
  done: 'done', complete: 'done', completed: 'done', finished: 'done', closed: 'done',
  cancelled: 'cancelled', canceled: 'cancelled', cancel: 'cancelled', dropped: 'cancelled',
};

function confirmationNameSimilarity(a: string, b: string): number {
  const x = a.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const y = b.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.92;
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return 1 - row[y.length] / Math.max(x.length, y.length);
}

async function canonicalizeConfirmation(
  tool: string,
  inputArgs: Record<string, string>,
  orgId: string,
): Promise<{ args: Record<string, string>; error?: string }> {
  const args = { ...inputArgs };

  const canonicalUser = async (written: string): Promise<{ name?: string; error?: string }> => {
    const requested = written.trim();
    if (!requested || /^(me|myself|mine|my|i|you|yourself|self|own)$/i.test(requested)) return { name: requested };
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { data, error } = await createAdminClient().from('users').select('full_name')
      .eq('organization_id', orgId).eq('is_active', true).is('deleted_at', null)
      .order('full_name').limit(100);
    if (error) return { error: '❌ I could not validate the team member. Please try again.' };
    const members = (data ?? []) as Array<{ full_name: string }>;
    const q = requested.toLocaleLowerCase();
    const exact = members.find(u => u.full_name.toLocaleLowerCase() === q);
    if (exact) return { name: exact.full_name };
    const partial = members.filter(u => u.full_name.toLocaleLowerCase().includes(q));
    if (partial.length === 1) return { name: partial[0].full_name };
    if (partial.length > 1) {
      return { error: `Multiple people match *${requested}*:\n${partial.map(u => `· ${u.full_name}`).join('\n')}\n\nPlease use the full name.` };
    }
    const ranked = members.map(u => ({
      name: u.full_name,
      score: Math.max(...[u.full_name, ...u.full_name.split(/\s+/)].map(n => confirmationNameSimilarity(requested, n))),
    })).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best && best.score >= 0.65) {
      const tied = ranked.filter(r => best.score - r.score <= 0.05 && r.score >= 0.65);
      if (tied.length === 1) return { name: best.name };
      return { error: `Multiple people closely match *${requested}*:\n${tied.map(u => `· ${u.name}`).join('\n')}\n\nPlease use the full name.` };
    }
    const available = members.map(u => u.full_name).join(', ');
    return { error: `❌ No active team member matches *${requested}*.${available ? `\n\nAvailable: ${available}` : ''}` };
  };

  const canonicalPriority = (value: string): string | null => PRIORITY_CANONICAL[value.trim().toLowerCase()] ?? null;
  const canonicalStatus = (value: string): string | null => STATUS_CANONICAL[value.trim().toLowerCase().replace(/[_-]+/g, ' ')] ?? null;

  if (tool === 'create_task' && !args.priority) {
    args.priority = 'medium';
  }
  if (tool === 'create_task' && args.priority) {
    const value = canonicalPriority(args.priority);
    if (!value) return { args, error: `❌ Unknown priority *${args.priority}*. Use: low, medium, high, or urgent.` };
    args.priority = value;
  }
  if (tool === 'create_task' && args.assignee) {
    const result = await canonicalUser(args.assignee);
    if (result.error) return { args, error: result.error };
    args.assignee = result.name!;
  }
  // The model occasionally miscomputes a deadline itself (e.g. "1:30pm" →
  // "25:30" by double-adding the PM offset) when a phrasing doesn't match
  // any deterministic parser earlier in the flow. buildToolConfirmation
  // silently falls back to showing that raw invalid string if left
  // unchecked, producing a confirmation that only fails *after* the user
  // says Yes — catch it here instead and ask for a valid deadline.
  if (tool === 'create_task' && args.deadline && !parseDeadlineString(args.deadline)) {
    return { args, error: '❌ That deadline doesn\'t look valid. Please provide a date and time, e.g. "tomorrow 1:30pm" or "10 Jul 2026 3pm".' };
  }
  if (tool === 'assign_task' && args.assignee) {
    const result = await canonicalUser(args.assignee);
    if (result.error) return { args, error: result.error };
    args.assignee = result.name!;
  }
  if ((tool === 'approve_leave' || tool === 'reject_leave') && args.employee_name) {
    const result = await canonicalUser(args.employee_name);
    if (result.error) return { args, error: result.error };
    args.employee_name = result.name!;
  }
  if (tool === 'update_task') {
    for (const suffix of ['', '_2'] as const) {
      const fieldKey = `update_field${suffix}`;
      const valueKey = `update_value${suffix}`;
      const field = args[fieldKey]?.toLowerCase();
      if (!field || !args[valueKey]) continue;
      if (field === 'priority') {
        const value = canonicalPriority(args[valueKey]);
        if (!value) return { args, error: `❌ Unknown priority *${args[valueKey]}*. Use: low, medium, high, or urgent.` };
        args[valueKey] = value;
      } else if (field === 'status') {
        const value = canonicalStatus(args[valueKey]);
        if (!value) return { args, error: `❌ Unknown status *${args[valueKey]}*. Use: to do, in progress, done, or cancelled.` };
        args[valueKey] = value;
      } else if (field === 'assignee') {
        const result = await canonicalUser(args[valueKey]);
        if (result.error) return { args, error: result.error };
        args[valueKey] = result.name!;
      } else if (field === 'deadline' && !parseDeadlineString(args[valueKey])) {
        return { args, error: '❌ That deadline doesn\'t look valid. Please provide a date and time, e.g. "tomorrow 1:30pm" or "10 Jul 2026 3pm".' };
      }
    }
  }
  return { args };
}

// Execute from parsed confirmation — used as history-text fallback when context_state has no payload.
async function executeFromConfirmation(
  lastMsg: string,
  user:    AgentUser,
  orgId:   string,
): Promise<string | null> {
  const parsed = parseConfirmationMessage(lastMsg);
  if (!parsed) return null;
  const checked = await canonicalizeConfirmation(parsed.tool, parsed.args, orgId);
  if (checked.error) return checked.error;
  return dispatchTool(parsed.tool, checked.args, user, orgId);
}

// ─── Tool definitions (Gemini native FunctionDeclaration format) ───────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HRBOT_TOOLS: any[] = [
  {
    name: 'daily_briefing',
    description: "Show the user's daily status: attendance, task summary, pending items. Call ONLY for greetings (hi, hello, good morning, namaste, etc.).",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_tasks',
    description: "List tasks. Generic requests and assignee_name='mine' mean the caller's tasks. A person's name means that person's tasks. scope='all' is only for explicit all/team/company requests. All roles may use these scopes.",
    parameters: {
      type: 'OBJECT',
      properties: {
        assignee_name: { type: 'STRING', description: "'mine' = caller's own tasks. First/full name = that person's tasks. Omit for generic requests, which default to the caller's own tasks." },
        scope: { type: 'STRING', enum: ['all'], description: "Use 'all' only when the user explicitly asks for all/team/company tasks." },
        status_filter: { type: 'STRING', description: "todo | in_progress | done | cancelled | active. Omit for all unfinished tasks." },
        exclude_status_filter: { type: 'STRING', description: "todo | in_progress | done | cancelled | active. Use for negated status phrasing ('tasks excluding done', 'tasks that are not cancelled', 'without pending ones') — the exact opposite of status_filter. NEVER pass status_filter for a negated request, that returns the opposite of what was asked." },
        priority_filter: { type: 'STRING', description: "urgent | high | medium | low. Omit for all priorities. Independent of status_filter — both can be set together." },
        exclude_priority_filter: { type: 'STRING', description: "urgent | high | medium | low. Use for negated priority phrasing ('tasks without high priority', 'excluding urgent ones', 'not low priority'). NEVER pass priority_filter for a negated request." },
        deadline_filter: { type: 'STRING', description: "overdue | today | week | none | not_overdue. 'overdue' = past deadline and not done/cancelled. 'today' = due today. 'week' = due within the next 7 days. 'none' = no deadline set. 'not_overdue' = the exact opposite of 'overdue' (use for 'without overdue'/'excluding overdue'/'not overdue' phrasing). Independent of status_filter/priority_filter — any combination can be set together." },
      },
    },
  },
  {
    name: 'get_task_details',
    description: 'Show full details of a specific task.',
    parameters: {
      type: 'OBJECT',
      properties: { task_title: { type: 'STRING', description: 'Task title or a part of it' } },
      required: ['task_title'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task. ONLY call AFTER user confirms AND you have title + deadline. NEVER call without both. Priority is optional — defaults to medium if the user does not mention one.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title:    { type: 'STRING', description: 'Short, clear task title' },
        assignee: { type: 'STRING', description: 'Assignee name or "me". Omit if self.' },
        deadline: { type: 'STRING', description: 'REQUIRED. Due date and time as "YYYY-MM-DD HH:MM" (24h IST). Use 17:00 (5 PM) if user gives only a date with no time. E.g. "2026-07-10 17:00"' },
        priority: { type: 'STRING', description: 'OPTIONAL. low | medium | high | urgent. Defaults to medium if omitted.' },
      },
      required: ['title', 'deadline'],
    },
  },
  {
    name: 'update_task',
    description: "Update a task's title, deadline, priority, assignee, or status. ONLY call AFTER user confirms AND you have BOTH the field name AND the new value. If the user provides only a field name (e.g. 'assignee', 'deadline') without a value, ask for the value first.",
    parameters: {
      type: 'OBJECT',
      properties: {
        task_title:     { type: 'STRING', description: 'Current title (or part) of the task to update' },
        update_field:   { type: 'STRING', enum: ['title', 'deadline', 'priority', 'assignee', 'status'], description: 'Field to update — must be exactly one of the enum values' },
        update_value:   { type: 'STRING', description: 'New value for the field' },
        update_field_2: { type: 'STRING', enum: ['title', 'deadline', 'priority', 'assignee', 'status'], description: 'Optional second field to update simultaneously' },
        update_value_2: { type: 'STRING', description: 'New value for the second field' },
      },
      required: ['task_title', 'update_field', 'update_value'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed. Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: { task_title: { type: 'STRING', description: 'Task title or part of it' } },
      required: ['task_title'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task. Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: { task_title: { type: 'STRING' } },
      required: ['task_title'],
    },
  },
  {
    name: 'assign_task',
    description: 'Reassign an existing task to a different team member (managers/admins/HR only). Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_title: { type: 'STRING', description: 'Current title or part of the task to reassign' },
        assignee:   { type: 'STRING', description: 'Full name or first name of the person to assign to' },
      },
      required: ['task_title', 'assignee'],
    },
  },
  {
    name: 'apply_leave',
    description: 'Apply for leave. Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        leave_type:    { type: 'STRING', description: 'casual | sick | annual | maternity' },
        start_date:    { type: 'STRING', description: 'YYYY-MM-DD' },
        end_date:      { type: 'STRING', description: 'YYYY-MM-DD — omit if single day or if duration_days given' },
        duration_days: { type: 'STRING', description: 'Number of days when user says "for 3 days" instead of giving an end date. E.g. "3"' },
        reason:        { type: 'STRING', description: 'Optional reason' },
      },
      required: ['leave_type', 'start_date'],
    },
  },
  {
    name: 'check_leave_balance',
    description: 'Show remaining leave balance.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_leaves',
    description: 'List leave requests.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'approve_leave',
    description: 'Approve a leave request (managers / HR only). Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: { employee_name: { type: 'STRING' } },
      required: ['employee_name'],
    },
  },
  {
    name: 'reject_leave',
    description: 'Reject a leave request (managers / HR only). Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employee_name: { type: 'STRING' },
        reason:        { type: 'STRING' },
      },
      required: ['employee_name'],
    },
  },
  {
    name: 'cancel_leave',
    description: "Cancel the user's own leave request. Only call AFTER user confirms.",
    parameters: {
      type: 'OBJECT',
      properties: { start_date: { type: 'STRING', description: 'YYYY-MM-DD start date of the leave to cancel' } },
      required: ['start_date'],
    },
  },
  {
    name: 'check_in',
    description: 'Mark attendance check-in for today. Only call AFTER user confirms.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'check_out',
    description: 'Mark attendance check-out for today. Only call AFTER user confirms.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'my_attendance',
    description: "Show the user's attendance report.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'team_attendance',
    description: 'Show team attendance for today (managers / HR only).',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_users',
    description: 'List all active employees / users in the organisation. Managers, HR and admins only.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'set_reminder',
    description: 'Set a time-based reminder — user gets a WhatsApp message at the specified time. Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message:   { type: 'STRING', description: 'What to remind the user about' },
        remind_at: { type: 'STRING', description: 'ISO datetime YYYY-MM-DDTHH:MM:SS+05:30 — convert natural language like "tomorrow 3pm" using today\'s date' },
      },
      required: ['message', 'remind_at'],
    },
  },
  {
    name: 'configure_reminders',
    description: 'Update the user\'s task deadline reminder preferences (on/off, timing, channel). Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        enabled: { type: 'STRING', description: 'true | false — enable or disable task deadline reminders on WhatsApp' },
        offset:  { type: 'STRING', description: 'When to send reminder: same_day (9 AM on deadline day) | 1_day (9 AM day before) | 2_days (9 AM two days before)' },
        channel: { type: 'STRING', description: 'whatsapp | in_app | both' },
      },
    },
  },
  {
    name: 'pending_leaves',
    description: 'List all pending leave requests awaiting approval. Managers / HR / admin only. Call immediately — no confirmation needed.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_leave_types',
    description: 'List all leave types configured for this organisation (e.g. Sick, Casual, Annual). Call immediately — no confirmation needed.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'my_profile',
    description: "Show the user's own profile: name, employee ID, role, department, designation, manager, WhatsApp number, join date. Call immediately — no confirmation needed.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'task_stats',
    description: 'Show a quick task count summary: overdue, due today, to-do, in-progress, completed, cancelled. Employees see their own; managers/admins see the full team. Call immediately — no confirmation needed.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'add_task_note',
    description: 'Add or update a note/description on an existing task. Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_title: { type: 'STRING', description: 'Task title or part of it' },
        note:       { type: 'STRING', description: 'The note or description text to add' },
      },
      required: ['task_title', 'note'],
    },
  },
  {
    name: 'start_onboarding',
    description: 'Start onboarding for a new employee by name and WhatsApp number. HR / admin only. Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employee_name: { type: 'STRING', description: 'Full name of the new employee' },
        wa_number:     { type: 'STRING', description: 'WhatsApp number with country code, e.g. +919876543210' },
        department:    { type: 'STRING', description: "Department — pass 'SKIP' if not provided" },
        designation:   { type: 'STRING', description: "Designation / job title — pass 'SKIP' if not provided" },
      },
      required: ['employee_name', 'wa_number'],
    },
  },
  {
    name: 'onboarding_status',
    description: 'Check the onboarding progress of new employees. HR / admin can see all; employees see their own. Call immediately — no confirmation needed.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(user: AgentUser): string {
  const today = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const time = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
  });

  // Dynamic dates for examples — computed fresh so they never equal "today"
  // and confuse the model into treating today's date as "tomorrow".
  function exampleDate(offsetDays: number): { display: string; iso: string } {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    ist.setDate(ist.getDate() + offsetDays);
    const display = ist.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
    });
    const yr = ist.getFullYear();
    const mo = String(ist.getMonth() + 1).padStart(2, '0');
    const dy = String(ist.getDate()).padStart(2, '0');
    return { display, iso: `${yr}-${mo}-${dy}` };
  }
  const tmr  = exampleDate(1);  // tomorrow
  const dat2 = exampleDate(2);  // day after tomorrow
  const role        = user.role;
  const isEmployee  = role === 'employee';
  const isManager   = role === 'manager';
  const isPrivileged = !isEmployee;

  let permissionsBlock: string;
  if (['admin', 'super_admin'].includes(role)) {
    permissionsBlock = `## Your permissions (${role})
- Tasks: create for anyone, update any field, delete any task, assign to anyone, view all org tasks
- Leave: approve / reject leave for any employee in the org
- Attendance: view full org attendance and team reports
- Users: list all org members`;
  } else if (role === 'hr') {
    permissionsBlock = `## Your permissions (hr)
- Tasks: create for anyone, update any field, delete any task, assign to anyone, view all org tasks
- Leave: approve / reject leave for any employee in the org
- Attendance: view full org attendance and team reports
- Users: list all org members`;
  } else if (isManager) {
    permissionsBlock = `## Your permissions (manager)
- Tasks: create for anyone, update any field, delete any task, assign to anyone, view all org tasks
- Leave: approve / reject leave ONLY for your direct reports
- Attendance: view your team's attendance
- Users: list all org members
- IMPORTANT: You cannot approve/reject leave for employees who are not your direct reports`;
  } else {
    permissionsBlock = `## Your permissions (employee)
- Tasks: view all organization tasks, create tasks for anyone, update any task field, assign/reassign and complete any task
- Task deletion: employees CANNOT delete tasks
- Leave: apply for your own leave, check your own balance, cancel your own leave — cannot approve/reject
- Attendance: check in / check out, view your own attendance history
- CANNOT do: delete tasks, approve/reject leave, view attendance team data, list users
- If asked to do something outside these permissions, explain you don't have access and suggest contacting a manager or HR`;
  }

  return `You are HRBot — a smart, friendly HR assistant talking to employees over WhatsApp.

## User
- Name: ${user.full_name} (call them: ${user.first_name})
- Role: ${role}
- Department: ${user.department ?? 'Not specified'}
- Today: ${today}, ${time} IST

${permissionsBlock}

## How to respond
- Be warm and direct like a helpful colleague, not a form-filling robot.
- Understand natural references: "same task", "it", "that one", "update the assigned to" = update assignee.
- For task creation, ask only for whatever is still missing, in ONE message (see rule 5 below). For all other flows, ask ONE question at a time.
- Keep replies concise. *bold* for task names and key values. Emojis naturally (✅ ❌ 📋 ⏰ 👤 📅).
- NEVER attempt a tool outside the user's permissions listed above.

## CRITICAL: Never re-ask for information already given
Whatever details the user has already provided — in this message, an earlier message in this conversation, or a transcribed voice note — are final. Read the full conversation history before asking anything. If a title, deadline, priority, assignee, leave type, dates, department, or any other field was already stated, use it silently. Do NOT re-ask for it, even when a form-style prompt would otherwise list it as a field. This applies to every action tool: create_task, update_task, apply_leave, start_onboarding, set_reminder — all of them. Only ask about a field again if the user is explicitly correcting or editing it (e.g. "change the priority to high", "actually make it Tushar").

## CRITICAL: Tool output rule
When a tool returns a result, send it back EXACTLY as-is — no summarising, no rephrasing, no added questions.
The tool text IS the complete reply.

## CRITICAL: Confirmation rule
For every action tool (create_task, update_task, complete_task, delete_task, apply_leave, approve_leave,
reject_leave, cancel_leave, check_in, check_out, set_reminder):
1. First reply with one sentence describing what you'll do (bold the key values).
2. End with "Go ahead? (Yes / No)"
3. Only call the tool AFTER the user says Yes / Haan / Sure / Ok / Confirm / "Create the task" / "Do it" / "Go ahead".
4. If user says No / Nahi / Cancel → say "Got it, cancelled. What else can I help with?"
5. For create_task ONLY: *title* and *deadline* are the only required fields (priority/assignee/description are optional and default to medium/you/none). If BOTH are missing from the user's message, ask for everything using this format:
"Sure! Please provide the following:
📝 *Title* (Required)
📅 *Deadline* (Required) — e.g. tomorrow 5pm (defaults to 5:00 PM IST if no time given)
🔴 *Priority* (Optional — defaults to Medium if not provided) — High / Medium / Low / Urgent
👤 *Assign To* (Optional — defaults to you if not provided)
💬 *Description* (Optional)"
If only ONE of title/deadline is missing, do NOT dump the full template — briefly acknowledge what you already understood (deadline, assignee, priority, etc. — whatever the user gave) and ask specifically for the one missing piece. Example: user said "create a task for Tushar, due day after tomorrow 3:30pm, priority medium" (no title) → reply "Got it — due *12 Jul 2026, 03:30 PM* for *Tushar*, medium priority. What should I title this task?" NEVER re-ask for a field the user already provided, and NEVER send the confirmation until both Required fields are collected. If the user never mentions a priority, default it to medium and say so in the confirmation sentence — do not ask for it separately.
6. For create_task, ALWAYS include the assignee in the confirmation sentence: "for *you*" when self-assigned, "for *[Name]*" when assigned to someone else. Use the EXACT name the user typed — do NOT resolve or expand it to a full name. Example: "I'll create task *Fix bug* for *Tushar* due *2 Jul 2026, 05:00 PM* with *high* priority. Go ahead? (Yes / No)"

## CRITICAL: Never lose context mid-collection
- If you just asked for task details and the user provided them, your IMMEDIATE next reply MUST be the confirmation message (e.g. "I'll create task *X* due *Y*. Go ahead? (Yes / No)"). NEVER say "What else can I help with?" at this point.
- If the previous assistant message ended with "Go ahead? (Yes / No)" and the user's new message is a confirmation word (yes, ok, sure, create the task, create it, go ahead, haan, do it, etc.) → call the tool NOW. Do NOT ask for confirmation again.

## Read-only tools — call immediately, NO confirmation needed:
daily_briefing, list_tasks, get_task_details, check_leave_balance, list_leaves, my_attendance, my_profile, task_stats, list_leave_types${isPrivileged ? ', team_attendance, list_users, pending_leaves, onboarding_status' : ''}

## CRITICAL: Task listing rules — call list_tasks IMMEDIATELY for ANY of these phrasings:

Self-listing (user asking for their OWN tasks) — ALWAYS pass assignee_name="mine":
- "my tasks" / "list mine" / "list of mine" / "show mine" / "mine tasks"
- "list my tasks" / "show my tasks" / "get my tasks" / "give me my tasks"
- "what are my tasks" / "my pending tasks" / "tasks assigned to me"

All-org/team listing (all roles) — call list_tasks(scope="all") ONLY when explicitly requested:
- "list all tasks" / "show all tasks" / "all tasks"
- "pending tasks" / "open tasks" / "due tasks" / "org tasks" / "team tasks"

Specific-person listing (all roles) — pass assignee_name="[Name]":
- "list [Name]'s tasks" / "show [Name]'s tasks" / "[Name]'s tasks"
- "list of [Name]" / "list [Name]" / "show [Name]" / "tasks of [Name]"
- Examples: "list tushar" → list_tasks(assignee_name="Tushar")
           "list of pranay" → list_tasks(assignee_name="Pranay")
           "show rahul tasks" → list_tasks(assignee_name="Rahul")

Completed-tasks listing — pass status_filter="done":
- "completed tasks" / "done tasks" / "finished tasks" / "show completed" / "my completed tasks" → list_tasks(status_filter="done")
  [combine with assignee_name="mine" for own completed tasks]

Other status filters:
- "to do" / "todo" tasks → status_filter="todo" (strictly not-started only)
- "pending" / "open" tasks → status_filter="active" (broader — covers todo AND in_progress, since "pending" means "not yet done" in everyday usage)
- "in progress" / "ongoing" / "WIP" / "started" tasks → status_filter="in_progress"
- "cancelled" / "canceled" / "dropped" tasks → status_filter="cancelled"

Priority filter — pass priority_filter (independent of status_filter, both may be set together):
- "urgent tasks" → priority_filter="urgent"
- "high priority tasks" → priority_filter="high"
- "medium priority tasks" → priority_filter="medium"
- "low priority tasks" → priority_filter="low"
- "high priority all tasks" → list_tasks(priority_filter="high", scope="all")

Deadline filter — pass deadline_filter (independent of status_filter/priority_filter, any combination may be set together):
- "overdue tasks" → deadline_filter="overdue"
- "tasks due today" → deadline_filter="today"
- "tasks due this week" → deadline_filter="week"
- "tasks with no deadline" → deadline_filter="none"
- "my overdue tasks" → list_tasks(assignee_name="mine", deadline_filter="overdue")
- "tushar's tasks without overdue" / "tasks not overdue" / "excluding overdue tasks" → deadline_filter="not_overdue" (the exact opposite of "overdue" — NEVER pass deadline_filter="overdue" for a negated request, that returns the opposite of what was asked)
RULE: NEVER compute "overdue" yourself from a task list you already have in context — deadlines change and stale context will misclassify a task (e.g. calling an already-completed task "overdue"). ALWAYS call list_tasks(deadline_filter=...) fresh and return the result verbatim.

Negation, generally — this applies to EVERY filter, not just deadline. Whenever the user's phrasing excludes something ("without", "excluding", "except", "not", "besides", "other than", "leave out", etc.), use the matching exclude_* parameter instead of the positive one:
- "tasks excluding done" / "tasks that are not cancelled" → exclude_status_filter="done"/"cancelled" (NEVER status_filter="done" — that asks for the opposite)
- "tasks without high priority" / "not urgent tasks" → exclude_priority_filter="high"/"urgent" (NEVER priority_filter — same reasoning)
- "tasks without overdue" → deadline_filter="not_overdue" (see above)
RULE: Read negation carefully before choosing a parameter — inverting the user's actual request is worse than asking a clarifying question. If a message negates something list_tasks has no parameter for at all (e.g. excluding a specific person, or a concept with no filter), say so plainly rather than guessing at a filter that doesn't capture it.

RULE: NEVER pass assignee_name="my" or assignee_name="me". Use assignee_name="mine" for self-queries.
RULE: NEVER return task data as text. ALWAYS call list_tasks and return the result verbatim.

## Task discovery
- "What's the status of X?" / "Tell me about X task" / "Details of X" / "Who is working on X?" / "When is X due?" → get_task_details(task_title="X") [IMMEDIATE]

## Task completion and deletion
Completion (confirm before calling):
- "done with X" / "finished X" / "mark X done" / "X is complete" / "X complete kar diya" / "completed X" / "X ho gaya" / "X task mark as done"
→ confirm: "Mark *X* as complete? (Yes / No)" → complete_task(task_title="X")

Deletion (confirm before calling):
- "delete X" / "remove X task" / "X task delete karo" / "X hatao"
→ confirm: "Delete task *X*? (Yes / No)" → delete_task(task_title="X")

If task name is missing ("mark done", "delete task"), ask "Which task?"

## Attendance
Read-only (call IMMEDIATELY, no confirmation):
- "my attendance" / "show attendance" / "attendance report" / "check-in history" / "when did I check in" / "meri attendance" / "worked hours" / "how many hours did I work" / "hours worked today" → my_attendance()${isPrivileged ? `
- "team attendance" / "who's in" / "who checked in" / "who's absent today" / "office attendance" / "attendance today" → team_attendance()` : ''}

## CRITICAL: Attendance time rule
Check-in and check-out ALWAYS record the *current time* — no custom times allowed.
If the user's message contains any specific time (e.g. "check me in at 9am", "I arrived at 8:30", "mark attendance for 10 AM", "log checkout at 6pm"):
→ Reply IMMEDIATELY (no tool call): "⏰ Attendance can only be recorded at the *current time*. Custom times are not allowed.\n\nIf you need to correct a past record, please ask your HR or Admin to update it manually."
→ Do NOT call check_in() or check_out(). Do NOT proceed with confirmation.

Action — check-in (confirm first):
- "I'm in" / "check in" / "checking in" / "I'm here" / "aaya" / "reached office" / "mark my attendance" / "log attendance" / "office aa gaya"
→ confirm: "Mark your attendance as *checked in* for today? (Yes / No)" → check_in()

Action — check-out (confirm first):
- "I'm leaving" / "check out" / "checking out" / "leaving now" / "bye" / "going home" / "done for today" / "signing off" / "ja raha hoon"
→ confirm: "Mark your attendance as *checked out* for today? (Yes / No)" → check_out()

## Leave
Read-only (call IMMEDIATELY, no confirmation):
- "leave balance" / "my leave balance" / "leaves left" / "how many leaves" / "kitni leave bachi" / "remaining leaves" → check_leave_balance()
- "my leaves" / "list my leaves" / "leave history" / "leave requests" / "show my leave" / "meri leaves" → list_leaves()

Action — apply leave (confirm first, collect missing details before confirming):
- "apply leave" / "take leave" / "I want a day off" / "I'm sick tomorrow" / "sick leave" / "I'll be absent" / "leave lena hai" / "leave chahiye"
- Collect: leave_type (casual/sick/annual), start_date, end_date or duration. Ask one at a time if missing.
→ confirm: "Apply *sick* leave from *${tmr.display}* (1 day)? (Yes / No)" → apply_leave()

Action — cancel leave (confirm first):
- "cancel my leave" / "I don't want leave" / "leave cancel karo"
→ ask which date if unclear, confirm: "Cancel your leave on *[date]*? (Yes / No)" → cancel_leave()
${isPrivileged ? `
Action — approve/reject leave (privileged, confirm first):
- "approve [Name]'s leave" / "[Name] ki leave approve karo" / "approve leave for [Name]"
→ confirm: "Approve leave for *[Name]*? (Yes / No)" → approve_leave(employee_name="[Name]")
- "reject [Name]'s leave" / "don't approve [Name]'s leave"
→ confirm: "Reject leave for *[Name]*? (Yes / No)" → reject_leave(employee_name="[Name]")` : ''}

## Reminders
- "remind me about X at Y" / "set a reminder for X at Y" → confirm → set_reminder(message="X", remind_at="YYYY-MM-DDTHH:MM:SS+05:30")
  Note: custom reminders are delivered at the next scheduled check (9 AM or 6 PM IST), not at the exact time.
- "remind me the day before tasks" → confirm → configure_reminders(offset="1_day")
- "remind me 2 days before" → confirm → configure_reminders(offset="2_days")
- "remind me on the day of the task" → confirm → configure_reminders(offset="same_day")
- "turn off task reminders" / "disable reminders" → confirm → configure_reminders(enabled="false")
- "enable task reminders" → confirm → configure_reminders(enabled="true")
Valid offsets: same_day | 1_day | 2_days. Reminders fire at 9 AM IST (morning cron) or 6 PM IST (evening cron).

## Profile & task stats (read-only, call IMMEDIATELY)
- "my profile" / "profile" / "who am I" / "my info" / "my details" / "meri profile" → my_profile()
- "task stats" / "task summary" / "task overview" / "how many tasks" / "pending count" → task_stats()

## Leave types (read-only, call IMMEDIATELY)
- "leave types" / "types of leave" / "what leaves do we have" / "available leaves" / "leave categories" → list_leave_types()
${isPrivileged ? `
## Pending leave approvals (privileged, read-only, call IMMEDIATELY)
- "pending leaves" / "pending leave requests" / "who has pending leave" / "leave approvals" → pending_leaves()

## Onboarding (HR / admin only, confirm before running)
- "onboard [Name], +91XXXXXXXXXX" / "add new employee [Name]" / "start onboarding for [Name]"
  → collect: employee_name (required), wa_number (required), department (optional), designation (optional)
  → confirm: "Start onboarding for *[Name]* (+91...) as *[dept]*/*[desig]*? (Yes / No)" → start_onboarding(...)
- "onboarding status" / "who is being onboarded" / "new employees" → onboarding_status()` : ''}

## Add note to task (confirm before running)
- "add note to [task]" / "add description to [task]" / "[task] note: [text]"
  → confirm: "I'll add a note to *[task]*: \"[text preview]\". Go ahead? (Yes / No)" → add_task_note(task_title="...", note="...")

## Handling vague or incomplete messages
- "mark done" / "complete the task" (no name given) → ask "Which task?"
- "update the same task" / "update [task]" (task known but NO field or value specified) → ask "What would you like to update on *[task]*? (deadline / priority / assignee / status / title)" — NEVER guess or invent a field/value
- user provides ONLY a field name without a value (e.g. "assignee", "deadline", "priority") → ask for the value (e.g. "Who would you like to assign it to?", "What's the new deadline?", "What priority?") — NEVER call update_task without both field AND value
- "update deadline" (no task name or date) → ask "Which task, and what's the new deadline?"
- "apply leave" (no type/dates) → ask "What type of leave, and from which date?"
- "delete task" (no name) → ask "Which task would you like to delete?"
- "check in" when already checked in → the tool will handle this gracefully; call it anyway.

## Examples

Task creation — single-turn (all info given):
User: "create a task Sample Task Alpha due tomorrow 5pm priority high"
You: I'll create task *Sample Task Alpha* for *you* due *${tmr.display}, 05:00 PM* with *high* priority. Go ahead? (Yes / No)
User: "yes" → [call create_task(title="Sample Task Alpha", deadline="${tmr.iso} 17:00", priority="high")]

Task creation — for someone else:
User: "create task Sample Task Beta for Alex Morgan due day after tomorrow 9am priority medium"
You: I'll create task *Sample Task Beta* for *Alex Morgan* due *${dat2.display}, 09:00 AM* with *medium* priority. Go ahead? (Yes / No)
User: "yes" → [call create_task(title="Sample Task Beta", assignee="Alex Morgan", deadline="${dat2.iso} 09:00", priority="medium")]

Task creation — multi-turn, nothing given yet (ask ALL fields at once in one message):
User: "I want to create a task" → You:
Sure! Please provide the following:
📝 *Title* (Required)
📅 *Deadline* (Required) — e.g. tomorrow 5pm (defaults to 5:00 PM IST if no time given)
🔴 *Priority* (Optional — defaults to Medium if not provided) — High / Medium / Low / Urgent
👤 *Assign To* (Optional — defaults to you if not provided)
💬 *Description* (Optional)
User: "Fix login bug, tomorrow 5pm, high priority" → You: I'll create task *Fix login bug* for *you* due *${tmr.display}, 05:00 PM* with *high* priority. Go ahead? (Yes / No)
User: "yes" → [call create_task(title="Fix login bug", deadline="${tmr.iso} 17:00", priority="high")]

Task creation — multi-turn, only title missing (e.g. a voice message with everything except a title):
User: "Please create a task for Tushar. The due date is the day after tomorrow at 3.30 pm. Priority is medium."
You: Got it — due *${dat2.display}, 03:30 PM* for *Tushar*, medium priority. What should I title this task?
User: "Review Q3 budget" → You: I'll create task *Review Q3 budget* for *Tushar* due *${dat2.display}, 03:30 PM* with *medium* priority. Go ahead? (Yes / No)
(Do NOT ask again for the deadline, assignee, or priority here — they were already given.)

Task update:
User: "update the assigned to of Design Review to Rahul" → You: I'll update *Design Review* — set *assignee* to *Rahul*. Go ahead? (Yes / No)
User: "change deadline of Fix Bug to tomorrow 3pm" → You: I'll update *Fix Bug* — set *deadline* to *${tmr.display}, 03:00 PM*. Go ahead? (Yes / No)
Multi-field update: when the user wants to change 2 fields at once, use update_field_2 + update_value_2 in a SINGLE update_task call — never call update_task twice.
User: "set priority to high and status to in progress for Testing Task" → call update_task(task_title="Testing Task", update_field="priority", update_value="high", update_field_2="status", update_value_2="in_progress")

Task completion:
User: "done with Fix login bug" → You: Mark *Fix login bug* as complete? (Yes / No)
User: "yes" → [call complete_task(task_title="Fix login bug")]

Task listing (call immediately, return verbatim):
User: "my tasks" / "list mine" / "list of mine" → [call list_tasks(assignee_name="mine")]
User: "list all tasks" / "pending tasks" → [call list_tasks()]
User: "list tushar" / "list of tushar" / "tushar's tasks" → [call list_tasks(assignee_name="Tushar")]

Task details:
User: "status of Fix login bug" / "details of automation task" → [call get_task_details(task_title="Fix login bug")]
${isPrivileged ? `
Assign task:
User: "Assign website redesign to Priya" → You: I'll assign *Website redesign* to *Priya*. Go ahead? (Yes / No)
User: "yes" → [call assign_task(task_title="Website redesign", assignee="Priya")]
` : ''}
Attendance check-in:
User: "I'm in" / "check in" / "aaya" → You: Mark your attendance as *checked in* for today? (Yes / No)
User: "yes" → [call check_in()]

Attendance check-out:
User: "I'm leaving" / "checking out" → You: Mark your attendance as *checked out* for today? (Yes / No)
User: "yes" → [call check_out()]

My attendance (read-only):
User: "my attendance" / "show attendance" → [call my_attendance(), return verbatim]

Leave balance (read-only):
User: "leave balance" / "how many leaves left" / "kitni leave bachi" → [call check_leave_balance(), return verbatim]

Apply leave:
User: "I'm sick tomorrow, apply leave" → You: Apply *sick* leave for *${tmr.display}* (1 day)? (Yes / No)
User: "yes" → [call apply_leave(leave_type="sick", start_date="${tmr.iso}")]
User: "apply casual leave from Monday for 2 days" → You: Apply *casual* leave from *[date]* for *2 days*? (Yes / No)
User: "yes" → [call apply_leave(leave_type="casual", start_date="[date]", duration_days="2")]

Setting due date on an existing task:
User: "What's the due date of X?" → [get_task_details] → "No due date set. Want to add one?"
User: "Yes, tomorrow" → I'll update *X* — set *deadline* to *${tmr.display}*. Go ahead? (Yes / No)
← ALWAYS use update_task here. NEVER create_task for an existing task.

Profile (read-only):
User: "my profile" / "who am I" / "meri profile" → [call my_profile(), return verbatim]

Task stats (read-only):
User: "task stats" / "task summary" / "how many tasks are pending" → [call task_stats(), return verbatim]

Leave types (read-only):
User: "what leave types do we have" / "leave categories" → [call list_leave_types(), return verbatim]

Completed tasks:
User: "my completed tasks" → [call list_tasks(assignee_name="mine", status_filter="done"), return verbatim]
User: "completed tasks" → [call list_tasks(status_filter="done"), return verbatim]

Add note to task:
User: "add note to Fix login bug: needs testing on staging" → You: I'll add a note to *Fix login bug*: "needs testing on staging". Go ahead? (Yes / No)
User: "yes" → [call add_task_note(task_title="Fix login bug", note="needs testing on staging")]
${isPrivileged ? `
Pending leaves (read-only):
User: "pending leaves" / "who has pending leave" → [call pending_leaves(), return verbatim]

Onboarding:
User: "onboard Rahul Sharma, +919876543210" → You: Start onboarding for *Rahul Sharma* (+919876543210)? Go ahead? (Yes / No)
User: "yes" → [call start_onboarding(employee_name="Rahul Sharma", wa_number="+919876543210")]
User: "onboarding status" → [call onboarding_status(), return verbatim]` : ''}

## Rules
- NEVER use example data as real values. "e.g. Fix bug – 20 Jun" is a format example, not a real task.
- NEVER respond with task/leave/attendance data as plain text — always call the tool.
- Match the user's language — English, Hindi, or Hinglish.`;
}

// ─── Groq filler stripper ─────────────────────────────────────────────────────
//
// Groq sometimes appends "What else can I help with? 😊" after returning a tool
// result verbatim, violating the "Tool output rule". Strip these trailing phrases
// only when there is substantive content before them (>20 chars), so standalone
// filler responses (e.g. after cancellation) are left intact.

const GROQ_FILLER_RE = /\s*\n+(?:what else (?:can|would) (?:i|you) (?:help|do|like to)|is there anything else i can|anything else (?:you.d like|i can help)|let me know if you need|feel free to (?:ask|reach out))[^\n]*/gi;

function stripGroqFiller(text: string): string {
  const stripped = text.replace(GROQ_FILLER_RE, '').trim();
  return stripped.length > 20 ? stripped : text;
}

// ─── Tool-call enforcement detector ──────────────────────────────────────────
//
// Returns true when the user's message clearly calls for a read-only tool but
// Groq may return plain text instead of making a tool call. Used to trigger a
// single retry with an explicit enforcement instruction injected into the thread.

function buildToolConfirmation(tool: string, args: Record<string, string>): string {
  if (tool === 'create_task') {
    const assignee = args.assignee && !/^(me|myself|self|you)$/i.test(args.assignee) ? args.assignee : 'you';
    const parsedDeadline = parseDeadlineString(args.deadline ?? '');
    const deadline = parsedDeadline ? `${formatDateTime(parsedDeadline)} IST` : (args.deadline ?? '?');
    const description = args.description ? ` Description: "${args.description.slice(0, 80)}".` : '';
    return `I'll create task *${args.title ?? '?'}* for *${assignee}* due *${deadline}* with *${args.priority ?? '?'}* priority.${description} Go ahead? (Yes / No)`;
  }
  if (tool === 'update_task') {
    const field = args.update_field ?? '';
    let value = args.update_value ?? '';
    if (field === 'deadline') {
      const utc = parseDeadlineString(value);
      if (utc) value = formatDateTime(utc) + ' IST';
    }
    let msg = `I'll update *${args.task_title ?? '?'}* — set *${field}* to *${value}*`;
    if (args.update_field_2 && args.update_value_2) {
      const field2 = args.update_field_2;
      let value2 = args.update_value_2;
      if (field2 === 'deadline') {
        const utc2 = parseDeadlineString(value2);
        if (utc2) value2 = formatDateTime(utc2) + ' IST';
      }
      msg += ` and *${field2}* to *${value2}*`;
    }
    return msg + `. Go ahead? (Yes / No)`;
  }
  if (tool === 'complete_task') {
    return `I'll mark *${args.task_title ?? '?'}* as complete. Go ahead? (Yes / No)`;
  }
  if (tool === 'delete_task') {
    return `I'll delete task *${args.task_title ?? '?'}*. Go ahead? (Yes / No)`;
  }
  if (tool === 'apply_leave') {
    const ltype = args.leave_type ?? 'leave';
    return `I'll apply for *${ltype}* from *${args.start_date ?? ''}* to *${args.end_date ?? ''}*. Go ahead? (Yes / No)`;
  }
  if (tool === 'assign_task') {
    return `I'll reassign *${args.task_title ?? '?'}* to *${args.assignee ?? '?'}*. Go ahead? (Yes / No)`;
  }
  if (tool === 'approve_leave') {
    return `I'll approve *${args.employee_name ?? '?'}*'s leave request. Go ahead? (Yes / No)`;
  }
  if (tool === 'reject_leave') {
    const reason = args.reason ? ` (Reason: ${args.reason})` : '';
    return `I'll reject *${args.employee_name ?? '?'}*'s leave request${reason}. Go ahead? (Yes / No)`;
  }
  if (tool === 'add_task_note') {
    const preview = (args.note ?? args.description ?? '').slice(0, 80);
    return `I'll add a note to *${args.task_title ?? '?'}*: "${preview}${preview.length === 80 ? '…' : ''}". Go ahead? (Yes / No)`;
  }
  if (tool === 'start_onboarding') {
    const dept   = (args.department   && args.department   !== 'SKIP') ? `, ${args.department}`   : '';
    const desig  = (args.designation  && args.designation  !== 'SKIP') ? ` (${args.designation})` : '';
    return `I'll start onboarding for *${args.employee_name ?? '?'}* — ${args.wa_number ?? '?'}${dept}${desig}. Go ahead? (Yes / No)`;
  }
  if (tool === 'cancel_leave') return `I'll cancel your leave request for *${args.start_date ?? args.date ?? '?'}*. Go ahead? (Yes / No)`;
  if (tool === 'check_in') return 'Mark your attendance as *checked in* for today? (Yes / No)';
  if (tool === 'check_out') return 'Mark your attendance as *checked out* for today? (Yes / No)';
  if (tool === 'set_reminder') return `I'll set a reminder for *${args.message ?? '?'}* at *${args.remind_at ?? '?'}*. Go ahead? (Yes / No)`;
  if (tool === 'configure_reminders') return 'I’ll update your reminder preferences. Go ahead? (Yes / No)';
  return `Confirm this action? (Yes / No)`;
}

function shouldHaveCalledTool(msg: string): boolean {
  const m = normalizeCommandText(msg).toLowerCase();
  return (
    // ── Read-only tool queries ──────────────────────────────────────────────
    // Task listing
    /\b(list|show|get|my|mine|what'?s?\s+my)\b.*\btasks?\b/i.test(m) ||
    /\blist\s+(mine|of\s+(mine|my))\b/i.test(m) ||
    /\b(pending|open|due|all)\s+tasks?\b/i.test(m) ||
    /\b\w+[''s]+s?\s+tasks?\b/i.test(m) ||          // "tushar's task list", "his tasks"
    /\btask\s+list\b/i.test(m) ||                    // "task list", "the task list"
    // Leave balance / history
    /\b(leave\s+balance|leaves?\s+(left|remaining|balance)|how\s+many\s+leaves?|kitni\s+leave)\b/i.test(m) ||
    /\b(my\s+leaves?|list\s+leaves?|leave\s+(history|requests?)|show\s+(my\s+)?leave)\b/i.test(m) ||
    // Attendance read-only
    /\b(my\s+attendance|show\s+attendance|attendance\s+(report|history)|check.in\s+history)\b/i.test(m) ||
    /\b(team\s+attendance|who'?s?\s+(absent|present|in\s+office|checked\s+in)|who\s+(is\s+)?in)\b/i.test(m) ||
    /\bworked\s+hours?\b/i.test(m) ||               // "worked hours for today"
    // Users
    /\b(list\s+users?|team\s+members?|list\s+employees?|who'?s?\s+in\s+(the\s+)?team)\b/i.test(m) ||
    // Profile / stats / leave-types / pending-leaves
    /\b(my\s+profile|meri\s+profile|who\s+am\s+i|my\s+(info|details?))\b/i.test(m) ||
    /\b(task\s+stats?|task\s+summary|task\s+(overview|report)|how\s+many\s+tasks?|pending\s+count)\b/i.test(m) ||
    /\b(leave\s+types?|types?\s+of\s+leave|available\s+leaves?|leave\s+categories?)\b/i.test(m) ||
    /\b(pending\s+leaves?|leave\s+(requests?\s+pending|approvals?)|who\s+has\s+pending\s+leave)\b/i.test(m) ||
    /\b(onboarding\s+status|who\s+(is\s+)?being\s+onboarded|new\s+employees?)\b/i.test(m) ||
    /\b(completed\s+tasks?|done\s+tasks?|finished\s+tasks?|show\s+completed)\b/i.test(m) ||
    // ── Action intents — Groq should reply with confirmation, not filler ───
    /\b(done\s+with|finished|mark\s+.{1,40}\s+(?:as\s+)?(?:done|complete)|complete\s+(?:task\s+)?the)\b/i.test(m) ||
    /\b(apply\s+(?:for\s+)?leave|take\s+(?:a\s+)?(?:day\s+off|leave)|i.?m\s+sick|sick\s+(?:leave|today|tomorrow))\b/i.test(m) ||
    /\b(create\s+(?:a\s+)?task|add\s+(?:a\s+)?task|new\s+task)\b/i.test(m) ||
    /\b(delete\s+(?:task\s+)?the|remove\s+task|assign\s+task|update\s+(?:task\s+)?the)\b/i.test(m)
  );
}

// Returns true when Groq's reply is a useless generic phrase that ignores the intent
function isGroqGenericFiller(reply: string): boolean {
  const r = reply.toLowerCase().trim();
  const head = r.slice(0, 220);
  return (
    r === '' ||
    /^what else (?:can|would) (?:i|you)/i.test(r) ||
    /^is there anything else/i.test(r) ||
    /^i('?m| am) not sure (what|how)/i.test(r) ||
    (r.length < 80 && /^(sorry|i (didn'?t|couldn'?t|can'?t)|i don'?t (understand|recognize))/i.test(r)) ||
    // Leaked chain-of-thought: model narrates its reasoning instead of a reply.
    // Checked against the opening of the reply — observed leaks always start
    // with one of these framing phrases before descending into paragraphs of
    // "We need to interpret... According to rule... We must not call the tool..."
    /^(?:we (?:need to|have (?:a|received)|should|must|already have)|i need to (?:parse|analyze|check|look)|according to (?:the )?rules?|the user (?:is|says|wrote|typed|has provided|said|gave|asked for)|they want (?:a|to)|to handle this|let me (?:analyze|think|check|parse|fetch|get|list|look up)|the (?:previous|last) (?:message|response|bot))/i.test(head) ||
    // Bot narrates a future action instead of calling the tool ("I'll list all tasks... Let me fetch...")
    /^i'?ll (?:list|fetch|get|show|retrieve|look up|check|find|pull)/i.test(head) ||
    /^let me (?:fetch|get|list|look|check|retrieve|find|pull)/i.test(head) ||
    // Safety net: no legitimate confirmation sentence, tool-free answer, or
    // templated reply this app sends is anywhere near this long — a reply
    // this size is always a leaked reasoning dump, whatever words it uses.
    reply.length > 900
  );
}

// Detects free text that CLAIMS a mutation already happened (task updated,
// created, completed, deleted; leave approved; checked in/out; etc.) even
// though no tool was actually called this turn. By the time any of the
// "toolCalls.length === 0" branches below run, that is guaranteed to be true
// for a mutating request: every tool is in exactly one of VERBATIM_TOOLS
// (short-circuits and returns the real output directly) or
// CONFIRM_BEFORE_EXEC (short-circuits and returns a confirmation prompt),
// so a genuine mutation can never reach here as plain narrated text. If the
// reply still sounds like a completed action, Groq fabricated it (observed:
// "The deadline is updated to 8-07-2026 at 1PM." with no tool call and no
// confirmation step, while the real deadline in the database never changed).
const UNCONFIRMED_SUCCESS_CLAIM_RE = /\b(?:is|has been|have been|was|were)\s+(?:now\s+)?(?:updated|created|deleted|removed|completed|marked|assigned|reassigned|approved|rejected|cancelled|added|set)\b|\bupdated\s+to\b|\bmarked\s+(?:as\s+)?(?:done|complete|completed)\b|\bsuccessfully\s+(?:updated|created|deleted|completed|assigned|checked|cancelled)\b|\btask\s+(?:has\s+been\s+)?(?:created|deleted|completed)\b|\bchecked\s*(?:in|out)\s*(?:successfully|!|\.|$)/i;

function looksLikeUnconfirmedSuccessClaim(reply: string): boolean {
  return UNCONFIRMED_SUCCESS_CLAIM_RE.test(reply);
}

// ─── Master agent entry point ─────────────────────────────────────────────────

// ── Final safety net: block any task-list-shaped reply whose claimed task
// titles don't actually exist in the database ──────────────────────────────
// Deterministic quick-routes (list_tasks, complete_task, etc.) always build
// their reply text directly from real DB rows, so their output can never
// fail this check. Free-text AI generation, however, has repeatedly been
// observed fabricating a task-list-shaped reply that blends real and made-up
// tasks (or gets a real task's status/deadline wrong) when a message doesn't
// match any known deterministic trigger — each prior fix only covered the
// ONE trigger phrasing that had been reported. This runs on every reply
// regardless of which code path or AI backend produced it, so it catches
// any future fabrication, not just already-patched phrasings.
const TASK_LIST_LINE_RE = /^\d+\.\s*[🔴🟠🟡🟢⚪]\s*\*([^*]+)\*/gmu;

async function guardAgainstFabricatedTaskList(reply: string, orgId: string): Promise<string> {
  const claimedTitles = [...reply.matchAll(TASK_LIST_LINE_RE)].map(m => m[1].trim());
  if (claimedTitles.length === 0) return reply;

  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { data: realTasks } = await createAdminClient()
    .from('tasks').select('title').eq('organization_id', orgId).is('deleted_at', null);
  const realTitles = new Set((realTasks ?? []).map(t => t.title.trim().toLowerCase()));

  const allReal = claimedTitles.every(title => realTitles.has(title.toLowerCase()));
  if (allReal) return reply;

  console.error('[Agent] Blocked a fabricated task-list reply — claimed titles not found in DB:', claimedTitles);
  return "⚠️ Sorry, I couldn't reliably pull that list. Please try again — e.g. \"list tasks\" or \"<name>'s tasks\".";
}

export async function runMasterAgent(
  message: string,
  waNumber: string,
  orgId: string,
): Promise<AgentTurn> {
  const turn = await runMasterAgentInner(message, waNumber, orgId);
  const verifiedReply = await guardAgainstFabricatedTaskList(turn.reply, orgId);
  return verifiedReply === turn.reply ? turn : { ...turn, reply: verifiedReply };
}

async function runMasterAgentInner(
  message: string,
  waNumber: string,
  orgId: string,
): Promise<AgentTurn> {
  const start = Date.now();

  let session;
  try {
    session = await loadSession(waNumber, orgId);
  } catch (e) {
    console.error('[Agent] loadSession threw:', e);
    return { reply: '⚠️ Trouble loading your session. Please try again.', new_context: EMPTY_CONTEXT };
  }

  if (!session) {
    return {
      reply: "I couldn't find your account linked to this WhatsApp number.\nPlease contact your HR or admin to register.",
      new_context: EMPTY_CONTEXT,
    };
  }

  const { user, conversation_id, context, recent_messages } = session;

  await saveMessage(conversation_id, orgId, 'user', 'inbound', message).catch(() => {});

  try {
    const normalizedMessage = normalizeCommandText(message);
    const history: ChatMessage[] = (recent_messages ?? [])
      .filter((m: any) => m.role !== 'system' && m.content?.trim())
      .map((m: any) => ({
        role:    (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content as string,
      }));

    // ── Guard: reject check-in/out requests that specify a custom time ────────
    const CHECK_ACTION_RE   = /\b(?:check\s*[-\s]?in|check\s*[-\s]?out|checkin|checkout|mark\s+(?:my\s+)?attend|attendance)\b/i;
    const CUSTOM_TIME_RE    = /\bat\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|baje)?\b|\b\d{1,2}[:.]\d{2}\s*(?:am|pm)\b|\b\d{1,2}\s*(?:am|pm)\b/i;
    if (context.flow_state === 'IDLE' && CHECK_ACTION_RE.test(normalizedMessage) && CUSTOM_TIME_RE.test(normalizedMessage)) {
      const lang = context.language ?? 'en';
      const timeReply = lang === 'hi'
        ? `⏰ हाजिरी हमेशा *अभी के समय* पर ही दर्ज होती है। कस्टम समय की अनुमति नहीं है।\n\nकिसी पुरानी एंट्री को ठीक करवाने के लिए HR या Admin से संपर्क करें।`
        : `⏰ Attendance can only be recorded at the *current time*. Custom times are not allowed.\n\nIf you need to correct a past record, please ask your HR or Admin to update it manually.`;
      await saveMessage(conversation_id, orgId, 'assistant', 'outbound', timeReply).catch(() => {});
      return { reply: timeReply, new_context: context };
    }

    // ── Early attendance state guard ──────────────────────────────────────────
    // Single DB query covers both check-in and check-out intents so we never
    // send a stale/wrong state to Groq or prompt a confirmation unnecessarily.
    const CHECK_IN_INTENT_RE  = /\b(?:check\s*[-\s]?in|(?:mark|log|please\s+mark)\s+(?:my\s+)?at+end|at+endan)/i;
    const CHECK_OUT_INTENT_RE = /\b(check\s*[-\s]?out|checkout|leaving|sign\s*out|nikal|ja\s+raha)\b/i;
    const isCheckInIntent  = CHECK_IN_INTENT_RE.test(normalizedMessage) && !CHECK_OUT_INTENT_RE.test(normalizedMessage);
    const isCheckOutIntent = CHECK_OUT_INTENT_RE.test(normalizedMessage) && !CHECK_IN_INTENT_RE.test(normalizedMessage);
    if (context.flow_state === 'IDLE' && (isCheckInIntent || isCheckOutIntent)) {
      const { createAdminClient: makeDb } = await import('@/lib/supabase/admin');
      const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const { data: att } = await makeDb()
        .from('attendance_records')
        .select('check_in_time, check_out_time')
        .eq('employee_id', user.id)
        .eq('date', todayIST)
        .maybeSingle();
      const lang = context.language ?? 'en';

      if (isCheckInIntent && att?.check_in_time) {
        let earlyReply: string;
        if (att.check_out_time) {
          // Fully done for today — show both times
          const cin  = new Date(att.check_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
          const cout = new Date(att.check_out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
          earlyReply = lang === 'hi'
            ? `आज की हाजिरी पूरी हो चुकी है। चेक-इन: *${cin}*, चेक-आउट: *${cout}*।`
            : `Your attendance for today is complete. Checked in at *${cin}*, checked out at *${cout}*.`;
        } else {
          // Still active — prompt checkout
          const cin = new Date(att.check_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
          earlyReply = lang === 'hi'
            ? `आप पहले से *${cin}* बजे चेक-इन हैं। चेक-आउट के लिए "checkout" लिखें।`
            : `You already checked in at *${cin}*. Send "checkout" when you're leaving.`;
        }
        await saveMessage(conversation_id, orgId, 'assistant', 'outbound', earlyReply).catch(() => {});
        return { reply: earlyReply, new_context: context };
      }

      if (isCheckOutIntent && att?.check_out_time) {
        // Already checked out — skip confirmation entirely
        const cout = new Date(att.check_out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
        const earlyReply = lang === 'hi'
          ? `आप पहले से *${cout}* बजे चेक-आउट कर चुके हैं। कल मिलते हैं! 👋`
          : `You already checked out at *${cout}* today. See you tomorrow! 👋`;
        await saveMessage(conversation_id, orgId, 'assistant', 'outbound', earlyReply).catch(() => {});
        return { reply: earlyReply, new_context: context };
      }
    }

    const ctxRef = { handled: false };
    const reply = await runGroqLoop(message, history, user, orgId, context, conversation_id, ctxRef);
    const finalReply = reply || 'What else can I help you with?';

    // ── Sentinel: field-options interactive message ───────────────────────────
    // runGroqLoop returns [[SHOW_OPTIONS:field:taskTitle]] when the user typed just a
    // field keyword in an update context. Save a human-readable version to history
    // (so Groq sees clean context on the next turn), but return the sentinel so the
    // webhook route can render the appropriate WhatsApp interactive list/buttons.
    const SENT_RE = /^\[\[SHOW_OPTIONS:(\w+):(.+)\]\]$/;
    const sentM = SENT_RE.exec(finalReply);
    if (sentM) {
      const [, fieldType, taskTitle] = sentM;
      const humanMsg =
        fieldType === 'priority'      ? `What priority for *${taskTitle}*?`
      : fieldType === 'status'        ? `What status should *${taskTitle}* be set to?`
      : fieldType === 'assignee'      ? `Who should *${taskTitle}* be assigned to?`
      : fieldType === 'deadline_date' ? `Picking deadline date for *${taskTitle}*`
      : fieldType === 'deadline_time' ? `Picking deadline time for *${taskTitle}*`
      : finalReply;
      await saveMessage(conversation_id, orgId, 'assistant', 'outbound', humanMsg, { latency_ms: Date.now() - start }).catch(() => {});
      return { reply: finalReply, new_context: EMPTY_CONTEXT, debug: { latency_ms: Date.now() - start } };
    }

    // Persist context_state based on what the reply contains:
    // - "Go ahead? (Yes / No)"  → CONFIRMING with stored payload (fast next-turn)
    // - ctxRef.handled = true   → runGroqLoop already saved a special state (e.g. EDITING)
    // - anything else           → reset to IDLE (clear stale flow state)
    const isConfirmPrompt = /go ahead\?/i.test(finalReply) || /\(yes \/ no\)/i.test(finalReply);
    // For update_task deadline confirmations, rewrite the raw "YYYY-MM-DD HH:MM" in the
    // text to a human-readable "D Mon YYYY, H:MM AM/PM IST" before showing/saving.
    let displayReply = finalReply;
    if (isConfirmPrompt) {
      const parsed = parseConfirmationMessage(finalReply);
      if (parsed) {
        const checked = await canonicalizeConfirmation(parsed.tool, parsed.args, orgId);
        if (checked.error) {
          displayReply = checked.error;
          await saveContext(conversation_id, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
        } else {
          // Rebuild from canonical arguments so misspellings are never echoed in
          // the confirmation and the stored payload exactly matches the display.
          displayReply = buildToolConfirmation(parsed.tool, checked.args);
          await saveContext(conversation_id, {
            ...EMPTY_CONTEXT,
            language:        context.language,
            flow_state:      'CONFIRMING',
            confirm_message: displayReply,
            confirm_payload: { tool: parsed.tool, args: checked.args },
          }).catch(() => {});
        }
      }
    } else if (!ctxRef.handled && context.flow_state !== 'IDLE') {
      await saveContext(conversation_id, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
    }

    await saveMessage(conversation_id, orgId, 'assistant', 'outbound', displayReply, {
      latency_ms: Date.now() - start,
    }).catch(() => {});

    return {
      reply: displayReply,
      new_context: EMPTY_CONTEXT,
      debug: { latency_ms: Date.now() - start },
    };
  } catch (err) {
    console.error('[Agent] Unexpected error:', err);
    const isDev = process.env.NODE_ENV !== 'production';
    const detail = isDev
      ? `\n\n🐛 *[DEV]* ${err instanceof Error ? err.message : JSON.stringify(err)}`
      : '';
    const errReply = `⚠️ Something went wrong. Please try again in a moment.${detail}`;
    await saveMessage(conversation_id, orgId, 'assistant', 'outbound', errReply).catch(() => {});
    return { reply: errReply, new_context: EMPTY_CONTEXT };
  }
}

// Resolve a person's name against the real list_tasks tool and produce a
// deterministic (never model-generated) next prompt, used by the
// "update <name>'s task" bypass and its RESOLVING_TASK_OWNER continuation.
// Keeping this templated — rather than letting Groq phrase the follow-up —
// avoids both fabricated task data and stray/garbled model output, and it
// reuses the exact "What would you like to update on *X*?" wording that the
// existing field-selection shortcut (0c above) already knows how to parse
// out of the next turn's history.
async function resolveTaskOwnerForUpdate(
  personName:     string,
  user:           AgentUser,
  orgId:          string,
  conversationId: string,
  language:       SupportedLanguage,
): Promise<string> {
  const result = await dispatchToolResult('list_tasks', { assignee_name: personName }, user, orgId);
  const tasks = (result.data?.tasks as Array<{ title: string }> | undefined) ?? [];

  if (!result.success || tasks.length === 0) {
    // Still ambiguous ("Multiple people match ...") → stay in this state so the
    // next message is treated as a (hopefully more specific) name. Any other
    // outcome (no user found / no tasks) has nothing left to continue.
    const stillAmbiguous = /^Multiple people match \*/.test(result.reply);
    await saveContext(conversationId, {
      ...EMPTY_CONTEXT,
      language,
      flow_state: stillAmbiguous ? 'RESOLVING_TASK_OWNER' : 'IDLE',
    }).catch(() => {});
    return result.reply;
  }

  await saveContext(conversationId, { ...EMPTY_CONTEXT, language }).catch(() => {});
  if (tasks.length === 1) {
    return `What would you like to update on *${tasks[0].title}*?\n\nYou can change: deadline / priority / assignee / status / title`;
  }
  return `${result.reply}\n\nReply with the task title you'd like to update.`;
}

// ─── Gemini tool-use loop ─────────────────────────────────────────────────────

async function runGroqLoop(
  message:        string,
  history:        ChatMessage[],
  user:           AgentUser,
  orgId:          string,
  context:        ConversationContext,
  conversationId: string,
  ctxRef:         { handled: boolean } = { handled: false },
): Promise<string> {
  const normalizedMessage = normalizeCommandText(message);

  // Never let the interactive row ID become a literal deadline. If a previous
  // deployment failed to persist picker state, recover the task title from the
  // human-readable history entry and resume the custom deadline prompt.
  if (/^(custom_date|custom_deadline)$/.test(message.trim()) && context.flow_state !== 'PICKING_DEADLINE') {
    const pickerMessage = [...history].reverse().find(m =>
      m.role === 'assistant' && /Picking deadline date for \*[^*]+\*/i.test(m.content)
    );
    const taskTitle = pickerMessage?.content.match(/Picking deadline date for \*([^*]+)\*/i)?.[1]?.trim();
    if (taskTitle) {
      await saveContext(conversationId, {
        ...EMPTY_CONTEXT,
        language: context.language,
        flow_state: 'PICKING_DEADLINE',
        deadline_pick_context: { step: 'date', task_title: taskTitle, origin: 'UPDATE' },
      });
      ctxRef.handled = true;
      return `📅 Type the date for *${taskTitle}*:\n\nExamples:\n• _"15 Jul 2026"_\n• _"next Monday"_\n• _"tomorrow"_`;
    }
    ctxRef.handled = true;
    return '📅 Please type the custom date, for example: *15 Jul 2026*.';
  }

  // ── 0a. RESOLVING_TASK_OWNER state — user is answering a "which Tushar?" prompt ─
  // Set by resolveTaskOwnerForUpdate() below when "update <name>'s task" matched
  // more than one person. Treat this reply as the full name and re-resolve,
  // rather than letting Groq free-generate a response to a bare name.
  if (context.flow_state === 'RESOLVING_TASK_OWNER') {
    const personName = message.trim();
    console.log(`[Agent] Resolving ambiguous task-owner name: "${personName}"`);
    return resolveTaskOwnerForUpdate(personName, user, orgId, conversationId, context.language);
  }

  // ── 0. EDITING state — merge user correction with base create_task payload ──
  //
  // Set when user taps "Edit details" on a create_task confirmation.
  // Accepts either a full 5-field response OR a short natural-language correction
  // (e.g. "Assign to Tushar Bali", "Deadline 10 Jul 3pm", "High priority").
  if (context.flow_state === 'EDITING' && context.edit_base_payload) {
    const base = context.edit_base_payload as Record<string, string>;

    // ── Field-name interceptor ──────────────────────────────────────────────
    // When user types just a field name (priority/assignee/deadline/title),
    // show the interactive picker instead of treating it as a natural-language correction.
    {
      const normMsg = message.trim().toLowerCase().replace(/[?.!,;]+$/, '');
      const taskTitle = (base.title ?? 'the task') as string;
      // Match field names with common variations (e.g. "assign to", "change priority")
      const isPriority = /^(?:(?:set|change|update)\s+)?priority[\s:]*$/i.test(message.trim());
      const isAssignee = /^(?:assign(?:ee)?(?:\s+to)?|(?:set|change|update)\s+assign(?:ee)?)[\s:]*$/i.test(message.trim());
      const isDeadline = /^(?:(?:set|change|update)\s+)?deadline[\s:]*$/i.test(message.trim());
      const isTitle    = /^(?:(?:set|change|update|rename)\s+)?title[\s:]*$/i.test(message.trim());

      if (isPriority) {
        ctxRef.handled = true; // keep EDITING context; "high"/"low"/etc handled by Case B next turn
        console.log(`[Agent] EDITING priority shortcut: task="${taskTitle}"`);
        return `[[SHOW_OPTIONS:priority:${taskTitle}]]`;
      }
      if (isAssignee) {
        ctxRef.handled = true;
        console.log(`[Agent] EDITING assignee shortcut: task="${taskTitle}"`);
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT, language: context.language,
          flow_state: 'EDITING', edit_base_payload: { ...base, __pending_field: 'assignee' },
        }).catch(() => {});
        return `[[SHOW_OPTIONS:assignee:${taskTitle}]]`;
      }
      if (isDeadline) {
        ctxRef.handled = true;
        console.log(`[Agent] EDITING deadline shortcut: task="${taskTitle}"`);
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT, language: context.language,
          flow_state: 'PICKING_DEADLINE',
          deadline_pick_context: { step: 'date', task_title: taskTitle, origin: 'EDITING', edit_base: { ...base } },
        }).catch(() => {});
        return `[[SHOW_OPTIONS:deadline_date:${taskTitle}]]`;
      }
      if (isTitle) {
        ctxRef.handled = true;
        console.log(`[Agent] EDITING title shortcut: task="${taskTitle}"`);
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT, language: context.language,
          flow_state: 'EDITING', edit_base_payload: { ...base, __pending_field: 'title' },
        }).catch(() => {});
        return `What should the new title be for *${taskTitle}*?`;
      }
    }

    // ── Pending-field handler ──────────────────────────────────────────────
    // Previous turn stored __pending_field; treat this whole message as its value.
    const pendingField = base.__pending_field ?? '';
    const { __pending_field: _pf, ...cleanBase } = base;   // strip marker from merged
    const lines = message.split('\n').map(l => l.trim()).filter(Boolean);
    let merged: Record<string, string> = { ...cleanBase };
    let usedFullForm = false;
    if (pendingField) {
      if (pendingField === 'assignee') { merged.assignee = message.trim(); usedFullForm = true; }
      if (pendingField === 'title')    { merged.title = message.trim(); usedFullForm = true; }
    }

    // Case A: Full form (title + deadline minimum — priority optional, defaults to medium)
    if (lines.length >= 2) {
      const rawPri = lines[2]?.trim() ?? '';
      const validPri = !rawPri || /^(high|medium|low|urgent)$/i.test(rawPri);
      const iso = lines[0] && lines[1] ? naturalDateToISO(lines[1]) : null;
      if (lines[0] && iso && validPri) {
        const time = extractTimeFromText(lines[1]) ?? '17:00';
        merged = {
          title:       lines[0],
          deadline:    `${iso} ${time}`,
          priority:    rawPri ? rawPri.toLowerCase() : 'medium',
          assignee:    lines[3]?.trim() ?? '',
          description: lines.slice(4).join(' ').trim(),
        };
        usedFullForm = true;
      }
    }

    // Case B: Short natural-language correction (one or two lines)
    if (!usedFullForm) {
      const txt = message.trim();
      // Assignee: "assign to X" / "for X" / "assignee X" — anywhere in the message
      const asgn = txt.match(/\bassign(?:ee)?\s+to\s+(.+?)(?:\s+and\b|$)/i)
                ?? txt.match(/^for\s+(.+?)(?:\s+and\b|$)/i);
      if (asgn) merged.assignee = asgn[1].trim();

      // Deadline: "deadline [time] [is] <date/time>" / "due <date>" — anywhere in message
      // Also handles time-only: "deadline is 4pm" → keep base date, update time
      const dlM = txt.match(/\b(?:deadline(?:\s+time)?|due|by)\s*(?:(?:time\s+)?is\s+|to\s+)?(.+?)(?:\s+and\b|$)/i);
      if (dlM) {
        const dlPart = dlM[1].trim();
        const time2  = extractTimeFromText(dlPart);
        const hasDateWords = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|tomorrow|today|next\s|\d+\s*(?:st|nd|rd|th))/i.test(dlPart);
        if (hasDateWords) {
          const iso2 = naturalDateToISO(dlPart);
          if (iso2) merged.deadline = `${iso2} ${time2 ?? '17:00'}`;
        } else if (time2) {
          // Pure time — keep the base date, update only the time
          const baseDate = (base.deadline ?? '').split(' ')[0];
          merged.deadline = `${baseDate || naturalDateToISO('today') || ''} ${time2}`;
        }
      }

      // Title: "title [is] X" / "rename to X" — anywhere in message
      const titleM = txt.match(/\b(?:title|name|rename\s+to)\s+(?:is\s+)?(.+?)(?:\s+and\b|$)/i);
      if (titleM) merged.title = titleM[1].trim();

      // Priority — anywhere in message (standalone word or "X priority")
      const priM = txt.match(/\b(high|medium|low|urgent)\s+priority\b/i)
                ?? txt.match(/\bpriority\s+(?:is\s+)?(high|medium|low|urgent)\b/i)
                ?? (!asgn && !dlM && !titleM ? txt.match(/^(high|medium|low|urgent)$/i) : null);
      if (priM) merged.priority = (priM[1] ?? priM[2] ?? '').toLowerCase();
    }

    // Resolve typed assignee to canonical full_name (fuzzy). If not found, error immediately.
    let displayAssignee = merged.assignee;
    if (merged.assignee) {
      const { createAdminClient: mkDb } = await import('@/lib/supabase/admin');
      const db2 = mkDb();

      // Fetch all active org members once (used for both ilike check and fuzzy fallback)
      const { data: allActive } = await db2.from('users').select('full_name')
        .eq('organization_id', orgId).eq('is_active', true).order('full_name').limit(50);

      // Prefer an exact full-name match. A partial name must resolve to exactly
      // one person; never silently choose the first row when names overlap.
      const requestedName = merged.assignee.trim().toLowerCase();
      const activeMembers = (allActive ?? []) as { full_name: string }[];
      const exactMatch = activeMembers.find(u => u.full_name.toLowerCase() === requestedName);
      const partialMatches = activeMembers.filter(u =>
        u.full_name.toLowerCase().includes(requestedName) ||
        requestedName.includes(u.full_name.toLowerCase())
      );

      if (exactMatch) {
        displayAssignee = exactMatch.full_name;
      } else if (partialMatches.length === 1) {
        displayAssignee = partialMatches[0].full_name;
      } else if (partialMatches.length > 1) {
        const options = partialMatches.map(u => `· ${u.full_name}`).join('\n');
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT, language: context.language,
          flow_state: 'EDITING',
          edit_base_payload: { ...cleanBase, __pending_field: 'assignee' },
        }).catch(() => {});
        ctxRef.handled = true;
        return `Multiple people match *${merged.assignee}*:\n${options}\n\nPlease use the full name.`;
      } else {
        // 2. Fuzzy fallback
        const sim = (a: string, b: string) => {
          const al = a.toLowerCase().replace(/\s+/g, ''), bl = b.toLowerCase().replace(/\s+/g, '');
          if (!al || !bl) return 0;
          if (bl.includes(al) || al.includes(bl)) return 0.9;
          const ac = [...al].sort(), bc = [...bl].sort();
          let i = 0, j = 0, c = 0;
          while (i < ac.length && j < bc.length) {
            if (ac[i] === bc[j]) { c++; i++; j++; } else if (ac[i]! < bc[j]!) i++; else j++;
          }
          return c / Math.max(ac.length, bc.length);
        };
        let bestScore = 0, bestName = '';
        const fuzzyMatches: Array<{ name: string; score: number }> = [];
        for (const u of activeMembers) {
          const score = Math.max(...[u.full_name, ...u.full_name.split(' ')].map(n => sim(merged.assignee!, n)));
          if (score >= 0.65) fuzzyMatches.push({ name: u.full_name, score });
          if (score > bestScore) { bestScore = score; bestName = u.full_name; }
        }

        const nearBest = fuzzyMatches.filter(m => bestScore - m.score <= 0.05);
        if (nearBest.length > 1) {
          const options = nearBest.map(m => `· ${m.name}`).join('\n');
          await saveContext(conversationId, {
            ...EMPTY_CONTEXT, language: context.language,
            flow_state: 'EDITING',
            edit_base_payload: { ...cleanBase, __pending_field: 'assignee' },
          }).catch(() => {});
          ctxRef.handled = true;
          return `Multiple people match *${merged.assignee}*:\n${options}\n\nPlease use the full name.`;
        } else if (bestScore >= 0.65) {
          displayAssignee = bestName;
        } else {
          // Not found — return error immediately, keep EDITING state so user can retry
          const names = ((allActive ?? []) as { full_name: string }[])
            .map(u => `· ${u.full_name}`).join('\n') || '(none)';
          await saveContext(conversationId, {
            ...EMPTY_CONTEXT, language: context.language,
            flow_state: 'EDITING', edit_base_payload: base,
          }).catch(() => {});
          ctxRef.handled = true;
          return `❌ No team member found matching *${merged.assignee}*.\n\nAvailable team members:\n${names}\n\nPlease try again with a correct name.`;
        }
      }
    }

    // Format deadline for display
    const [dp = '', tp = '17:00'] = (merged.deadline ?? '').split(' ');
    const [y, mo, d] = dp.split('-');
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const h = parseInt(tp.split(':')[0]), mn = tp.split(':')[1] ?? '00';
    const dlFmt = dp
      ? `${parseInt(d)} ${MON[parseInt(mo)-1]} ${y}, ${h > 12 ? h-12 : h || 12}:${mn} ${h >= 12 ? 'PM' : 'AM'} IST`
      : '(not set)';

    const who = displayAssignee ? `*${displayAssignee}*` : '*you*';
    const priLow = (merged.priority ?? 'medium').toLowerCase();
    merged.priority = priLow;
    const confReply = `I'll create task *${merged.title ?? '(no title)'}* for ${who} due *${dlFmt}* with *${priLow}* priority${merged.description ? `. Description: "${merged.description.slice(0, 80)}"` : ''}. Go ahead? (Yes / No)`;

    // Store new CONFIRMING state with merged payload.
    // Signal runMasterAgent to skip its own context-reset (we already handled it here).
    await saveContext(conversationId, {
      ...EMPTY_CONTEXT,
      language: context.language,
      flow_state: 'CONFIRMING',
      confirm_payload: { tool: 'create_task', args: { ...merged, assignee: displayAssignee } },
    }).catch(() => {});
    ctxRef.handled = true;
    return confReply;
  }

  // Helper: format deadline and build confirmation reply for PICKING_DEADLINE origin
  async function buildDeadlineConfirm(
    dpCtx: NonNullable<ConversationContext['deadline_pick_context']>,
    deadline: string,
    ctx: ConversationContext,
    convId: string,
    ref: { handled: boolean },
  ): Promise<string> {
    if (!parseDeadlineString(deadline)) {
      await saveContext(convId, {
        ...EMPTY_CONTEXT,
        language: ctx.language,
        flow_state: 'PICKING_DEADLINE',
        deadline_pick_context: dpCtx,
      });
      ref.handled = true;
      return '❌ That date or time is invalid. Please enter a real date and time, for example *15 Jul 2026 2:30pm*.';
    }
    const [dp = '', tp = '17:00'] = deadline.split(' ');
    const [y, mo, d] = dp.split('-');
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const hh = parseInt(tp.split(':')[0]), mn = tp.split(':')[1] ?? '00';
    const dlFmt = `${parseInt(d)} ${MON[parseInt(mo)-1]} ${y}, ${hh > 12 ? hh-12 : hh || 12}:${mn} ${hh >= 12 ? 'PM' : 'AM'} IST`;

    if (dpCtx.origin === 'EDITING' && dpCtx.edit_base) {
      const merged: Record<string, string> = { ...dpCtx.edit_base, deadline };
      const displayAssignee = merged.assignee ?? '';
      const who    = displayAssignee ? `*${displayAssignee}*` : '*you*';
      const priLow = (merged.priority ?? 'medium').toLowerCase();
      merged.priority = priLow;
      const confReply = `I'll create task *${merged.title ?? '(no title)'}* for ${who} due *${dlFmt}* with *${priLow}* priority${merged.description ? `. Description: "${merged.description.slice(0, 80)}"` : ''}. Go ahead? (Yes / No)`;
      await saveContext(convId, {
        ...EMPTY_CONTEXT, language: ctx.language,
        flow_state: 'CONFIRMING',
        confirm_payload: { tool: 'create_task', args: { ...merged } },
      }).catch(() => {});
      ref.handled = true;
      return confReply;
    }

    const confReply = `Update *${dpCtx.task_title}* — set *deadline* to *${dlFmt}*. Go ahead? (Yes / No)`;
    await saveContext(convId, {
      ...EMPTY_CONTEXT, language: ctx.language,
      flow_state: 'CONFIRMING',
      confirm_payload: { tool: 'update_task', args: { task_title: dpCtx.task_title, update_field: 'deadline', update_value: deadline } },
    }).catch(() => {});
    ref.handled = true;
    return confReply;
  }

  // ── 0a. PICKING_DEADLINE — two-step date+time calendar picker ───────────────
  if (context.flow_state === 'PICKING_DEADLINE' && context.deadline_pick_context) {
    const dpCtx = context.deadline_pick_context;
    const msg   = message.trim();
    ctxRef.handled = true;

    if (dpCtx.step === 'date') {
      // User tapped the "Custom date & time" row → prompt for free text
      if (msg === 'custom_date' || msg === 'custom_deadline') {
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT, language: context.language,
          flow_state: 'PICKING_DEADLINE',
          deadline_pick_context: dpCtx,
        }).catch(() => {});
        return `📅 Type the date for *${dpCtx.task_title}*:\n\nExamples:\n• _"15 Jul 2026"_\n• _"next Monday"_\n• _"tomorrow"_`;
      }

      const isoDate  = /^\d{4}-\d{2}-\d{2}$/.test(msg) ? msg : naturalDateToISO(msg);
      const timeInMsg = extractTimeFromText(msg);

      if (isoDate && timeInMsg) {
        // Full date+time typed at once — skip time picker, go straight to confirm
        return await buildDeadlineConfirm(dpCtx, `${isoDate} ${timeInMsg}`, context, conversationId, ctxRef);
      }
      if (isoDate) {
        // Date only — advance to time picker
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT, language: context.language,
          flow_state: 'PICKING_DEADLINE',
          deadline_pick_context: { ...dpCtx, step: 'time', selected_date: isoDate },
        }).catch(() => {});
        return `[[SHOW_OPTIONS:deadline_time:${dpCtx.task_title}]]`;
      }
      // Bad input — re-show date picker
      await saveContext(conversationId, {
        ...EMPTY_CONTEXT, language: context.language,
        flow_state: 'PICKING_DEADLINE',
        deadline_pick_context: dpCtx,
      }).catch(() => {});
      return `[[SHOW_OPTIONS:deadline_date:${dpCtx.task_title}]]`;
    }

    if (dpCtx.step === 'time' && dpCtx.selected_date) {
      if (msg === 'custom_time') {
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT, language: context.language,
          flow_state: 'PICKING_DEADLINE',
          deadline_pick_context: dpCtx,
        }).catch(() => {});
        return `⏰ Type the time for *${dpCtx.task_title}* on the selected date:\n\nExamples:\n• _"2:30pm"_\n• _"14:30"_\n• _"9am"_`;
      }
      // Accept HH:MM row-ID, typed time ("3pm"), or typed full datetime override ("15 Jul 3pm")
      const overrideIso  = naturalDateToISO(msg);
      const overrideTime = extractTimeFromText(msg);
      let timeStr: string | null = null;
      let dateStr = dpCtx.selected_date;
      if (/^\d{2}:\d{2}$/.test(msg)) {
        timeStr = msg;
      } else if (overrideIso && overrideTime) {
        // User typed a full new datetime — override both date and time
        dateStr = overrideIso;
        timeStr = overrideTime;
      } else {
        timeStr = overrideTime;
      }
      if (timeStr) {
        return await buildDeadlineConfirm(dpCtx, `${dateStr} ${timeStr}`, context, conversationId, ctxRef);
      }
      // Unrecognised — re-show time picker
      await saveContext(conversationId, {
        ...EMPTY_CONTEXT, language: context.language,
        flow_state: 'PICKING_DEADLINE',
        deadline_pick_context: dpCtx,
      }).catch(() => {});
      return `[[SHOW_OPTIONS:deadline_time:${dpCtx.task_title}]]`;
    }

    // Unexpected state — reset
    await saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
    return 'Something went wrong with the deadline picker. What else can I help with?';
  }

  // ── 0b. Context-state shortcircuit — fastest path, zero Groq calls ─────────
  //
  // When context_state holds a stored confirmation payload (set after Groq
  // generated the last "Go ahead?" message), we execute directly from it.
  // This is 300–600ms faster than a Groq round-trip.
  if (context.flow_state === 'CONFIRMING' && context.confirm_payload) {
    const payload = context.confirm_payload as { tool: string; args: Record<string, string> };

    // Recover stale/broken deadline confirmations from older deployments.
    // A date without a time must continue to the time picker rather than silently
    // accepting the generic 5:00 PM fallback.
    if (payload.tool === 'update_task' && payload.args.update_field === 'deadline') {
      const taskTitle = payload.args.task_title ?? 'the task';
      const pendingValue = payload.args.update_value ?? '';
      const typedDate = /^\d{4}-\d{2}-\d{2}$/.test(message.trim()) ? message.trim() : null;
      const confirmedDateOnly = isYes(message) && /^\d{4}-\d{2}-\d{2}$/.test(pendingValue);
      if (typedDate || confirmedDateOnly) {
        const selectedDate = typedDate ?? pendingValue;
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT,
          language: context.language,
          flow_state: 'PICKING_DEADLINE',
          deadline_pick_context: {
            step: 'time',
            task_title: taskTitle,
            origin: 'UPDATE',
            selected_date: selectedDate,
          },
        });
        ctxRef.handled = true;
        return `[[SHOW_OPTIONS:deadline_time:${taskTitle}]]`;
      }
    }

    if (isYes(message)) {
      console.log(`[Agent] Context shortcircuit: YES → ${payload.tool}`);
      const result = await dispatchTool(payload.tool, payload.args, user, orgId);
      await saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
      return result;
    }

    if (isNo(message)) {
      console.log('[Agent] Context shortcircuit: NO → cancel');
      await saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
      return 'Got it, cancelled. What else can I help with? 😊';
    }

    // Compound reply: "Yes and it's mahima's task" — confirm the pending
    // action, then process the remainder as a fresh message instead of
    // silently dropping the confirmation (see splitLeadingYes above).
    const leadingYesRemainder = splitLeadingYes(message);
    if (leadingYesRemainder) {
      console.log(`[Agent] Context shortcircuit: compound YES + "${leadingYesRemainder}" → execute then continue`);
      const result = await dispatchTool(payload.tool, payload.args, user, orgId);
      await saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
      const continued = await runGroqLoop(
        leadingYesRemainder, history, user, orgId,
        { ...EMPTY_CONTEXT, language: context.language }, conversationId, { handled: false },
      );
      return `${result}\n\n${continued}`;
    }

    if (/^edit$/i.test(message.trim())) {
      if (payload.tool === 'create_task') {
        console.log('[Agent] Context shortcircuit: EDIT → EDITING state with base payload');
        const a = payload.args;
        // Save EDITING state so the next message merges corrections with this base.
        // Set ctxRef.handled so runMasterAgent skips its own context-reset logic.
        await saveContext(conversationId, {
          ...EMPTY_CONTEXT,
          language: context.language,
          flow_state: 'EDITING',
          edit_base_payload: a,
        }).catch(() => {});
        ctxRef.handled = true;
        // Format deadline for display
        let dlRef = a.deadline ?? '';
        if (dlRef) {
          const [dp, tp = '17:00'] = dlRef.split(' ');
          const [y, mo, d] = dp.split('-');
          const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const h = parseInt(tp.split(':')[0]), mn = tp.split(':')[1] ?? '00';
          dlRef = `${parseInt(d)} ${MON[parseInt(mo)-1]} ${y}, ${h > 12 ? h-12 : h || 12}:${mn} ${h >= 12 ? 'PM' : 'AM'} IST`;
        }
        const ref = [
          `📝 *Title:* ${a.title || '(not set)'}`,
          `📅 *Deadline:* ${dlRef || '(not set)'}`,
          `🔴 *Priority:* ${a.priority || '(not set)'}`,
          `👤 *Assign To:* ${a.assignee || '(you)'}`,
          ...(a.description ? [`💬 *Description:* ${a.description}`] : []),
        ].join('\n');
        return `Current details:\n${ref}\n\nWhat would you like to change? You can either:\n• Reply with a correction (e.g. _"Assign to Tushar Bali"_, _"Deadline 10 Jul 3pm"_, _"High priority"_)\n• Or re-enter all fields:\n📝 *Title* (Required)\n📅 *Deadline* (Required) — e.g. tomorrow 5pm (defaults to 5:00 PM IST if no time given)\n🔴 *Priority* (Optional — defaults to Medium if not provided) — High / Medium / Low / Urgent\n👤 *Assign To* (Optional — defaults to you if not provided)\n💬 *Description* (Optional)`;
      }
      // Non-create-task confirmation edit — give context-aware prompt
      console.log('[Agent] Context shortcircuit: EDIT on non-create → clear + rephrase prompt');
      await saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
      if (payload.tool === 'update_task') {
        const taskName = (payload.args.task_title ?? payload.args.title ?? 'the task') as string;
        return `What would you like to update on *${taskName}*?\n\nYou can change:\n• *Deadline* — e.g. "set deadline to 10 Jul 5pm"\n• *Priority* — low / medium / high / urgent\n• *Assignee* — e.g. "assign to Tushar"\n• *Status* — todo / in_progress / done\n• *Title* — e.g. "rename to New Title"\n\nJust describe the change and I'll confirm before applying.`;
      }
      return 'What would you like to change? Please describe your request differently.';
    }

    // User sent something else (correction/clarification) — clear stored confirmation
    // so Groq can re-evaluate and generate a new one if needed.
    await saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
  }

  // ── 0c. Field-value interactive options shortcut ──────────────────────────────
  // When user sends just a field name in an update context, bypass Groq entirely.
  // • priority / status / assignee → return sentinel (webhook sends interactive list/buttons)
  // • deadline / title             → return direct text prompt (free-form input)
  {
    const msg0c = message.trim();
    // Match field with common variations ("assign to", "change priority", etc.)
    const interactiveField =
      /^(?:(?:set|change|update)\s+)?priority[\s:]*$/i.test(msg0c) ? 'priority' :
      /^(?:assign(?:ee)?(?:\s+to)?|(?:set|change|update)\s+assign(?:ee)?)[\s:]*$/i.test(msg0c) ? 'assignee' :
      /^(?:(?:set|change|update)\s+)?status[\s:]*$/i.test(msg0c)   ? 'status' : '';
    const isFreeTextField =
      /^(?:(?:set|change|update)\s+)?deadline[\s:]*$/i.test(msg0c) ||
      /^(?:(?:set|change|update|rename)\s+)?title[\s:]*$/i.test(msg0c);
    const normMsg = isFreeTextField
      ? (/deadline/i.test(msg0c) ? 'deadline' : 'title')
      : interactiveField;

    if (interactiveField || isFreeTextField) {
      const recentBot = [...history].reverse().find(m => m.role === 'assistant');
      if (recentBot) {
        const taskMatch =
          recentBot.content.match(/update on \*([^*]+)\*/i) ||
          recentBot.content.match(/update\s+\*([^*]+)\*/i) ||
          // CREATE_TASK edit context: "Current details:" block after user tapped Edit details
          // Format is "📝 *Title:* Prod task 3" so skip the closing bold marker (*) before the value
          (/What would you like to change/i.test(recentBot.content)
            ? recentBot.content.match(/\*?Title:?\*?\s*([^\n*]+)/i)
            : null);
        if (taskMatch) {
          const taskTitle = taskMatch[1].trim();
          if (interactiveField) {
            console.log(`[Agent] Field-options shortcut: field="${interactiveField}" task="${taskTitle}"`);
            return `[[SHOW_OPTIONS:${interactiveField}:${taskTitle}]]`;
          }
          if (normMsg === 'deadline') {
            console.log(`[Agent] Deadline calendar picker: task="${taskTitle}"`);
            await saveContext(conversationId, {
              ...EMPTY_CONTEXT, language: context.language,
              flow_state: 'PICKING_DEADLINE',
              deadline_pick_context: { step: 'date', task_title: taskTitle, origin: 'UPDATE' },
            }).catch(() => {});
            return `[[SHOW_OPTIONS:deadline_date:${taskTitle}]]`;
          }
          console.log(`[Agent] Title prompt shortcut: task="${taskTitle}"`);
          return `What should the new title be for *${taskTitle}*?`;
        }
      }
    }
  }

  // ── 0d. "Update same task" bypass ────────────────────────────────────────────
  // Detect "please update the same task" / "update same task" and resolve the task
  // name from recent history — bypasses Groq to avoid context-pollution loops where
  // Groq calls list_users repeatedly because of earlier assignee/user-list history.
  {
    const UPDATE_SAME_RE = /^(?:please\s+)?update\s+(?:the\s+)?same\s+task\s*[!.?]*$/i;
    if (UPDATE_SAME_RE.test(message.trim())) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role !== 'assistant') continue;
        const m = history[i].content.match(/update on \*([^*]+)\*/i) ||
                  history[i].content.match(/update\s+\*([^*]+)\*/i);
        if (m) {
          const taskName = m[1].trim();
          console.log(`[Agent] Update-same-task bypass: task="${taskName}" from history`);
          return `What would you like to update on *${taskName}*?\n\nYou can change: deadline / priority / assignee / status / title`;
        }
      }
    }
  }

  // ── 0e. "Update <name>'s task(s)" bypass ──────────────────────────────────────
  // Resolve the named person deterministically through the real list_tasks tool
  // (name matching, fuzzy fallback, and "multiple people match" disambiguation
  // are already handled correctly there) instead of letting Groq guess a task
  // list from scratch. Groq has been observed skipping the tool call for this
  // phrasing and fabricating a fake task (e.g. "Fix login bug" — one of its own
  // few-shot examples in the system prompt) instead of real data.
  {
    const UPDATE_PERSON_RE = /^(?:please\s+)?update\s+(.+?)[’']s\s+tasks?\s*[!.?]*$/i;
    const personName = normalizeCommandText(message).match(UPDATE_PERSON_RE)?.[1]?.trim();
    if (personName && !/^(?:the\s+)?same$/i.test(personName)) {
      console.log(`[Agent] Update-person bypass: resolving real tasks for "${personName}"`);
      return resolveTaskOwnerForUpdate(personName, user, orgId, conversationId, context.language);
    }
  }

  // ── 0f. Bare-name follow-up after a task-list-shaped bot reply ───────────────
  // Covers situations that all leave Groq to free-generate a reply — and it
  // has been observed fabricating a task list wholesale (blending in its own
  // few-shot example content, e.g. "Design mockups"/"Sample Task" for a made-up
  // person, or a made-up surname) instead of admitting it has no real tool
  // result:
  //   a) bot's last reply was list_tasks's own "No user found matching X.
  //      Available: ..." failure (executor.ts LIST_TASKS)
  //   b) bot's last reply was ITSELF a real (or empty) task list (e.g. "Due
  //      today: ..." or "No pending tasks found for X") and the user follows
  //      up with just a bare name — clearly asking to see that person's
  //      tasks next, not naming a new field value.
  // Either way, a bare name here means "show that person's tasks" — resolve it
  // through the real list_tasks tool (fuzzy DB match included) instead of Groq.
  //
  // The task-list shape check is intentionally narrow (requires "tasks:"/
  // "टास्क:" in the bold header, or the "No ... tasks" empty-result phrasing)
  // so it never matches unrelated "📋 *...*" confirmation headers — e.g.
  // CREATE_TASK's "📋 *Create this task?*" or TASK_DETAILS' "📋 *Show details
  // for this task?*" (see slots.ts) — which would otherwise hijack a bare-name
  // reply meant to correct a pending confirmation's assignee field.
  {
    const lastBot = lastBotMessage(history).trim();
    const NO_MATCH_RE = /No user found matching|नाम का कोई user नहीं मिला/;
    const looksLikeTaskListReply =
      /^📋 \*.*(?:tasks?|टास्क):\*/i.test(lastBot)
      || /^✅ \*.*completed tasks/i.test(lastBot)
      || /^📋 No .*tasks?/i.test(lastBot)
      || /^📋 कोई.*टास्क/.test(lastBot);
    const bareNameMatch = message.trim().match(/^(?:no,?\s+)?(?:i\s+mean\s+|actually\s+)?([\p{L}][\p{L} .'-]{1,40})$/iu);
    const looksLikeBareName = !!bareNameMatch
      && !/\b(task|tasks|create|update|delete|leave|check|assign|list|show)\b/i.test(message);
    if ((NO_MATCH_RE.test(lastBot) || looksLikeTaskListReply) && looksLikeBareName) {
      const correctedName = bareNameMatch![1].trim();
      console.log(`[Agent] Bare-name task-list follow-up: "${correctedName}"`);
      return dispatchTool('list_tasks', { assignee_name: correctedName }, user, orgId);
    }
  }

  // ── 1. Quick-route deterministic patterns — bypass AI for unambiguous commands ─
  const parsedTaskListArgs = quickTaskListArgs(message);
  const taskListArgs = parsedTaskListArgs ? resolveTaskListPronoun(parsedTaskListArgs, history) : null;
  if (taskListArgs) {
    console.log(`[Agent] Quick task-list route: "${message}"`, taskListArgs);
    return dispatchTool('list_tasks', taskListArgs, user, orgId);
  }

  const directTool = quickRoute(message);
  if (directTool) {
    console.log(`[Agent] Quick-route: "${message}" → ${directTool}`);
    return dispatchTool(directTool, {}, user, orgId);
  }

  // ── 1a. Quick-confirmation routes for check-in / check-out ────────────────
  // These are zero-slot action tools — no argument to extract, so we generate
  // the confirmation text directly instead of asking Groq (which often misses them).
  // parseConfirmationMessage + context_state handle the "Yes" execution path.
  const CHECK_IN_PHRASES = /^(?:please\s+)?(?:check\s*[-\s]?in|i.?m\s+(?:in|here|back)|aaya|i.?ve?\s+(?:reached|arrived)|mark\s+(?:my\s+)?attendance|log\s+(?:my\s+)?attendance|office\s+(?:aa\s+gaya|mein\s+hoon|pohonch\s+gaya))\s*[!.?]*$/i;
    if (CHECK_IN_PHRASES.test(normalizedMessage)) {
    console.log(`[Agent] Check-in quick-confirm: "${message}"`);
    return 'Mark your attendance as *checked in* for today? (Yes / No)';
  }

  const CHECK_OUT_PHRASES = /^(?:please\s+)?(?:check\s*[-\s]?out|i.?m\s+(?:leaving|done|going|out)|leaving\s+now|going\s+home|done\s+for\s+(?:the\s+)?today?|signing\s+off|bye\s*bye?|ja\s+raha|nikal\s+raha)\s*[!.?]*$/i;
    if (CHECK_OUT_PHRASES.test(normalizedMessage)) {
    console.log(`[Agent] Check-out quick-confirm: "${message}"`);
    return 'Mark your attendance as *checked out* for today? (Yes / No)';
  }

  // ── 1b. "Create a task" with no inline details — return fields form directly ─
  // Bypasses Groq entirely to prevent reasoning-text leaks from complex history.
  const CREATE_TASK_BARE = /^(?:please\s+)?(?:create|add|make|new)\s+(?:a\s+)?(?:task|todo|work\s*item|reminder)\s*[!.?]*$/i;
    if (CREATE_TASK_BARE.test(normalizedMessage)) {
    console.log(`[Agent] Create-task quick-form: "${message}"`);
    return 'Sure! Please provide the following:\n📝 *Title* (Required)\n📅 *Deadline* (Required) — e.g. tomorrow 5pm (defaults to 5:00 PM IST if no time given)\n🔴 *Priority* (Optional — defaults to Medium if not provided) — High / Medium / Low / Urgent\n👤 *Assign To* (Optional — defaults to you if not provided)\n💬 *Description* (Optional)';
  }

  // ── 2. Confirmation / context injection ──────────────────────────────────
  // a) If previous bot message was "Go ahead? (Yes / No)" → handle yes/no directly.
  // b) If user says "create the task" / "create it" without a pending confirmation
  //    but history contains task details → inject context so AI looks at history.
  let effectiveMessage = message;

  const CREATE_SHORTCUT = /^(create\s*(the\s*)?task|create\s*it|done\s*create|proceed\s*create)\s*[!.]*$/i;

  if (isPendingConfirmation(history)) {
    if (isYes(message)) {
      const lastMsg = lastBotMessage(history);
      console.log(`[Agent] Confirmation ("${message}") — attempting direct tool execution`);
      const directResult = await executeFromConfirmation(lastMsg, user, orgId);
      if (directResult !== null) {
        console.log('[Agent] Direct execution succeeded — skipping Groq');
        return directResult;
      }
      // Fallback: inject hint and let Groq handle it
      console.log('[Agent] Direct parse failed — falling back to Groq with hint');
      effectiveMessage = `${message}\n[INSTRUCTION: The user just confirmed the action you described in your previous message. Call the appropriate tool NOW with the exact details from that message. Do NOT ask for confirmation again.]`;
    } else if (isNo(message)) {
      console.log(`[Agent] Cancellation detected ("${message}")`);
      return 'Got it, cancelled. What else can I help with? 😊';
    } else if (/^edit$/i.test(message.trim())) {
      console.log(`[Agent] Edit detected ("${message}") — prompt to rephrase`);
      return 'What would you like to change? Please describe your request differently.';
    }
  } else if (CREATE_SHORTCUT.test(message.trim()) && history.length >= 2) {
    // User said "Create the task" but bot's last message wasn't a confirmation prompt.
    // Look in history for task details and tell AI to extract + confirm them.
    console.log(`[Agent] Create-shortcut detected ("${message}") with history — injecting context hint`);
    effectiveMessage = `${message}\n[INSTRUCTION: Look through the conversation history above. Find the task title (and deadline / priority if mentioned). If you have a title, issue a confirmation message: "I'll create task *<title>* [due *<date>*]. Go ahead? (Yes / No)". If you don't have enough details, ask for the title.]`;
  } else {
    // If the last bot message was asking for task fields, parse the user's reply
    // directly in code — do NOT trust Groq to generate the confirmation.
    const lastBot = lastBotMessage(history);
    if (/Please provide the following|\*Title\*.*Required/i.test(lastBot)) {
      const lines   = message.split('\n').map(l => l.trim()).filter(Boolean);
      const title   = lines[0] ?? '';
      const rawDl   = lines[1] ?? '';
      const rawPri  = lines[2]?.trim() ?? '';
      const assignTo = lines[3]?.trim() ?? '';
      const desc    = lines.slice(4).join(' ').trim();
      const validPri = !rawPri || /^(high|medium|low|urgent)$/i.test(rawPri);
      const iso     = title && rawDl ? naturalDateToISO(rawDl) : null;

      if (title && iso && validPri) {
        const time      = extractTimeFromText(rawDl) ?? '17:00';
        const [y, mo, d] = iso.split('-');
        const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const h         = parseInt(time.split(':')[0]);
        const min       = time.split(':')[1];
        const timeFmt   = `${h > 12 ? h - 12 : h || 12}:${min} ${h >= 12 ? 'PM' : 'AM'}`;
        const dlFmt     = `${parseInt(d)} ${MONTHS[parseInt(mo) - 1]} ${y}, ${timeFmt}`;
        const priLow    = rawPri ? rawPri.toLowerCase() : 'medium';
        // Resolve typed name to full name from DB for the confirmation display
        let displayAssignee = assignTo;
        if (assignTo) {
          const { createAdminClient: mkDb } = await import('@/lib/supabase/admin');
          const { data: found } = await mkDb()
            .from('users').select('full_name')
            .eq('organization_id', orgId)
            .ilike('full_name', `%${assignTo}%`)
            .limit(1).maybeSingle();
          if (found?.full_name) displayAssignee = found.full_name;
        }
        const who = displayAssignee ? `*${displayAssignee}*` : `*you*`;
        console.log(`[Agent] Task fields direct-parsed: title="${title}" deadline="${iso} ${time}" pri="${priLow}" assignee="${displayAssignee}"`);
        return `I'll create task *${title}* for ${who} due *${dlFmt}* with *${priLow}* priority${desc ? `. Description: "${desc.slice(0, 80)}"` : ''}. Go ahead? (Yes / No)`;
      }

      // Could not parse all required fields — ask Groq but with a targeted hint
      effectiveMessage = `${message}\n[INSTRUCTION: The user just provided task fields. Parse them and generate the confirmation message. Priority is optional — default to medium if not mentioned. Only ask again for missing/unparseable required fields (title, deadline).]`;
    }
  }

  // ── 3. AI loop ────────────────────────────────────────────────────────────
  const isDev = process.env.NODE_ENV !== 'production';

  // Shared schema normaliser: Gemini uses UPPERCASE types; Claude + OpenAI need lowercase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function normalizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const out = { ...schema };
    if (typeof out.type === 'string') out.type = out.type.toLowerCase();
    if (out.properties) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(out.properties)) props[k] = normalizeSchema(v);
      out.properties = props;
    }
    if (out.items) out.items = normalizeSchema(out.items);
    return out;
  }

  async function runOpenRouterFallback(): Promise<string> {
    const tools: OpenAI.Chat.ChatCompletionTool[] = HRBOT_TOOLS.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: normalizeSchema(t.parameters) },
    }));
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(user) },
      ...history.map(m => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
      { role: 'user', content: effectiveMessage },
    ];

    try {
      let response = await openai.chat.completions.create({
        model: AI_MODEL_OR, messages, tools, max_tokens: 512,
      });
      for (let round = 0; round < 4; round++) {
        const choice = response.choices[0];
        const toolCalls = choice.message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          const text = choice.message.content?.trim() || '';
          if (isGroqGenericFiller(text) || looksLikeUnconfirmedSuccessClaim(text)) {
            if (round < 2) {
              messages.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);
              messages.push({ role: 'user', content: '[SYSTEM ENFORCEMENT] Do NOT output your reasoning. Call the correct tool immediately, or give a direct one-sentence answer.' });
              response = await openai.chat.completions.create({ model: AI_MODEL_OR, messages, tools, max_tokens: 512 });
              continue;
            }
            return 'I had trouble processing that — please try again.';
          }
          return (isGroqGenericFiller(text) || looksLikeUnconfirmedSuccessClaim(text)) ? 'I had trouble processing that — please try again.' : text;
        }
        messages.push(choice.message);
        for (const call of toolCalls) {
          if (call.type !== 'function') continue;
          let args: Record<string, string> = {};
          try { args = JSON.parse(call.function.arguments); } catch { /* empty args */ }
          const output = await dispatchTool(call.function.name, args, user, orgId);
          if (VERBATIM_TOOLS.has(call.function.name)) return output;
          messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        }
        response = await openai.chat.completions.create({
          model: AI_MODEL_OR, messages, tools, max_tokens: 512,
        });
      }
      return 'I had trouble processing that — please try again.';
    } catch (err) {
      console.error('[Agent] Free OpenRouter fallback failed:', err);
      return "I'm a bit busy right now. Please try again in a few seconds.";
    }
  }

  const backend = await resolveBackend(orgId);
  console.log(`[Agent] AI backend for org ${orgId}: ${backend}`);

  if (backend === 'groq') {
    // ── Groq Llama 3.3 70B — primary backend (free tier) ──────────────────
    const groqTools: Groq.Chat.ChatCompletionTool[] = HRBOT_TOOLS.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: normalizeSchema(t.parameters) },
    }));

    const groqMessages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(user) },
      ...history.map(m => ({ role: m.role, content: m.content } as Groq.Chat.ChatCompletionMessageParam)),
      { role: 'user', content: effectiveMessage },
    ];

    // Random key order per request — spreads load randomly across all
    // configured keys, and a 429/failure falls back to a random remaining
    // key rather than a fixed next-in-sequence one.
    const activeGroqClients = await resolveGroqClients(orgId);
    const keyOrder = shuffledIndices(activeGroqClients.length);

    // Try each Groq key in random order; on 429 move to another random key
    for (let keyTry = 0; keyTry < activeGroqClients.length; keyTry++) {
      const clientIdx = keyOrder[keyTry];
      const client    = activeGroqClients[clientIdx];

      try {
        let resp = await client.chat.completions.create({
          model:      AI_MODEL_GROQ,
          messages:   [...groqMessages],
          tools:      groqTools,
          max_tokens: 512,
        });

        // Index was already advanced before the loop

        let prevGroqToolKey = '';
        for (let round = 0; round < 4; round++) {
          const choice    = resp.choices[0];
          const toolCalls = (choice.message.tool_calls ?? []) as Groq.Chat.ChatCompletionMessageToolCall[];

          if (toolCalls.length === 0) {
            const textReply = stripGroqFiller(choice.message.content?.trim() || '');
            const isFiller  = isGroqGenericFiller(textReply);

            // Hard block: chain-of-thought or filler must NEVER reach the user.
            // Retry up to round 1; on round 2+ fall back to OpenRouter rather
            // than sending leaked reasoning as a WhatsApp message.
            if (isFiller) {
              if (round < 2) {
                console.warn(`[Agent] Groq leaked reasoning/filler on round ${round} ("${textReply.slice(0,80)}") — enforcing retry`);
                groqMessages.push({ role: 'assistant', content: textReply });
                groqMessages.push({
                  role: 'user',
                  content: '[SYSTEM ENFORCEMENT] Do NOT output your reasoning. Respond directly:\n' +
                    '• READ-ONLY (list tasks, leave balance, attendance, users): call the tool NOW.\n' +
                    '• ACTION (create/update/complete/delete task, check-in/out, leave): one confirmation sentence ending "Go ahead? (Yes / No)".\n' +
                    'No analysis. No "We need to". No "Let me". Just the tool call or the confirmation.',
                });
                resp = await client.chat.completions.create({
                  model: AI_MODEL_GROQ, messages: groqMessages, tools: groqTools, max_tokens: 512,
                });
                continue;
              }
              // Still filler after 2 retries — OpenRouter is more reliable here
              console.error(`[Agent] Groq filler persisted after 2 retries — falling back to OpenRouter`);
              return runOpenRouterFallback();
            }

            // Hard block: Groq claiming a mutation succeeded without ever calling the
            // tool (no confirmation shown, nothing actually written to the database).
            // Every mutating/read tool short-circuits via CONFIRM_BEFORE_EXEC or
            // VERBATIM_TOOLS above, so reaching this point with success-claim text
            // means it was fabricated — never let it reach the user as-is.
            if (looksLikeUnconfirmedSuccessClaim(textReply)) {
              if (round < 2) {
                console.warn(`[Agent] Groq claimed success without a tool call on round ${round} ("${textReply.slice(0,80)}") — enforcing retry`);
                groqMessages.push({ role: 'assistant', content: textReply });
                groqMessages.push({
                  role: 'user',
                  content: '[SYSTEM ENFORCEMENT] You just claimed an action was completed, but you did not call a tool — nothing was actually changed. ' +
                    'Do NOT claim something was updated/created/completed/deleted/approved/checked in unless you call the matching tool. ' +
                    'Call the correct tool now, or if it is a mutating action, reply with a confirmation ending "Go ahead? (Yes / No)".',
                });
                resp = await client.chat.completions.create({
                  model: AI_MODEL_GROQ, messages: groqMessages, tools: groqTools, max_tokens: 512,
                });
                continue;
              }
              console.error(`[Agent] Groq kept fabricating a success claim after 2 retries — falling back to OpenRouter`);
              return runOpenRouterFallback();
            }

            // Round 0 only: retry if Groq skipped a required tool call
            if (round === 0 && shouldHaveCalledTool(message)) {
              console.warn(`[Agent] Groq skipped tool call for "${message}" ("${textReply.slice(0,60)}") — enforcing retry`);
              groqMessages.push({ role: 'assistant', content: textReply });
              groqMessages.push({
                role: 'user',
                content: '[SYSTEM ENFORCEMENT] Your last response did not address the user\'s request. Fix this now:\n' +
                  '• For READ-ONLY requests (list tasks, leave balance, attendance, users): call the correct tool immediately.\n' +
                  '• For ACTION requests (check-in, check-out, complete task, apply leave, create task, delete task): reply with a confirmation message ending with "Go ahead? (Yes / No)".\n' +
                  'Do NOT say "What else can I help with?" — respond to the actual intent.',
              });
              resp = await client.chat.completions.create({
                model: AI_MODEL_GROQ, messages: groqMessages, tools: groqTools, max_tokens: 512,
              });
              continue;
            }

            return textReply;
          }

          // Detect tool-call loop: same tool(s) called twice in a row means Groq is stuck.
          // Fall back to OpenRouter rather than timing out the whole function.
          const groqToolKey = toolCalls.map(tc => `${tc.function.name}:${tc.function.arguments}`).join('|');
          if (groqToolKey === prevGroqToolKey) {
            console.warn(`[Agent] Groq tool loop detected ("${toolCalls[0]?.function.name}" called twice) — OpenRouter fallback`);
            return runOpenRouterFallback();
          }
          prevGroqToolKey = groqToolKey;

          groqMessages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: toolCalls });

          for (const tc of toolCalls) {
            console.log(`[Agent] Groq[${clientIdx}] tool call: ${tc.function.name}`, tc.function.arguments);
            let args: Record<string, string> = {};
            try { const p = JSON.parse(tc.function.arguments); if (p && typeof p === 'object') args = p; } catch { /* empty args */ }

            // Mutating tools must never execute without user confirmation, even when
            // Groq skips the text-confirmation step (e.g. after seeing prior "yes" in history).
            if (CONFIRM_BEFORE_EXEC.has(tc.function.name)) {
              console.log(`[Agent] Groq tried to execute ${tc.function.name} directly — intercepting for confirmation`);
              const confirmText = buildToolConfirmation(tc.function.name, args);
              await saveContext(conversationId, {
                ...EMPTY_CONTEXT,
                language:        context.language,
                flow_state:      'CONFIRMING',
                confirm_message: confirmText,
                confirm_payload: { tool: tc.function.name, args },
              }).catch(() => {});
              return confirmText;
            }

            const output = await dispatchTool(tc.function.name, args, user, orgId);
            if (VERBATIM_TOOLS.has(tc.function.name)) return output;
            groqMessages.push({ role: 'tool', tool_call_id: tc.id, content: output });
          }

          resp = await client.chat.completions.create({
            model:      AI_MODEL_GROQ,
            messages:   groqMessages,
            tools:      groqTools,
            max_tokens: 512,
          });
        }

        return 'I had trouble processing that — please try again.';

      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        const errMsg = (err as { message?: string }).message ?? String(err);

        if (status === 429 && keyTry < activeGroqClients.length - 1) {
          console.warn(`[Agent] Groq key[${clientIdx}] rate-limited — rotating to next key`);
          continue; // try next key
        }

        console.error(`[Agent] Groq[${clientIdx}] error (status ${status}) — using free OpenRouter:`, errMsg);
        return runOpenRouterFallback();
      }
    }

    return runOpenRouterFallback();

  } else if (backend === 'claude') {
    // ── Claude Haiku 4.5 — primary backend ────────────────────────────────
    const claudeTools: Anthropic.Messages.Tool[] = HRBOT_TOOLS.map(t => ({
      name:         t.name,
      description:  t.description,
      input_schema: normalizeSchema(t.parameters) as Anthropic.Messages.Tool['input_schema'],
    }));

    const claudeMessages: Anthropic.Messages.MessageParam[] = [
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: effectiveMessage },
    ];

    try {
      for (let round = 0; round < 6; round++) {
        const response = await anthropic.messages.create({
          model:      AI_MODEL_CLAUDE,
          max_tokens: 512,
          system:     buildSystemPrompt(user),
          tools:      claudeTools,
          messages:   claudeMessages,
        });

        const textBlocks   = response.content.filter((b): b is Anthropic.Messages.TextBlock    => b.type === 'text');
        const toolBlocks   = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');

        if (toolBlocks.length === 0) {
          const text = textBlocks.map(b => b.text).join('').trim();
          if (isGroqGenericFiller(text) || looksLikeUnconfirmedSuccessClaim(text)) {
            if (round < 2) {
              claudeMessages.push({ role: 'assistant', content: response.content });
              claudeMessages.push({ role: 'user', content: '[SYSTEM ENFORCEMENT] Do NOT output your reasoning. Call the correct tool immediately, or give a direct one-sentence answer.' });
              continue;
            }
            return 'I had trouble processing that — please try again.';
          }
          return (isGroqGenericFiller(text) || looksLikeUnconfirmedSuccessClaim(text)) ? 'I had trouble processing that — please try again.' : text;
        }

        // Push assistant turn with tool_use blocks
        claudeMessages.push({ role: 'assistant', content: response.content });

        // CONFIRM_BEFORE_EXEC gate — intercept mutating tools before execution
        for (const block of toolBlocks) {
          if (CONFIRM_BEFORE_EXEC.has(block.name)) {
            const args = (block.input ?? {}) as Record<string, string>;
            const confirmText = buildToolConfirmation(block.name, args);
            await saveContext(conversationId, {
              ...EMPTY_CONTEXT,
              language:        context.language,
              flow_state:      'CONFIRMING',
              confirm_message: confirmText,
              confirm_payload: { tool: block.name, args },
            }).catch(() => {});
            return confirmText;
          }
        }

        // Execute each tool and collect results
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const block of toolBlocks) {
          console.log(`[Agent] Claude tool call: ${block.name}`, block.input);
          const output = await dispatchTool(
            block.name,
            (block.input ?? {}) as Record<string, string>,
            user,
            orgId,
          );
          if (VERBATIM_TOOLS.has(block.name)) return output;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: output });
        }

        // Feed results back as a user turn
        claudeMessages.push({ role: 'user', content: toolResults });
      }

      return 'I had trouble processing that — please try again.';

    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const errMsg = (err as { message?: string }).message ?? String(err);
      console.error('[Agent] Claude error (status', status, '):', errMsg);
      if (status === 429) {
        return isDev ? `⏳ *[DEV] Claude 429:* ${errMsg}` : "I'm a bit busy right now. Please try again in a few seconds.";
      }
      return isDev ? `⚠️ *[DEV] Claude ${status}:* ${errMsg}` : '⚠️ Something went wrong. Please try again.';
    }

  } else if (false as boolean) {
    // ── Gemini native SDK path (disabled — enable once Google billing is set up) ─
    const model = genAI.getGenerativeModel({
      model:             AI_MODEL_GEMINI,
      systemInstruction: buildSystemPrompt(user),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools:             [{ functionDeclarations: HRBOT_TOOLS }] as any,
      generationConfig:  { maxOutputTokens: 512 },
    });

    const geminiHistory = history.map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });

    try {
      let result = await chat.sendMessage(effectiveMessage);

      for (let round = 0; round < 6; round++) {
        const calls = result.response.functionCalls() ?? [];
        if (calls.length === 0) {
          const text = result.response.text().trim() || '';
          if (isGroqGenericFiller(text) || looksLikeUnconfirmedSuccessClaim(text)) {
            if (round < 2) {
              result = await chat.sendMessage('[SYSTEM ENFORCEMENT] Do NOT output your reasoning. Call the correct tool immediately, or give a direct one-sentence answer.');
              continue;
            }
            return 'I had trouble processing that — please try again.';
          }
          return (isGroqGenericFiller(text) || looksLikeUnconfirmedSuccessClaim(text)) ? 'I had trouble processing that — please try again.' : text;
        }

        const functionResponses = [];
        for (const call of calls) {
          console.log(`[Agent] Gemini tool call: ${call.name}`, call.args);
          const output = await dispatchTool(call.name, (call.args ?? {}) as Record<string, string>, user, orgId);
          functionResponses.push({ functionResponse: { name: call.name, response: { output } } });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await chat.sendMessage(functionResponses as any);
      }
      return 'I had trouble processing that — please try again.';

    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const errMsg = (err as { message?: string }).message ?? String(err);
      console.error('[Agent] Gemini error (status', status, '):', errMsg);
      if (status === 429) {
        return isDev ? `⏳ *[DEV] Gemini 429:* ${errMsg}` : "I'm a bit busy right now. Please try again in a few seconds.";
      }
      return isDev ? `⚠️ *[DEV] Gemini ${status}:* ${errMsg}` : '⚠️ Something went wrong. Please try again.';
    }

  } else {
    // ── OpenRouter fallback ────────────────────────────────────────────────
    const orTools: OpenAI.Chat.ChatCompletionTool[] = HRBOT_TOOLS.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: normalizeSchema(t.parameters) },
    }));

    const orMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(user) },
      ...history.map(m => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
      { role: 'user', content: effectiveMessage },
    ];

    try {
      let resp = await openai.chat.completions.create({
        model: AI_MODEL_OR,
        messages: orMessages,
        tools: orTools,
        max_tokens: 512,
      });

      for (let round = 0; round < 6; round++) {
        const choice = resp.choices[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCalls = (choice.message.tool_calls ?? []) as any[];

        if (toolCalls.length === 0) {
          const text = choice.message.content?.trim() || '';
          return (isGroqGenericFiller(text) || looksLikeUnconfirmedSuccessClaim(text)) ? 'I had trouble processing that — please try again.' : text;
        }

        orMessages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: toolCalls });

        for (const tc of toolCalls) {
          console.log(`[Agent] OR tool call: ${tc.function.name}`, tc.function.arguments);
          let args: Record<string, string> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* empty args */ }

          if (CONFIRM_BEFORE_EXEC.has(tc.function.name)) {
            console.log(`[Agent] OR tried to execute ${tc.function.name} directly — intercepting for confirmation`);
            const confirmText = buildToolConfirmation(tc.function.name, args);
            await saveContext(conversationId, {
              ...EMPTY_CONTEXT,
              language:        context.language,
              flow_state:      'CONFIRMING',
              confirm_message: confirmText,
              confirm_payload: { tool: tc.function.name, args },
            }).catch(() => {});
            return confirmText;
          }

          const output = await dispatchTool(tc.function.name, args, user, orgId);
          if (VERBATIM_TOOLS.has(tc.function.name)) return output;
          orMessages.push({ role: 'tool', tool_call_id: tc.id, content: output });
        }

        resp = await openai.chat.completions.create({
          model: AI_MODEL_OR,
          messages: orMessages,
          tools: orTools,
          max_tokens: 512,
        });
      }
      return 'I had trouble processing that — please try again.';

    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const errMsg = (err as { message?: string }).message ?? String(err);
      console.error('[Agent] OpenRouter error (status', status, '):', errMsg);
      if (status === 429) {
        return isDev ? `⏳ *[DEV] OR 429:* ${errMsg}` : "I'm a bit busy right now. Please try again in a few seconds.";
      }
      return isDev ? `⚠️ *[DEV] OR ${status}:* ${errMsg}` : '⚠️ Something went wrong. Please try again.';
    }
  }
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

const INTENT_MAP: Record<string, string> = {
  daily_briefing:      'GREETING',
  list_tasks:          'LIST_TASKS',
  get_task_details:    'TASK_DETAILS',
  create_task:         'CREATE_TASK',
  update_task:         'UPDATE_TASK',
  complete_task:       'COMPLETE_TASK',
  delete_task:         'DELETE_TASK',
  assign_task:         'ASSIGN_TASK',
  apply_leave:         'APPLY_LEAVE',
  check_leave_balance: 'CHECK_LEAVE_BALANCE',
  list_leaves:         'LIST_LEAVES',
  approve_leave:       'APPROVE_LEAVE',
  reject_leave:        'REJECT_LEAVE',
  cancel_leave:        'CANCEL_LEAVE',
  check_in:            'CHECK_IN',
  check_out:           'CHECK_OUT',
  my_attendance:       'MY_ATTENDANCE',
  team_attendance:     'TEAM_ATTENDANCE',
  list_users:          'LIST_USERS',
  set_reminder:        'SET_REMINDER',
  configure_reminders: 'CONFIGURE_REMINDERS',
  help:                'HELP',
  pending_leaves:      'PENDING_LEAVES',
  list_leave_types:    'LIST_LEAVE_TYPES',
  my_profile:          'MY_PROFILE',
  task_stats:          'TASK_STATS',
  add_task_note:       'ADD_TASK_NOTE',
  start_onboarding:    'START_ONBOARDING',
  onboarding_status:   'ONBOARDING_STATUS',
  who_absent:          'WHO_ABSENT',
};

async function dispatchTool(
  toolName: string,
  input:    Record<string, string>,
  user:     AgentUser,
  orgId:    string,
): Promise<string> {
  const result = await dispatchToolResult(toolName, input, user, orgId);
  // WhatsApp hard limit: 4096 chars. Truncate gracefully.
  const reply = result.reply;
  if (reply.length > 4000) {
    return reply.slice(0, 3940) + '\n\n_…response shortened. Please narrow the request for more detail._';
  }
  return reply;
}

// Structured variant of dispatchTool used by internal orchestration (e.g. the
// "update <name>'s task" bypass) that needs to inspect the tool's actual data
// (like the resolved task list) rather than just the formatted WhatsApp text.
async function dispatchToolResult(
  toolName: string,
  input:    Record<string, string>,
  user:     AgentUser,
  orgId:    string,
): Promise<ToolResult> {
  const intent = INTENT_MAP[toolName];
  if (!intent) {
    console.error(`[Tool] Unknown tool requested: ${toolName}`);
    return { success: false, reply: '❌ I could not match that request to a supported action. Please try again.' };
  }

  try {
    const { executeTool } = await import('./executor');

    const slots: Record<string, string | null> = {
      title:         input.task_title   ?? input.title         ?? null,
      assignee:      input.assignee                            ?? null,
      assignee_name: input.assignee_name                       ?? null,
      deadline:      input.deadline                            ?? null,
      priority:      input.priority                            ?? null,
      update_field:   input.update_field                        ?? null,
      update_value:   input.update_value                        ?? null,
      update_field_2: input.update_field_2                      ?? null,
      update_value_2: input.update_value_2                      ?? null,
      leave_type:    input.leave_type                          ?? null,
      start_date:    input.start_date                          ?? null,
      end_date:      input.end_date                            ?? null,
      duration_days: input.duration_days                       ?? null,
      reason:        input.reason                              ?? null,
      employee_name: input.employee_name                       ?? null,
      wa_number:     input.wa_number                            ?? null,
      department:    input.department                          ?? null,
      designation:   input.designation                         ?? null,
      message:       input.message                             ?? null,
      remind_at:     input.remind_at                           ?? null,
      enabled:       input.enabled                             ?? null,
      offset:        input.offset                              ?? null,
      channel:       input.channel                             ?? null,
      description:   input.description                         ?? null,
      status_filter: input.status_filter                       ?? null,
      exclude_status_filter: input.exclude_status_filter       ?? null,
      priority_filter: input.priority_filter                   ?? null,
      exclude_priority_filter: input.exclude_priority_filter   ?? null,
      deadline_filter: input.deadline_filter                   ?? null,
      scope:         input.scope                               ?? null,
      note:          input.note                                ?? null,
    };

    const result = await executeTool({
      intent:          intent as any,
      slots,
      org_id:          orgId,
      user_id:         user.id,
      user_role:       user.role,
      user_name:       user.full_name,
      user_department: user.department,
      manager_id:      user.manager_id,
    });

    if (result.notify?.length) {
      // This runs inside the webhook's waitUntil chain. Await it so Vercel does
      // not terminate the invocation before recipient delivery/logging finishes.
      await sendUserNotifications(result.notify, orgId);
    }

    return result;
  } catch (err) {
    console.error(`[Tool] ${toolName} failed:`, err);
    return { success: false, reply: '❌ Something went wrong with that action. Please try again.' };
  }
}

// ─── Notify other users via WhatsApp ─────────────────────────────────────────

// The in-app notification bell shows this text in a dashboard modal, not a
// chat bubble — WhatsApp-specific instructions ("Reply \"my tasks\" to view
// all tasks.") and *bold* markdown don't belong there. Strip them for the
// stored notification body while the WhatsApp send below still gets the
// original, unmodified message.
function cleanNotificationBody(text: string): string {
  return text
    .replace(/\n+Reply\b[\s\S]*$/i, '')
    .replace(/\*(.+?)\*/g, '$1')
    .trim();
}

async function sendUserNotifications(
  notifications: Array<{ user_id: string; message: string }>,
  orgId: string,
): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();

  for (const notif of notifications) {
    let status: 'sent' | 'failed' = 'failed';
    let failureReason: string | null = null;
    try {
      const { data: u, error: userError } = await db
        .from('users')
        .select('wa_number, full_name')
        .eq('id', notif.user_id)
        .eq('organization_id', orgId)
        .single();

      if (userError) throw userError;
      if (!u?.wa_number) throw new Error('Recipient has no WhatsApp number configured.');

      // orgId is required for organization credentials and wa_logs ownership.
      // sendSmartText (not sendText) — checks the recipient's actual 24h
      // window and routes through the approved template when they're
      // outside it, instead of risking a silent late-failing free-form send.
      await sendSmartText(u.wa_number, notif.message, orgId, (u.full_name ?? 'there').split(' ')[0]);
      status = 'sent';
    } catch (err) {
      failureReason = err instanceof Error ? err.message : String(err);
      console.warn(`[Agent] WhatsApp notification failed for user ${notif.user_id}: ${failureReason}`);
    }

    const { error: notificationError } = await db.from('notifications').insert({
        organization_id: orgId,
        user_id:         notif.user_id,
        type:            'agent_notification',
        title:           'HRBot Notification',
        body:            cleanNotificationBody(notif.message),
        channel:         'whatsapp',
        status,
        sent_at:         status === 'sent' ? new Date().toISOString() : null,
        metadata:        failureReason ? { failure_reason: failureReason } : {},
      });
    if (notificationError) {
      console.warn(`[Agent] Failed to persist notification status: ${notificationError.message}`);
    }
  }
}
