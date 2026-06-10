/**
 * POST /api/wa-broadcast
 *
 * Role-based broadcast:
 *   employee  → forbidden (403)
 *   manager   → can only message their own direct reports
 *   hr/admin  → can message any subset (department, role, specific IDs) or all
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { broadcastMessage } from '@/lib/whatsapp/notify';
import { isHrOrAbove, isManagerOrAbove } from '@/lib/rbac';
import { z } from 'zod';

const BroadcastSchema = z.object({
  message:     z.string().min(1).max(1000),
  department:  z.string().optional(),
  role:        z.string().optional(),
  employeeIds: z.array(z.string().uuid()).optional(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role, full_name')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // Only manager+ can broadcast
  if (!isManagerOrAbove(profile.role)) {
    return NextResponse.json({ error: 'Only managers and above can send broadcasts' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = BroadcastSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const { message, department, role, employeeIds } = parsed.data;
  const senderName = (profile as any).full_name ?? 'HR Team';

  // ── Manager: can only broadcast to their own direct reports ─────────────────
  if (!isHrOrAbove(profile.role)) {
    // Fetch this manager's direct reports
    const { data: reports } = await db
      .from('users')
      .select('id')
      .eq('manager_id', user.id)
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true);

    if (!reports?.length) {
      return NextResponse.json({ success: true, sent: 0, skipped: 0, note: 'No direct reports found' });
    }

    const teamIds = reports.map((r: any) => r.id);

    // If caller specified employeeIds, intersect with their team
    const targetIds = employeeIds?.length
      ? employeeIds.filter(id => teamIds.includes(id))
      : teamIds;

    if (!targetIds.length) {
      return NextResponse.json({ error: 'None of the specified employees are your direct reports' }, { status: 403 });
    }

    const { sent, skipped } = await broadcastMessage({
      orgId:      profile.organization_id,
      message,
      senderName,
      filter:     { employeeIds: targetIds },
    });

    return NextResponse.json({ success: true, sent, skipped, scope: 'team' });
  }

  // ── HR+: full control over who receives the broadcast ───────────────────────
  const { sent, skipped } = await broadcastMessage({
    orgId:      profile.organization_id,
    message,
    senderName,
    filter:     { department, role, employeeIds },
  });

  return NextResponse.json({ success: true, sent, skipped, scope: 'org' });
}
