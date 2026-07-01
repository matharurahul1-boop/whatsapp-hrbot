import Anthropic                from '@anthropic-ai/sdk';
import { GoogleGenerativeAI }  from '@google/generative-ai';
import OpenAI                  from 'openai';
import Groq                    from 'groq-sdk';
import { loadSession, saveMessage, saveContext } from './memory';
import { sendText }            from '@/lib/whatsapp/client';
import { EMPTY_CONTEXT }       from './types';
import type { AgentTurn, AgentUser, ConversationContext } from './types';

// ── AI backend ────────────────────────────────────────────────────────────────
// USE_GROQ    = true  → Groq Llama 3.3 70B (primary — free tier, fast tool use)
// USE_CLAUDE  = false → Claude Haiku 4.5 (requires paid credits)
// USE_GEMINI  = false → Gemini 2.0 Flash (enable once Google billing is set up)
// fallback           → OpenRouter free tier
const USE_GROQ   = true;
const USE_CLAUDE = false;
const USE_GEMINI = false;

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
let   groqKeyIndex = 0; // round-robins across serverless warm instances
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
  { re: /^(list\s*(all\s*)?tasks?|my\s*tasks?|show\s*(all\s*)?tasks?|tasks?|pending\s*tasks?|(give\s*me\s*)?(the\s*)?list(\s*of\s*(all\s*)?tasks?)?|open\s*tasks?|due\s*tasks?)$/i, tool: 'list_tasks' },
  { re: /^(leave\s*balance|my\s*leave\s*balance|leaves?\s*left|check\s*leave|how\s*many\s*leaves?)$/i,                                        tool: 'check_leave_balance' },
  { re: /^(my\s*attendance|attendance\s*report|show\s*attendance|attendance|my\s*check\s*in\s*history)$/i,                                     tool: 'my_attendance'       },
  { re: /^(list\s*leaves?|my\s*leaves?|leave\s*requests?|leaves?|my\s*leave\s*history)$/i,                                                    tool: 'list_leaves'         },
  { re: /^(team\s*attendance|who\s*(is\s*)?absent|absent\s*today|who\s*checked\s*in|attendance\s*today)$/i,                                    tool: 'team_attendance'     },
  { re: /^(list\s*(all\s*)?users?|team\s*members?|employees?|all\s*employees?|who\s*is\s*in\s*(the\s*)?team)$/i,                               tool: 'list_users'          },
  { re: /^(help|\?|commands?|what\s*can\s*(you|u)\s*do|options?)$/i,                                                                           tool: 'help'                },
];

