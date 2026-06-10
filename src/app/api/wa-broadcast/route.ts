/**
 * POST /api/wa-broadcast
 *
 * HR / Admin sends a WhatsApp message to all employees
 * or a filtered subset (by department, role, or specific IDs).
 *
 * Body:
 *   message     string       — the text to send
 *   department? string       — filter by department
 *   role?       string       — filter by role
 *   employeeIds? string[]    — send to specific employee IDs only
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { broadcastMessage } from '@/lib/whatsapp/notify';
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

  // Only HR / Admin / Super Admin can broadcast
  if (!['super_admin', 'admin', 'hr'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only HR and admins can send broadcasts' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = BroadcastSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  const { message, department, role, employeeIds } = parsed.data;

  const { sent, skipped } = await broadcastMessage({
    orgId:      profile.organization_id,
    message,
    senderName: (profile as any).full_name ?? 'HR Team',
    filter:     { department, role, employeeIds },
  });

  return NextResponse.json({ success: true, sent, skipped });
}
