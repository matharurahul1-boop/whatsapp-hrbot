import { NextRequest, NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyWelcome }   from '@/lib/whatsapp/notify';
import { z } from 'zod';

const JoinSchema = z.object({
  orgId:    z.string().uuid(),
  role:     z.enum(['employee', 'manager', 'hr']).default('employee'),
  fullName: z.string().min(2).max(100),
  waNumber: z.string().optional(),  // optional: notify via WA if provided
});

// POST /api/auth/join — join an existing org (called after signUp)
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const parsed = JoinSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

    const { orgId, role, fullName, waNumber } = parsed.data;

    const db = createAdminClient();

    // Check org exists
    const { data: org } = await db
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single();

    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    // Check user not already in a profile
    const { data: existing } = await db
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, message: 'Profile already exists' });
    }

    // Create user profile in the org with specified role
    const { error: userErr } = await db.from('users').insert({
      id:              user.id,
      organization_id: orgId,
      full_name:       fullName.trim(),
      email:           user.email ?? '',
      role:            role,
      is_active:       true,
      joined_at:       new Date().toISOString(),
      ...(waNumber ? { wa_number: waNumber.replace(/\D/g, '') } : {}),
    });

    if (userErr) throw new Error(`Failed to create profile: ${userErr.message}`);

    // Seed leave balances for the new user
    const currentYear = new Date().getFullYear();
    const { data: leaveTypes } = await db
      .from('leave_types')
      .select('id, default_days')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (leaveTypes && leaveTypes.length > 0) {
      await db.from('leave_balances').insert(
        leaveTypes.map(lt => ({
          employee_id:     user.id,
          organization_id: orgId,
          leave_type_id:   lt.id,
          entitled_days:   lt.default_days,
          used_days:       0,
          carried_over:    0,
          year:            currentYear,
        }))
      );
    }

    // Send WhatsApp welcome message if number was provided
    if (waNumber) {
      const { data: orgInfo } = await db.from('organizations').select('name').eq('id', orgId).single();
      notifyWelcome({
        orgId,
        waNumber:     waNumber.replace(/\D/g, ''),
        employeeName: fullName.trim(),
        companyName:  orgInfo?.name ?? 'your company',
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, orgId, role });
  } catch (err: unknown) {
    console.error('[join]', err);
    const message = err instanceof Error ? err.message : 'Join failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
