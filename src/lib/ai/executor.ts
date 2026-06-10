import Anthropic                from '@anthropic-ai/sdk';
import { createAdminClient }   from '@/lib/supabase/admin';
import { writeAuditLog }       from '@/lib/utils/audit';
import { formatDate, calcBusinessDays } from '@/lib/utils/date';
import { generateEmployeeId }  from '@/lib/utils/employee-id';
import { n8n }                 from '@/lib/n8n/trigger';
import { REPLIES, NOTIFICATIONS } from './prompts/responses';
import {
  notifyTaskAssigned,
  notifyTaskCompleted,
  notifyLeaveDecision,
  notifyWelcome,
} from '@/lib/whatsapp/notify';
import type { ToolInput, ToolResult, AgentIntent, SlotValues } from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tool Executor Registry ───────────────────────────────────────────────────

export async function executeTool(input: ToolInput): Promise<ToolResult> {
  const executor = TOOL_MAP[input.intent];

  if (!executor) {
    return {
      success: false,
      reply: REPLIES.error((input.slots._lang as 'en' | 'hi') ?? 'en'),
    };
  }

  try {
    return await executor(input);
  } catch (err: unknown) {
    console.error(`[Executor] ${input.intent} failed:`, err);
    return {
      success: false,
      reply: REPLIES.error('en'),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getISTHour(): number {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours();
}

function priorityEmoji(p: string | null): string {
  if (!p) return '⚪';
  const map: Record<string, string> = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  return map[p.toLowerCase()] ?? '⚪';
}

// ─── Tool Map ─────────────────────────────────────────────────────────────────

const TOOL_MAP: Partial<Record<AgentIntent, (input: ToolInput) => Promise<ToolResult>>> = {

  // ── GREETING — Smart daily briefing ────────────────────────────────────────
  async GREETING({ user_id, user_name, slots, org_id, user_role }): Promise<ToolResult> {
    const db    = createAdminClient();
    const lang  = (slots._lang as 'en' | 'hi') ?? 'en';
    const today = new Date().toISOString().split('T')[0];
    const hour  = getISTHour();
    const firstName = (user_name ?? 'there').split(' ')[0];

    // Parallel DB queries for speed
    const [tasksRes, attendanceRes, leaveRes] = await Promise.all([
      db.from('tasks')
        .select('id, title, status, deadline, priority')
        .eq('organization_id', org_id)
        .eq('assignee_id', user_id)
        .neq('status', 'completed')
        .is('deleted_at', null)
        .order('deadline', { ascending: true, nullsFirst: false })
        .limit(6),
      db.from('attendance_records')
        .select('check_in_time, check_out_time, status')
        .eq('employee_id', user_id)
        .eq('date', today)
        .maybeSingle(),
      db.from('leave_requests')
        .select('id, status, start_date')
        .eq('employee_id', user_id)
        .eq('status', 'pending')
        .limit(1),
    ]);

    const tasks      = tasksRes.data ?? [];
    const attendance = attendanceRes.data;
    const pendingLeave = leaveRes.data ?? [];

    const overdue   = tasks.filter((t: any) => t.deadline && t.deadline < today);
    const dueToday  = tasks.filter((t: any) => t.deadline === today);
    const upcoming  = tasks.filter((t: any) => !t.deadline || t.deadline > today);

    // Time greeting
    let emoji = '🌅'; let greeting = 'Good morning';
    if (hour >= 12 && hour < 17) { emoji = '☀️'; greeting = 'Good afternoon'; }
    else if (hour >= 17)          { emoji = '🌙'; greeting = 'Good evening'; }

    const lines: string[] = [];
    lines.push(`${emoji} *${greeting}, ${firstName}!*`);
    lines.push('');

    // ── Attendance ──
    if (!attendance?.check_in_time) {
      lines.push(`📍 *Attendance:* Not checked in yet`);
      lines.push(`_Send "checkin" to mark your attendance_`);
    } else if (attendance.check_out_time) {
      const cin  = new Date(attendance.check_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      const cout = new Date(attendance.check_out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      lines.push(`✅ *Attendance:* ${cin} → ${cout}`);
    } else {
      const cin = new Date(attendance.check_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      lines.push(`✅ *Attendance:* Checked in at ${cin}`);
    }
    lines.push('');

    // ── Tasks ──
    if (overdue.length > 0) {
      lines.push(`🔴 *Overdue (${overdue.length}):*`);
      (overdue as any[]).slice(0, 2).forEach((t) => lines.push(`  • ${t.title}`));
      if (overdue.length > 2) lines.push(`  _...and ${overdue.length - 2} more_`);
      lines.push('');
    }
    if (dueToday.length > 0) {
      lines.push(`📋 *Due today (${dueToday.length}):*`);
      (dueToday as any[]).slice(0, 2).forEach((t) => lines.push(`  • ${t.title}`));
      lines.push('');
    }
    if (overdue.length === 0 && dueToday.length === 0) {
      if (upcoming.length > 0) {
        lines.push(`📋 *${upcoming.length} upcoming task${upcoming.length > 1 ? 's' : ''}* — you're on track! 🎯`);
      } else {
        lines.push(`✨ *No pending tasks* — you're all caught up!`);
      }
      lines.push('');
    }

    // ── Pending leave ──
    if (pendingLeave.length > 0) {
      lines.push(`⏳ You have a *pending leave request* awaiting approval`);
      lines.push('');
    }

    lines.push(`💬 *What can I help you with?*`);
    lines.push(`Type *help* to see all commands.`);

    return { success: true, reply: lines.join('\n') };
  },

  // ── HELP — Role-aware command guide ────────────────────────────────────────
  async HELP({ user_role, slots }): Promise<ToolResult> {
    const lang      = (slots._lang as 'en' | 'hi') ?? 'en';
    const isManager = ['manager', 'hr', 'admin', 'super_admin'].includes(user_role);
    const isHR      = ['hr', 'admin', 'super_admin'].includes(user_role);

    if (lang === 'hi') {
      let msg = `📖 *HRBot — मैं क्या कर सकता हूं:*\n\n`;
      msg += `*⏰ हाजिरी:*\n"checkin" — उपस्थिति दर्ज करें\n"checkout" — जाने का समय दर्ज करें\n"मेरी हाजिरी दिखाओ"\n\n`;
      msg += `*📋 टास्क:*\n"call client का टास्क बनाओ"\n"मेरे सभी टास्क दिखाओ"\n"website टास्क complete किया"\n`;
      if (isManager) msg += `"Rahul को design टास्क दो"\n`;
      msg += `\n*📅 छुट्टी:*\n"कल casual leave चाहिए"\n"मेरा leave balance बताओ"\n"मेरी leave requests"\n`;
      if (isManager) msg += `"Rahul की leave approve करो"\n"Rahul की leave reject करो"\n`;
      if (isHR)      msg += `\n*👤 ऑनबोर्डिंग:*\n"Rahul Kumar को onboard करो +91XXXXXXXXXX"\n`;
      msg += `\n_कोई भी HR सवाल पूछें — मैं जवाब देने की कोशिश करूंगा!_`;
      return { success: true, reply: msg };
    }

    let msg = `📖 *HRBot — Here's what I can do:*\n\n`;
    msg += `*⏰ Attendance:*\n"checkin" — mark your arrival\n"checkout" — mark your departure\n"my attendance report"\n\n`;
    msg += `*📋 Tasks:*\n"Create task call client by Friday"\n"Show my pending tasks"\n"Mark website task complete"\n`;
    if (isManager) msg += `"Assign design task to Rahul"\n`;
    msg += `\n*📅 Leave:*\n"Apply for sick leave tomorrow"\n"Check my leave balance"\n"My leave requests"\n`;
    if (isManager) msg += `"Approve leave for Rahul"\n"Reject Priya's leave"\n`;
    if (isHR)      msg += `\n*👤 Onboarding:*\n"Onboard new employee Rahul Kumar +91XXXXXXXXXX"\n`;
    msg += `\n_Ask me anything in plain English — I'll do my best to help!_ 🤖`;
    return { success: true, reply: msg };
  },

  // ── UNKNOWN — Claude AI general handler ────────────────────────────────────
  async UNKNOWN({ slots, user_id, org_id, user_role, user_name, user_department, raw_message }): Promise<ToolResult> {
    const lang    = (slots._lang as 'en' | 'hi') ?? 'en';
    const message = raw_message?.trim() ?? '';

    if (!message) {
      return { success: true, reply: REPLIES.help(user_role, lang) };
    }

    const systemPrompt = `You are HRBot — a professional, friendly AI HR assistant for a company, responding via WhatsApp.

Employee context:
- Name: ${user_name ?? 'Employee'}
- Role: ${user_role}
- Department: ${user_department ?? 'Not specified'}
- Today: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}

WhatsApp formatting rules — use these:
- *bold* for important words
- _italic_ for hints/tips
- Line breaks for readability
- Relevant emojis (1-2 per message max)

Capabilities you have (tell them to type these):
- "checkin" / "checkout" — attendance
- "my tasks" — view pending tasks
- "create task [title]" — create a task
- "apply [type] leave [date]" — apply for leave
- "my leave balance" — check leave days
- "help" — full command list

Rules:
- Be concise: max 4 sentences or equivalent
- For specific actions, tell them to type the command
- Do NOT make up company data (leave balances, policies, team names)
- If you don't know, say so and suggest they contact HR
- Respond in ${lang === 'hi' ? 'Hindi' : 'English'}`;

    try {
      const response = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 350,
        temperature: 0.6,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: message }],
      });

      const reply = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : REPLIES.help(user_role, lang);

      return { success: true, reply };
    } catch (err) {
      console.error('[Executor] UNKNOWN/AI handler failed:', err);
      return { success: true, reply: REPLIES.help(user_role, lang) };
    }
  },

  // ── TASK TOOLS ──────────────────────────────────────────────────────────────

  async CREATE_TASK({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let assignedTo   = user_id;
    let assigneeName = lang === 'hi' ? 'आप' : 'You';

    if (slots.assignee && slots.assignee.toLowerCase() !== 'me') {
      const { data: found } = await db
        .from('users')
        .select('id, full_name')
        .eq('organization_id', org_id)
        .ilike('full_name', `%${slots.assignee}%`)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (found) {
        assignedTo   = found.id;
        assigneeName = found.full_name;
      }
    }

    let dueDate: string | null = null;
    let dueTime: string | null = null;
    if (slots.deadline) {
      const parts = slots.deadline.split(' ');
      dueDate = parts[0];
      dueTime = parts[1] ?? null;
    }

    const { data: task, error } = await db
      .from('tasks')
      .insert({
        organization_id: org_id,
        title:           slots.title!,
        assignee_id:     assignedTo,
        assigned_by:     user_id,
        deadline:        dueDate,
        due_time:        dueTime,
        priority:        (slots.priority as string) ?? 'medium',
        status:          'todo',
        source:          'whatsapp',
      })
      .select()
      .single();

    if (error) throw error;

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'CREATE_TASK', table_name: 'tasks',
      record_id: task.id, new_data: task, source: 'whatsapp',
    });

    const notify = assignedTo !== user_id ? [{
      user_id: assignedTo,
      message: NOTIFICATIONS.taskAssigned('your colleague', slots.title!, dueDate),
    }] : [];

    n8n.notifyTaskAssigned(org_id, task.id, assignedTo).catch(() => {});

    return {
      success: true,
      reply:   REPLIES.taskCreated(slots.title!, assigneeName, dueDate ? formatDate(dueDate) : null, slots.priority as string ?? 'medium', lang),
      notify,
    };
  },

  async LIST_TASKS({ org_id, user_id, user_role, slots, user_name }): Promise<ToolResult> {
    const db    = createAdminClient();
    const lang  = (slots._lang as 'en' | 'hi') ?? 'en';
    const today = new Date().toISOString().split('T')[0];

    let query = db
      .from('tasks')
      .select(`id, title, status, deadline, priority, assignee_id:users!tasks_assignee_id_fkey(full_name)`)
      .eq('organization_id', org_id)
      .is('deleted_at', null)
      .neq('status', 'completed')
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(10);

    if (user_role === 'employee') {
      query = query.eq('assignee_id', user_id);
    }

    const { data: tasks } = await query;

    if (!tasks?.length) {
      return {
        success: true,
        reply: lang === 'hi'
          ? `📋 कोई पेंडिंग टास्क नहीं। शानदार काम! 🎉`
          : `📋 No pending tasks — you're all caught up! 🎉`,
      };
    }

    const overdue  = (tasks as any[]).filter((t) => t.deadline && t.deadline < today);
    const dueToday = (tasks as any[]).filter((t) => t.deadline === today);
    const rest     = (tasks as any[]).filter((t) => !t.deadline || t.deadline > today);

    const formatTask = (t: any, i: number) => {
      const pEmoji  = priorityEmoji(t.priority);
      const due     = t.deadline ? ` — ${formatDate(t.deadline)}` : '';
      const assignee = user_role !== 'employee' && t.assignee_id?.full_name ? ` _(${t.assigned_to.full_name})_` : '';
      return `${i + 1}. ${pEmoji} *${t.title}*${due}${assignee}`;
    };

    const lines: string[] = [];
    const header = lang === 'hi' ? `📋 *आपके टास्क:*` : `📋 *Your tasks:*`;
    lines.push(header);

    if (overdue.length > 0) {
      lines.push('');
      lines.push(lang === 'hi' ? `🔴 *ओवरड्यू:*` : `🔴 *Overdue:*`);
      overdue.forEach((t, i) => lines.push(formatTask(t, i)));
    }

    if (dueToday.length > 0) {
      lines.push('');
      lines.push(lang === 'hi' ? `📅 *आज देय:*` : `📅 *Due today:*`);
      dueToday.forEach((t, i) => lines.push(formatTask(t, i)));
    }

    if (rest.length > 0) {
      lines.push('');
      lines.push(lang === 'hi' ? `⏳ *आगामी:*` : `⏳ *Upcoming:*`);
      rest.slice(0, 4).forEach((t, i) => lines.push(formatTask(t, i)));
    }

    lines.push('');
    lines.push(lang === 'hi' ? `_टास्क पूरा करने के लिए: "टास्क का नाम complete किया"_` : `_To complete: "mark [task name] complete"_`);

    return { success: true, reply: lines.join('\n') };
  },

  async COMPLETE_TASK({ slots, org_id, user_id, user_name }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: tasks } = await db
      .from('tasks')
      .select('id, title, created_by')
      .eq('organization_id', org_id)
      .eq('assignee_id', user_id)
      .ilike('title', `%${slots.title}%`)
      .neq('status', 'completed')
      .limit(1);

    const task = tasks?.[0] as any;
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    await db
      .from('tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', task.id);

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'COMPLETE_TASK', table_name: 'tasks',
      record_id: task.id, new_data: { status: 'completed' }, source: 'whatsapp',
    });

    // Notify creator if different from the person completing
    if (task.created_by && task.created_by !== user_id) {
      notifyTaskCompleted({
        orgId:           org_id,
        taskTitle:       task.title,
        completedByName: user_name ?? 'your team member',
        creatorId:       task.created_by,
      }).catch(() => {});
    }

    return { success: true, reply: REPLIES.taskCompleted(task.title, lang) };
  },

  async ASSIGN_TASK({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: tasks } = await db
      .from('tasks')
      .select('id, title')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .limit(1);

    const task = tasks?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    const { data: found } = await db
      .from('users').select('id, full_name')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.assignee}%`)
      .maybeSingle();

    if (!found) return { success: false, reply: REPLIES.notFound(slots.assignee!, lang) };

    // Fetch updated task details for the notification
    const { data: fullTask } = await db.from('tasks').select('priority, deadline').eq('id', task.id).single() as any;
    await db.from('tasks').update({ assignee_id: found.id }).eq('id', task.id);
    n8n.notifyTaskAssigned(org_id, task.id, found.id).catch(() => {});

    // Fetch assigner name
    const { data: assigner } = await db.from('users').select('full_name').eq('id', user_id).single();
    notifyTaskAssigned({
      orgId:       org_id,
      taskTitle:   task.title,
      priority:    (fullTask as any)?.priority ?? 'medium',
      deadline:    (fullTask as any)?.deadline ?? null,
      assigneeId:  found.id,
      creatorName: assigner?.full_name ?? 'your manager',
    }).catch(() => {});

    return {
      success: true,
      reply: lang === 'hi'
        ? `✅ *${task.title}* — ${found.full_name} को सौंप दिया गया!\n\nउन्हें WhatsApp पर सूचित किया जा रहा है।`
        : `✅ *${task.title}* has been assigned to *${found.full_name}*!\n\nThey'll be notified on WhatsApp.`,
    };
  },

  async DELETE_TASK({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: tasks } = await db
      .from('tasks')
      .select('id, title')
      .eq('organization_id', org_id)
      .eq('assignee_id', user_id)
      .ilike('title', `%${slots.title}%`)
      .limit(1);

    const task = tasks?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    await db.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', task.id);

    return {
      success: true,
      reply: lang === 'hi'
        ? `🗑️ टास्क *"${task.title}"* हटा दिया गया।`
        : `🗑️ Task *"${task.title}"* has been deleted.`,
    };
  },

  async UPDATE_TASK({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let query = db
      .from('tasks')
      .select('id, title')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .is('deleted_at', null)
      .limit(1);

    if (user_role === 'employee') query = query.eq('assignee_id', user_id);

    const { data: tasks } = await query;
    const task = (tasks as any[])?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    const patch: Record<string, unknown> = {};
    const field = slots.update_field?.toLowerCase().trim();
    const value = slots.update_value?.trim() ?? '';

    if (field === 'deadline') {
      const parts = value.split(' ');
      patch.deadline = parts[0];
      if (parts[1]) patch.due_time = parts[1];
    } else if (field === 'priority') {
      const p = value.toLowerCase();
      if (!['low', 'medium', 'high', 'urgent'].includes(p)) {
        return { success: false, reply: lang === 'hi'
          ? `❌ Priority: low / medium / high / urgent में से एक चुनें।`
          : `❌ Invalid priority. Use: low / medium / high / urgent`
        };
      }
      patch.priority = p;
    } else if (field === 'status') {
      const statusMap: Record<string, string> = {
        todo: 'todo', pending: 'todo', 'in_progress': 'in_progress', 'in progress': 'in_progress',
        completed: 'completed', complete: 'completed', done: 'completed',
        cancelled: 'cancelled', cancel: 'cancelled',
      };
      const mapped = statusMap[value.toLowerCase()];
      if (!mapped) {
        return { success: false, reply: lang === 'hi'
          ? `❌ Status: pending / in_progress / completed / cancelled`
          : `❌ Invalid status. Use: pending / in_progress / completed / cancelled`
        };
      }
      patch.status = mapped;
      if (mapped === 'completed') patch.completed_at = new Date().toISOString();
    } else if (field === 'assignee') {
      const { data: found } = await db
        .from('users')
        .select('id, full_name')
        .eq('organization_id', org_id)
        .ilike('full_name', `%${value}%`)
        .maybeSingle();
      if (!found) return { success: false, reply: REPLIES.notFound(value, lang) };
      patch.assignee_id = found.id;
    }

    if (!Object.keys(patch).length) {
      return { success: false, reply: lang === 'hi'
        ? `क्या अपडेट करना है? (deadline / priority / assignee / status)`
        : `What should I update? deadline / priority / assignee / status`
      };
    }

    patch.updated_at = new Date().toISOString();
    await db.from('tasks').update(patch).eq('id', task.id);

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'UPDATE_TASK', table_name: 'tasks',
      record_id: task.id, new_data: patch, source: 'whatsapp',
    });

    return {
      success: true,
      reply: lang === 'hi'
        ? `✅ *"${task.title}"* — ${field} अपडेट हो गया!`
        : `✅ *"${task.title}"* — ${field} updated to *${value}*!`,
    };
  },

  async SET_REMINDER({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let dueDate: string | null = null;
    let dueTime: string | null = null;
    if (slots.deadline) {
      const parts = slots.deadline.split(' ');
      dueDate = parts[0];
      dueTime = parts[1] ?? null;
    }

    const { data: task, error } = await db
      .from('tasks')
      .insert({
        organization_id: org_id,
        title:           slots.title!,
        assignee_id:     user_id,
        assigned_by:     user_id,
        deadline:        dueDate,
        due_time:        dueTime,
        priority:        'medium',
        status:          'todo',
        source:          'whatsapp',
      })
      .select()
      .single();

    if (error) throw error;

    const timeStr = dueDate
      ? `${formatDate(dueDate)}${dueTime ? ` at ${dueTime}` : ''}`
      : null;

    return {
      success: true,
      reply: lang === 'hi'
        ? `⏰ *रिमाइंडर सेट!*\n\n📋 ${slots.title!}${timeStr ? `\n🗓 ${timeStr}` : ''}`
        : `⏰ *Reminder set!*\n\n📋 ${slots.title!}${timeStr ? `\n🗓 ${timeStr}` : ''}`,
    };
  },

  async TASK_DETAILS({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let query = db
      .from('tasks')
      .select(`id, title, status, deadline, due_time, priority, description,
        assignee_id:users!tasks_assignee_id_fkey(full_name),
        assigned_by:users!tasks_assigned_by_fkey(full_name)`)
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title ?? ''}%`)
      .is('deleted_at', null)
      .limit(1);

    if (user_role === 'employee') query = query.eq('assignee_id', user_id);

    const { data: tasks } = await query;
    const t = (tasks as any[])?.[0];
    if (!t) return { success: false, reply: REPLIES.taskNotFound(slots.title ?? '', lang) };

    const statusEmoji: Record<string, string> = {
      pending: '⏳', in_progress: '🔄', completed: '✅', cancelled: '❌',
    };

    const lines = [
      `📋 *Task Details*`,
      ``,
      `*Title:* ${t.title}`,
      `*Status:* ${statusEmoji[t.status] ?? ''} ${t.status}`,
      `*Priority:* ${priorityEmoji(t.priority)} ${t.priority ?? 'medium'}`,
      t.deadline ? `*Due:* ${formatDate(t.deadline)}${t.due_time ? ` at ${t.due_time}` : ''}` : null,
      t.assignee_id?.full_name ? `*Assigned to:* ${t.assignee_id.full_name}` : null,
      t.assigned_by?.full_name ? `*Created by:* ${t.assigned_by.full_name}` : null,
      t.description ? `\n*Notes:* ${t.description}` : null,
    ].filter(Boolean);

    return { success: true, reply: lines.join('\n') };
  },

  // ── LEAVE TOOLS ─────────────────────────────────────────────────────────────

  async APPLY_LEAVE({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: leaveType } = await db
      .from('leave_types')
      .select('id, name, requires_approval, max_days_per_year')
      .eq('organization_id', org_id)
      .ilike('name', `%${slots.leave_type}%`)
      .maybeSingle();

    if (!leaveType) {
      return { success: false, reply: lang === 'hi'
        ? `❌ "${slots.leave_type}" leave type नहीं मिली। HR से संपर्क करें।`
        : `❌ Leave type *"${slots.leave_type}"* not found. Contact HR to set up leave types.`
      };
    }

    const startDate = slots.start_date!;
    let endDate = slots.end_date ?? startDate;

    if (slots.duration_days && !slots.end_date) {
      const start = new Date(startDate);
      start.setDate(start.getDate() + parseInt(slots.duration_days) - 1);
      endDate = start.toISOString().split('T')[0];
    }

    const totalDays = calcBusinessDays(startDate, endDate);
    const year = new Date(startDate).getFullYear();

    const { data: balance } = await db
      .from('leave_balances')
      .select('remaining_days')
      .eq('employee_id', user_id)
      .eq('leave_type_id', leaveType.id)
      .eq('year', year)
      .maybeSingle();

    if (balance && balance.remaining_days < totalDays) {
      return {
        success: false,
        reply: REPLIES.leaveInsufficientBalance(balance.remaining_days, totalDays, leaveType.name, lang),
      };
    }

    const reason = (slots.reason === 'SKIP' || !slots.reason) ? null : slots.reason;

    const { data: request, error } = await db
      .from('leave_requests')
      .insert({
        organization_id: org_id, employee_id: user_id,
        leave_type_id:   leaveType.id,
        start_date:      startDate, end_date: endDate,
        duration_days:   totalDays, reason,
        status:          leaveType.requires_approval ? 'pending' : 'approved',
        source:          'whatsapp',
      })
      .select().single();

    if (error) throw error;

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'APPLY_LEAVE', table_name: 'leave_requests',
      record_id: request.id, new_data: request, source: 'whatsapp',
    });

    n8n.notifyLeaveRequest(org_id, request.id).catch(() => {});

    return {
      success: true,
      reply: REPLIES.leaveApplied(leaveType.name, startDate, endDate, totalDays, leaveType.requires_approval, lang),
    };
  },

  async CHECK_LEAVE_BALANCE({ org_id, user_id, slots }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';
    const year = new Date().getFullYear();

    const { data: balances } = await db
      .from('leave_balances')
      .select('entitled_days, remaining_days, used_days, leave_types(name)')
      .eq('employee_id', user_id)
      .eq('year', year);

    if (!balances?.length) {
      return {
        success: true,
        reply: lang === 'hi'
          ? `📊 इस साल का leave balance अभी सेट नहीं हुआ है। HR से संपर्क करें।`
          : `📊 No leave balance found for ${year}. Contact HR to set up your leave entitlements.`,
      };
    }

    const lines: string[] = [];
    lines.push(lang === 'hi' ? `📊 *${year} का Leave Balance:*` : `📊 *Leave Balance — ${year}:*`);
    lines.push('');

    (balances as any[]).forEach((b) => {
      const used = b.used_days ?? (b.entitled_days - b.remaining_days);
      const bar  = '█'.repeat(Math.min(used, 10)) + '░'.repeat(Math.max(0, 10 - Math.min(used, 10)));
      lines.push(`*${b.leave_types?.name ?? 'Leave'}*`);
      lines.push(`  ${b.remaining_days} remaining of ${b.entitled_days} days`);
      lines.push(`  \`${bar}\` ${used} used`);
      lines.push('');
    });

    return { success: true, reply: lines.join('\n').trimEnd() };
  },

  async LIST_LEAVES({ org_id, user_id, user_role, slots }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let query = db
      .from('leave_requests')
      .select(`id, start_date, end_date, duration_days, status, reason,
        leave_types(name), users!leave_requests_employee_id_fkey(full_name)`)
      .eq('organization_id', org_id)
      .order('created_at', { ascending: false })
      .limit(6);

    if (user_role === 'employee') query = query.eq('employee_id', user_id);

    const { data: requests } = await query;

    if (!requests?.length) {
      return { success: true, reply: lang === 'hi' ? '📅 कोई leave request नहीं।' : '📅 No leave requests found.' };
    }

    const statusEmoji: Record<string, string> = {
      pending: '⏳', approved: '✅', rejected: '❌', cancelled: '🚫',
    };

    const lines = [lang === 'hi' ? `📅 *Leave Requests:*` : `📅 *Leave Requests:*`, ''];

    (requests as any[]).forEach((r, i) => {
      const empName = user_role !== 'employee' ? ` — ${(r.users as any)?.full_name ?? ''}` : '';
      lines.push(`${i + 1}. ${statusEmoji[r.status] ?? ''} *${(r.leave_types as any)?.name}*${empName}`);
      lines.push(`   ${formatDate(r.start_date)} → ${formatDate(r.end_date)} _(${r.duration_days}d)_`);
      if (r.reason) lines.push(`   💬 ${r.reason}`);
    });

    return { success: true, reply: lines.join('\n') };
  },

  async APPROVE_LEAVE({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('approve leave', lang) };
    }

    const { data: employee } = await db.from('users').select('id, full_name')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.employee_name}%`)
      .maybeSingle();

    if (!employee) return { success: false, reply: REPLIES.notFound(slots.employee_name!, lang) };

    const { data: request } = await db
      .from('leave_requests')
      .select('id, leave_type_id, start_date, end_date, duration_days, leave_types(name)')
      .eq('organization_id', org_id)
      .eq('employee_id', employee.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!request) {
      return { success: false, reply: lang === 'hi'
        ? `${employee.full_name} का कोई pending leave नहीं।`
        : `No pending leave request found for *${employee.full_name}*.`
      };
    }

    await db.from('leave_requests').update({
      status: 'approved', reviewed_by: user_id, reviewed_at: new Date().toISOString(),
    }).eq('id', request.id);

    n8n.notifyLeaveDecision(org_id, request.id, 'approved').catch(() => {});

    const { data: approver } = await db.from('users').select('full_name').eq('id', user_id).single();
    notifyLeaveDecision({
      orgId:         org_id,
      employeeId:    employee.id,
      action:        'approved',
      leaveTypeName: (request.leave_types as any)?.name ?? 'Leave',
      startDate:     request.start_date,
      endDate:       request.end_date,
      reviewerName:  approver?.full_name ?? 'your manager',
    }).catch(() => {});

    return {
      success: true,
      reply: REPLIES.leaveApproved(employee.full_name, (request.leave_types as any)?.name, request.start_date, request.end_date, lang),
      notify: [{
        user_id: employee.id,
        message: NOTIFICATIONS.leaveApprovedNotify(
          (request.leave_types as any)?.name, request.start_date, request.end_date, 'your manager'
        ),
      }],
    };
  },

  async REJECT_LEAVE({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('reject leave', lang) };
    }

    const { data: employee } = await db.from('users').select('id, full_name')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.employee_name}%`)
      .maybeSingle();

    if (!employee) return { success: false, reply: REPLIES.notFound(slots.employee_name!, lang) };

    const { data: request } = await db
      .from('leave_requests')
      .select('id, leave_types(name), start_date, end_date')
      .eq('organization_id', org_id)
      .eq('employee_id', employee.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!request) {
      return { success: false, reply: lang === 'hi'
        ? `${employee.full_name} का कोई pending leave नहीं।`
        : `No pending leave found for *${employee.full_name}*.`
      };
    }

    const reason = (slots.reason === 'SKIP' || !slots.reason) ? null : slots.reason;

    await db.from('leave_requests').update({
      status: 'rejected', reviewed_by: user_id, reviewed_at: new Date().toISOString(),
      remarks: reason,
    }).eq('id', request.id);

    const { data: rejecter } = await db.from('users').select('full_name').eq('id', user_id).single();
    notifyLeaveDecision({
      orgId:         org_id,
      employeeId:    employee.id,
      action:        'rejected',
      leaveTypeName: (request.leave_types as any)?.name ?? 'Leave',
      startDate:     request.start_date,
      endDate:       request.end_date,
      reviewerName:  rejecter?.full_name ?? 'your manager',
      remarks:       reason,
    }).catch(() => {});

    return {
      success: true,
      reply: REPLIES.leaveRejected(employee.full_name, (request.leave_types as any)?.name, lang),
      notify: [{
        user_id: employee.id,
        message: NOTIFICATIONS.leaveRejectedNotify((request.leave_types as any)?.name, reason),
      }],
    };
  },

  async CANCEL_LEAVE({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: request } = await db
      .from('leave_requests')
      .select('id, leave_types(name), start_date, end_date')
      .eq('organization_id', org_id)
      .eq('employee_id', user_id)
      .eq('start_date', slots.start_date!)
      .in('status', ['pending', 'approved'])
      .maybeSingle();

    if (!request) {
      return { success: false, reply: lang === 'hi'
        ? `${formatDate(slots.start_date!)} की कोई active leave नहीं मिली।`
        : `No active leave found starting *${formatDate(slots.start_date!)}*.`
      };
    }

    await db.from('leave_requests')
      .update({ status: 'cancelled' })
      .eq('id', request.id);

    return {
      success: true,
      reply: lang === 'hi'
        ? `✅ ${formatDate(request.start_date)} की *${(request.leave_types as any)?.name}* leave रद्द हो गई।`
        : `✅ Your *${(request.leave_types as any)?.name}* leave on ${formatDate(request.start_date)} has been cancelled.`,
    };
  },

  // ── ATTENDANCE TOOLS ────────────────────────────────────────────────────────

  async CHECK_IN({ org_id, user_id, slots, user_name }): Promise<ToolResult> {
    const db      = createAdminClient();
    const lang    = (slots._lang as 'en' | 'hi') ?? 'en';
    const today   = new Date().toISOString().split('T')[0];
    const now     = new Date().toISOString();
    const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    const firstName = (user_name ?? 'there').split(' ')[0];

    const { data: existing } = await db
      .from('attendance_records')
      .select('check_in_time')
      .eq('employee_id', user_id).eq('date', today)
      .maybeSingle();

    if (existing?.check_in_time) {
      const t = new Date(existing.check_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      return { success: false, reply: REPLIES.checkInAlready(t, lang) };
    }

    const { data: record, error } = await db
      .from('attendance_records')
      .upsert(
        { organization_id: org_id, employee_id: user_id, date: today, check_in_time: now, status: 'present', source: 'whatsapp' },
        { onConflict: 'employee_id,date' }
      )
      .select().single();

    if (error) throw error;

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'CHECK_IN', table_name: 'attendance_records',
      record_id: record.id, new_data: record, source: 'whatsapp',
    });

    return { success: true, reply: REPLIES.checkInSuccess(firstName, timeStr, lang) };
  },

  async CHECK_OUT({ org_id, user_id, slots, user_name }): Promise<ToolResult> {
    const db      = createAdminClient();
    const lang    = (slots._lang as 'en' | 'hi') ?? 'en';
    const today   = new Date().toISOString().split('T')[0];
    const now     = new Date().toISOString();
    const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    const firstName = (user_name ?? 'there').split(' ')[0];

    const { data: record } = await db
      .from('attendance_records')
      .select('id, check_in_time')
      .eq('employee_id', user_id).eq('date', today)
      .not('check_in_time', 'is', null)
      .is('check_out_time', null)
      .maybeSingle();

    if (!record) return { success: false, reply: REPLIES.notCheckedIn(lang) };

    const { data: updated } = await db
      .from('attendance_records')
      .update({ check_out_time: now })
      .eq('id', record.id)
      .select().maybeSingle();

    // Calculate hours worked
    const hoursWorked = record.check_in_time
      ? ((new Date(now).getTime() - new Date(record.check_in_time).getTime()) / 3600000).toFixed(1)
      : (updated as any)?.total_hours?.toFixed(1) ?? '?';

    return { success: true, reply: REPLIES.checkOutSuccess(firstName, timeStr, hoursWorked, lang) };
  },

  async MY_ATTENDANCE({ org_id, user_id, slots, user_name }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const firstName = (user_name ?? 'there').split(' ')[0];

    const { data: records } = await db
      .from('attendance_records')
      .select('date, status, check_in_time, check_out_time, total_hours')
      .eq('employee_id', user_id).eq('organization_id', org_id)
      .gte('date', since)
      .order('date', { ascending: false });

    if (!records?.length) {
      return {
        success: true,
        reply: lang === 'hi'
          ? `📊 *${firstName} जी की हाजिरी:* कोई रिकॉर्ड नहीं।`
          : `📊 No attendance records found for the last 7 days.`,
      };
    }

    const statusEmoji: Record<string, string> = {
      present: '✅', absent: '❌', late: '⏰', half_day: '🔵', on_leave: '🏖️',
    };

    const lines = [lang === 'hi' ? `📊 *${firstName} जी — पिछले 7 दिन:*` : `📊 *Attendance — Last 7 days:*`, ''];

    let presentDays = 0;
    (records as any[]).forEach((r) => {
      const cin  = r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '';
      const cout = r.check_out_time ? new Date(r.check_out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '';
      const hours = r.total_hours ? `${parseFloat(r.total_hours).toFixed(1)}h` : '';
      const timeInfo = cin ? ` ${cin}${cout ? `→${cout}` : ''} ${hours}` : '';
      if (r.status === 'present') presentDays++;
      lines.push(`${statusEmoji[r.status] ?? '•'} *${r.date}*${timeInfo}`);
    });

    lines.push('');
    lines.push(lang === 'hi'
      ? `📈 *उपस्थिति: ${presentDays}/${records.length} दिन*`
      : `📈 *Present: ${presentDays}/${records.length} days*`);

    return { success: true, reply: lines.join('\n') };
  },

  async WHO_ABSENT({ org_id, slots, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('view team attendance', lang) };
    }

    const today = new Date().toISOString().split('T')[0];
    const dateStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short' });

    const [empRes, presentRes] = await Promise.all([
      db.from('users').select('id, full_name, department').eq('organization_id', org_id).eq('is_active', true).neq('role', 'super_admin'),
      db.from('attendance_records').select('employee_id').eq('organization_id', org_id).eq('date', today).eq('status', 'present'),
    ]);

    const presentIds = new Set((presentRes.data ?? []).map((r: any) => r.employee_id));
    const absent     = (empRes.data ?? []).filter((e: any) => !presentIds.has(e.id));
    const present    = (empRes.data ?? []).filter((e: any) => presentIds.has(e.id));

    const lines = [
      lang === 'hi' ? `📊 *आज की टीम हाजिरी — ${dateStr}:*` : `📊 *Team Attendance — ${dateStr}:*`,
      '',
      lang === 'hi' ? `✅ उपस्थित: ${present.length}` : `✅ Present: ${present.length}`,
      lang === 'hi' ? `❌ अनुपस्थित: ${absent.length}` : `❌ Absent: ${absent.length}`,
    ];

    if (absent.length > 0) {
      lines.push('');
      lines.push(lang === 'hi' ? `*अनुपस्थित कर्मचारी:*` : `*Absent employees:*`);
      absent.slice(0, 10).forEach((e: any) => {
        lines.push(`• ${e.full_name}${e.department ? ` _(${e.department})_` : ''}`);
      });
      if (absent.length > 10) lines.push(`_...और ${absent.length - 10} और_`);
    }

    return { success: true, reply: lines.join('\n') };
  },

  async TEAM_ATTENDANCE({ org_id, slots, user_id, user_role, manager_id }): Promise<ToolResult> {
    return TOOL_MAP.WHO_ABSENT!({ org_id, slots, user_id, user_role, manager_id, user_name: '', user_department: null, intent: 'TEAM_ATTENDANCE' });
  },

  // ── ONBOARDING TOOLS ────────────────────────────────────────────────────────

  async START_ONBOARDING({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const empName  = slots.employee_name!;
    const waNumber = slots.wa_number!.replace(/\s/g, '');

    const { data: newAuthUser, error: authError } = await db.auth.admin.createUser({
      email:         `${waNumber.replace('+', '')}@wa.placeholder`,
      password:      Math.random().toString(36).slice(2) + 'A1!',
      user_metadata: { full_name: empName },
    });

    if (authError && !authError.message.includes('already registered')) throw authError;

    const userId = newAuthUser?.user?.id;
    if (!userId) return { success: false, reply: REPLIES.error(lang) };

    await db.from('users').upsert({
      id:               userId,
      organization_id:  org_id,
      full_name:        empName,
      email:            `${waNumber.replace('+', '')}@wa.placeholder`,
      wa_number:        waNumber.replace('+', ''),
      role:             'employee',
      department:       slots.department !== 'SKIP' ? slots.department ?? null : null,
      designation:      slots.designation !== 'SKIP' ? slots.designation ?? null : null,
      onboarding_status: 'in_progress',
    });

    const { data: session, error: sessError } = await db.from('onboarding_sessions')
      .insert({ organization_id: org_id, user_id: userId, initiated_by: user_id, current_step: 1, total_steps: 8, status: 'in_progress' })
      .select().single();

    if (sessError) throw sessError;

    const empId = await generateEmployeeId();
    await db.from('users').update({ employee_id: empId }).eq('id', userId);

    n8n.notifyOnboardingStarted(org_id, session.id).catch(() => {});

    return {
      success: true,
      reply: lang === 'hi'
        ? `👤 *${empName}* का onboarding शुरू!\n\n🪪 Employee ID: *${empId}*\n📱 WA: ${waNumber}\n\nउनके WhatsApp पर welcome message भेजा जा रहा है। ✅`
        : `👤 Onboarding started for *${empName}*!\n\n🪪 Employee ID: *${empId}*\n📱 WhatsApp: ${waNumber}\n\nA welcome message is being sent to them now. ✅`,
      notify: [{
        user_id: userId,
        message: NOTIFICATIONS.onboardingWelcome(empName, 'your company'),
      }],
    };
  },

  async ONBOARDING_STATUS({ slots, org_id, user_role, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let query = db
      .from('onboarding_sessions')
      .select(`id, current_step, total_steps, status, created_at, users(full_name, department)`)
      .eq('organization_id', org_id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (user_role === 'employee') {
      query = query.eq('user_id', user_id);
    }

    const { data: sessions } = await query;

    if (!sessions?.length) {
      return {
        success: true,
        reply: lang === 'hi' ? `👤 कोई onboarding session नहीं मिला।` : `👤 No onboarding sessions found.`,
      };
    }

    const statusEmoji: Record<string, string> = { completed: '✅', in_progress: '🔄', pending: '⏳', cancelled: '❌' };

    const lines = [lang === 'hi' ? `👤 *Onboarding Status:*` : `👤 *Onboarding Status:*`, ''];

    (sessions as any[]).forEach((s, i) => {
      const prog = `${s.current_step}/${s.total_steps} steps`;
      lines.push(`${i + 1}. ${statusEmoji[s.status] ?? ''} *${(s.users as any)?.full_name ?? 'Unknown'}*`);
      lines.push(`   ${prog} — ${s.status}${(s.users as any)?.department ? ` _(${(s.users as any).department})_` : ''}`);
    });

    return { success: true, reply: lines.join('\n') };
  },
};