function quickRoute(message: string): string | null {
  const t = message.trim().replace(/[?.!,;]+$/, '');
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

function isYes(msg: string): boolean { return YES_RE.test(msg.trim()); }
function isNo (msg: string): boolean { return NO_RE.test(msg.trim()); }

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
    // "for *Tushar*" — extract assignee when creating on behalf of someone
    const assigneeM = lastMsg.match(/\bfor\s+\*([^*]+)\*/i);
    const priorityM = lastMsg.match(/\*(urgent|high|medium|low)\*/i);
    const deadlineM = lastMsg.match(/due\s+\*([^*]+)\*/i);
    if (assigneeM) args.assignee = assigneeM[1].trim();
    if (priorityM) args.priority = priorityM[1].toLowerCase();
    if (deadlineM) {
      const raw  = deadlineM[1];
      const iso  = naturalDateToISO(raw);
      const time = extractTimeFromText(raw);
      if (iso) args.deadline = time ? `${iso} ${time}` : `${iso} 09:00`;
    }
    return { tool: 'create_task', args };
  }

  // CHECK_IN
  if (lower.includes('check-in') || lower.includes('check in') || lower.includes('mark your attendance')) {
    return { tool: 'check_in', args: {} };
  }

  // CHECK_OUT
  if (lower.includes('check-out') || lower.includes('check out') || lower.includes('mark your check-out')) {
    return { tool: 'check_out', args: {} };
  }

  // COMPLETE_TASK: "I'll mark *Title* as complete"
  const completeM = lastMsg.match(/mark\s+\*([^*]+)\*\s+as\s+complet/i);
  if (completeM) return { tool: 'complete_task', args: { task_title: completeM[1].trim() } };

  // DELETE_TASK: "I'll delete task *Title*"
  const deleteM = lastMsg.match(/delete\s+task\s+\*([^*]+)\*/i);
  if (deleteM) return { tool: 'delete_task', args: { task_title: deleteM[1].trim() } };

  // ASSIGN_TASK: "I'll assign *Task Name* to *Person Name*"
  const assignM = lastMsg.match(/assign\s+\*([^*]+)\*\s+to\s+\*([^*]+)\*/i);
  if (assignM) return { tool: 'assign_task', args: { task_title: assignM[1].trim(), assignee: assignM[2].trim() } };

  // UPDATE_TASK: "I'll update *Title* — set *field* to *value*"
  const updateM = lastMsg.match(/update\s+\*([^*]+)\*[\s—–-]+set\s+(?:\*([^*]+)\*|(?:its\s+)?(\w+))\s+to\s+\*([^*]+)\*/i);
  if (updateM) {
    return { tool: 'update_task', args: {
      task_title:   updateM[1].trim(),
      update_field: (updateM[2] ?? updateM[3] ?? '').trim().toLowerCase(),
      update_value: updateM[4].trim(),
    }};
  }

  // APPLY_LEAVE: "I'll apply *type* leave from *date*"
  const leaveM = lastMsg.match(/apply\s+\*(casual|sick|annual|maternity)\*\s+leave/i);
  if (leaveM) {
    const startM = lastMsg.match(/from\s+\*([^*]+)\*/i);
    const endM   = lastMsg.match(/to\s+\*([^*]+)\*/i);
    if (startM) {
      const args: Record<string, string> = {
        leave_type: leaveM[1].toLowerCase(),
        start_date: naturalDateToISO(startM[1]) ?? startM[1],
      };
      if (endM) args.end_date = naturalDateToISO(endM[1]) ?? endM[1];
      return { tool: 'apply_leave', args };
    }
  }

  // APPROVE / REJECT LEAVE
  const approveM = lastMsg.match(/approve\s+\*([^*]+)\*['']?s?\s+leave/i);
  if (approveM) return { tool: 'approve_leave', args: { employee_name: approveM[1].trim() } };
  const rejectM  = lastMsg.match(/reject\s+\*([^*]+)\*['']?s?\s+leave/i);
  if (rejectM)  return { tool: 'reject_leave',  args: { employee_name: rejectM[1].trim()  } };

  return null;
}

