/**
 * PATCH /api/organizations/settings
 * Updates org name + WhatsApp API credentials.
 * Uses admin client (bypasses RLS) so the token is always saved reliably.
 * Only admin / super_admin can call this.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { isAdminOrAbove }            from '@/lib/rbac';
import { z } from 'zod';

const Schema = z.object({
  name:                 z.string().min(1).max(100).optional(),
  wa_phone_number_id:   z.string().max(50).optional(),
  wa_access_token:      z.string().min(1).optional(),
  wa_message_template:  z.string().max(100).nullable().optional(),
  wa_template_lang:     z.string().max(10).optional(),
  wa_template_variables: z.number().int().min(1).max(5).optional(),
  // AI backend toggle — stored inside organizations.settings JSONB, not a direct column
  ai_backend:           z.enum(['groq', 'claude']).optional(),
});

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (!isAdminOrAbove(profile.role))
    return NextResponse.json({ error: 'Only admins can update org settings' }, { status: 403 });

  const body   = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    const msg = firstError ? `${firstError.path.join('.') || 'field'}: ${firstError.message}` : 'Invalid request data';
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const { ai_backend, ...directFields } = parsed.data;
  const orgId = profile.organization_id;

  // Update direct columns (name, wa_*, etc.) if any were supplied
  if (Object.keys(directFields).length > 0) {
    const { error } = await db
      .from('organizations')
      .update({ ...directFields, updated_at: new Date().toISOString() })
      .eq('id', orgId);
    if (error) {
      console.error('[org/settings PATCH] direct columns:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Merge ai_backend into the settings JSONB column
  if (ai_backend !== undefined) {
    const { data: org } = await db
      .from('organizations').select('settings').eq('id', orgId).single();
    const current = (org?.settings as Record<string, unknown>) ?? {};
    const { error } = await db
      .from('organizations')
      .update({ settings: { ...current, ai_backend } })
      .eq('id', orgId);
    if (error) {
      console.error('[org/settings PATCH] ai_backend:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data, error: selErr } = await db
    .from('organizations')
    .select('id, name, wa_phone_number_id, wa_message_template, wa_template_lang, wa_template_variables, settings')
    .eq('id', orgId)
    .single();

  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  return NextResponse.json({ data });
}
