import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { loadSession, saveMessage } from './memory';
import { sendText } from '@/lib/whatsapp/client';
import { EMPTY_CONTEXT } from './types';
import type { AgentTurn, AgentUser } from './types';

// ── AI backend ────────────────────────────────────────────────────────────────
// Set USE_GEMINI=true once Google AI Studio billing is set up (unlocks 1M TPM).
// Until then, OpenRouter free tier handles traffic fine for normal use.
const USE_GEMINI = false;

const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
const openai  = new OpenAI({
  apiKey:  process.env.OPENROUTER_API_KEY ?? '',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'https://handysolver.com', 'X-Title': 'HRBot' },
});

const AI_MODEL_GEMINI = 'gemini-2.0-flash';
const AI_MODEL_OR     = 'openai/gpt-oss-20b:free';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// ─── Deterministic quick-router ───────────────────────────────────────────────
//
// For crystal-clear short patterns, bypass the AI entirely.
// This guarantees correct behaviour regardless of model quality.
// Only read-only tools here — action tools (check_in, create_task etc.)
// still go through Groq so confirmation prompts are preserved.

const QUICK_ROUTES: Array<{ re: RegExp; tool: string }> = [
  { re: /^(hi+|hey+|hello+|good\s*(morning|afternoon|evening|night)|namaste|namaskar|hlo+|hii+|greetings?)\s*[!.]*$/i, tool: 'daily_briefing' },
  { re: /^(list\s*tasks?|my\s*tasks?|show\s*tasks?|tasks?|pending\s*tasks?)$/i,                                        tool: 'list_tasks'     },
  { re: /^(leave\s*balance|my\s*leave\s*balance|leaves?\s*left|check\s*leave)$/i,                                      tool: 'check_leave_balance' },
  { re: /^(my\s*attendance|attendance\s*report|show\s*attendance|attendance)$/i,                                        tool: 'my_attendance'  },
  { re: /^(list\s*leaves?|my\s*leaves?|leave\s*requests?|leaves?)$/i,                                                  tool: 'list_leaves'    },
  { re: /^(team\s*attendance|who\s*(is\s*)?absent|absent\s*today)$/i,                                                  tool: 'team_attendance'},
  { re: /^(help|\?|commands?)$/i,                                                                                       tool: 'help'           },
];

function quickRoute(message: string): string | null {
  const t = message.trim();
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

function naturalDateToISO(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const yr = new Date().getFullYear();
  // "17th June" or "17 June"
  let m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/i);
  if (m) { const mo = MONTH_MAP[m[2].toLowerCase()]; if (mo) return `${yr}-${mo}-${m[1].padStart(2,'0')}`; }
  // "June 17" or "June 17th"
  m = t.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (m) { const mo = MONTH_MAP[m[1].toLowerCase()]; if (mo) return `${yr}-${mo}-${m[2].padStart(2,'0')}`; }
  return null;
}

// ─── Parse confirmation message → call tool directly ─────────────────────────
//
// When the user says "yes", we extract the pending action from the bot's last
// message and call the tool directly — no second Groq round-trip needed.