// Execute from parsed confirmation — used as history-text fallback when context_state has no payload.
async function executeFromConfirmation(
  lastMsg: string,
  user:    AgentUser,
  orgId:   string,
): Promise<string | null> {
  const parsed = parseConfirmationMessage(lastMsg);
  if (!parsed) return null;
  return dispatchTool(parsed.tool, parsed.args, user, orgId);
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
    description: "List pending/active tasks. For managers/admins, pass assignee_name to show tasks for a specific person (e.g. 'Pranay', 'Tushar'). Without assignee_name, managers see ALL org tasks.",
    parameters: {
      type: 'OBJECT',
      properties: {
        assignee_name: { type: 'STRING', description: 'Filter by assignee full name or first name (managers/admins only).' },
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
    description: 'Create a new task. ONLY call AFTER user confirms AND you have title + deadline + priority. NEVER call without all three.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title:    { type: 'STRING', description: 'Short, clear task title' },
        assignee: { type: 'STRING', description: 'Assignee name or "me". Omit if self.' },
        deadline: { type: 'STRING', description: 'REQUIRED. Due date and time as "YYYY-MM-DD HH:MM" (24h IST). Use 09:00 if user gives only a date. E.g. "2026-07-10 17:00"' },
        priority: { type: 'STRING', description: 'REQUIRED. low | medium | high | urgent' },
      },
      required: ['title', 'deadline', 'priority'],
    },
  },
  {
    name: 'update_task',
    description: "Update a task's title, deadline, priority, assignee, or status. Only call AFTER user confirms.",
    parameters: {
      type: 'OBJECT',
      properties: {
        task_title:   { type: 'STRING', description: 'Current title (or part) of the task to update' },
        update_field: { type: 'STRING', description: 'title | deadline | priority | assignee | status' },
        update_value: { type: 'STRING', description: 'New value for the field' },
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
        offset:  { type: 'STRING', description: 'When to send reminder before deadline: 1_day (day before, morning) | same_day (morning of deadline day)' },
        channel: { type: 'STRING', description: 'whatsapp | in_app | both' },
      },
    },
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
- Tasks: create tasks for yourself only; update only the *status* of your own tasks; complete your own tasks
- Leave: apply for your own leave, check your own balance, cancel your own leave — cannot approve/reject
- Attendance: check in / check out, view your own attendance history
- CANNOT do: assign tasks to others, update task deadline/priority/assignee, approve/reject leave, view team data, list users
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
- Read conversation history. If a task title or detail was mentioned earlier, use it — never ask again.
- Understand natural references: "same task", "it", "that one", "update the assigned to" = update assignee.
- Ask ONE question at a time if you need info.
- Keep replies concise. *bold* for task names and key values. Emojis naturally (✅ ❌ 📋 ⏰ 👤 📅).
- NEVER attempt a tool outside the user's permissions listed above.

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
5. For create_task ONLY: NEVER send the confirmation until *title*, *deadline* (date + time), AND *priority* are all collected. Ask for any that are missing — one question at a time — before confirming.

## CRITICAL: Never lose context mid-collection
- If you just asked for task details and the user provided them, your IMMEDIATE next reply MUST be the confirmation message (e.g. "I'll create task *X* due *Y*. Go ahead? (Yes / No)"). NEVER say "What else can I help with?" at this point.
- If the previous assistant message ended with "Go ahead? (Yes / No)" and the user's new message is a confirmation word (yes, ok, sure, create the task, create it, go ahead, haan, do it, etc.) → call the tool NOW. Do NOT ask for confirmation again.

## Read-only tools — call immediately, NO confirmation needed:
daily_briefing, list_tasks, get_task_details, check_leave_balance, list_leaves, my_attendance${isPrivileged ? ', team_attendance, list_users' : ''}

## Task discovery — users often ask about tasks by describing them or checking details:
- "What's the status of X?" / "Tell me about X task" / "Details of X" → get_task_details(task_title="X")
- "Who is working on X?" / "When is X due?" → get_task_details(task_title="X")

## Task reminder settings
Users can configure their task deadline reminders via natural language:
- "Remind me the day before tasks" → configure_reminders(offset="1_day")
- "Remind me on the day of the task" → configure_reminders(offset="same_day")
- "Turn off task reminders" / "Disable reminders" → configure_reminders(enabled="false")
- "Enable task reminders" → configure_reminders(enabled="true")
- "Remind me on WhatsApp only" → configure_reminders(channel="whatsapp")
Reminders fire at 9 AM IST (morning cron). Always confirm before calling configure_reminders.

## Asking for tasks by person (managers/admins only)
- "List Pranay's tasks" → call list_tasks(assignee_name="Pranay")
- "Show Tushar's tasks" → call list_tasks(assignee_name="Tushar")
- "List all tasks" / "show all org tasks" → call list_tasks() with NO assignee_name

## Examples

Single-turn task creation (title + deadline + priority all in one message):
User: "create a task Fix login bug due tomorrow 5pm priority high"
You: I'll create task *Fix login bug* due *2 Jul 2026, 05:00 PM* with *high* priority. Go ahead? (Yes / No)
User: "yes"
You: [call create_task(title="Fix login bug", deadline="2026-07-02 17:00", priority="high")]

Multi-turn — title given, deadline + priority missing:
User: "I want to create a task"
You: Sure! What's the *title*, *deadline* (date & time), and *priority*? 📝
User: "Fix login bug"
You: Got it — *Fix login bug*. When is the deadline? (e.g. tomorrow 5pm, 10 July 3pm)
User: "tomorrow 5pm"
You: And the priority? (low / medium / high / urgent)
User: "high"
You: I'll create task *Fix login bug* due *2 Jul 2026, 05:00 PM* with *high* priority. Go ahead? (Yes / No)
User: "Create the task"  ← this IS the confirmation
You: [call create_task(title="Fix login bug", deadline="2026-07-02 17:00", priority="high")]

Multi-turn — title + deadline given, priority missing:
User: "create task Automation tool deadline 19 June"
You: Got it — *Automation tool* due *19 Jun 2026, 09:00 AM*. What's the priority? (low / medium / high / urgent)
User: "medium"
You: I'll create task *Automation tool* due *19 Jun 2026, 09:00 AM* with *medium* priority. Go ahead? (Yes / No)
User: "yes"
You: [call create_task(title="Automation tool", deadline="2026-06-19 09:00", priority="medium")]

Field update (ALWAYS bold both the task name AND the field name):
User: "update the assigned to of Design Review to Rahul"
You: I'll update *Design Review* — set *assignee* to *Rahul*. Go ahead? (Yes / No)
User: "change the title of Fix Bug to Fix Login Bug"
You: I'll update *Fix Bug* — set *title* to *Fix Login Bug*. Go ahead? (Yes / No)
User: "update deadline of Fix Bug to tomorrow 3pm"
You: I'll update *Fix Bug* — set *deadline* to *2 Jul 2026, 03:00 PM*. Go ahead? (Yes / No)

Read-only query:
User: "list my tasks"
You: [call list_tasks(), return result verbatim]

Get task details (read-only, call immediately, no confirmation):
User: "What's the status of Fix login bug?" / "details of automation task" / "show me the design review task"
You: [call get_task_details(task_title="Fix login bug"), return result verbatim]
${isPrivileged ? `
Assign task to a team member:
User: "Assign website redesign to Priya"
You: I'll assign *Website redesign* to *Priya*. Go ahead? (Yes / No)
User: "yes"
You: [call assign_task(task_title="Website redesign", assignee="Priya")]
` : ''}
Setting due date on an existing task:
User: "What's the due date of X?"
Bot: [call get_task_details → sees no deadline] "No due date set. Do you want to add one?"
User: "Yes, for tomorrow"
Bot: I'll update *X* — set *deadline* to *17 Jun 2026*. Go ahead? (Yes / No)
← ALWAYS use update_task here. NEVER call create_task for an already-existing task.

## IMPORTANT: Never use example text as real data
If the user says something like "e.g. Review quarterly report – 20 Jun" they are showing an EXAMPLE FORMAT, not providing the actual task details. Ask them for the real title, deadline (date & time), and priority.

## Language
Match the user — English, Hindi, or Hinglish.`;
}

// ─── Master agent entry point ─────────────────────────────────────────────────

export async function runMasterAgent(
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
    const history: ChatMessage[] = (recent_messages ?? [])
      .filter((m: any) => m.role !== 'system' && m.content?.trim())
      .map((m: any) => ({
        role:    (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content as string,
      }));

    const reply = await runGroqLoop(message, history, user, orgId, context, conversation_id);
    const finalReply = reply || 'What else can I help you with?';

    // Persist context_state based on what the reply contains:
    // - "Go ahead? (Yes / No)"  → CONFIRMING with stored payload (fast next-turn)
    // - anything else           → reset to IDLE (clear stale flow state)
    const isConfirmPrompt = /go ahead\?/i.test(finalReply) || /\(yes \/ no\)/i.test(finalReply);
    if (isConfirmPrompt) {
      const parsed = parseConfirmationMessage(finalReply);
      if (parsed) {
        saveContext(conversation_id, {
          ...EMPTY_CONTEXT,
          language:        context.language,
          flow_state:      'CONFIRMING',
          confirm_message: finalReply,
          confirm_payload: { tool: parsed.tool, args: parsed.args },
        }).catch(() => {});
      }
    } else if (context.flow_state !== 'IDLE') {
      saveContext(conversation_id, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
    }

    await saveMessage(conversation_id, orgId, 'assistant', 'outbound', finalReply, {
      latency_ms: Date.now() - start,
    }).catch(() => {});

    return {
      reply: finalReply,
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

// ─── Gemini tool-use loop ─────────────────────────────────────────────────────

async function runGroqLoop(
  message:        string,
  history:        ChatMessage[],
  user:           AgentUser,
  orgId:          string,
  context:        ConversationContext,
  conversationId: string,
): Promise<string> {

  // ── 0. Context-state shortcircuit — fastest path, zero Groq calls ─────────
  //
  // When context_state holds a stored confirmation payload (set after Groq
  // generated the last "Go ahead?" message), we execute directly from it.
  // This is 300–600ms faster than a Groq round-trip.
  if (context.flow_state === 'CONFIRMING' && context.confirm_payload) {
    const payload = context.confirm_payload as { tool: string; args: Record<string, string> };

    if (isYes(message)) {
      console.log(`[Agent] Context shortcircuit: YES → ${payload.tool}`);
      const result = await dispatchTool(payload.tool, payload.args, user, orgId);
      saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
      return result;
    }

    if (isNo(message)) {
      console.log('[Agent] Context shortcircuit: NO → cancel');
      saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
      return 'Got it, cancelled. What else can I help with? 😊';
    }

    // User sent something else (correction/clarification) — clear stored confirmation
    // so Groq can re-evaluate and generate a new one if needed.
    saveContext(conversationId, { ...EMPTY_CONTEXT, language: context.language }).catch(() => {});
  }

  // ── 1. Quick-route deterministic patterns — bypass AI entirely ────────────
  const directTool = quickRoute(message);
  if (directTool) {
    console.log(`[Agent] Quick-route: "${message}" → ${directTool}`);
    return dispatchTool(directTool, {}, user, orgId);
  }

  // "List [Name]'s tasks" / "Show [Name]'s tasks" — privileged users only
  const isPrivilegedUser = ['manager', 'hr', 'admin', 'super_admin'].includes(user.role);
  const tasksByNameMatch = message.match(
    /\b(?:list|show|get)\s+(?:of\s+)?([a-z][a-z\s]{1,30}?)(?:'s|'s|s)?\s+tasks?\b/i
  );
  if (tasksByNameMatch && isPrivilegedUser) {
    const assigneeName = tasksByNameMatch[1].trim();
    // Don't match generic terms like "all", "my", "pending"
    if (!/^(all|my|mine|our|the|any|pending|team|org|your|own|me|self)$/i.test(assigneeName)) {
      console.log(`[Agent] Name-task quick-route: "${message}" → list_tasks(assignee_name="${assigneeName}")`);
      return dispatchTool('list_tasks', { assignee_name: assigneeName }, user, orgId);
    }
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
    }
  } else if (CREATE_SHORTCUT.test(message.trim()) && history.length >= 2) {
    // User said "Create the task" but bot's last message wasn't a confirmation prompt.
    // Look in history for task details and tell AI to extract + confirm them.
    console.log(`[Agent] Create-shortcut detected ("${message}") with history — injecting context hint`);
    effectiveMessage = `${message}\n[INSTRUCTION: Look through the conversation history above. Find the task title (and deadline / priority if mentioned). If you have a title, issue a confirmation message: "I'll create task *<title>* [due *<date>*]. Go ahead? (Yes / No)". If you don't have enough details, ask for the title.]`;
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
        if (toolCalls.length === 0) return choice.message.content?.trim() || '';
        messages.push(choice.message);
        for (const call of toolCalls) {
          if (call.type !== 'function') continue;
          let args: Record<string, string> = {};
          try { args = JSON.parse(call.function.arguments); } catch { /* empty args */ }
          const output = await dispatchTool(call.function.name, args, user, orgId);
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

  if (USE_GROQ) {
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

    // Advance global index BEFORE any await so parallel requests on the same warm
    // instance read different starting positions (eliminates read-after-write races).
    const startIdx = groqKeyIndex;
    groqKeyIndex   = (startIdx + 1) % (groqClients.length || 1);

    // Try each Groq key in rotation; on 429 move to the next key
    for (let keyTry = 0; keyTry < groqClients.length; keyTry++) {
      const clientIdx = (startIdx + keyTry) % groqClients.length;
      const client    = groqClients[clientIdx];

      try {
        let resp = await client.chat.completions.create({
          model:      AI_MODEL_GROQ,
          messages:   [...groqMessages],
          tools:      groqTools,
          max_tokens: 512,
        });

        // Index was already advanced before the loop

        for (let round = 0; round < 6; round++) {
          const choice    = resp.choices[0];
          const toolCalls = (choice.message.tool_calls ?? []) as Groq.Chat.ChatCompletionMessageToolCall[];

          if (toolCalls.length === 0) return choice.message.content?.trim() || '';

          groqMessages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: toolCalls });

          for (const tc of toolCalls) {
            console.log(`[Agent] Groq[${clientIdx}] tool call: ${tc.function.name}`, tc.function.arguments);
            let args: Record<string, string> = {};
            try { args = JSON.parse(tc.function.arguments); } catch { /* empty args */ }
            const output = await dispatchTool(tc.function.name, args, user, orgId);
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

        if (status === 429 && keyTry < groqClients.length - 1) {
          console.warn(`[Agent] Groq key[${clientIdx}] rate-limited — rotating to next key`);
          continue; // try next key
        }

        console.error(`[Agent] Groq[${clientIdx}] error (status ${status}) — using free OpenRouter:`, errMsg);
        return runOpenRouterFallback();
      }
    }

    return runOpenRouterFallback();

  } else if (USE_CLAUDE) {
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
          return textBlocks.map(b => b.text).join('').trim();
        }

        // Push assistant turn with tool_use blocks
        claudeMessages.push({ role: 'assistant', content: response.content });

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

  } else if (USE_GEMINI) {
    // ── Gemini native SDK path ─────────────────────────────────────────────
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
        if (calls.length === 0) return result.response.text().trim() || '';

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

        if (toolCalls.length === 0) return choice.message.content?.trim() || '';

        orMessages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: toolCalls });

        for (const tc of toolCalls) {
          console.log(`[Agent] OR tool call: ${tc.function.name}`, tc.function.arguments);
          let args: Record<string, string> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* empty args */ }
          const output = await dispatchTool(tc.function.name, args, user, orgId);
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
};

