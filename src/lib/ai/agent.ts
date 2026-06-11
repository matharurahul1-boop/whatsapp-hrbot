import Anthropic from '@anthropic-ai/sdk';
import { loadSession, saveMessage } from './memory';
import { sendText } from '@/lib/whatsapp/client';
import { EMPTY_CONTEXT } from './types';
import type { AgentTurn, AgentUser } from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tool definitions ─────────────────────────────────────────────────────────
//
// Each tool maps 1-to-1 to an executor in executor.ts.
// Claude decides which tool to call and when — no intent classification needed.

const HRBOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'daily_briefing',
    description: "Show the user's daily status: attendance check-in, task summary, pending items. Call this when they greet you (hi, hello, good morning, namaste, etc.).",
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_tasks',
    description: "List the user's pending / active tasks.",
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_task_details',
    description: 'Show full details of a specific task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_title: { type: 'string', description: 'Task title or a part of it' },
      },
      required: ['task_title'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:    { type: 'string',  description: 'Short, clear task title' },
        assignee: { type: 'string',  description: 'Assignee name, or "me" to assign to self. Omit if self.' },
        deadline: { type: 'string',  description: 'Due date as YYYY-MM-DD, optionally YYYY-MM-DD HH:MM' },
        priority: { type: 'string',  enum: ['low', 'medium', 'high', 'urgent'] },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: "Update a task's deadline, priority, assignee, or status.",
    input_schema: {
      type: 'object' as const,
      properties: {
        task_title:   { type: 'string', description: 'Title (or part) of the task to update' },
        update_field: { type: 'string', enum: ['deadline', 'priority', 'assignee', 'status'], description: 'Which field to change' },
        update_value: { type: 'string', description: 'New value for the field' },
      },
      required: ['task_title', 'update_field', 'update_value'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done / completed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_title: { type: 'string', description: 'Task title or part of it' },
      },
      required: ['task_title'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_title: { type: 'string' },
      },
      required: ['task_title'],
    },
  },
  {
    name: 'apply_leave',
    description: 'Apply for leave.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leave_type: { type: 'string', enum: ['casual', 'sick', 'annual', 'maternity'] },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date:   { type: 'string', description: 'YYYY-MM-DD — omit if single day' },
        reason:     { type: 'string', description: 'Optional reason' },
      },
      required: ['leave_type', 'start_date'],
    },
  },
  {
    name: 'check_leave_balance',
    description: 'Show the remaining leave balance for the current year.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'list_leaves',
    description: 'List leave requests.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'approve_leave',
    description: 'Approve a leave request (managers / HR only).',
    input_schema: {
      type: 'object' as const,
      properties: {
        employee_name: { type: 'string', description: 'Employee whose leave to approve' },
      },
      required: ['employee_name'],
    },
  },
  {
    name: 'reject_leave',
    description: 'Reject a leave request (managers / HR only).',
    input_schema: {
      type: 'object' as const,
      properties: {
        employee_name: { type: 'string' },
        reason:        { type: 'string', description: 'Optional reason for rejection' },
      },
      required: ['employee_name'],
    },
  },
  {
    name: 'cancel_leave',
    description: "Cancel one of the user's own leave requests.",
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD start date of the leave to cancel' },
      },
      required: ['start_date'],
    },
  },
  {
    name: 'check_in',
    description: 'Mark attendance check-in for today.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'check_out',
    description: 'Mark attendance check-out for today.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'my_attendance',
    description: "Show the user's own attendance report for the last 7 days.",
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'team_attendance',
    description: 'Show team attendance for today (managers / HR only).',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'start_onboarding',
    description: 'Onboard a new employee (HR / admin only).',
    input_schema: {
      type: 'object' as const,
      properties: {
        employee_name: { type: 'string', description: 'Full name of the new employee' },
        wa_number:     { type: 'string', description: 'WhatsApp number with country code, e.g. +919876543210' },
        department:    { type: 'string', description: 'Department (optional)' },
        designation:   { type: 'string', description: 'Job title / designation (optional)' },
      },
      required: ['employee_name', 'wa_number'],
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

  return `You are HRBot — a smart, friendly HR assistant for a company, talking to employees over WhatsApp.

## Who you are talking to
- Name: ${user.full_name} (address them by first name: ${user.first_name})
- Role: ${user.role}${isManager ? ' (can approve/reject leave, manage team tasks)' : ''}
- Department: ${user.department ?? 'Not specified'}
- Today: ${today}, ${time} IST

## Personality & style
Respond like a knowledgeable, warm colleague — not a robot filling out a form.
- Read the conversation history carefully. If you already know the task title, assignee, or any detail from earlier in the chat, USE it — don't ask again.
- Understand natural references: "same task", "it", "that one", "the one we just created", "also", "update the assigned to" (= update the assignee), etc.
- If you need more info, ask ONE clear question — never a list of questions at once.
- Keep replies short: 1-4 lines for simple things, longer only when listing data.
- WhatsApp formatting: *bold* for task names, field names, and key values. Emojis where natural (✅ ❌ 📋 ⏰ 👤 📅 🔴 🟠 🟡 🟢).

## Confirmation before actions — MANDATORY
Before calling any action tool (create_task, update_task, complete_task, delete_task, apply_leave, approve_leave, reject_leave, cancel_leave, start_onboarding, check_in, check_out):
1. Write one clear line describing exactly what you will do, using *bold* for the key values.
2. End with "Go ahead? (Yes/No)" or "Shall I go ahead?"
3. Wait for the user to confirm — do NOT call the tool until they say yes.

Read-only tools call immediately (no confirmation needed):
daily_briefing, list_tasks, get_task_details, check_leave_balance, list_leaves, my_attendance, team_attendance

## Greeting
When user says hi / hello / good morning / namaste or any greeting → call daily_briefing immediately.

## Permissions
- Employees can only update a task's *status* (not priority, deadline, or assignee). If they try, explain politely and suggest asking their manager.
- Only managers / HR can approve or reject leave requests, or view team attendance.
- Never invent employee names, task titles, leave balances, or any company data.
- If a task or person is not found, say so clearly and ask the user to double-check the name.

## Language
Match the user's language — English or Hindi/Hinglish.`;
}

// ─── Master agent entry point ─────────────────────────────────────────────────

export async function runMasterAgent(
  message: string,
  waNumber: string,
  orgId: string,
): Promise<AgentTurn> {
  const start = Date.now();

  // Load session (user identity + recent conversation)
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
    // Build Claude message history from recent conversation
    const history: Anthropic.MessageParam[] = (recent_messages ?? [])
      .filter((m: any) => m.role !== 'system' && m.content?.trim())
      .map((m: any) => ({
        role:    (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content as string,
      }));

    const reply = await runClaudeLoop(message, history, user, orgId);
    const finalReply = reply || "What else can I help you with?";

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

// ─── Claude tool-use loop ─────────────────────────────────────────────────────
//
// Claude reads the full conversation, decides what to do, and either:
//   a) Responds with a question / confirmation (end_turn — no tool call)
//   b) Calls a tool → we execute it → Claude formats the final reply
//
// The loop runs until Claude produces a text-only response (end_turn).

async function runClaudeLoop(
  message:  string,
  history:  Anthropic.MessageParam[],
  user:     AgentUser,
  orgId:    string,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: message },
  ];

  for (let round = 0; round < 6; round++) {
    const response = await anthropic.messages.create({
      model:      'claude-3-5-haiku-20241022',
      max_tokens: 1000,
      system:     buildSystemPrompt(user),
      tools:      HRBOT_TOOLS,
      messages,
    });

    // Pure text reply — return it
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((c) => c.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text.trim() : '';
    }

    // Tool call(s) — execute them and feed results back to Claude
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const toolOutput = await dispatchTool(
          block.name,
          block.input as Record<string, string>,
          user,
          orgId,
        );
        results.push({ type: 'tool_result', tool_use_id: block.id, content: toolOutput });
      }

      messages.push({ role: 'user', content: results });
      continue; // loop → Claude formulates final reply
    }

    break; // unexpected stop_reason
  }

  return 'I had trouble processing that — please try again.';
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────
//
// Maps Claude's tool_use call to the existing executor.ts functions.
// executor.ts handles all DB logic; nothing changes there.

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

    // Normalise Claude's tool input into the slot map the executor expects
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
    return '❌ Something went wrong. Please try again.';
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
    } catch { /* non-critical — don't fail the main flow */ }
  }
}
