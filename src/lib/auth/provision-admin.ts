import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

const AdminWorkspaceBaseSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  orgName: z.string().trim().min(2, 'Company name must be at least 2 characters').max(120),
  waNumber: z.string().transform(value => value.replace(/\D/g, '')).pipe(
    z.string().min(10, 'Enter a valid WhatsApp number with country code').max(15),
  ),
  department: z.string().trim().min(2).max(80),
  designation: z.string().trim().min(2).max(80),
  companySize: z.enum(['1-10', '11-50', '51-200', '201-500', '501+']),
  timezone: z.string().trim().min(1).max(80).default('Asia/Kolkata'),
  workdayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  workdayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00'),
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
      whatsapp_number: input.waNumber,
      department: input.department,
      designation: input.designation,
      onboarding_status: 'completed',
      is_active: true,
      joined_at: new Date().toISOString(),
      metadata: { registration_source: 'public_signup' },
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

    return { orgId, alreadyExists: false };
  } catch (error) {
    if (orgId) await db.from('organizations').delete().eq('id', orgId);
    throw error;
  }
}