async function dispatchTool(
  toolName: string,
  input:    Record<string, string>,
  user:     AgentUser,
  orgId:    string,
): Promise<string> {
  const intent = INTENT_MAP[toolName];
  if (!intent) return `Unknown tool: ${toolName}`;

  try {
    const { executeTool } = await import('./executor');

    const slots: Record<string, string | null> = {
      title:         input.task_title   ?? input.title         ?? null,
      assignee:      input.assignee                            ?? null,
      assignee_name: input.assignee_name                       ?? null,
      deadline:      input.deadline                            ?? null,
      priority:      input.priority                            ?? null,
      update_field:  input.update_field                        ?? null,
      update_value:  input.update_value                        ?? null,
      leave_type:    input.leave_type                          ?? null,
      start_date:    input.start_date                          ?? null,
      end_date:      input.end_date                            ?? null,
      duration_days: input.duration_days                       ?? null,
      reason:        input.reason                              ?? null,
      employee_name: input.employee_name                       ?? null,
      wa_number:     input.wa_number    ?? user.whatsapp_number ?? null,
      department:    input.department                          ?? null,
      designation:   input.designation                         ?? null,
      message:       input.message                             ?? null,
      remind_at:     input.remind_at                           ?? null,
      enabled:       input.enabled                             ?? null,
      offset:        input.offset                              ?? null,
      channel:       input.channel                             ?? null,
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
      sendUserNotifications(result.notify, orgId).catch(err => console.warn('[Agent] Notify failed:', err));
    }

    // WhatsApp hard limit: 4096 chars. Truncate gracefully.
    const reply = result.reply;
    if (reply.length > 4000) {
      return reply.slice(0, 3940) + '\n\n_...list is long. Send "more tasks" to see the next page._';
    }
    return reply;
  } catch (err) {
    console.error(`[Tool] ${toolName} failed:`, err);
    return '❌ Something went wrong with that action. Please try again.';
  }
}

// ─── Notify other users via WhatsApp ─────────────────────────────────────────

async function sendUserNotifications(
  notifications: Array<{ user_id: string; message: string }>,
  orgId: string,
): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();

  for (const notif of notifications) {
    try {
      const { data: u } = await db
        .from('users')
        .select('wa_number')
        .eq('id', notif.user_id)
        .eq('organization_id', orgId)
        .single();

      if (u?.wa_number) await sendText(u.wa_number, notif.message);

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
    } catch { /* non-critical */ }
  }
}
