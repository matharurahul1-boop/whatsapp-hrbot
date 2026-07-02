import { createAdminClient }   from '@/lib/supabase/admin';
import { writeAuditLog }       from '@/lib/utils/audit';
import { formatDate, formatDateTime, calcBusinessDays, todayISO } from '@/lib/utils/date';
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

// Sorted-character overlap similarity — robust to single-char typos and transpositions.
// "Prnay" vs "Pranay" → ~0.83 (above the 0.65 threshold used below).
function nameSimilarity(a: string, b: string): number {
  const al = a.toLowerCase().replace(/\s+/g, '');
  const bl = b.toLowerCase().replace(/\s+/g, '');
  if (al.length === 0 || bl.length === 0) return 0;
  if (bl.includes(al) || al.includes(bl)) return 0.9;
  const ac = [...al].sort(), bc = [...bl].sort();
  let i = 0, j = 0, common = 0;
  while (i < ac.length && j < bc.length) {
    if (ac[i] === bc[j]) { common++; i++; j++; }
    else if (ac[i] < bc[j]) i++; else j++;
  }
  return common / Math.max(ac.length, bc.length);
}

// ─── Tool Map ─────────────────────────────────────────────────────────────────

const TOOL_MAP: Partial<Record<AgentIntent, (input: ToolInput) => Promise<ToolResult>>> = {

  // ── GREETING — Smart daily briefing ────────────────────────────────────────
  async GREETING({ user_id, user_name, slots, org_id, user_role }): Promise<ToolResult> {
    const db    = createAdminClient();
    const lang  = (slots._lang as 'en' | 'hi') ?? 'en';
    const today = todayISO();
    const hour  = getISTHour();
    const firstName = (user_name ?? 'there').split(' ')[0];

    // Parallel DB queries for speed
    const [tasksRes, attendanceRes, leaveRes] = await Promise.all([
      db.from('tasks')
        .select('id, title, status, deadline, priority')
        .eq('organization_id', org_id)
        .eq('assignee_id', user_id)
        .neq('status', 'done')
        .neq('status', 'cancelled')
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

    const todayStartMs = new Date(`${today}T00:00:00+05:30`).getTime();
    const todayEndMs   = new Date(`${today}T23:59:59+05:30`).getTime();
    const overdue   = tasks.filter((t: any) => t.deadline && new Date(t.deadline).getTime() < todayStartMs);
    const dueToday  = tasks.filter((t: any) => t.deadline && new Date(t.deadline).getTime() >= todayStartMs && new Date(t.deadline).getTime() <= todayEndMs);
    const upcoming  = tasks.filter((t: any) => !t.deadline || new Date(t.deadline).getTime() > todayEndMs);

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

  // ── UNKNOWN — fallback to help menu (Groq now handles free-form queries in agent.ts)
  async UNKNOWN({ slots, user_role }): Promise<ToolResult> {
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';
    return { success: true, reply: REPLIES.help(user_role, lang) };
  },

  // ── TASK TOOLS ──────────────────────────────────────────────────────────────

  async CREATE_TASK({ slots, org_id, user_id, user_role, user_name }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    // Duplicate guard — prevent the AI from re-creating an existing active task
    const { data: dupTask } = await db
      .from('tasks')
      .select('id, assignee:users!tasks_assignee_id_fkey(full_name)')
      .eq('organization_id', org_id)
      .ilike('title', slots.title!)
      .is('deleted_at', null)
      .neq('status', 'done')
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle();

    if (dupTask) {
      const owner = (dupTask as any).assignee?.full_name ?? 'someone';
      return {
        success: false,
        reply: lang === 'hi'
          ? `⚠️ *"${slots.title}"* नाम का task पहले से मौजूद है (${owner} को assigned)। क्या आप उसे update करना चाहते हैं?`
          : `⚠️ A task *"${slots.title}"* already exists (assigned to ${owner}). Did you mean to *update* it? Try: "update deadline of ${slots.title} to [date]"`,
      };
    }

    let assignedTo   = user_id;
    let assigneeName = user_name ?? (lang === 'hi' ? 'आप' : 'You');

    // Treat any self-referential word as "assign to self" (Groq may pass "me", "myself", "you", "mine" etc.)
    const ASSIGNEE_SELF_RE = /^(me|myself|mine|my|i|you|yourself|self|own)$/i;
    if (slots.assignee && !ASSIGNEE_SELF_RE.test(slots.assignee.trim())) {
      // RBAC: employees can only create tasks for themselves via bot
      if (user_role === 'employee') {
        return {
          success: false,
          reply: lang === 'hi'
            ? `❌ Employees केवल अपने लिए task बना सकते हैं। Task किसी और को assign करने के लिए dashboard उपयोग करें।`
            : `❌ Employees can only create tasks for themselves. Use the dashboard to assign tasks to others.`,
        };
      }

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

    // Build deadline as UTC (no-tz string) so the timestamp column stores UTC.
    // Convert from IST (user's timezone) to UTC by parsing with +05:30 offset.
    let deadlineISO: string | null = null;
    if (slots.deadline) {
      const parts = slots.deadline.split(' ');
      const date  = parts[0];
      const time  = parts[1] ?? '09:00';
      deadlineISO = new Date(`${date}T${time}:00+05:30`).toISOString().slice(0, 19);
    }

    // Enforce required fields — reject early with an actionable prompt
    if (!deadlineISO) {
      return {
        success: false,
        reply: lang === 'hi'
          ? '❌ डेडलाइन बताएं — तारीख और समय (जैसे: कल शाम 5 बजे, 10 July 5pm)'
          : '❌ Please provide a deadline — date and time. (e.g. tomorrow 5pm, July 10 at 3pm)',
      };
    }
    const taskPriority = (slots.priority as string | null);
    if (!taskPriority) {
      return {
        success: false,
        reply: lang === 'hi'
          ? '❌ Priority बताएं: low / medium / high / urgent में से एक'
          : '❌ Please provide a priority: low / medium / high / urgent',
      };
    }

    // Read assignee's reminder preference to auto-set reminders on the task.
    // Default: '1_day' (morning-before reminder). User can override via bot.
    let taskReminders = ['1_day'];
    try {
      const { data: assigneeUser } = await db
        .from('users').select('metadata').eq('id', assignedTo).single();
      const prefs = (assigneeUser?.metadata as Record<string, unknown> | null)?.task_reminders as
        { enabled?: boolean; offset?: string } | undefined ?? {};
      if (prefs.enabled === false) {
        taskReminders = [];
      } else if (prefs.offset) {
        taskReminders = [prefs.offset];
      }
    } catch { /* keep default */ }

    const { data: task, error } = await db
      .from('tasks')
      .insert({
        organization_id: org_id,
        title:           slots.title!,
        assignee_id:     assignedTo,
        created_by:      user_id,
        deadline:        deadlineISO,
        priority:        taskPriority,
        status:          'todo',
        source:          'whatsapp',
        reminders:       taskReminders,
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
      message: NOTIFICATIONS.taskAssigned('your colleague', slots.title!, deadlineISO),
    }] : [];

    n8n.notifyTaskAssigned(org_id, task.id, assignedTo).catch(() => {});

    return {
      success: true,
      reply:   REPLIES.taskCreated(slots.title!, assigneeName, formatDateTime(deadlineISO), taskPriority, lang),
      notify,
    };
  },

  async LIST_TASKS({ org_id, user_id, user_role, slots, user_name }): Promise<ToolResult> {
    const db    = createAdminClient();
    const lang  = (slots._lang as 'en' | 'hi') ?? 'en';
    const today = todayISO();
    const isPrivileged = ['manager', 'hr', 'admin', 'super_admin'].includes(user_role);

    // Normalize self-referential assignee_name words that Groq sometimes passes.
    // Covers: mine/my/me/myself/i/own/self/your (all mean "show the caller's own tasks")
    const SELF_NAME_RE = /^(mine|my|me|myself|i|own|self|your)$/i;
    const isSelfQuery = !!slots.assignee_name && SELF_NAME_RE.test(slots.assignee_name.trim());

    // Employees cannot list another person's tasks
    if (!isPrivileged && slots.assignee_name && !isSelfQuery) {
      return {
        success: false,
        reply: lang === 'hi'
          ? `🚫 आपके पास दूसरों के टास्क देखने की अनुमति नहीं है। अपने टास्क देखने के लिए *my tasks* टाइप करें।`
          : `🚫 You don't have permission to view other people's tasks. Type *my tasks* to see your own.`,
      };
    }

    let query = db
      .from('tasks')
      .select(`id, title, status, deadline, priority, assignee:users!tasks_assignee_id_fkey(full_name)`)
      .eq('organization_id', org_id)
      .is('deleted_at', null)
      .neq('status', 'done')
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(10);

    if (!isPrivileged || isSelfQuery) {
      // Employees always see only their own tasks.
      // Privileged users using self-referential words ("mine", "my", "me") also get own tasks.
      query = query.eq('assignee_id', user_id);
    } else if (slots.assignee_name) {
      // Manager/admin filtering by a specific person
      const { data: targetRows } = await db
        .from('users')
        .select('id, full_name')
        .eq('organization_id', org_id)
        .ilike('full_name', `%${slots.assignee_name}%`)
        .limit(5);
      let target: { id: string; full_name: string } | null = targetRows?.[0] ?? null;

      // Fuzzy fallback for typos — e.g. "Prnay" → "Pranay"
      if (!target) {
        const { data: allActive } = await db
          .from('users')
          .select('id, full_name')
          .eq('organization_id', org_id)
          .eq('is_active', true)
          .limit(20);

        let bestScore = 0;
        for (const u of (allActive ?? []) as { id: string; full_name: string }[]) {
          // Score against full name AND each word (first name, last name separately)
          const scores = [u.full_name, ...u.full_name.split(' ')]
            .map(n => nameSimilarity(slots.assignee_name!, n));
          const score = Math.max(...scores);
          if (score > bestScore) { bestScore = score; target = u; }
        }
        if (bestScore < 0.65) {
          // Still no close match — show who is available
          const nameList = ((allActive ?? []) as { full_name: string }[]).map(u => u.full_name).join(', ');
          return { success: false, reply: lang === 'hi'
            ? `❌ "*${slots.assignee_name}*" नाम का कोई user नहीं मिला।${nameList ? `\n\nउपलब्ध: ${nameList}` : ''}`
            : `❌ No user found matching "*${slots.assignee_name}*".${nameList ? `\n\nAvailable: ${nameList}` : ''}`
          };
        }
      }
      query = query.eq('assignee_id', target!.id);
    }
    // else: privileged user with no filter → show all org tasks

    const { data: tasks } = await query;

    if (!tasks?.length) {
      const noTasksName = slots.assignee_name && isPrivileged && !isSelfQuery ? slots.assignee_name : null;
      return {
        success: true,
        reply: noTasksName
          ? `📋 No pending tasks found for *${noTasksName}*.`
          : (lang === 'hi' ? `📋 कोई पेंडिंग टास्क नहीं। शानदार काम! 🎉` : `📋 No pending tasks — you're all caught up! 🎉`),
      };
    }

    const nowMs   = Date.now();
    const todayStartMs = new Date(`${today}T00:00:00+05:30`).getTime();
    const todayEndMs   = new Date(`${today}T23:59:59+05:30`).getTime();

    const overdue  = (tasks as any[]).filter((t) => t.deadline && new Date(t.deadline).getTime() < todayStartMs);
    const dueToday = (tasks as any[]).filter((t) => t.deadline && new Date(t.deadline).getTime() >= todayStartMs && new Date(t.deadline).getTime() <= todayEndMs);
    const rest     = (tasks as any[]).filter((t) => !t.deadline || new Date(t.deadline).getTime() > todayEndMs);

    const formatTask = (t: any, i: number) => {
      const pEmoji = priorityEmoji(t.priority);
      let due = '';
      if (t.deadline) {
        const d = new Date(t.deadline);
        due = ` — ${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`;
      }
      const assignee = user_role !== 'employee' && t.assignee?.full_name ? ` _(${t.assignee.full_name})_` : '';
      return `${i + 1}. ${pEmoji} *${t.title}*${due}${assignee}`;
    };

    const lines: string[] = [];
    const headerName = slots.assignee_name && isPrivileged && !isSelfQuery
      ? (tasks as any[])[0]?.assignee?.full_name ?? slots.assignee_name
      : null;
    const header = headerName
      ? `📋 *${headerName}'s tasks:*`
      : (lang === 'hi' ? `📋 *आपके टास्क:*` : `📋 *Your tasks:*`);
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
      .neq('status', 'done')
      .limit(1);

    const task = tasks?.[0] as any;
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    await db
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
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

  async ASSIGN_TASK({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    // RBAC: only manager+ can assign tasks to others via bot
    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('assign tasks to others', lang) };
    }

    const { data: tasks } = await db
      .from('tasks')
      .select('id, title')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .limit(1);

    const task = tasks?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    const { data: foundRows } = await db
      .from('users').select('id, full_name')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.assignee}%`)
      .limit(5);
    const found = foundRows?.[0] ?? null;

    if (!found) {
      // Show who IS available so the user can pick
      const { data: available } = await db
        .from('users').select('full_name')
        .eq('organization_id', org_id).eq('is_active', true).is('deleted_at', null)
        .neq('id', user_id).limit(10);
      const names = (available ?? []).map(u => `· ${u.full_name}`).join('\n') || '(none)';
      return {
        success: false,
        reply: lang === 'hi'
          ? `❌ *${slots.assignee}* नहीं मिला।\n\nउपलब्ध assignees:\n${names}`
          : `❌ *${slots.assignee}* not found.\n\nAvailable assignees:\n${names}`,
      };
    }

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

  async DELETE_TASK({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';
    const isPrivileged = ['manager', 'hr', 'admin', 'super_admin'].includes(user_role);

    let query = db
      .from('tasks')
      .select('id, title')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .limit(1);

    // Employees can only delete their own tasks; managers+ can delete any org task
    if (!isPrivileged) query = query.eq('assignee_id', user_id);

    const { data: tasks } = await query;
    const task = tasks?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    await db.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', task.id);

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'DELETE_TASK', table_name: 'tasks',
      record_id: task.id, new_data: { deleted_at: new Date().toISOString() }, source: 'whatsapp',
    });

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

    // RBAC: employees can only change status, not structural fields
    if (user_role === 'employee' && field && !['status', 'description'].includes(field)) {
      return { success: false, reply: lang === 'hi'
        ? `❌ Employees केवल task का status बदल सकते हैं। Priority, deadline या assignee बदलने के लिए manager से कहें।`
        : `❌ Employees can only update a task's status. Ask your manager to change priority, deadline, or assignee.`
      };
    }

    if (field === 'title') {
      if (!value) {
        return { success: false, reply: lang === 'hi' ? `❌ नया title बताएं।` : `❌ Please provide the new title.` };
      }
      patch.title = value;
    } else if (field === 'deadline') {
      const parts = value.split(' ');
      const date  = parts[0];
      const time  = parts[1] ?? '09:00';
      patch.deadline = `${date}T${time}:00+05:30`;
    } else if (field === 'priority') {
      const PRIORITY_MAP: Record<string, string> = {
        urgent: 'urgent', critical: 'urgent', asap: 'urgent', top: 'urgent', highest: 'urgent',
        high: 'high', hi: 'high',
        medium: 'medium', med: 'medium', normal: 'medium', moderate: 'medium',
        low: 'low', lo: 'low', minor: 'low',
      };
      const normalized = PRIORITY_MAP[value.toLowerCase()];
      if (!normalized) {
        return { success: false, recoverable: true, retry_slot: 'update_value', reply: lang === 'hi'
          ? `❌ Priority: low / medium / high / urgent में से एक चुनें।`
          : `❌ Invalid priority. Use: low / medium / high / urgent`
        };
      }
      patch.priority = normalized;
    } else if (field === 'status') {
      const statusMap: Record<string, string> = {
        todo: 'todo', pending: 'todo', open: 'todo', new: 'todo',
        'in_progress': 'in_progress', 'in progress': 'in_progress', wip: 'in_progress',
        started: 'in_progress', doing: 'in_progress', ongoing: 'in_progress',
        done: 'done', completed: 'done', complete: 'done', khatam: 'done', finished: 'done',
        cancelled: 'cancelled', cancel: 'cancelled', dropped: 'cancelled',
      };
      const mapped = statusMap[value.toLowerCase()];
      if (!mapped) {
        return { success: false, recoverable: true, retry_slot: 'update_value', reply: lang === 'hi'
          ? `❌ Status: todo / in_progress / done / cancelled`
          : `❌ Invalid status. Use: todo / in_progress / done / cancelled`
        };
      }
      patch.status = mapped;
      if (mapped === 'done') patch.completed_at = new Date().toISOString();
    } else if (field === 'assignee') {
      const { data: foundRows } = await db
        .from('users')
        .select('id, full_name')
        .eq('organization_id', org_id)
        .ilike('full_name', `%${value}%`)
        .limit(5);
      const found = foundRows?.[0] ?? null;
      if (!found) {
        const { data: avail } = await db
          .from('users').select('full_name')
          .eq('organization_id', org_id).eq('is_active', true).is('deleted_at', null)
          .neq('id', user_id).limit(10);
        const names = (avail ?? []).map(u => `· ${u.full_name}`).join('\n') || '(none)';
        return {
          success: false,
          reply: lang === 'hi'
            ? `❌ *${value}* नहीं मिला।\n\nउपलब्ध assignees:\n${names}`
            : `❌ *${value}* not found.\n\nAvailable assignees:\n${names}`,
        };
      }
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

    // Use human-readable values in the reply (avoid showing UUIDs for assignee).
    let displayValue: string;
    if (field === 'assignee') {
      displayValue = value;
    } else if (field === 'priority') {
      const pVal = String(patch.priority ?? value);
      displayValue = `${priorityEmoji(pVal)} ${pVal}`;
    } else {
      displayValue = String(patch.title ?? patch.priority ?? patch.status ?? patch.deadline ?? value);
    }
    const displayField = field ?? 'field';
    const displayTitle = field === 'title' ? value : task.title;
    return {
      success: true,
      reply: lang === 'hi'
        ? `✅ *"${displayTitle}"* — ${displayField} *${displayValue}* कर दिया!`
        : `✅ *"${displayTitle}"* — *${displayField}* updated to *${displayValue}*!`,
    };
  },

  async SET_REMINDER({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const message   = slots.message ?? slots.title ?? '';
    const remindAt  = slots.remind_at ?? slots.deadline ?? null;
    const waNumber  = slots.wa_number ?? null;

    if (!message || !remindAt) {
      return { success: false, reply: lang === 'hi'
        ? '❌ रिमाइंडर के लिए message और time दोनों बताएं।'
        : '❌ Please provide both a message and a time for the reminder.'
      };
    }

    // Parse remind_at — accept ISO or YYYY-MM-DD HH:MM
    let fireAt: Date;
    try {
      fireAt = new Date(remindAt);
      if (isNaN(fireAt.getTime())) throw new Error('invalid');
    } catch {
      return { success: false, reply: lang === 'hi'
        ? `❌ समय समझ नहीं आया: "${remindAt}". ISO format (YYYY-MM-DDTHH:MM+05:30) दें।`
        : `❌ Couldn't parse time: "${remindAt}". Please use a format like "2026-06-24T15:00:00+05:30".`
      };
    }

    if (fireAt <= new Date()) {
      return { success: false, reply: lang === 'hi'
        ? '❌ रिमाइंडर का समय भविष्य में होना चाहिए।'
        : '❌ Reminder time must be in the future.'
      };
    }

    // Look up wa_number if not in slots
    let finalWaNumber = waNumber;
    if (!finalWaNumber) {
      const { data: u } = await db.from('users').select('wa_number').eq('id', user_id).single();
      finalWaNumber = u?.wa_number ?? null;
    }

    if (!finalWaNumber) {
      return { success: false, reply: lang === 'hi'
        ? '❌ WhatsApp नंबर नहीं मिला।'
        : '❌ Could not find your WhatsApp number.'
      };
    }

    const { error } = await db.from('bot_reminders').insert({
      organization_id: org_id,
      type:            'custom',
      user_id,
      wa_number:       finalWaNumber,
      custom_message:  message,
      fire_at:         fireAt.toISOString(),
    });

    if (error) throw error;

    const displayTime = fireAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });

    return {
      success: true,
      reply: lang === 'hi'
        ? `⏰ *रिमाइंडर सेट!*\n\n📋 ${message}\n🗓 ${displayTime} IST`
        : `⏰ *Reminder set!*\n\n📋 ${message}\n🗓 ${displayTime} IST`,
    };
  },

  async TASK_DETAILS({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let query = db
      .from('tasks')
      .select(`id, title, status, deadline, priority, description,
        assignee:users!tasks_assignee_id_fkey(full_name),
        created_by:users!tasks_created_by_fkey(full_name)`)
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
      t.deadline ? `*Due:* ${new Date(t.deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}` : null,
      t.assignee?.full_name    ? `*Assigned to:* ${t.assignee.full_name}` : null,
      t.created_by?.full_name  ? `*Created by:* ${t.created_by.full_name}` : null,
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

    let empQuery = db.from('users').select('id, full_name, manager_id')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.employee_name}%`)
      .limit(5);

    const { data: empRows } = await empQuery;
    const employee = empRows?.[0] ?? null;

    if (!employee) return { success: false, reply: REPLIES.notFound(slots.employee_name!, lang) };

    // Managers can only approve their own direct reports
    if (user_role === 'manager' && employee.manager_id !== user_id) {
      return { success: false, reply: lang === 'hi'
        ? `❌ आप केवल अपने direct reports की leave approve कर सकते हैं।`
        : `❌ You can only approve leave for your direct reports.`
      };
    }

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

    const { data: empRows } = await db.from('users').select('id, full_name, manager_id')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.employee_name}%`)
      .limit(5);
    const employee = empRows?.[0] ?? null;

    if (!employee) return { success: false, reply: REPLIES.notFound(slots.employee_name!, lang) };

    // Managers can only reject their own direct reports
    if (user_role === 'manager' && employee.manager_id !== user_id) {
      return { success: false, reply: lang === 'hi'
        ? `❌ आप केवल अपने direct reports की leave reject कर सकते हैं।`
        : `❌ You can only reject leave for your direct reports.`
      };
    }

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
    const today   = todayISO();
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
      const msSince = Date.now() - new Date(existing.check_in_time).getTime();
      if (msSince > 5 * 60 * 1000) {
        return { success: false, reply: REPLIES.checkInAlready(t, lang) };
      }
      return { success: true, reply: REPLIES.checkInSuccess(firstName, t, lang) };
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
    const today   = todayISO();
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

  async WHO_ABSENT({ org_id, slots, user_role, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('view team attendance', lang) };
    }

    const today = todayISO();
    const dateStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short' });

    // Managers see only their team; HR+ see the whole org
    let employeeQuery = db.from('users').select('id, full_name, department')
      .eq('organization_id', org_id).eq('is_active', true).neq('role', 'super_admin');

    if (user_role === 'manager') {
      employeeQuery = employeeQuery.eq('manager_id', user_id);
    }

    const [empRes, presentRes] = await Promise.all([
      employeeQuery,
      db.from('attendance_records').select('employee_id').eq('organization_id', org_id).eq('date', today).eq('status', 'present'),
    ]);

    const presentIds = new Set((presentRes.data ?? []).map((r: any) => r.employee_id));
    const absent     = (empRes.data ?? []).filter((e: any) => !presentIds.has(e.id));
    const present    = (empRes.data ?? []).filter((e: any) => presentIds.has(e.id));

    const scope = user_role === 'manager' ? 'Team' : 'Org';
    const lines = [
      lang === 'hi' ? `📊 *आज की ${user_role === 'manager' ? 'टीम' : 'संस्था'} हाजिरी — ${dateStr}:*` : `📊 *${scope} Attendance — ${dateStr}:*`,
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

  // ── LIST USERS ───────────────────────────────────────────────────────────────

  async LIST_USERS({ org_id, user_id, user_role, slots }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return {
        success: false,
        reply: lang === 'hi'
          ? '❌ यह जानकारी केवल managers और HR देख सकते हैं।'
          : '❌ Only managers and HR can view the full user list.',
      };
    }

    const { data: users, error: usersErr } = await db
      .from('users')
      .select('full_name, role, department, designation, wa_number')
      .eq('organization_id', org_id)
      .is('deleted_at', null)
      .order('full_name', { ascending: true })
      .limit(20);
    console.log(`[LIST_USERS] org_id=${org_id} → ${users?.length ?? 0} rows`, usersErr?.message ?? '');

    if (!users?.length) {
      return { success: true, reply: lang === 'hi' ? 'कोई उपयोगकर्ता नहीं मिला।' : 'No users found in your organisation.' };
    }

    const lines = [lang === 'hi' ? `👥 *संस्था के सदस्य (${users.length}):*` : `👥 *Organisation Members (${users.length}):*`, ''];
    users.forEach((u, i) => {
      const dept = u.department ? ` — ${u.department}` : '';
      const desg = u.designation ? ` (${u.designation})` : '';
      lines.push(`${i + 1}. *${u.full_name}*${desg}${dept}`);
    });

    return { success: true, reply: lines.join('\n') };
  },

  // ── ONBOARDING TOOLS ────────────────────────────────────────────────────────

  async START_ONBOARDING({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const empName  = slots.employee_name!;
    if (!slots.wa_number) {
      return { success: false, reply: "Please provide the employee's WhatsApp number (with country code, e.g. +919876543210)." };
    }
    const waNumber = slots.wa_number.replace(/\s/g, '');

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
      .insert({ organization_id: org_id, employee_id: userId, initiated_by: user_id, current_step: 1, total_steps: 8, status: 'in_progress' })
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

  // ── REMINDER PREFERENCES ────────────────────────────────────────────────────

  async CONFIGURE_REMINDERS({ slots, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: userRow } = await db
      .from('users').select('metadata').eq('id', user_id).single();

    const existingMeta  = (userRow?.metadata as Record<string, unknown>) ?? {};
    const existingPrefs = (existingMeta.task_reminders as Record<string, unknown>) ?? {};
    const updates: Record<string, unknown> = { ...existingPrefs };

    if (slots.enabled !== null && slots.enabled !== undefined) {
      updates.enabled = slots.enabled === 'true';
    }
    if (slots.offset) updates.offset = slots.offset;
    if (slots.channel) {
      updates.channels = slots.channel === 'both'    ? ['whatsapp', 'in_app']
                       : slots.channel === 'in_app'  ? ['in_app']
                       : ['whatsapp'];
    }

    await db.from('users')
      .update({ metadata: { ...existingMeta, task_reminders: updates } })
      .eq('id', user_id);

    const OFFSET_LABEL: Record<string, string> = {
      '1_day':   lang === 'hi' ? 'deadline से 1 दिन पहले (सुबह)' : '1 day before deadline (morning)',
      'same_day': lang === 'hi' ? 'deadline वाले दिन सुबह'        : 'morning of the deadline day',
    };

    const statusStr = updates.enabled === false
      ? (lang === 'hi' ? '🔕 बंद'        : '🔕 Disabled')
      : (lang === 'hi' ? '🔔 चालू'       : '🔔 Enabled');
    const offsetStr = OFFSET_LABEL[(updates.offset as string) ?? '1_day']
      ?? (updates.offset as string ?? '1 day before');

    return {
      success: true,
      reply: lang === 'hi'
        ? `⏰ *Reminder preferences saved!*\n\n📋 Status: ${statusStr}\n🕐 Timing: ${offsetStr}`
        : `⏰ *Reminder preferences saved!*\n\n📋 Status: ${statusStr}\n🕐 Timing: ${offsetStr}`,
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
      query = query.eq('employee_id', user_id);
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
