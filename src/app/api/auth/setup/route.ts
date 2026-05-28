import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    // Verify caller is authenticated
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { fullName, orgName } = await req.json();

    if (!fullName?.trim() || !orgName?.trim()) {
      return NextResponse.json({ error: 'Full name and organization name are required' }, { status: 400 });
    }

    const db = createAdminClient();

    // Check if profile already exists
    const { data: existing } = await db
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, message: 'Profile already exists' });
    }

    // Create organization
    const slug = orgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .insert({
        name: orgName.trim(),
        slug: `${slug}-${Date.now()}`,
        plan: 'pro',
        settings: { timezone: 'Asia/Kolkata', work_hours: { start: '09:00', end: '18:00' } },
      })
      .select('id')
      .single();

    if (orgErr) throw new Error(`Failed to create organization: ${orgErr.message}`);

    // Create admin user profile
    const { error: userErr } = await db
      .from('users')
      .insert({
        id:              user.id,
        organization_id: org.id,
        full_name:       fullName.trim(),
        email:           user.email ?? '',
        role:            'admin',
        is_active:       true,
        joined_at:       new Date().toISOString(),
      });

    if (userErr) {
      // Rollback org
      await db.from('organizations').delete().eq('id', org.id);
      throw new Error(`Failed to create user profile: ${userErr.message}`);
    }

    // Seed default leave types for this org
    await db.from('leave_types').insert([
      { organization_id: org.id, name: 'Casual Leave',    default_days: 12,  carry_forward: false, requires_approval: true,  color: '#22c55e', is_active: true },
      { organization_id: org.id, name: 'Sick Leave',      default_days: 10,  carry_forward: false, requires_approval: false, color: '#ef4444', is_active: true },
      { organization_id: org.id, name: 'Annual Leave',    default_days: 21,  carry_forward: true,  requires_approval: true,  color: '#3b82f6', is_active: true },
      { organization_id: org.id, name: 'Maternity Leave', default_days: 180, carry_forward: false, requires_approval: true,  color: '#ec4899', is_active: true },
    ]);

    // Seed default onboarding steps
    await db.from('onboarding_steps').insert([
      { organization_id: org.id, step_order: 1, title: 'Personal Information',   description: 'Collect name, DOB, contact details',  step_type: 'info_collection', is_active: true },
      { organization_id: org.id, step_order: 2, title: 'Address Details',        description: 'Permanent and current address',        step_type: 'info_collection', is_active: true },
      { organization_id: org.id, step_order: 3, title: 'Emergency Contact',      description: 'Emergency contact details',            step_type: 'info_collection', is_active: true },
      { organization_id: org.id, step_order: 4, title: 'ID Proof Upload',        description: 'Aadhar, PAN, Passport',                step_type: 'document_upload', is_active: true },
      { organization_id: org.id, step_order: 5, title: 'Address Proof Upload',   description: 'Utility bill or rental agreement',     step_type: 'document_upload', is_active: true },
      { organization_id: org.id, step_order: 6, title: 'Education Certificates', description: 'Degree and mark sheets',               step_type: 'document_upload', is_active: true },
      { organization_id: org.id, step_order: 7, title: 'Contract Signing',       description: 'Employment contract acceptance',       step_type: 'form',            is_active: true },
      { organization_id: org.id, step_order: 8, title: 'HR Approval',            description: 'Final HR sign-off',                    step_type: 'approval',        is_active: true },
    ]);

    // Initialize leave balances for the admin user
    // (trigger only fires on future inserts; admin was just inserted so do it manually)
    const currentYear = new Date().getFullYear();
    const { data: leaveTypes } = await db
      .from('leave_types')
      .select('id, default_days')
      .eq('organization_id', org.id)
      .eq('is_active', true);

    if (leaveTypes && leaveTypes.length > 0) {
      await db.from('leave_balances').insert(
        leaveTypes.map(lt => ({
          employee_id:   user.id,
          organization_id: org.id,
          leave_type_id: lt.id,
          entitled_days: lt.default_days,
          used_days:     0,
          carried_over:  0,
          year:          currentYear,
        }))
      );
    }

    return NextResponse.json({ ok: true, orgId: org.id });
  } catch (err: unknown) {
    console.error('[setup]', err);
    const message = err instanceof Error ? err.message : 'Setup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
