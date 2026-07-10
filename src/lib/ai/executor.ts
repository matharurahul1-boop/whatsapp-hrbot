import { createAdminClient }   from '@/lib/supabase/admin';
import { writeAuditLog }       from '@/lib/utils/audit';
import { formatDate, formatDateTime, calcBusinessDays, todayISO, parseDeadlineToUTC, parseDeadlineString } from '@/lib/utils/date';
import { generateEmployeeId }  from '@/lib/utils/employee-id';
import { n8n }                 from '@/lib/n8n/trigger';
import { isManagerOrAbove }    from '@/lib/rbac';
import { REPLIES, NOTIFICATIONS } from './prompts/responses';
import {
  notifyTaskAssigned,
  notifyTaskCompleted,
  notifyTaskUpdated,
  notifyTaskDeleted,
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

function statusLabel(s: string | null): string {
  const map: Record<string, string> = {
    todo: 'To Do', pending: 'To Do', in_progress: 'In Progress',
    done: 'Done', completed: 'Done', cancelled: 'Cancelled',
  };
  return map[(s ?? '').toLowerCase()] ?? (s ?? '');
}

// Normalized edit-distance similarity. Unlike sorted-character overlap, this
// does not treat unrelated anagrams as the same employee.
function nameSimilarity(a: string, b: string): number {
  const al = a.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const bl = b.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!al || !bl) return 0;
  if (al === bl) return 1;
  if (bl.includes(al) || al.includes(bl)) return 0.92;
  const previous = Array.from({ length: bl.length + 1 }, (_, i) => i);
  for (let i = 1; i <= al.length; i++) {
    const current = [i];
    for (let j = 1; j <= bl.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (al[i - 1] === bl[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return 1 - previous[bl.length] / Math.max(al.length, bl.length);
}

async function managerTeamIds(orgId: string, managerId: string): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db.from('users').select('id')
    .eq('organization_id', orgId).eq('manager_id', managerId)
    .eq('is_active', true).is('deleted_at', null);
  return (data ?? []).map(row => row.id);
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
      msg += `*📋 टास्क:*\n"call client का टास्क बनाओ"\n"मेरे सभी टास्क दिखाओ"\n"मेरे complete टास्क"\n"Task stats" — स्टेटस के अनुसार गिनती\n"website टास्क complete किया"\n"[task] में note जोड़ो: [text]"\n`;
      if (isManager) msg += `"Rahul को design टास्क दो"\n`;
      msg += `\n*📅 छुट्टी:*\n"कल casual leave चाहिए"\n"मेरा leave balance बताओ"\n"मेरी leave requests"\n"Leave types" — सभी उपलब्ध प्रकार\n`;
      if (isManager) msg += `"Pending leaves" — सभी बकाया अनुरोध\n"Rahul की leave approve करो"\n"Rahul की leave reject करो"\n`;
      msg += `\n*👤 प्रोफ़ाइल:*\n"मेरी profile" — नाम, रोल, डिपार्टमेंट\n`;
      if (isHR)      msg += `\n*🧑‍💼 ऑनबोर्डिंग:*\n"Rahul Kumar को onboard करो +91XXXXXXXXXX"\n"Onboarding status"\n`;
      msg += `\n_कोई भी HR सवाल पूछें — मैं जवाब देने की कोशिश करूंगा!_`;
      return { success: true, reply: msg };
    }

    let msg = `📖 *HRBot — Here's what I can do:*\n\n`;
    msg += `*⏰ Attendance:*\n"checkin" — mark your arrival\n"checkout" — mark your departure\n"my attendance report"\n\n`;
    msg += `*📋 Tasks:*\n"Create task call client by Friday"\n"Show my pending tasks"\n"My completed tasks"\n"Task stats" — count by status\n"Mark website task complete"\n"Add note to [task]: [text]"\n`;
    if (isManager) msg += `"Assign design task to Rahul"\n`;
    msg += `\n*📅 Leave:*\n"Apply for sick leave tomorrow"\n"Check my leave balance"\n"My leave requests"\n"Leave types" — all available categories\n`;
    if (isManager) msg += `"Pending leaves" — all awaiting approval\n"Approve leave for Rahul"\n"Reject Priya's leave"\n`;
    msg += `\n*👤 Profile:*\n"My profile" — name, role, department, manager\n`;
    if (isHR)      msg += `\n*🧑‍💼 Onboarding:*\n"Onboard new employee Rahul Kumar +91XXXXXXXXXX"\n"Onboarding status"\n`;
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
    const cleanTitle = slots.title?.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!cleanTitle) return { success: false, reply: '❌ Please provide a short task title.' };
    slots.title = cleanTitle;

    let assignedTo   = user_id;
    let assigneeName = user_name ?? (lang === 'hi' ? 'आप' : 'You');

    // Treat any self-referential word as "assign to self" (Groq may pass "me", "myself", "you", "mine" etc.)
    const ASSIGNEE_SELF_RE = /^(me|myself|mine|my|i|you|yourself|self|own)$/i;
    if (slots.assignee && !ASSIGNEE_SELF_RE.test(slots.assignee.trim())) {
      // A partial name is valid only when it identifies exactly one person.
      const { data: matchingUsers } = await db
        .from('users').select('id, full_name')
        .eq('organization_id', org_id).eq('is_active', true)
        .is('deleted_at', null)
        .ilike('full_name', `%${slots.assignee}%`).limit(5);

      const requestedName = slots.assignee.trim().toLowerCase();
      const exactUser = (matchingUsers ?? []).find(u => u.full_name.toLowerCase() === requestedName) ?? null;
      if (!exactUser && (matchingUsers?.length ?? 0) > 1) {
        const options = matchingUsers!.map(u => `· ${u.full_name}`).join('\n');
        return { success: false, reply: `Multiple people match *${slots.assignee}*:\n${options}\n\nPlease use the full name.` };
      }
      let resolvedUser: { id: string; full_name: string } | null = exactUser ?? matchingUsers?.[0] ?? null;

      // 2. Fuzzy fallback for typos / partial names
      if (!resolvedUser) {
        const { data: allActive } = await db
          .from('users').select('id, full_name')
          .eq('organization_id', org_id).eq('is_active', true).limit(50);
        let bestScore = 0;
        for (const u of (allActive ?? []) as { id: string; full_name: string }[]) {
          const scores = [u.full_name, ...u.full_name.split(' ')]
            .map(n => nameSimilarity(slots.assignee!, n));
          const score = Math.max(...scores);
          if (score > bestScore) { bestScore = score; resolvedUser = u; }
        }
        if (bestScore < 0.65) {
          const names = ((allActive ?? []) as { full_name: string }[]).map(u => `· ${u.full_name}`).join('\n') || '(none)';
          return {
            success: false,
            reply: lang === 'hi'
              ? `❌ *${slots.assignee}* नाम का कोई active user नहीं मिला।\n\nउपलब्ध:\n${names}`
              : `❌ No active user found matching *${slots.assignee}*.\n\nAvailable:\n${names}`,
          };
        }
      }

      assignedTo   = resolvedUser!.id;
      assigneeName = resolvedUser!.full_name;
    }

    // Idempotency is scoped to the assignee. Different employees may validly
    // have tasks with the same title (for example, "Submit timesheet").
    const { data: dupTask, error: duplicateError } = await db
      .from('tasks')
      .select('id')
      .eq('organization_id', org_id)
      .eq('assignee_id', assignedTo)
      .ilike('title', slots.title!)
      .is('deleted_at', null)
      .not('status', 'in', '(done,cancelled)')
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (dupTask) {
      return { success: false, reply: `⚠️ *${assigneeName}* already has an active task named *"${slots.title}"*. Did you mean to update it?` };
    }

    // Build deadline as UTC (no-tz string) so the timestamp column stores UTC.
    let deadlineISO: string | null = null;
    if (slots.deadline) {
      const parts = slots.deadline.split(' ');
      deadlineISO = parseDeadlineToUTC(parts[0] ?? '', parts[1] ?? '17:00');
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
    const PRIORITY_MAP: Record<string, string> = {
      urgent: 'urgent', critical: 'urgent', asap: 'urgent', top: 'urgent', highest: 'urgent',
      high: 'high', hi: 'high',
      medium: 'medium', med: 'medium', normal: 'medium', moderate: 'medium',
      low: 'low', lo: 'low', minor: 'low',
    };
    const rawPriority = (slots.priority as string | null)?.toLowerCase().trim() ?? '';
    // Priority is optional — default to medium when the caller didn't mention
    // one, rather than blocking task creation on an extra round-trip.
    const taskPriority = PRIORITY_MAP[rawPriority] ?? 'medium';

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
        description:     (slots.description && slots.description !== 'SKIP') ? slots.description.slice(0, 2000) : null,
      })
      .select()
      .single();

    if (error) throw error;

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'CREATE_TASK', table_name: 'tasks',
      record_id: task.id, new_data: task, source: 'whatsapp',
    });

    if (assignedTo !== user_id) {
      // notifyTaskAssigned includes priority + deadline + creator, not just
      // title — matches what the dashboard-created-task path already sends,
      // so the WhatsApp notification carries every detail of the task.
      notifyTaskAssigned({
        orgId:       org_id,
        taskTitle:   slots.title!,
        priority:    taskPriority,
        deadline:    deadlineISO,
        assigneeId:  assignedTo,
        creatorName: user_name || 'your colleague',
      }).catch(() => {});
      n8n.notifyTaskAssigned(org_id, task.id, assignedTo).catch(() => {});
    }

    return {
      success: true,
      reply:   REPLIES.taskCreated(slots.title!, assigneeName, formatDateTime(deadlineISO), taskPriority, lang),
    };
  },

  async LIST_TASKS({ org_id, user_id, user_role, slots, user_name }): Promise<ToolResult> {
    const db    = createAdminClient();
    const lang  = (slots._lang as 'en' | 'hi') ?? 'en';
    const today = todayISO();

    // Normalize self-referential assignee_name words that Groq sometimes passes.
    // Covers: mine/my/me/myself/i/own/self/your (all mean "show the caller's own tasks")
    const SELF_NAME_RE = /^(mine|my|me|myself|i|own|self|your)$/i;
    const isSelfQuery = !!slots.assignee_name && SELF_NAME_RE.test(slots.assignee_name.trim());
    const wantsAll = slots.scope === 'all';

    // status_filter: 'done' → show completed tasks; 'all' → show everything; default → active only
    const statusFilter = (slots.status_filter as string | null)?.toLowerCase();
    const showDone = statusFilter === 'done' || statusFilter === 'completed';

    let query = db
      .from('tasks')
      .select(`id, title, status, deadline, priority, assignee:users!tasks_assignee_id_fkey(full_name)`)
      .eq('organization_id', org_id)
      .is('deleted_at', null);

    if (showDone) {
      query = (query as any).eq('status', 'done').order('completed_at', { ascending: false, nullsFirst: false });
    } else if (statusFilter === 'todo') {
      query = (query as any).eq('status', 'todo').order('deadline', { ascending: true, nullsFirst: false });
    } else if (statusFilter === 'in_progress') {
      query = (query as any).eq('status', 'in_progress').order('deadline', { ascending: true, nullsFirst: false });
    } else if (statusFilter === 'cancelled' || statusFilter === 'canceled') {
      query = (query as any).eq('status', 'cancelled').order('updated_at', { ascending: false, nullsFirst: false });
    } else {
      query = (query as any).neq('status', 'done').neq('status', 'cancelled').order('deadline', { ascending: true, nullsFirst: false });
    }

    // 50 comfortably covers a single org's active task list in one WhatsApp
    // message; if it's ever hit, the reply below says so instead of silently
    // dropping tasks past the cap (previously capped at 10 — an org with 13
    // active tasks would lose 3 with no indication anything was missing).
    const TASK_QUERY_LIMIT = 50;
    query = (query as any).limit(TASK_QUERY_LIMIT);

    if (isSelfQuery || (!slots.assignee_name && !wantsAll)) {
      // Generic task lists default to the caller. Named/all requests expand scope.
      query = query.eq('assignee_id', user_id);
    } else if (slots.assignee_name) {
      // Manager/admin filtering by a specific person
      const { data: targetRows } = await db
        .from('users')
        .select('id, full_name')
        .eq('organization_id', org_id)
        .ilike('full_name', `%${slots.assignee_name}%`)
        .limit(5);
      if ((targetRows?.length ?? 0) > 1) {
        const options = targetRows!.map(u => `· ${u.full_name}`).join('\n');
        return { success: false, reply: `Multiple people match *${slots.assignee_name}*:\n${options}\n\nPlease use the full name.` };
      }
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
    // Explicit all/team requests show all organization tasks for every role.

    const { data: tasks, error: taskListError } = await query;
    if (taskListError) throw taskListError;

    if (!tasks?.length) {
      const noTasksName = slots.assignee_name && !isSelfQuery ? slots.assignee_name : null;
      if (statusFilter) {
        const label = statusFilter === 'in_progress' ? 'in progress' : statusFilter === 'todo' ? 'to do' : statusFilter;
        return { success: true, reply: noTasksName
          ? `📋 No ${label} tasks found for *${noTasksName}*.`
          : `📋 No ${label} tasks found.` };
      }
      return {
        success: true,
        reply: noTasksName
          ? `📋 No pending tasks found for *${noTasksName}*.`
          : (lang === 'hi' ? `📋 कोई पेंडिंग टास्क नहीं। शानदार काम! 🎉` : `📋 No pending tasks — you're all caught up! 🎉`),
      };
    }

    const todayStartMs = new Date(`${today}T00:00:00+05:30`).getTime();
    const todayEndMs   = new Date(`${today}T23:59:59+05:30`).getTime();

    const formatTask = (t: any, i: number) => {
      const pEmoji = priorityEmoji(t.priority);
      let due = '';
      if (t.deadline) {
        const d = new Date(t.deadline);
        due = ` — ${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`;
      }
      const assignee = (wantsAll || !!slots.assignee_name) && t.assignee?.full_name ? ` _(${t.assignee.full_name})_` : '';
      return `${i + 1}. ${pEmoji} *${t.title}*${due}${assignee} · ${statusLabel(t.status)}`;
    };

    const lines: string[] = [];
    const headerName = slots.assignee_name && !isSelfQuery
      ? (tasks as any[])[0]?.assignee?.full_name ?? slots.assignee_name
      : null;

    if (showDone) {
      // Completed tasks: list flat in completion order — no time bucketing
      // (bucketing by deadline makes no sense for already-done tasks)
      const header = headerName
        ? `✅ *${headerName}'s completed tasks (${tasks.length}):*`
        : wantsAll
          ? `✅ *${user_role === 'manager' ? 'Team' : 'All'} completed tasks (${tasks.length}):*`
          : `✅ *Your completed tasks (${tasks.length}):*`;
      lines.push(header, '');
      (tasks as any[]).forEach((t, i) => lines.push(formatTask(t, i)));
    } else {
      const filterLabel = statusFilter === 'in_progress' ? 'In Progress' : statusFilter === 'todo' ? 'To Do' : statusFilter === 'cancelled' ? 'Cancelled' : null;
      const header = headerName
        ? `📋 *${headerName}'s${filterLabel ? ` ${filterLabel}` : ''} tasks:*`
        : wantsAll
          ? `📋 *${user_role === 'manager' ? 'Team' : 'All'}${filterLabel ? ` ${filterLabel}` : ''} tasks:*`
          : (lang === 'hi' ? `📋 *आपके टास्क:*` : `📋 *Your${filterLabel ? ` ${filterLabel}` : ''} tasks:*`);
      lines.push(header);

      const overdue  = (tasks as any[]).filter((t) => t.deadline && new Date(t.deadline).getTime() < todayStartMs);
      const dueToday = (tasks as any[]).filter((t) => t.deadline && new Date(t.deadline).getTime() >= todayStartMs && new Date(t.deadline).getTime() <= todayEndMs);
      const rest     = (tasks as any[]).filter((t) => !t.deadline || new Date(t.deadline).getTime() > todayEndMs);

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
      const REST_DISPLAY_CAP = 10;
      if (rest.length > 0) {
        lines.push('');
        lines.push(lang === 'hi' ? `⏳ *आगामी:*` : `⏳ *Upcoming:*`);
        rest.slice(0, REST_DISPLAY_CAP).forEach((t, i) => lines.push(formatTask(t, i)));
        if (rest.length > REST_DISPLAY_CAP) {
          const more = rest.length - REST_DISPLAY_CAP;
          lines.push(lang === 'hi' ? `_...और ${more} टास्क_` : `_...and ${more} more_`);
        }
      }
      if (tasks.length === TASK_QUERY_LIMIT) {
        lines.push('');
        lines.push(lang === 'hi'
          ? `_सिर्फ पहले ${TASK_QUERY_LIMIT} दिखाए गए — पूरी लिस्ट के लिए dashboard देखें।_`
          : `_Showing the first ${TASK_QUERY_LIMIT} — check the dashboard for the complete list._`);
      }
      lines.push('');
      lines.push(lang === 'hi' ? `_टास्क पूरा करने के लिए: "टास्क का नाम complete किया"_` : `_To complete: "mark [task name] complete"_`);
    }

    return { success: true, reply: lines.join('\n'), data: { tasks: (tasks as any[]).map(t => ({ id: t.id, title: t.title })) } };
  },

  async COMPLETE_TASK({ slots, org_id, user_id, user_name, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const query = db
      .from('tasks')
      .select('id, title, created_by, status')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .is('deleted_at', null)
      .neq('status', 'done')
      .limit(3);

    const { data: tasks, error: completeLookupError } = await query;
    if (completeLookupError) throw completeLookupError;

    if ((tasks?.length ?? 0) > 1) {
      const titles = tasks!.map((t: any) => `· *${t.title}*`).join('\n');
      return { success: false, reply: lang === 'hi'
        ? `"${slots.title}" से मेल खाते कई tasks हैं:\n${titles}\n\nकृपया पूरा task नाम बताएं।`
        : `Multiple tasks match *"${slots.title}"*:\n${titles}\n\nPlease use the full task name.`
      };
    }

    const task = tasks?.[0] as any;
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    // Guard: cancelled tasks should not be silently marked done
    if (task.status === 'cancelled') {
      return { success: false, reply: lang === 'hi'
        ? `⚠️ *${task.title}* पहले से रद्द है। पहले इसे *in progress* करें, फिर complete करें।`
        : `⚠️ *${task.title}* is cancelled. Set it back to *in progress* first if you'd like to complete it.`
      };
    }

    const { data: completed, error: completeError } = await db
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString(), updated_by: user_id })
      .eq('id', task.id)
      .neq('status', 'done')
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (completeError) throw completeError;
    if (!completed) return { success: false, reply: `⚠️ *${task.title}* was already completed or changed. Please refresh your task list.` };

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'COMPLETE_TASK', table_name: 'tasks',
      record_id: task.id, new_data: { status: 'completed', title: task.title }, source: 'whatsapp',
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

    const taskQuery = db
      .from('tasks')
      .select('id, title')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .is('deleted_at', null);
    const { data: taskRows } = await taskQuery.limit(3);

    if ((taskRows?.length ?? 0) > 1) {
      const titles = taskRows!.map(t => `· *${t.title}*`).join('\n');
      return { success: false, reply: lang === 'hi'
        ? `"${slots.title}" से मेल खाते कई tasks हैं:\n${titles}\n\nकृपया पूरा task नाम बताएं।`
        : `Multiple tasks match *"${slots.title}"*:\n${titles}\n\nPlease use the full task name.`
      };
    }

    const task = taskRows?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    const { data: foundRows } = await db
      .from('users').select('id, full_name')
      .eq('organization_id', org_id)
      .eq('is_active', true)
      .ilike('full_name', `%${slots.assignee}%`)
      .limit(5);
    const found = foundRows?.[0] ?? null;

    if ((foundRows?.length ?? 0) > 1) {
      const options = foundRows!.map(u => `· ${u.full_name}`).join('\n');
      return { success: false, reply: `Multiple people match *${slots.assignee}*:\n${options}\n\nPlease use the full name.` };
    }

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
    const { data: assigned, error: assignError } = await db.from('tasks')
      .update({ assignee_id: found.id, updated_at: new Date().toISOString(), updated_by: user_id })
      .eq('id', task.id).is('deleted_at', null).select('id').maybeSingle();
    if (assignError) throw assignError;
    if (!assigned) return { success: false, reply: '⚠️ That task changed or was deleted. Please refresh your task list.' };
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

    const query = db
      .from('tasks')
      .select('id, title, assignee_id, created_by, priority, deadline')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .is('deleted_at', null)
      .limit(3);

    const { data: tasks, error: deleteLookupError } = await query;
    if (deleteLookupError) throw deleteLookupError;

    if ((tasks?.length ?? 0) > 1) {
      const titles = tasks!.map((t: any) => `· *${t.title}*`).join('\n');
      return { success: false, reply: lang === 'hi'
        ? `"${slots.title}" से मेल खाते कई tasks हैं:\n${titles}\n\nकृपया पूरा task नाम बताएं।`
        : `Multiple tasks match *"${slots.title}"*:\n${titles}\n\nPlease use the full task name to avoid deleting the wrong one.`
      };
    }

    const task = tasks?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    // Only the assignee, the creator ("assigned by"), or manager+ may delete a task.
    const actorIsAssignee = task.assignee_id === user_id;
    const actorIsCreator   = task.created_by === user_id;
    if (!actorIsAssignee && !actorIsCreator && !isManagerOrAbove(user_role)) {
      return { success: false, reply: lang === 'hi'
        ? '🚫 आप सिर्फ अपने assigned/created tasks delete कर सकते हैं, या manager/HR/admin होने पर कोई भी task।'
        : '🚫 You can only delete tasks assigned to you or created by you — unless you\'re a manager, HR, or admin.' };
    }

    const deletedAt = new Date().toISOString();
    const { data: deleted, error: deleteError } = await db.from('tasks')
      .update({ deleted_at: deletedAt, updated_by: user_id })
      .eq('id', task.id).is('deleted_at', null).select('id').maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) return { success: false, reply: '⚠️ That task was already deleted or changed. Please refresh your task list.' };

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'DELETE_TASK', table_name: 'tasks',
      record_id: task.id, new_data: { deleted_at: deletedAt, title: task.title }, source: 'whatsapp',
    });

    // Notification goes to "the other party" — see the matching note in UPDATE_TASK.
    const notifyTargetId = actorIsAssignee ? task.created_by : task.assignee_id;
    if (notifyTargetId && notifyTargetId !== user_id) {
      const { data: deleter } = await db.from('users').select('full_name').eq('id', user_id).single();
      notifyTaskDeleted({
        orgId:       org_id,
        taskTitle:   task.title,
        priority:    task.priority,
        deadline:    task.deadline,
        assigneeId:  notifyTargetId,
        deleterName: deleter?.full_name ?? 'your manager',
      }).catch(() => {});
    }

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

    // task_title is the correct slot name from the tool definition
    const taskTitle = (slots.task_title ?? slots.title) as string | undefined;
    if (!taskTitle) {
      return { success: false, reply: lang === 'hi'
        ? '❌ कौन सा task update करना है? उसका नाम बताएं।'
        : '❌ Which task would you like to update? Please provide the task name.' };
    }

    if (!slots.update_field) {
      return { success: false, reply: lang === 'hi'
        ? `❌ *${taskTitle}* में क्या update करना है? (deadline / priority / assignee / status / title)`
        : `❌ What would you like to update on *${taskTitle}*?\n\nYou can change: deadline / priority / assignee / status / title` };
    }

    const query = db
      .from('tasks')
      .select('id, title, assignee_id, created_by, priority, deadline, status, assignee:users!tasks_assignee_id_fkey(full_name)')
      .eq('organization_id', org_id)
      .ilike('title', `%${taskTitle}%`)
      .is('deleted_at', null)
      .limit(3);

    const { data: tasks, error: updateLookupError } = await query;
    if (updateLookupError) throw updateLookupError;

    if ((tasks?.length ?? 0) > 1) {
      const titles = (tasks as any[]).map(t => `· *${t.title}*`).join('\n');
      return { success: false, reply: lang === 'hi'
        ? `"${taskTitle}" से मेल खाते कई tasks हैं:\n${titles}\n\nकृपया पूरा task नाम बताएं।`
        : `Multiple tasks match *"${taskTitle}"*:\n${titles}\n\nPlease use the full task name.`
      };
    }

    const task = (tasks as any[])?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(taskTitle, lang) };

    // Only the assignee, the creator ("assigned by"), or manager+ may update a task.
    const actorIsAssignee = task.assignee_id === user_id;
    const actorIsCreator   = task.created_by === user_id;
    if (!actorIsAssignee && !actorIsCreator && !isManagerOrAbove(user_role)) {
      return { success: false, reply: lang === 'hi'
        ? '🚫 आप सिर्फ अपने assigned/created tasks update कर सकते हैं, या manager/HR/admin होने पर कोई भी task।'
        : '🚫 You can only update tasks assigned to you or created by you — unless you\'re a manager, HR, or admin.' };
    }

    const patch: Record<string, unknown> = {};
    let updatedAssigneeId: string | null = null;
    let updatedAssigneeName: string | null = null;

    // Helper: apply one field/value pair to the patch. Returns an error reply or null on success.
    const applyField = async (field: string | undefined, value: string): Promise<string | null> => {
      const f = field?.toLowerCase().trim();
      if (!f) return null;
      if (f === 'title') {
        if (!value) return lang === 'hi' ? `❌ नया title बताएं।` : `❌ Please provide the new title.`;
        patch.title = value;
      } else if (f === 'deadline') {
        const utc = parseDeadlineString(value);
        if (!utc) return lang === 'hi'
          ? `❌ तारीख का format सही नहीं है। Example: "6 Jul 2026 5pm"`
          : `❌ Invalid date format. Try: "6 Jul 2026 5pm" or "12-07-2026 4pm".`;
        patch.deadline = utc;
      } else if (f === 'priority') {
        const PRIORITY_MAP: Record<string, string> = {
          urgent: 'urgent', critical: 'urgent', asap: 'urgent', top: 'urgent', highest: 'urgent',
          high: 'high', hi: 'high',
          medium: 'medium', med: 'medium', normal: 'medium', moderate: 'medium',
          low: 'low', lo: 'low', minor: 'low',
        };
        const normalized = PRIORITY_MAP[value.toLowerCase()];
        if (!normalized) return lang === 'hi'
          ? `❌ Priority: low / medium / high / urgent में से एक चुनें।`
          : `❌ Invalid priority. Use: low / medium / high / urgent`;
        patch.priority = normalized;
      } else if (f === 'status') {
        const statusMap: Record<string, string> = {
          todo: 'todo', pending: 'todo', open: 'todo', new: 'todo',
          'in_progress': 'in_progress', 'in progress': 'in_progress', wip: 'in_progress',
          started: 'in_progress', doing: 'in_progress', ongoing: 'in_progress',
          done: 'done', completed: 'done', complete: 'done', khatam: 'done', finished: 'done',
          cancelled: 'cancelled', cancel: 'cancelled', dropped: 'cancelled',
        };
        const mapped = statusMap[value.toLowerCase()];
        if (!mapped) return lang === 'hi'
          ? `❌ Status: todo / in_progress / done / cancelled`
          : `❌ Invalid status. Use: todo / in_progress / done / cancelled`;
        patch.status = mapped;
        if (mapped === 'done') patch.completed_at = new Date().toISOString();
      } else if (f === 'assignee') {
        const { data: foundRows } = await db
          .from('users').select('id, full_name')
          .eq('organization_id', org_id).eq('is_active', true).is('deleted_at', null).ilike('full_name', `%${value}%`).limit(5);
        const found = foundRows?.[0] ?? null;
        if ((foundRows?.length ?? 0) > 1) {
          const options = foundRows!.map(u => `· ${u.full_name}`).join('\n');
          return `Multiple people match *${value}*:\n${options}\n\nPlease use the full name.`;
        }
        if (!found) {
          const { data: avail } = await db.from('users').select('full_name')
            .eq('organization_id', org_id).eq('is_active', true).is('deleted_at', null)
            .neq('id', user_id).limit(10);
          const names = (avail ?? []).map((u: {full_name: string}) => `· ${u.full_name}`).join('\n') || '(none)';
          return lang === 'hi'
            ? `❌ *${value}* नहीं मिला।\n\nउपलब्ध assignees:\n${names}`
            : `❌ *${value}* not found.\n\nAvailable assignees:\n${names}`;
        }
        patch.assignee_id = found.id;
        updatedAssigneeId = found.id;
        updatedAssigneeName = found.full_name;
      } else {
        // Unknown field — tell the user what's supported
        return lang === 'hi'
          ? `❌ *${f}* field को update नहीं किया जा सकता। Valid fields: title / deadline / priority / assignee / status`
          : `❌ Cannot update *${f}*. Supported fields: title / deadline / priority / assignee / status`;
      }
      return null;
    };

    const field = slots.update_field?.toLowerCase().trim();

    const errMsg1 = await applyField(slots.update_field ?? undefined, slots.update_value?.trim() ?? '');
    if (errMsg1) return { success: false, reply: errMsg1 };

    if (slots.update_field_2 && slots.update_value_2) {
      const errMsg2 = await applyField(slots.update_field_2, slots.update_value_2.trim());
      if (errMsg2) return { success: false, reply: errMsg2 };
    }

    if (!Object.keys(patch).length) {
      return { success: false, reply: lang === 'hi'
        ? `क्या अपडेट करना है? (deadline / priority / assignee / status)`
        : `What should I update? deadline / priority / assignee / status`
      };
    }

    patch.updated_at = new Date().toISOString();
    patch.updated_by = user_id;
    const { data: updatedTask, error: updateError } = await db.from('tasks')
      .update(patch).eq('id', task.id).is('deleted_at', null).select('id').maybeSingle();
    if (updateError) throw updateError;
    if (!updatedTask) return { success: false, reply: '⚠️ That task changed or was deleted. Please refresh your task list.' };

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'UPDATE_TASK', table_name: 'tasks',
      record_id: task.id,
      // If title itself changed, patch.title IS the new title — keep it.
      // Otherwise stash the pre-existing title under a separate key purely
      // so the activity feed can identify "which task", without it being
      // mistaken for a real title change (see task_ref in ActivityFeedList).
      new_data: { ...patch, ...(patch.title === undefined ? { task_ref: task.title } : {}) },
      source: 'whatsapp',
    });

    // Human-readable OLD value for a field, read from `task` (the record as
    // it was *before* this patch) — used so every WhatsApp notification can
    // say "changed from X to Y" instead of just announcing the new value.
    const oldDisplayValue = (f: string): string => {
      if (f === 'priority') {
        const pVal = task.priority ?? 'medium';
        return `${priorityEmoji(pVal)} ${pVal}`;
      }
      if (f === 'deadline') return task.deadline ? formatDateTime(task.deadline) + ' IST' : '(none)';
      if (f === 'assignee') return (task.assignee as { full_name?: string } | null)?.full_name ?? '(unassigned)';
      if (f === 'status') return task.status ?? 'todo';
      return task.title;
    };

    // Use human-readable values in the reply (avoid showing UUIDs for assignee).
    const value = slots.update_value?.trim() ?? '';
    let displayValue: string;
    if (field === 'assignee') {
      displayValue = updatedAssigneeName ?? value;
    } else if (field === 'priority') {
      const pVal = String(patch.priority ?? value);
      displayValue = `${priorityEmoji(pVal)} ${pVal}`;
    } else if (field === 'deadline') {
      displayValue = formatDateTime(patch.deadline as string) + ' IST';
    } else {
      displayValue = String(patch.title ?? patch.status ?? value);
    }
    const displayField = field ?? 'field';
    const oldValue = field ? oldDisplayValue(field) : '';
    // Always identify the task by its title *before* this update, even when
    // the title itself is the field being changed — otherwise a rename shows
    // the same new title twice ("X" ... "title changed to: X") with no way
    // to tell what it used to be called.
    const displayTitle = task.title;

    // Build combined update label when two fields were updated
    const hasField2 = !!(slots.update_field_2 && slots.update_value_2);

    // Same display-value treatment as field 1 (priority emoji, formatted
    // deadline, etc.) so a combined update tells the assignee about BOTH
    // changes, not just the first one.
    let displayField2: string | undefined;
    let displayValue2: string | undefined;
    let oldValue2: string | undefined;
    if (hasField2) {
      const field2 = slots.update_field_2!.toLowerCase().trim();
      const value2 = slots.update_value_2!.trim();
      displayField2 = field2;
      oldValue2 = oldDisplayValue(field2);
      if (field2 === 'priority') {
        const pVal2 = String(patch.priority ?? value2);
        displayValue2 = `${priorityEmoji(pVal2)} ${pVal2}`;
      } else if (field2 === 'deadline') {
        displayValue2 = formatDateTime(patch.deadline as string) + ' IST';
      } else if (field2 === 'title') {
        displayValue2 = String(patch.title ?? value2);
      } else if (field2 === 'status') {
        displayValue2 = String(patch.status ?? value2);
      } else if (field2 === 'assignee') {
        displayValue2 = updatedAssigneeName ?? value2;
      } else {
        displayValue2 = value2;
      }
    }

    const field2Label = hasField2 ? ` and *${displayField2}* from *${oldValue2}* to *${displayValue2}*` : '';

    // Notification goes to "the other party": if the assignee made this change,
    // tell the creator (assigned-by); otherwise (creator or manager/HR/admin
    // acting on someone else's task) tell the assignee, as before.
    const currentAssigneeId = updatedAssigneeId ?? task.assignee_id;
    const notifyTargetId = actorIsAssignee ? task.created_by : currentAssigneeId;
    if (notifyTargetId && notifyTargetId !== user_id) {
      const { data: updater } = await db.from('users').select('full_name').eq('id', user_id).single();
      notifyTaskUpdated({
        orgId:       org_id,
        taskTitle:   displayTitle,
        field:       displayField,
        oldValue:    oldValue,
        value:       displayValue,
        field2:      displayField2,
        oldValue2:   oldValue2,
        value2:      displayValue2,
        assigneeId:  notifyTargetId,
        updaterName: updater?.full_name ?? 'your manager',
      }).catch(() => {});
    }

    return {
      success: true,
      reply: lang === 'hi'
        ? `✅ *"${displayTitle}"* — ${displayField} *${oldValue}* से *${displayValue}* में बदला${hasField2 ? ` और ${displayField2} *${oldValue2}* से *${displayValue2}* में बदला` : ''}!`
        : `✅ *"${displayTitle}"* — *${displayField}* changed from *${oldValue}* to *${displayValue}*${field2Label}!`,
    };
  },

  async SET_REMINDER({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const message   = (slots.message ?? slots.title ?? '').trim().slice(0, 1000);
    const remindAt  = slots.remind_at ?? slots.deadline ?? null;

    if (!message || !remindAt) {
      return { success: false, reply: lang === 'hi'
        ? '❌ रिमाइंडर के लिए message और time दोनों बताएं।'
        : '❌ Please provide both a message and a time for the reminder.'
      };
    }

    // Parse remind_at — accept ISO or YYYY-MM-DD HH:MM
    let fireAt: Date;
    try {
      const parsed = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(remindAt)
        ? remindAt
        : parseDeadlineString(remindAt);
      if (!parsed) throw new Error('invalid');
      fireAt = new Date(parsed);
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
    const { data: u } = await db.from('users').select('wa_number').eq('id', user_id).single();
    const finalWaNumber = u?.wa_number ?? null;

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

    // Determine which scheduled run will actually deliver this reminder.
    // Reminders are checked at 9 AM and 6 PM IST daily.
    const fireHourIST = fireAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
    const deliverySlot = Number(fireHourIST) < 9  ? '9:00 AM'
                       : Number(fireHourIST) < 18 ? '6:00 PM'
                       : '9:00 AM (next day)';

    const displayTime = fireAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });

    return {
      success: true,
      reply: lang === 'hi'
        ? `⏰ *रिमाइंडर सेट!*\n\n📋 ${message}\n🗓 ${displayTime} IST\n\n_यह reminder ${deliverySlot} IST पर deliver होगा।_`
        : `⏰ *Reminder set!*\n\n📋 ${message}\n🗓 ${displayTime} IST\n\n_This will be delivered at ${deliverySlot} IST._`,
    };
  },

  async TASK_DETAILS({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!slots.title) {
      return { success: false, reply: lang === 'hi'
        ? '❌ कौन सा task देखना है? उसका नाम बताएं।'
        : '❌ Which task would you like details for? Please provide the task name.' };
    }

    const query = db
      .from('tasks')
      .select(`id, title, status, deadline, priority, description,
        assignee:users!tasks_assignee_id_fkey(full_name),
        created_by:users!tasks_created_by_fkey(full_name)`)
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .is('deleted_at', null)
      .limit(1);

    const { data: tasks, error: detailLookupError } = await query;
    if (detailLookupError) throw detailLookupError;
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
    if (!slots.leave_type?.trim() || !slots.start_date?.trim()) {
      return { success: false, reply: '❌ Please provide the leave type and start date.' };
    }

    const { data: leaveType, error: leaveTypeError } = await db
      .from('leave_types')
      .select('id, name, requires_approval, max_days_per_year')
      .eq('organization_id', org_id)
      .ilike('name', `%${slots.leave_type}%`)
      .maybeSingle();
    if (leaveTypeError) throw leaveTypeError;

    if (!leaveType) {
      return { success: false, reply: lang === 'hi'
        ? `❌ "${slots.leave_type}" leave type नहीं मिली। HR से संपर्क करें।`
        : `❌ Leave type *"${slots.leave_type}"* not found. Contact HR to set up leave types.`
      };
    }

    const startDate = slots.start_date!;
    let endDate = slots.end_date ?? startDate;

    const isValidYmd = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const [y, m, d] = value.split('-').map(Number);
      const parsed = new Date(Date.UTC(y, m - 1, d));
      return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
    };
    if (!isValidYmd(startDate) || !isValidYmd(endDate)) {
      return { success: false, reply: '❌ Invalid leave date. Please use a real date such as 2026-07-15.' };
    }

    if (slots.duration_days && !slots.end_date) {
      const duration = Number(slots.duration_days);
      if (!Number.isInteger(duration) || duration < 1 || duration > 365) {
        return { success: false, reply: '❌ Leave duration must be between 1 and 365 days.' };
      }
      const start = new Date(startDate);
      start.setDate(start.getDate() + duration - 1);
      endDate = start.toISOString().split('T')[0];
    }

    // Validate: start date must not be in the past
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (startDate < todayStr) {
      return { success: false, reply: lang === 'hi'
        ? `⚠️ छुट्टी की शुरुआती तारीख आज या भविष्य में होनी चाहिए।`
        : `⚠️ Leave start date must be today or in the future.`
      };
    }

    // Validate: end date must be on or after start date
    if (endDate < startDate) {
      return { success: false, reply: lang === 'hi'
        ? `⚠️ अंतिम तारीख शुरुआती तारीख से पहले नहीं हो सकती।`
        : `⚠️ End date must be on or after the start date.`
      };
    }

    const totalDays = calcBusinessDays(startDate, endDate);
    const year = new Date(startDate).getFullYear();

    // Validate: must be at least 1 business day
    if (totalDays <= 0) {
      return { success: false, reply: lang === 'hi'
        ? `⚠️ छुट्टी कम से कम 1 कार्यदिवस की होनी चाहिए।`
        : `⚠️ Leave must be at least 1 business day.`
      };
    }

    // Check for overlapping pending or approved leaves
    const { data: overlapping } = await db
      .from('leave_requests')
      .select('start_date, end_date, status')
      .eq('employee_id', user_id)
      .in('status', ['pending', 'approved'])
      .lte('start_date', endDate)
      .gte('end_date', startDate)
      .limit(1)
      .maybeSingle();

    if (overlapping) {
      return { success: false, reply: lang === 'hi'
        ? `⚠️ इन तारीखों पर पहले से एक *${overlapping.status}* छुट्टी है (${formatDate(overlapping.start_date)} – ${formatDate(overlapping.end_date)})। पहले उसे रद्द करें।`
        : `⚠️ You already have a *${overlapping.status}* leave from *${formatDate(overlapping.start_date)}* to *${formatDate(overlapping.end_date)}* overlapping these dates. Cancel it first if you'd like to change it.`
      };
    }

    const { data: balance } = await db
      .from('leave_balances')
      .select('remaining_days')
      .eq('employee_id', user_id)
      .eq('leave_type_id', leaveType.id)
      .eq('year', year)
      .maybeSingle();

    if (!balance) {
      return { success: false, reply: lang === 'hi'
        ? `❌ ${leaveType.name} का leave balance configured नहीं है। HR से संपर्क करें।`
        : `❌ No ${leaveType.name} leave balance is configured for you. Please contact HR.` };
    }
    if (balance.remaining_days < totalDays) {
      return {
        success: false,
        reply: REPLIES.leaveInsufficientBalance(balance.remaining_days, totalDays, leaveType.name, lang),
      };
    }

    const reason = (slots.reason === 'SKIP' || !slots.reason) ? null : slots.reason.trim().slice(0, 1000);

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
      record_id: request.id, new_data: { ...request, leave_type_name: leaveType.name }, source: 'whatsapp',
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
    const isPrivileged = ['manager', 'hr', 'admin', 'super_admin'].includes(user_role);

    let query = db
      .from('leave_requests')
      .select(`id, start_date, end_date, duration_days, status, reason,
        leave_types(name), users!leave_requests_employee_id_fkey(full_name)`)
      .eq('organization_id', org_id)
      .order('created_at', { ascending: false })
      .limit(6);

    if (!isPrivileged) {
      query = query.eq('employee_id', user_id);
    } else if (user_role === 'manager') {
      const allowed = [user_id, ...await managerTeamIds(org_id, user_id)];
      if (slots.employee_name) {
        const { data: target } = await db.from('users').select('id').eq('organization_id', org_id)
          .ilike('full_name', `%${slots.employee_name}%`).limit(1).maybeSingle();
        if (!target || !allowed.includes(target.id)) return { success: false, reply: '🚫 Managers can only view leave requests for direct reports.' };
        query = query.eq('employee_id', target.id);
      } else {
        query = query.in('employee_id', allowed);
      }
    } else if (slots.employee_name) {
      // Manager filtering by a specific person
      const { data: empRows } = await db.from('users').select('id, full_name')
        .eq('organization_id', org_id).ilike('full_name', `%${slots.employee_name}%`).limit(5);
      let empTarget: { id: string; full_name: string } | null = (empRows?.[0] as { id: string; full_name: string }) ?? null;
      if (!empTarget) {
        const { data: allU } = await db.from('users').select('id, full_name')
          .eq('organization_id', org_id).eq('is_active', true).limit(50);
        let bestScore = 0;
        for (const u of (allU ?? []) as { id: string; full_name: string }[]) {
          const score = Math.max(...[u.full_name, ...u.full_name.split(' ')].map(n => nameSimilarity(slots.employee_name!, n)));
          if (score > bestScore) { bestScore = score; empTarget = u; }
        }
        if (bestScore < 0.65) return { success: false, reply: REPLIES.notFound(slots.employee_name!, lang) };
      }
      query = query.eq('employee_id', empTarget!.id);
    }
    // If privileged with no employee_name filter, show all org leaves

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

    if (!slots.employee_name) {
      return { success: false, reply: lang === 'hi'
        ? '❌ किस कर्मचारी की leave approve करनी है? उनका नाम बताएं।'
        : '❌ Which employee\'s leave would you like to approve? Please provide their name.' };
    }

    const { data: empRows } = await db.from('users').select('id, full_name, manager_id')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.employee_name}%`)
      .limit(5);
    if ((empRows?.length ?? 0) > 1) {
      const options = empRows!.map(u => `· ${u.full_name}`).join('\n');
      return { success: false, reply: `Multiple employees match *${slots.employee_name}*:\n${options}\n\nPlease use the full name.` };
    }

    // Fuzzy fallback when ilike finds nothing
    type EmpRecord = { id: string; full_name: string; manager_id: string | null };
    let employee: EmpRecord | null = (empRows?.[0] as EmpRecord) ?? null;
    if (!employee) {
      const { data: allUsers } = await db.from('users').select('id, full_name, manager_id')
        .eq('organization_id', org_id).eq('is_active', true).limit(50);
      let best: EmpRecord | null = null, bestScore = 0;
      for (const u of (allUsers ?? []) as EmpRecord[]) {
        const score = Math.max(...[u.full_name, ...u.full_name.split(' ')].map(n => nameSimilarity(slots.employee_name!, n)));
        if (score > bestScore) { bestScore = score; best = u; }
      }
      if (bestScore >= 0.65) employee = best;
    }

    if (!employee) return { success: false, reply: REPLIES.notFound(slots.employee_name!, lang) };

    // Managers can only approve their own direct reports
    if (user_role === 'manager' && employee.manager_id !== user_id) {
      return { success: false, reply: lang === 'hi'
        ? `❌ आप केवल अपने direct reports की leave approve कर सकते हैं।`
        : `❌ You can only approve leave for your direct reports.`
      };
    }

    const { data: pendingLeaves } = await db
      .from('leave_requests')
      .select('id, leave_type_id, start_date, end_date, duration_days, leave_types(name)')
      .eq('organization_id', org_id)
      .eq('employee_id', employee.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(3);

    if (!pendingLeaves?.length) {
      return { success: false, reply: lang === 'hi'
        ? `${employee.full_name} का कोई pending leave नहीं।`
        : `No pending leave request found for *${employee.full_name}*.`
      };
    }

    // If multiple pending leaves, ask manager to clarify which one
    if (pendingLeaves.length > 1) {
      const list = pendingLeaves.map((r: any) =>
        `· *${(r.leave_types as any)?.name}* — ${formatDate(r.start_date)} to ${formatDate(r.end_date)}`
      ).join('\n');
      return { success: false, reply: lang === 'hi'
        ? `${employee.full_name} की ${pendingLeaves.length} pending leaves हैं:\n${list}\n\nकृपया तारीख के साथ बताएं: "Approve Rahul's leave from [date]"`
        : `${employee.full_name} has ${pendingLeaves.length} pending leave requests:\n${list}\n\nPlease specify which one: "Approve ${employee.full_name}'s [leave type] from [date]"`
      };
    }

    const request = pendingLeaves[0];

    const { data: approved, error: approveError } = await db.from('leave_requests').update({
      status: 'approved', reviewed_by: user_id, reviewed_at: new Date().toISOString(),
    }).eq('id', request.id).eq('status', 'pending').select('id').maybeSingle();
    if (approveError) {
      console.error('[APPROVE_LEAVE] update failed:', approveError.message);
      return { success: false, reply: '❌ Could not approve this leave. Please refresh the pending list and try again.' };
    }
    if (!approved) return { success: false, reply: '⚠️ This leave request was already reviewed. Please refresh the pending list.' };

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

    // notifyLeaveDecision above already sends the WhatsApp message + in-app
    // push notification to the employee — returning a `notify` array here
    // too would fire a second, differently-worded WhatsApp message and a
    // duplicate in-app notification for the same approval.
    return {
      success: true,
      reply: REPLIES.leaveApproved(employee.full_name, (request.leave_types as any)?.name, request.start_date, request.end_date, lang),
    };
  },

  async REJECT_LEAVE({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('reject leave', lang) };
    }

    if (!slots.employee_name) {
      return { success: false, reply: lang === 'hi'
        ? '❌ किस कर्मचारी की leave reject करनी है? उनका नाम बताएं।'
        : '❌ Which employee\'s leave would you like to reject? Please provide their name.' };
    }

    const { data: empRowsR } = await db.from('users').select('id, full_name, manager_id')
      .eq('organization_id', org_id)
      .ilike('full_name', `%${slots.employee_name}%`)
      .limit(5);
    if ((empRowsR?.length ?? 0) > 1) {
      const options = empRowsR!.map(u => `· ${u.full_name}`).join('\n');
      return { success: false, reply: `Multiple employees match *${slots.employee_name}*:\n${options}\n\nPlease use the full name.` };
    }

    // Fuzzy fallback when ilike finds nothing
    type EmpRec = { id: string; full_name: string; manager_id: string | null };
    let employee: EmpRec | null = (empRowsR?.[0] as EmpRec) ?? null;
    if (!employee) {
      const { data: allUsers } = await db.from('users').select('id, full_name, manager_id')
        .eq('organization_id', org_id).eq('is_active', true).limit(50);
      let best: EmpRec | null = null, bestScore = 0;
      for (const u of (allUsers ?? []) as EmpRec[]) {
        const score = Math.max(...[u.full_name, ...u.full_name.split(' ')].map(n => nameSimilarity(slots.employee_name!, n)));
        if (score > bestScore) { bestScore = score; best = u; }
      }
      if (bestScore >= 0.65) employee = best;
    }

    if (!employee) return { success: false, reply: REPLIES.notFound(slots.employee_name!, lang) };

    // Managers can only reject their own direct reports
    if (user_role === 'manager' && employee.manager_id !== user_id) {
      return { success: false, reply: lang === 'hi'
        ? `❌ आप केवल अपने direct reports की leave reject कर सकते हैं।`
        : `❌ You can only reject leave for your direct reports.`
      };
    }

    const { data: pendingR } = await db
      .from('leave_requests')
      .select('id, leave_types(name), start_date, end_date')
      .eq('organization_id', org_id)
      .eq('employee_id', employee.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(3);

    if (!pendingR?.length) {
      return { success: false, reply: lang === 'hi'
        ? `${employee.full_name} का कोई pending leave नहीं।`
        : `No pending leave found for *${employee.full_name}*.`
      };
    }

    if (pendingR.length > 1) {
      const list = (pendingR as any[]).map(r =>
        `· *${(r.leave_types as any)?.name}* — ${formatDate(r.start_date)} to ${formatDate(r.end_date)}`
      ).join('\n');
      return { success: false, reply: lang === 'hi'
        ? `${employee.full_name} की ${pendingR.length} pending leaves हैं:\n${list}\n\nकृपया तारीख के साथ बताएं: "Reject ${employee.full_name}'s leave from [date]"`
        : `${employee.full_name} has ${pendingR.length} pending leave requests:\n${list}\n\nPlease specify which one: "Reject ${employee.full_name}'s [leave type] from [date]"`
      };
    }

    const request = pendingR[0];
    const rawReason = (slots.reason === 'SKIP' || !slots.reason) ? null : slots.reason;
    const reason = rawReason ? rawReason.slice(0, 500) : null;

    const { data: rejected, error: rejectError } = await db.from('leave_requests').update({
      status: 'rejected', reviewed_by: user_id, reviewed_at: new Date().toISOString(),
      remarks: reason,
    }).eq('id', request.id).eq('status', 'pending').select('id').maybeSingle();
    if (rejectError) {
      console.error('[REJECT_LEAVE] update failed:', rejectError.message);
      return { success: false, reply: '❌ Could not reject this leave. Please refresh the pending list and try again.' };
    }
    if (!rejected) return { success: false, reply: '⚠️ This leave request was already reviewed. Please refresh the pending list.' };

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

    // notifyLeaveDecision above already sends the WhatsApp message + in-app
    // push notification to the employee — see the matching note in
    // APPROVE_LEAVE for why `notify` isn't also returned here.
    return {
      success: true,
      reply: REPLIES.leaveRejected(employee.full_name, (request.leave_types as any)?.name, lang),
    };
  },

  async CANCEL_LEAVE({ slots, org_id, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    // First try exact start_date match; if not found, check if the given date falls within a multi-day leave
    let { data: request } = await db
      .from('leave_requests')
      .select('id, leave_types(name), start_date, end_date')
      .eq('organization_id', org_id)
      .eq('employee_id', user_id)
      .eq('start_date', slots.start_date!)
      .in('status', ['pending', 'approved'])
      .maybeSingle();

    if (!request) {
      const { data: rangeHit } = await db
        .from('leave_requests')
        .select('id, leave_types(name), start_date, end_date')
        .eq('organization_id', org_id)
        .eq('employee_id', user_id)
        .in('status', ['pending', 'approved'])
        .lte('start_date', slots.start_date!)
        .gte('end_date', slots.start_date!)
        .maybeSingle();
      request = rangeHit ?? null;
    }

    if (!request) {
      return { success: false, reply: lang === 'hi'
        ? `${formatDate(slots.start_date!)} पर कोई active leave नहीं मिली।`
        : `No active leave found on or starting *${formatDate(slots.start_date!)}*.`
      };
    }

    const { data: cancelled, error: cancelError } = await db.from('leave_requests')
      .update({ status: 'cancelled' })
      .eq('id', request.id)
      .in('status', ['pending', 'approved'])
      .select('id').maybeSingle();
    if (cancelError) throw cancelError;
    if (!cancelled) return { success: false, reply: '⚠️ That leave request was already changed. Please refresh your leave list.' };

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
      .select('id, check_in_time, check_out_time')
      .eq('employee_id', user_id).eq('date', today)
      .not('check_in_time', 'is', null)
      .maybeSingle();

    if (!record) return { success: false, reply: REPLIES.notCheckedIn(lang) };
    if (record.check_out_time) {
      const cout = new Date(record.check_out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      return { success: false, reply: lang === 'hi'
        ? `आप पहले से *${cout}* बजे चेक-आउट कर चुके हैं। कल मिलते हैं! 👋`
        : `You already checked out at *${cout}* today. See you tomorrow! 👋` };
    }

    const { data: updated, error: checkoutError } = await db
      .from('attendance_records')
      .update({ check_out_time: now })
      .eq('id', record.id)
      .is('check_out_time', null)
      .select().maybeSingle();
    if (checkoutError) throw checkoutError;
    if (!updated) return { success: false, reply: '⚠️ Attendance was already updated. Please check your attendance status.' };

    // Calculate hours worked
    const hoursWorked = record.check_in_time
      ? ((new Date(now).getTime() - new Date(record.check_in_time).getTime()) / 3600000).toFixed(2)
      : (updated as any)?.total_hours?.toFixed(2) ?? '?';

    return { success: true, reply: REPLIES.checkOutSuccess(firstName, timeStr, hoursWorked, lang) };
  },

  async MY_ATTENDANCE({ org_id, user_id, slots, user_name }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const firstName = (user_name ?? 'there').split(' ')[0];

    const { data: records, error: attendanceError } = await db
      .from('attendance_records')
      .select('date, status, check_in_time, check_out_time, total_hours')
      .eq('employee_id', user_id).eq('organization_id', org_id)
      .gte('date', since)
      .order('date', { ascending: false });
    if (attendanceError) throw attendanceError;

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
    if (empRes.error) throw empRes.error;
    if (presentRes.error) throw presentRes.error;

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

    let usersQuery = db
      .from('users')
      .select('full_name, role, department, designation')
      .eq('organization_id', org_id)
      .eq('is_active', true)
      .is('deleted_at', null);
    if (user_role === 'manager') usersQuery = usersQuery.or(`id.eq.${user_id},manager_id.eq.${user_id}`);
    const { data: users, error: usersErr } = await usersQuery.order('full_name', { ascending: true }).limit(20);
    if (usersErr) throw usersErr;

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

  async START_ONBOARDING({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('start onboarding', lang) };
    }

    if (!slots.employee_name) {
      return { success: false, reply: lang === 'hi'
        ? "❌ कर्मचारी का नाम बताएं।"
        : "❌ Please provide the new employee's full name." };
    }
    const empName = slots.employee_name;
    if (!slots.wa_number) {
      return { success: false, reply: "Please provide the employee's WhatsApp number (with country code, e.g. +919876543210)." };
    }
    const waNumber = slots.wa_number.replace(/\s/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(waNumber)) {
      return { success: false, reply: '❌ Invalid WhatsApp number. Include the country code, for example +919876543210.' };
    }

    const bareWaNumber = waNumber.replace(/^\+/, '');
    const { data: existingEmployee } = await db.from('users')
      .select('id, full_name').eq('organization_id', org_id)
      .in('wa_number', [waNumber, bareWaNumber]).limit(1).maybeSingle();
    if (existingEmployee) {
      return { success: false, reply: `⚠️ This WhatsApp number is already registered to *${existingEmployee.full_name}*.` };
    }

    const { data: newAuthUser, error: authError } = await db.auth.admin.createUser({
      email:         `${bareWaNumber}@wa.placeholder`,
      password:      Math.random().toString(36).slice(2) + 'A1!',
      user_metadata: { full_name: empName },
    });

    if (authError && !authError.message.includes('already registered')) throw authError;

    const userId = newAuthUser?.user?.id;
    if (!userId) return { success: false, reply: REPLIES.error(lang) };

    const { error: profileError } = await db.from('users').upsert({
      id:               userId,
      organization_id:  org_id,
      full_name:        empName,
      email:            `${bareWaNumber}@wa.placeholder`,
      wa_number:        bareWaNumber,
      role:             'employee',
      department:       slots.department !== 'SKIP' ? slots.department ?? null : null,
      designation:      slots.designation !== 'SKIP' ? slots.designation ?? null : null,
      onboarding_status: 'in_progress',
    });
    if (profileError) {
      await db.auth.admin.deleteUser(userId).catch(() => {});
      throw profileError;
    }

    const { data: session, error: sessError } = await db.from('onboarding_sessions')
      .insert({ organization_id: org_id, employee_id: userId, initiated_by: user_id, current_step: 1, total_steps: 8, status: 'in_progress' })
      .select().single();

    if (sessError) throw sessError;

    const empId = await generateEmployeeId();
    const { error: employeeIdError } = await db.from('users').update({ employee_id: empId }).eq('id', userId);
    if (employeeIdError) throw employeeIdError;

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

    const { data: reminderUser, error: reminderError } = await db.from('users')
      .update({ metadata: { ...existingMeta, task_reminders: updates } })
      .eq('id', user_id).select('id').maybeSingle();
    if (reminderError) throw reminderError;
    if (!reminderUser) return { success: false, reply: REPLIES.error(lang) };

    const OFFSET_LABEL: Record<string, string> = {
      'same_day': lang === 'hi' ? 'deadline वाले दिन सुबह 9 बजे'         : 'morning of the deadline day (9 AM)',
      '1_day':    lang === 'hi' ? 'deadline से 1 दिन पहले सुबह 9 बजे'    : '1 day before deadline (9 AM)',
      '2_days':   lang === 'hi' ? 'deadline से 2 दिन पहले सुबह 9 बजे'    : '2 days before deadline (9 AM)',
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

  // ── PENDING LEAVES — manager view of all awaiting approval ─────────────────

  async PENDING_LEAVES({ org_id, user_id, user_role, slots }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!['manager', 'hr', 'admin', 'super_admin'].includes(user_role)) {
      return { success: false, reply: REPLIES.permissionDenied('view pending leaves', lang) };
    }

    let baseQuery = db
      .from('leave_requests')
      .select(`id, start_date, end_date, duration_days, reason, created_at,
        leave_types(name), users!leave_requests_employee_id_fkey(id, full_name)`)
      .eq('organization_id', org_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20);

    // Managers only see pending leaves from their direct reports
    if (user_role === 'manager') {
      const { data: reports } = await db
        .from('users').select('id').eq('manager_id', user_id).eq('organization_id', org_id);
      const reportIds = (reports ?? []).map((r: any) => r.id as string);
      if (reportIds.length === 0) {
        return { success: true, reply: lang === 'hi'
          ? '✅ आपके किसी direct report की कोई pending leave नहीं।'
          : '✅ No pending leave requests from your direct reports.' };
      }
      baseQuery = baseQuery.in('employee_id', reportIds);
    }

    const { data: requests } = await baseQuery;

    if (!requests?.length) {
      return { success: true, reply: lang === 'hi'
        ? '✅ कोई pending leave request नहीं।'
        : '✅ No pending leave requests at this time.' };
    }

    const lines = [lang === 'hi'
      ? `⏳ *Pending Leave Requests (${requests.length}):*`
      : `⏳ *Pending Leave Requests (${requests.length}):*`, ''];

    (requests as any[]).forEach((r, i) => {
      const empName = (r.users as any)?.full_name ?? 'Unknown';
      lines.push(`${i + 1}. *${empName}* — ${(r.leave_types as any)?.name ?? 'Leave'}`);
      lines.push(`   📆 ${formatDate(r.start_date)} → ${formatDate(r.end_date)} _(${r.duration_days}d)_`);
      if (r.reason) lines.push(`   💬 ${r.reason}`);
      lines.push(`   → "approve leave for ${empName}" / "reject leave for ${empName}"`);
      lines.push('');
    });

    return { success: true, reply: lines.join('\n').trimEnd() };
  },

  // ── LIST LEAVE TYPES — show configured leave categories ─────────────────────

  async LIST_LEAVE_TYPES({ org_id, slots }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: types } = await db
      .from('leave_types')
      .select('name, max_days_per_year, requires_approval, description')
      .eq('organization_id', org_id)
      .order('name');

    if (!types?.length) {
      return { success: true, reply: lang === 'hi'
        ? '📋 कोई leave type कॉन्फ़िगर नहीं है। HR से संपर्क करें।'
        : '📋 No leave types configured. Contact HR to set them up.' };
    }

    const lines = [lang === 'hi' ? '📋 *उपलब्ध Leave Types:*' : '📋 *Available Leave Types:*', ''];

    (types as any[]).forEach((t, i) => {
      const approvalStr = t.requires_approval
        ? (lang === 'hi' ? '_(अनुमोदन जरूरी)_' : '_(requires approval)_')
        : (lang === 'hi' ? '_(स्वतः स्वीकृत)_' : '_(auto-approved)_');
      lines.push(`${i + 1}. *${t.name}* ${approvalStr}`);
      if (t.max_days_per_year) lines.push(`   📊 Max: ${t.max_days_per_year} days/year`);
      if (t.description) lines.push(`   💬 ${t.description}`);
      lines.push('');
    });

    return { success: true, reply: lines.join('\n').trimEnd() };
  },

  // ── MY PROFILE — user's own info ────────────────────────────────────────────

  async MY_PROFILE({ user_id, org_id, slots, user_name, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    const { data: u } = await db
      .from('users')
      .select('full_name, employee_id, department, designation, wa_number, role, manager_id, created_at')
      .eq('id', user_id)
      .single();

    if (!u) return { success: false, reply: REPLIES.error(lang) };

    let managerName: string | null = null;
    if (u.manager_id) {
      const { data: mgr } = await db.from('users').select('full_name').eq('id', u.manager_id).single();
      managerName = mgr?.full_name ?? null;
    }

    const joinDate = u.created_at
      ? new Date(u.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })
      : null;

    const lines = [
      lang === 'hi' ? '👤 *मेरी प्रोफ़ाइल:*' : '👤 *My Profile:*',
      '',
      `*Name:* ${u.full_name}`,
      u.employee_id ? `*Employee ID:* ${u.employee_id}` : null,
      `*Role:* ${u.role}`,
      u.department ? `*Department:* ${u.department}` : null,
      u.designation ? `*Designation:* ${u.designation}` : null,
      managerName ? `*Manager:* ${managerName}` : null,
      u.wa_number ? `*WhatsApp:* +${u.wa_number}` : null,
      joinDate ? `*Joined:* ${joinDate}` : null,
    ].filter(Boolean) as string[];

    return { success: true, reply: lines.join('\n') };
  },

  // ── TASK STATS — quick task count breakdown ─────────────────────────────────

  async TASK_STATS({ org_id, user_id, user_role, slots }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';
    const today = todayISO();
    const todayStartMs = new Date(`${today}T00:00:00+05:30`).getTime();
    const todayEndMs   = todayStartMs + 86_400_000;

    const baseQuery = db
      .from('tasks')
      .select('id, status, deadline')
      .eq('organization_id', org_id)
      .is('deleted_at', null);

    const { data: tasks } = await baseQuery.limit(1000);
    if (!tasks) return { success: false, reply: REPLIES.error(lang) };
    const hitLimit = tasks.length === 1000;

    const all         = tasks as any[];
    const active      = all.filter(t => !['done', 'cancelled'].includes(t.status));
    const todo        = active.filter(t => t.status === 'todo');
    const inProgress  = active.filter(t => t.status === 'in_progress');
    const done        = all.filter(t => t.status === 'done');
    const cancelled   = all.filter(t => t.status === 'cancelled');
    const overdue     = active.filter(t => t.deadline && new Date(t.deadline).getTime() < todayStartMs);
    const dueToday    = active.filter(t => {
      if (!t.deadline) return false;
      const ms = new Date(t.deadline).getTime();
      return ms >= todayStartMs && ms < todayEndMs;
    });

    const scope = 'Organization';
    const lines: string[] = [
      lang === 'hi' ? `📊 *Organization Task Stats:*` : `📊 *${scope} Task Stats:*`,
      '',
      `🔴 Overdue: *${overdue.length}*`,
      `📅 Due Today: *${dueToday.length}*`,
      `⏳ To Do: *${todo.length}*`,
      `🔄 In Progress: *${inProgress.length}*`,
      `✅ Completed: *${done.length}*`,
      ...(cancelled.length > 0 ? [`❌ Cancelled: *${cancelled.length}*`] : []),
      '',
      `📋 *Active Total: ${active.length}*`,
      ...(hitLimit ? ['', '_⚠️ Result capped at 1000 tasks — counts may be approximate for very large teams._'] : []),
    ];

    return { success: true, reply: lines.join('\n') };
  },

  // ── ADD TASK NOTE — add/replace description on an existing task ──────────────

  async ADD_TASK_NOTE({ slots, org_id, user_id, user_role }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    if (!slots.title) {
      return { success: false, reply: lang === 'hi'
        ? '❌ किस task में note जोड़ना है, वो बताएं।'
        : '❌ Please specify which task you want to add a note to.' };
    }

    const rawNote = slots.note ?? slots.description ?? '';
    if (!rawNote) {
      return { success: false, reply: lang === 'hi'
        ? '❌ Note/description का text बताएं।'
        : '❌ Please provide the note or description to add.' };
    }
    const note = rawNote.slice(0, 2000);

    const query = db
      .from('tasks')
      .select('id, title, assignee_id')
      .eq('organization_id', org_id)
      .ilike('title', `%${slots.title}%`)
      .is('deleted_at', null)
      .limit(3);

    const { data: tasks, error: noteLookupError } = await query;
    if (noteLookupError) throw noteLookupError;

    if ((tasks?.length ?? 0) > 1) {
      const titles = (tasks as any[]).map(t => `· *${t.title}*`).join('\n');
      return { success: false, reply: lang === 'hi'
        ? `"${slots.title}" से मेल खाते कई tasks हैं:\n${titles}\n\nकृपया पूरा task नाम बताएं।`
        : `Multiple tasks match *"${slots.title}"*:\n${titles}\n\nPlease use the full task name.` };
    }

    const task = (tasks as any[])?.[0];
    if (!task) return { success: false, reply: REPLIES.taskNotFound(slots.title!, lang) };

    const { data: noted, error: noteError } = await db.from('tasks')
      .update({ description: note, updated_at: new Date().toISOString(), updated_by: user_id })
      .eq('id', task.id).is('deleted_at', null).select('id').maybeSingle();
    if (noteError) throw noteError;
    if (!noted) return { success: false, reply: '⚠️ That task changed or was deleted. Please refresh your task list.' };

    await writeAuditLog({
      org_id, actor_id: user_id, actor_type: 'user',
      action: 'ADD_TASK_NOTE', table_name: 'tasks',
      record_id: task.id, new_data: { description: note, title: task.title }, source: 'whatsapp',
    });

    return { success: true, reply: lang === 'hi'
      ? `✅ *"${task.title}"* में note जोड़ा गया।`
      : `✅ Note added to *"${task.title}"* successfully.` };
  },

  async ONBOARDING_STATUS({ slots, org_id, user_role, user_id }): Promise<ToolResult> {
    const db   = createAdminClient();
    const lang = (slots._lang as 'en' | 'hi') ?? 'en';

    let query = db
      .from('onboarding_sessions')
      .select(`id, current_step, total_steps, status, created_at, users!employee_id(full_name, department)`)
      .eq('organization_id', org_id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (user_role === 'employee') {
      query = query.eq('employee_id', user_id);
    } else if (user_role === 'manager') {
      const teamIds = await managerTeamIds(org_id, user_id);
      if (teamIds.length === 0) {
        return { success: true, reply: '👤 No onboarding sessions found for your direct reports.' };
      }
      query = query.in('employee_id', teamIds);
    }

    const { data: sessions, error: onboardingStatusError } = await query;
    if (onboardingStatusError) throw onboardingStatusError;

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
