/**
 * GET/PATCH /api/organizations/[id]
 * The creation-time workspace fields for a SPECIFIC org — name, company
 * size, workday hours — editable by admin/super_admin members of the
 * platform-operator org for ANY organization, not just their own. This is
 * deliberately narrower than /api/organizations/settings (which handles
 * WhatsApp credentials, AI backend, etc. for the caller's own org only) —
 * only the fields captured during New Organization, so a platform operator
 * can fix what was set at creation time without touching a customer's live
 * WhatsApp/AI configuration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { checkPlatformOperatorAdmin } from '@/lib/auth/platform-operator';
import { z } from 'zod';

const PatchSchema = z.object({
  name:         z.string().trim().min(2).max(120).optional(),
  companySize:  z.enum(['1-10', '11-50', '51-200', '201-500', '501+']).optional(),
  workdayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  workdayEnd:   z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

async function requirePlatformOperator() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

  const db = createAdminClient();
  const { allowed } = await checkPlatformOperatorAdmin(db, user.id);
  if (!allowed) return { error: NextResponse.json({ error: 'Only the platform operator org can manage other organizations' }, { status: 403 }) } as const;

  return { db } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePlatformOperator();
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const { data, error } = await ctx.db
    .from('organizations').select('id, name, settings').eq('id', id).single();
  if (error || !data) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

  const settings = (data.settings as Record<string, unknown>) ?? {};
  const workHours = (settings.work_hours as { start?: string; end?: string } | undefined) ?? {};

  return NextResponse.json({
    data: {
      id: data.id,
      name: data.name,
      companySize: (settings.company_size as string | undefined) ?? '1-10',
      workdayStart: workHours.start ?? '09:00',
      workdayEnd: workHours.end ?? '18:00',
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePlatformOperator();
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return NextResponse.json({ error: firstError ? `${firstError.path.join('.') || 'field'}: ${firstError.message}` : 'Invalid request data' }, { status: 422 });
  }

  const { name, companySize, workdayStart, workdayEnd } = parsed.data;

  const { data: existing, error: fetchError } = await ctx.db
    .from('organizations').select('settings').eq('id', id).single();
  if (fetchError || !existing) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

  const currentSettings = (existing.settings as Record<string, unknown>) ?? {};
  const currentWorkHours = (currentSettings.work_hours as { start?: string; end?: string } | undefined) ?? {};

  const { error } = await ctx.db
    .from('organizations')
    .update({
      ...(name !== undefined && { name }),
      settings: {
        ...currentSettings,
        ...(companySize !== undefined && { company_size: companySize }),
        ...((workdayStart !== undefined || workdayEnd !== undefined) && {
          work_hours: {
            start: workdayStart ?? currentWorkHours.start ?? '09:00',
            end: workdayEnd ?? currentWorkHours.end ?? '18:00',
          },
        }),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