async function executeFromConfirmation(
  lastMsg: string,
  user:    AgentUser,
  orgId:   string,
): Promise<string | null> {
  const lower = lastMsg.toLowerCase();

  // CREATE_TASK: "I'll create task *Title* ... Go ahead?"
  if (/i.?ll\s+create\s+task/i.test(lastMsg)) {
    const titleM    = lastMsg.match(/create\s+task\s+\*([^*]+)\*/i);
    if (!titleM) return null;
    const priorityM = lastMsg.match(/\*(urgent|high|medium|low)\*/i);
    const deadlineM = lastMsg.match(/due\s+\*([^*]+)\*/i);
    const args: Record<string, string> = { title: titleM[1].trim() };
    if (priorityM) args.priority = priorityM[1].toLowerCase();
    if (deadlineM) { const iso = naturalDateToISO(deadlineM[1]); if (iso) args.deadline = iso; }
    return dispatchTool('create_task', args, user, orgId);
  }

  // CHECK_IN
  if (lower.includes('check-in') || lower.includes('check in') || lower.includes('mark your attendance')) {
    return dispatchTool('check_in', {}, user, orgId);
  }

  // CHECK_OUT
  if (lower.includes('check-out') || lower.includes('check out') || lower.includes("mark your check-out")) {
    return dispatchTool('check_out', {}, user, orgId);
  }

  // COMPLETE_TASK: "I'll mark *Title* as complete"
  const completeM = lastMsg.match(/mark\s+\*([^*]+)\*\s+as\s+complet/i);
  if (completeM) return dispatchTool('complete_task', { task_title: completeM[1].trim() }, user, orgId);

  // DELETE_TASK: "I'll delete task *Title*"
  const deleteM = lastMsg.match(/delete\s+task\s+\*([^*]+)\*/i);
  if (deleteM) return dispatchTool('delete_task', { task_title: deleteM[1].trim() }, user, orgId);

  // UPDATE_TASK: "I'll update *Title* — set *field* to *value*"
  const updateM = lastMsg.match(/update\s+\*([^*]+)\*[\s—–-]+set\s+\*([^*]+)\*\s+to\s+\*([^*]+)\*/i);
  if (updateM) {
    return dispatchTool('update_task', {
      task_title:   updateM[1].trim(),
      update_field: updateM[2].trim().toLowerCase(),
      update_value: updateM[3].trim(),
    }, user, orgId);
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
      return dispatchTool('apply_leave', args, user, orgId);
    }
  }

  // APPROVE / REJECT LEAVE
  const approveM = lastMsg.match(/approve\s+\*([^*]+)\*['']?s?\s+leave/i);
  if (approveM) return dispatchTool('approve_leave', { employee_name: approveM[1].trim() }, user, orgId);
  const rejectM  = lastMsg.match(/reject\s+\*([^*]+)\*['']?s?\s+leave/i);
  if (rejectM)  return dispatchTool('reject_leave',  { employee_name: rejectM[1].trim()  }, user, orgId);

  return null; // can't parse — fall back to Groq
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
    description: 'Create a new task. ONLY call AFTER user confirms AND you have the task title. NEVER call without a title.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title:    { type: 'STRING', description: 'Short, clear task title' },
        assignee: { type: 'STRING', description: 'Assignee name or "me". Omit if self.' },
        deadline: { type: 'STRING', description: 'Due date as YYYY-MM-DD' },
        priority: { type: 'STRING', description: 'low | medium | high | urgent' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: "Update a task's deadline, priority, assignee, or status. Only call AFTER user confirms.",
    parameters: {
      type: 'OBJECT',
      properties: {
        task_title:   { type: 'STRING', description: 'Title (or part) of the task to update' },
        update_field: { type: 'STRING', description: 'deadline | priority | assignee | status' },
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
    name: 'apply_leave',
    description: 'Apply for leave. Only call AFTER user confirms.',
    parameters: {
      type: 'OBJECT',
      properties: {
        leave_type: { type: 'STRING', description: 'casual | sick | annual | maternity' },
        start_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        end_date:   { type: 'STRING', description: 'YYYY-MM-DD — omit if single day' },
        reason:     { type: 'STRING', description: 'Optional reason' },
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
reject_leave, cancel_leave, check_in, check_out):
1. First reply with one sentence describing what you'll do (bold the key values).
2. End with "Go ahead? (Yes / No)"
3. Only call the tool AFTER the user says Yes / Haan / Sure / Ok / Confirm / "Create the task" / "Do it" / "Go ahead".
4. If user says No / Nahi / Cancel → say "Got it, cancelled. What else can I help with?"

## CRITICAL: Never lose context mid-collection
- If you just asked for task details and the user provided them, your IMMEDIATE next reply MUST be the confirmation message (e.g. "I'll create task *X* due *Y*. Go ahead? (Yes / No)"). NEVER say "What else can I help with?" at this point.
- If the previous assistant message ended with "Go ahead? (Yes / No)" and the user's new message is a confirmation word (yes, ok, sure, create the task, create it, go ahead, haan, do it, etc.) → call the tool NOW. Do NOT ask for confirmation again.

## Read-only tools — call immediately, NO confirmation needed:
daily_briefing, list_tasks, get_task_details, check_leave_balance, list_leaves, my_attendance${isPrivileged ? ', team_attendance, list_users' : ''}

## Asking for tasks by person (managers/admins only)
- "List Pranay's tasks" → call list_tasks(assignee_name="Pranay")
- "Show Tushar's tasks" → call list_tasks(assignee_name="Tushar")
- "List all tasks" / "show all org tasks" → call list_tasks() with NO assignee_name

## Examples

Single-turn task creation:
User: "create a task Fix login bug due tomorrow priority high"
You: I'll create task *Fix login bug* with *high* priority due *tomorrow*. Go ahead? (Yes / No)
User: "yes"
You: [call create_task(title="Fix login bug", deadline="<tomorrow's date>", priority="high")]

Multi-turn task creation:
User: "I want to create a task" OR "let's create one" OR "create another one"
You: Sure! What's the task *title* and *deadline*? 📝
User: "Title is Automation tool and deadline is 19 June"
You: I'll create task *Automation tool* due *June 19, 2026*. Go ahead? (Yes / No)
User: "Create the task"  ← this IS the confirmation
You: [call create_task(title="Automation tool", deadline="2026-06-19")]

Field update:
User: "update the assigned to of Design Review to Rahul"
You: I'll update *Design Review* — set *assignee* to *Rahul*. Go ahead? (Yes / No)

Read-only query:
User: "list my tasks"
You: [call list_tasks(), return result verbatim]

Setting due date on an existing task:
User: "What's the due date of X?"
Bot: [call get_task_details → sees no deadline] "No due date set. Do you want to add one?"
User: "Yes, for tomorrow"
Bot: I'll update *X* — set *deadline* to *17 Jun 2026*. Go ahead? (Yes / No)
← ALWAYS use update_task here. NEVER call create_task for an already-existing task.

## IMPORTANT: Never use example text as real data
If the user says something like "e.g. Review quarterly report – 20 Jun" they are showing an EXAMPLE FORMAT, not providing the actual task details. Ask them for the real title and deadline.

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

  const { user, conversation_id, recent_messages } = session;

  await saveMessage(conversation_id, orgId, 'user', 'inbound', message).catch(() => {});

  try {
    const history: ChatMessage[] = (recent_messages ?? [])
      .filter((m: any) => m.role !== 'system' && m.content?.trim())
      .map((m: any) => ({
        role:    (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content as string,
      }));

    const reply = await runGroqLoop(message, history, user, orgId);
    const finalReply = reply || 'What else can I help you with?';

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
  message: string,
  history: ChatMessage[],
  user:    AgentUser,
  orgId:   string,
): Promise<string> {

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
    if (!/^(all|my|our|the|any|pending|team|org|your)$/i.test(assigneeName)) {
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

  if (USE_GEMINI) {
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
    // ── OpenRouter path (active while Gemini billing isn't set up) ─────────
    // Gemini uses UPPERCASE type names; OpenAI/JSON-Schema needs lowercase.
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
      deadline:      input.deadline                            ?? null,
      priority:      input.priority                            ?? null,
      update_field:  input.update_field                        ?? null,
      update_value:  input.update_value                        ?? null,
      leave_type:    input.leave_type                          ?? null,
      start_date:    input.start_date                          ?? null,
      end_date:      input.end_date                            ?? null,
      reason:        input.reason                              ?? null,
      employee_name: input.employee_name                       ?? null,
      wa_number:     input.wa_number                           ?? null,
      department:    input.department                          ?? null,
      designation:   input.designation                         ?? null,
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
      sendUserNotifications(result.notify, orgId).catch(() => {});
    }

    return result.reply;
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
