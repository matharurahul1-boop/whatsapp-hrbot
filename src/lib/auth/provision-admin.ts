import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeWaNumber } from '@/lib/utils/phone';
import { AttendancePolicySchema } from '@/lib/validation/attendance-policy-schema';
import { composeAttendancePolicySummary, ATTENDANCE_POLICY_DEFAULTS } from '@/lib/utils/attendance-policy-shared';
import type { AttendancePolicy } from '@/lib/utils/attendance-policy-shared';

const AdminWorkspaceBaseSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  orgName: z.string().trim().min(2, 'Company name must be at least 2 characters').max(120),
  waNumber: z.string().transform(value => normalizeWaNumber(value)).pipe(
    z.string().min(10, 'Enter a valid WhatsApp number with country code').max(15),
  ),
  // Department doesn't cleanly apply to a founding admin (they might be the
  // owner, IT, HR — anything) — optional here, unlike a real employee join
  // where it's required. Job title is kept since "Administrator"/"Owner"/
  // "Founder" is still meaningful context for the account that's setting
  // the workspace up.
  department: z.string().trim().max(80).optional(),
  designation: z.string().trim().min(2).max(80),
  companySize: z.enum(['1-10', '11-50', '51-200', '201-500', '501+']),
  timezone: z.string().trim().min(1).max(80).default('Asia/Kolkata'),
  workdayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  workdayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00'),
  // Optional — filled in when the creator completes the Attendance Policy
  // wizard as part of org setup (New Organization page). Left out entirely
  // when skipped; the new org's admin can still configure it later from
  // Settings → Attendance Policy, same as any existing org.
  attendancePolicy: AttendancePolicySchema.optional(),
});

const validWorkday = (data: { workdayStart: string; workdayEnd: string }) => data.workdayStart < data.workdayEnd;
const workdayError = {
  message: 'Workday end must be later than the start time',
  path: ['workdayEnd'],
};

export const AdminWorkspaceSchema = AdminWorkspaceBaseSchema.refine(validWorkday, workdayError);

export const PublicRegistrationSchema = AdminWorkspaceBaseSchema.extend({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(72)
    .regex(/[a-z]/, 'Password needs a lowercase letter')
    .regex(/[A-Z]/, 'Password needs an uppercase letter')
    .regex(/\d/, 'Password needs a number'),
}).refine(validWorkday, workdayError);

export type AdminWorkspaceInput = z.infer<typeof AdminWorkspaceSchema>;

