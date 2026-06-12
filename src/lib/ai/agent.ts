import Groq from 'groq-sdk';
import { loadSession, saveMessage } from './memory';
import { sendText } from '@/lib/whatsapp/client';
import { EMPTY_CONTEXT } from './types';
import type { AgentTurn, AgentUser } from './types';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

type GroqMessage = Groq.Chat.ChatCompletionMessageParam;
type GroqTool    = Groq.Chat.ChatCompletionTool;

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

// ─── Tool definitions (OpenAI / Groq function-calling format) ─────────────────

const HRBOT_TOOLS: GroqTool[] = [
  {
    type: 'function',
    function: {
      name: 'daily_briefing',
      description: "Show the user's daily status: attendance, task summary, pending items. Call ONLY for greetings (hi, hello, good morning, namaste, etc.).",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: "List the user's pending / active tasks.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_task_details',
      description: 'Show full details of a specific task.',
      parameters: {
        type: 'object',
        properties: {
          task_title: { type: 'string', description: 'Task title or a part of it' },
        },
        required: ['task_title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new task. Only call AFTER the user confirms.',
      parameters: {
        type: 'object',
        properties: {
          title:    { type: 'string',  description: 'Short, clear task title' },
          assignee: { type: 'string',  description: 'Assignee name or "me". Omit if self.' },
          deadline: { type: 'string',  description: 'Due date as YYYY-MM-DD' },
          priority: { type: 'string',  enum: ['low', 'medium', 'high', 'urgent'] },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: "Update a task's deadline, priority, assignee, or status. Only call AFTER user confirms.",
      parameters: {
        type: 'object',
        properties: {
          task_title:   { type: 'string', description: 'Title (or part) of the task to update' },
          update_field: { type: 'string', enum: ['deadline', 'priority', 'assignee', 'status'] },
          update_value: { type: 'string', description: 'New value for the field' },
        },
        required: ['task_title', 'update_field', 'update_value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark a task as completed. Only call AFTER user confirms.',
      parameters: {
        type: 'object',
        properties: {
          task_title: { type: 'string', description: 'Task title or part of it' },
        },
        required: ['task_title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Delete a task. Only call AFTER user confirms.',
      parameters: {
        type: 'object',
        properties: {
          task_title: { type: 'string' },
        },
        required: ['task_title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_leave',
      description: 'Apply for leave. Only call AFTER user confirms.',
      parameters: {
        type: 'object',
        properties: {
          leave_type: { type: 'string', enum: ['casual', 'sick', 'annual', 'maternity'] },
          start_date: { type: 'string', description: 'YYYY-MM-DD' },
          end_date:   { type: 'string', description: 'YYYY-MM-DD — omit if single day' },
          reason:     { type: 'string', description: 'Optional reason' },
        },
        required: ['leave_type', 'start_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_leave_balance',
      description: 'Show remaining leave balance.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_leaves',
      description: 'List leave requests.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_leave',
      description: 'Approve a leave request (managers / HR only). Only call AFTER user confirms.',
      parameters: {
        type: 'object',
        properties: {
          employee_name: { type: 'string' },
        },
        required: ['employee_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reject_leave',
      description: 'Reject a leave request (managers / HR only). Only call AFTER user confirms.',
      parameters: {
        type: 'object',
        properties: {
          employee_name: { type: 'string' },
          reason:        { type: 'string' },
        },
        required: ['employee_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_leave',
      description: "Cancel the user's own leave request. Only call AFTER user confirms.",
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'YYYY-MM-DD start date of the leave to cancel' },
        },
        required: ['start_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_in',
      description: 'Mark attendance check-in for today. Only call AFTER user confirms.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_out',
      description: 'Mark attendance check-out for today. Only call AFTER user confirms.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'my_attendance',
      description: "Show the user's attendance report.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'team_attendance',
      description: 'Show team attendance for today (managers / HR only).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_onboarding',
      description: 'Onboard a new employee (HR / admin only). Only call AFTER user confirms.',
      parameters: {
        type: 'object',
        properties: {
          employee_name: { type: 'string' },
          wa_number:     { type: 'string', description: 'WhatsApp number with country code, e.g. +919876543210' },
          department:    { type: 'string' },
          designation:   { type: 'string' },
        },
        required: ['employee_name', 'wa_number'],
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
  const isManager = ['manager', 'hr', 'admin', 'super_admin'].includes(user.role);

  return `You are HRBot — a smart, friendly HR assistant talking to employees over WhatsApp.

## User
- Name: ${user.full_name} (call them: ${user.first_name})
- Role: ${user.role}${isManager ? ' (manager — can approve/reject leave, view team)' : ''}
- Department: ${user.department ?? 'Not specified'}
- Today: ${today}, ${time} IST

## How to respond
- Be warm and direct like a helpful colleague, not a form-filling robot.
- Read conversation history. If a task title or detail was mentioned earlier, use it — never ask again.
- Understand natural references: "same task", "it", "that one", "update the assigned to" = update assignee.
- Ask ONE question at a time if you need info.
- Keep replies concise. *bold* for task names and key values. Emojis naturally (✅ ❌ 📋 ⏰ 👤 📅).

## CRITICAL: Tool output rule
When a tool returns a result, send it back EXACTLY as-is — no summarising, no rephrasing, no added questions.
The tool text IS the complete reply.

## CRITICAL: Confirmation rule
For every action tool (create_task, update_task, complete_task, delete_task, apply_leave, approve_leave,
reject_leave, cancel_leave, start_onboarding, check_in, check_out):
1. First reply with one sentence describing what you'll do (bold the key values).
2. End with "Go ahead? (Yes / No)"
3. Only call the tool AFTER the user says Yes / Haan / Sure / Ok / Confirm.
4. If user says No / Nahi / Cancel → say "Got it, cancelled. What else can I help with?"

## Read-only tools — call immediately, NO confirmation needed:
daily_briefing, list_tasks, get_task_details, check_leave_balance, list_leaves, my_attendance, team_attendance

## Examples
User: "create a task Fix login bug due tomorrow priority high"
You: I'll create task *Fix login bug* with *high* priority due *tomorrow*. Go ahead? (Yes / No)

User: "yes"
You: [call create_task]

User: "update the assigned to of Design Review to Rahul"
You: I'll update *Design Review* — set *assignee* to *Rahul*. Go ahead? (Yes / No)

User: "list my tasks"
You: [call list_tasks, return result verbatim]

## Permissions
- Regular employees can only change task *status*. For other fields, suggest asking their manager.
- Only managers/HR can approve/reject leave or view team attendance.
- Never invent data. If something is not found, say so clearly.

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
    const history: GroqMessage[] = (recent_messages ?? [])
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
    const errReply = '⚠️ Something went wrong. Please try again in a moment.';
    await saveMessage(conversation_id, orgId, 'assistant', 'outbound', errReply).catch(() => {});
    return { reply: errReply, new_context: EMPTY_CONTEXT };
  }
}

// ─── Groq tool-use loop ───────────────────────────────────────────────────────

async function runGroqLoop(
  message: string,
  history: GroqMessage[],
  user:    AgentUser,
  orgId:   string,
): Promise<string> {

  // ── 1. Quick-route deterministic patterns — bypass AI entirely ────────────
  const directTool = quickRoute(message);
  if (directTool) {
    console.log(`[Agent] Quick-route: "${message}" → ${directTool}`);
    return dispatchTool(directTool, {}, user, orgId);
  }

  // ── 2. AI loop for everything else ────────────────────────────────────────
  const messages: GroqMessage[] = [
    { role: 'system', content: buildSystemPrompt(user) },
    ...history,
    { role: 'user', content: message },
  ];

  for (let round = 0; round < 6; round++) {
    const response = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      max_tokens:  1024,
      tools:       HRBOT_TOOLS,
      tool_choice: 'auto',
      messages,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const { finish_reason, message: assistantMsg } = choice;

    // Text reply (confirmation question, clarification, or final answer)
    if (finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
      return assistantMsg.content?.trim() ?? '';
    }

    // Tool calls — execute and feed results back
    if (finish_reason === 'tool_calls') {
      messages.push(assistantMsg as GroqMessage);

      for (const toolCall of assistantMsg.tool_calls!) {
        let toolInput: Record<string, string> = {};
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          if (parsed && typeof parsed === 'object') toolInput = parsed;
        } catch { /* malformed args — use empty */ }

        console.log(`[Agent] Tool call: ${toolCall.function.name}`, toolInput);

        const toolOutput = await dispatchTool(
          toolCall.function.name,
          toolInput,
          user,
          orgId,
        );

        messages.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          content:      toolOutput,
        });
      }
      continue;
    }

    break;
  }

  return 'I had trouble processing that — please try again.';
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
  start_onboarding:    'START_ONBOARDING',
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
