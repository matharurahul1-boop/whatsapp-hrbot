/**
 * POST /api/escalate-leaves
 *
 * Checks all orgs for pending leave requests and sends WhatsApp escalations:
 *   – 24 h overdue → WhatsApp the manager (or HR role)
 *   – 48 h overdue → WhatsApp the admin / super_admin
 *   – 72 h overdue → WhatsApp the requesting employee with a status update
 *
 * Protected by a shared secret (ESCALATION_SECRET env var) so only cron or
 * super_admin dashboard calls can trigger it. If the env var is not set the
 * route still requires super_admin role via Supabase auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { sendText, sendTemplate }    from '@/lib/whatsapp/client';

const HOUR_MS = 60 * 60 * 1000;

// ── Helper: send a WA message (text first, template fallback) ────────────────

async function notifyViaWA(
  wa_number: string,
  message:   string,
  orgId:     string,
  orgName:   string,
  recipientName: string
): Promise<void> {
  try {
    await sendText(wa_number, message, orgId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fallback to template if outside 24h window
    if (msg.includes('131047') || msg.includes('131021')) {
      const db   = createAdminClient();
      const { data: org } = await db
        .from('organizations')
        .select('wa_message_template, wa_template_lang, wa_template_variables')
        .eq('id', orgId)
        .single();
      const tplName  = org?.wa_message_template?.trim() ?? null;
      const tplLang  = org?.wa_template_lang?.trim()    ?? 'en';
      const tplVars  = (org?.wa_template_variables as number) ?? 2;
      if (!tplName) throw new Error('No template configured and outside 24h window');
      const vars = tplVars === 1 ? [message]
                 : tplVars === 3 ? [recipientName, message, orgName]
                 : [recipientName, message];
      await sendTemplate(wa_number, tplName, vars, tplLang, orgId);
    } else {
      throw err;
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth: accept either the secret header or a super_admin session
  const secret  = process.env.ESCALATION_SECRET;
  const header  = req.headers.get('x-escalation-secret');

  let authorized = false;

  if (secret && header === secret) {
    authorized = true;
  } else {
    // Check Supabase auth
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const db = createAdminClient();
      const { data: profile } = await db
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role === 'super_admin' || profile?.role === 'admin' || profile?.role === 'hr') {
        authorized = true;
      }
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db  = createAdminClient();
  const now = Date.now();

  // Fetch all pending leave requests with user + org info
  const { data: pendingLeaves, error } = await db
    .from('leave_requests')
    .select(`
      id, organization_id, created_at,
      escalated_manager_at, escalated_admin_at, escalated_employee_at,
      reason, start_date, end_date,
      user:users!leave_requests_employee_id_fkey(
        id, full_name, wa_number, manager_id,
        manager:users!manager_id(id, full_name, wa_number)
      ),
      leave_type:leave_types!leave_requests_leave_type_id_fkey(name),
      organization:organizations!leave_requests_organization_id_fkey(
        id, name, wa_message_template, wa_template_lang, wa_template_variables
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[escalate-leaves] DB error:', error.message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const results: Array<{
    leaveId: string;
    action:  string;
    success: boolean;
    error?:  string;
  }> = [];

  for (const leave of pendingLeaves ?? []) {
    const age     = now - new Date(leave.created_at).getTime();
    const orgId   = leave.organization_id;
    const orgName = ((leave.organization as unknown) as { name: string } | null)?.name ?? 'HRBot';
    const employee = ((leave.user as unknown) as {
      id: string; full_name: string; wa_number: string | null; manager_id: string | null;
      manager?: { id: string; full_name: string; wa_number: string | null } | null;
    } | null);

    if (!employee) continue;

    const employeeName = employee.full_name;
    const leaveType    = ((leave.leave_type as unknown) as { name: string } | null)?.name ?? 'Leave';
    const dateRange    = `${leave.start_date} to ${leave.end_date}`;

    // ── 24h escalation → notify manager ─────────────────────────────────────
    if (age >= 24 * HOUR_MS && !leave.escalated_manager_at) {
      // Find manager: either direct manager_id or first HR/manager role in org
      let managerWa: string | null = null;
      let managerName = 'Manager';

      if (employee.manager?.wa_number) {
        managerWa   = employee.manager.wa_number;
        managerName = employee.manager.full_name;
      } else {
        // Fallback: any HR or manager in the org
        const { data: mgr } = await db
          .from('users')
          .select('full_name, wa_number')
          .eq('organization_id', orgId)
          .in('role', ['manager', 'hr'])
          .eq('is_active', true)
          .is('deleted_at', null)
          .not('wa_number', 'is', null)
          .limit(1)
          .maybeSingle();
        if (mgr?.wa_number) {
          managerWa   = mgr.wa_number;
          managerName = mgr.full_name;
        }
      }

      if (managerWa) {
        const msg = `⚠️ Pending Leave Approval\n\n${employeeName} has a ${leaveType} request (${dateRange}) that has been pending for over 24 hours. Please review and take action.`;
        try {
          await notifyViaWA(managerWa, msg, orgId, orgName, managerName);
          await db.from('leave_requests')
            .update({ escalated_manager_at: new Date().toISOString() })
            .eq('id', leave.id);
          results.push({ leaveId: leave.id, action: '24h→manager', success: true });
        } catch (err) {
          results.push({ leaveId: leave.id, action: '24h→manager', success: false, error: String(err) });
        }
      }
    }

    // ── 48h escalation → notify admin ───────────────────────────────────────
    if (age >= 48 * HOUR_MS && !leave.escalated_admin_at) {
      const { data: adminUser } = await db
        .from('users')
        .select('full_name, wa_number')
        .eq('organization_id', orgId)
        .in('role', ['admin', 'super_admin'])
        .eq('is_active', true)
        .is('deleted_at', null)
        .not('wa_number', 'is', null)
        .limit(1)
        .maybeSingle();

      if (adminUser?.wa_number) {
        const msg = `🚨 Escalation: Leave Still Pending\n\n${employeeName}'s ${leaveType} request (${dateRange}) has been pending for over 48 hours without action. Immediate attention required.`;
        try {
          await notifyViaWA(adminUser.wa_number, msg, orgId, orgName, adminUser.full_name);
          await db.from('leave_requests')
            .update({ escalated_admin_at: new Date().toISOString() })
            .eq('id', leave.id);
          results.push({ leaveId: leave.id, action: '48h→admin', success: true });
        } catch (err) {
          results.push({ leaveId: leave.id, action: '48h→admin', success: false, error: String(err) });
        }
      }
    }

    // ── 72h: notify the requesting employee of status (once only) ────────
    if (age >= 72 * HOUR_MS && !leave.escalated_employee_at && employee.wa_number) {
      const msg = `📋 Leave Request Update\n\nHi ${employeeName}, your ${leaveType} request (${dateRange}) is still under review. Please follow up with your manager or HR for an update.`;
      try {
        await notifyViaWA(employee.wa_number, msg, orgId, orgName, employeeName);
        await db.from('leave_requests')
          .update({ escalated_employee_at: new Date().toISOString() })
          .eq('id', leave.id);
        results.push({ leaveId: leave.id, action: '72h→employee', success: true });
      } catch (err) {
        results.push({ leaveId: leave.id, action: '72h→employee', success: false, error: String(err) });
      }
    }
  }

  return NextResponse.json({
    processed: pendingLeaves?.length ?? 0,
    actions:   results.length,
    results,
  });
}

// Allow GET for easy cron triggers (same logic)
export async function GET(req: NextRequest) {
  return POST(req);
}