export async function provisionAdminWorkspace(
  user: { id: string; email: string },
  input: AdminWorkspaceInput,
  options?: {
    // True when a DIFFERENT person (an existing admin, via New Organization)
    // typed this password on the new admin's behalf — that admin now knows
    // the plaintext, so the new org's founding admin is forced to set their
    // own password on first login. False (default) for self-service
    // bootstrap via /api/auth/setup, where the person setting the password
    // is the one who'll use it.
    forcePasswordChange?: boolean;
  },
) {
  const db = createAdminClient();

  const { data: existing, error: existingError } = await db
    .from('users')
    .select('id, organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (existingError) throw new Error(`Could not verify profile: ${existingError.message}`);
  if (existing) return { orgId: existing.organization_id, alreadyExists: true };

  // Refuse to silently spin up a duplicate workspace for a company that's
  // already here — this is how a single org name ends up with a dozen
  // empty, indistinguishable copies over time.
  const { data: dupOrg } = await db
    .from('organizations')
    .select('id')
    .ilike('name', input.orgName)
    .limit(1)
    .maybeSingle();
  if (dupOrg) {
    throw new Error(`A workspace named "${input.orgName}" already exists. Ask an admin there for an invite link instead of creating a new one.`);
  }

  const baseSlug = input.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'company';
  let orgId: string | null = null;

  try {
    const { data: org, error: orgError } = await db
      .from('organizations')
      .insert({
        name: input.orgName,
        slug: `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`,
        plan: 'free',
        settings: {
          registration_complete: true,
          company_size: input.companySize,
          timezone: input.timezone,
          work_hours: { start: input.workdayStart, end: input.workdayEnd },
        },
      })
      .select('id')
      .single();
    if (orgError || !org) throw new Error(`Failed to create organization: ${orgError?.message ?? 'No organization returned'}`);
    orgId = org.id;

    const { error: profileError } = await db.from('users').insert({
      id: user.id,
      organization_id: orgId,
      full_name: input.fullName,
      email: user.email,
      role: 'admin',
      wa_number: input.waNumber,
      department: input.department || 'Administration',
      designation: input.designation,
      onboarding_status: 'completed',
      is_active: true,
      joined_at: new Date().toISOString(),
      metadata: {
        registration_source: options?.forcePasswordChange ? 'admin_created' : 'self_setup',
        ...(options?.forcePasswordChange && { must_change_password: true }),
      },
    });
    if (profileError) throw new Error(`Failed to create admin profile: ${profileError.message}`);

    const { data: leaveTypes, error: leaveTypeError } = await db
      .from('leave_types')
      .insert([
        { organization_id: orgId, name: 'Casual Leave', default_days: 12, carry_forward: false, requires_approval: true, color: '#22c55e', is_active: true },
        { organization_id: orgId, name: 'Sick Leave', default_days: 10, carry_forward: false, requires_approval: false, color: '#ef4444', is_active: true },
        { organization_id: orgId, name: 'Annual Leave', default_days: 21, carry_forward: true, requires_approval: true, color: '#3b82f6', is_active: true },
        { organization_id: orgId, name: 'Maternity Leave', default_days: 180, carry_forward: false, requires_approval: true, color: '#ec4899', is_active: true },
      ])
      .select('id, default_days');
    if (leaveTypeError || !leaveTypes?.length) throw new Error(`Failed to initialize leave types: ${leaveTypeError?.message ?? 'No leave types returned'}`);

    const { error: onboardingError } = await db.from('onboarding_steps').insert([
      { organization_id: orgId, step_order: 1, title: 'Personal Information', description: 'Collect name, DOB, and contact details', step_type: 'info_collection', is_required: true, is_active: true },
      { organization_id: orgId, step_order: 2, title: 'Address Details', description: 'Permanent and current address', step_type: 'info_collection', is_required: true, is_active: true },
      { organization_id: orgId, step_order: 3, title: 'Emergency Contact', description: 'Emergency contact details', step_type: 'info_collection', is_required: true, is_active: true },
      { organization_id: orgId, step_order: 4, title: 'ID Proof Upload', description: 'Government-issued identity proof', step_type: 'document_upload', is_required: true, is_active: true },
      { organization_id: orgId, step_order: 5, title: 'Address Proof Upload', description: 'Utility bill or rental agreement', step_type: 'document_upload', is_required: true, is_active: true },
      { organization_id: orgId, step_order: 6, title: 'Education Certificates', description: 'Degree and mark sheets', step_type: 'document_upload', is_required: false, is_active: true },
      { organization_id: orgId, step_order: 7, title: 'Contract Signing', description: 'Employment contract acceptance', step_type: 'form', is_required: true, is_active: true },
      { organization_id: orgId, step_order: 8, title: 'HR Approval', description: 'Final HR sign-off', step_type: 'approval', is_required: true, is_active: true },
    ]);
    if (onboardingError) throw new Error(`Failed to initialize onboarding: ${onboardingError.message}`);

    const currentYear = new Date().getFullYear();
    const { error: balanceError } = await db.from('leave_balances').insert(
      leaveTypes.map(type => ({
        employee_id: user.id,
        organization_id: orgId,
        leave_type_id: type.id,
        entitled_days: type.default_days,
        used_days: 0,
        carried_over: 0,
        year: currentYear,
      })),
    );
    if (balanceError) throw new Error(`Failed to initialize leave balances: ${balanceError.message}`);

    // Attendance policy is optional — only written when the creator actually
    // completed the wizard during setup. Skipping it entirely (rather than
    // writing a defaulted, is_configured:false row) keeps this consistent
    // with an org that configures it later from Settings: no row until
    // someone deliberately confirms one.
    if (input.attendancePolicy) {
      const merged = { ...ATTENDANCE_POLICY_DEFAULTS, ...input.attendancePolicy } as AttendancePolicy;
      const { error: policyError } = await db.from('attendance_policies').insert({
        organization_id: orgId,
        ...input.attendancePolicy,
        summary_text: composeAttendancePolicySummary(merged),
        is_configured: true,
        configured_by: user.id,
      });
      if (policyError) throw new Error(`Failed to save attendance policy: ${policyError.message}`);
    }

    return { orgId, alreadyExists: false };
  } catch (error) {
    if (orgId) await db.from('organizations').delete().eq('id', orgId);
    throw error;
  }
}
