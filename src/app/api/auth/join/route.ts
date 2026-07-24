import { NextRequest, NextResponse } from 'next/server';
import { createClient }    from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyInvite, type InviteRole } from '@/lib/utils/invite-token';
import { normalizeWaNumber } from '@/lib/utils/phone';
import { z } from 'zod';

const JoinSchema = z.object({
  inviteToken: z.string().min(1),               // signed token from /api/organizations/invite — always required
  fullName:    z.string().min(2).max(100),
  waNumber:    z.string().min(6).max(20),
  department:  z.string().min(1).max(100),
  designation: z.string().min(1).max(100),
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

    const { fullName, waNumber, department, designation } = parsed.data;

    // Org and role are never trusted from the client — both come from a
    // signed token minted by an existing HR/admin user via
    // /api/organizations/invite. There used to be a bare org-picker path
    // (any authenticated new user could self-join any org UUID they knew,
    // no invite required) — removed, since it depended on a public
    // organizations/list endpoint that leaked every customer's org name.
    const payload = verifyInvite(parsed.data.inviteToken);
    if (!payload) return NextResponse.json({ error: 'Invite link is invalid or has expired' }, { status: 400 });
    const orgId: string = payload.orgId;
    const role: InviteRole = payload.role;

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
      department:      department.trim(),
      designation:     designation.trim(),
      is_active:       true,
      joined_at:       new Date().toISOString(),
      wa_number:       normalizeWaNumber(waNumber),
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

    // Welcome message is deferred — sent once an admin marks this account's
    // onboarding_status as 'completed' (see PATCH /api/employees).

    return NextResponse.json({ ok: true, orgId, role });
  } catch (err: unknown) {
    console.error('[join]', err);
    const message = err instanceof Error ? err.message : 'Join failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
