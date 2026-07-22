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
import { invalidateMetaCreds } from '@/lib/whatsapp/client';

const Schema = z.object({
  name:                 z.string().min(1).max(100).optional(),
  wa_phone_number_id:   z.string().max(50).optional(),
  wa_access_token:      z.string().min(1).optional(),
  wa_message_template:  z.string().max(100).nullable().optional(),
  wa_template_lang:     z.string().max(10).optional(),
  wa_template_variables: z.number().int().min(1).max(5).optional(),
  // AI backend toggle — stored inside organizations.settings JSONB, not a direct column
  ai_backend:           z.enum(['groq', 'claude']).optional(),
  // Realtime dashboard auto-refresh, per page — also stored inside organizations.settings JSONB.
  // Partial: only the pages included get updated, others keep their existing value.
  realtime_refresh_pages: z.record(z.string(), z.boolean()).optional(),
  // Per-notification-type on/off, also stored inside organizations.settings JSONB.
  // Partial: only the types included get updated, others keep their existing value.
  notification_toggles: z.record(z.string(), z.boolean()).optional(),
  // Comma-separated Groq keys, stored in organization_secrets alongside wa_access_token
  groq_api_keys:        z.string().min(1).optional(),
});

// wa_template_variables was added by a migration that (as of this writing)
// hasn't been run in every environment yet — selecting a column that
// doesn't exist fails the *entire* query, which was silently blanking out
// every other org field (name, phone id, template name...) on this page.
// Retry without it rather than let one missing column break everything else.
async function fetchOrg(db: ReturnType<typeof createAdminClient>, orgId: string) {
  const cols = 'id, name, wa_phone_number_id, wa_access_token, wa_message_template, wa_template_lang, wa_template_variables, settings';
  const full = await db.from('organizations').select(cols).eq('id', orgId).single();
  if (!full.error) return full.data;

  const partial = await db
    .from('organizations')
    .select('id, name, wa_phone_number_id, wa_access_token, wa_message_template, wa_template_lang, settings')
    .eq('id', orgId)
    .single();
  return partial.data;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile || !isAdminOrAbove(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [data, { data: secret }] = await Promise.all([
    fetchOrg(db, profile.organization_id),
    db.from('organization_secrets').select('wa_access_token, groq_api_keys').eq('organization_id', profile.organization_id).maybeSingle(),
  ]);
  const legacyConfigured = !!data?.wa_access_token;
  if (data) delete (data as { wa_access_token?: string | null }).wa_access_token;

  const orgGroqKeys = secret?.groq_api_keys ? secret.groq_api_keys.split(',').map((k: string) => k.trim()).filter(Boolean) : [];
  // When the org hasn't set its own keys, show the server-default env keys
  // that are actually powering the bot right now, so admins aren't looking
  // at an empty box while the bot is demonstrably working off some key.
  const serverDefaultKeys = [
    ...(process.env.GROQ_API_KEY ?? '').split(','),
    process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6, process.env.GROQ_API_KEY_7,
    process.env.GROQ_API_KEY_8, process.env.GROQ_API_KEY_9, process.env.GROQ_API_KEY_10,
  ].filter((k): k is string => !!k?.trim()).map(k => k.trim());

  const groqKeys       = orgGroqKeys.length > 0 ? orgGroqKeys : serverDefaultKeys;
  const groqKeysSource = orgGroqKeys.length > 0 ? 'org' : 'server';

  return NextResponse.json({
    data: {
      ...data,
      wa_access_token_configured: !!secret?.wa_access_token || legacyConfigured,
      groq_api_keys_count:  orgGroqKeys.length,
      groq_api_keys:        groqKeys,
      groq_api_keys_source: groqKeysSource,
    },
  });
}

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

  const { ai_backend, realtime_refresh_pages, notification_toggles, wa_access_token, groq_api_keys, wa_template_variables, ...directFields } = parsed.data;
  const orgId = profile.organization_id;

  if (wa_access_token !== undefined || groq_api_keys !== undefined) {
    const { error } = await db.from('organization_secrets').upsert({
      organization_id: orgId,
      ...(wa_access_token !== undefined && { wa_access_token }),
      ...(groq_api_keys  !== undefined && { groq_api_keys }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
    if (error) {
      if (wa_access_token !== undefined) {
        const legacy = await db.from('organizations').update({ wa_access_token }).eq('id', orgId);
        if (legacy.error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    if (wa_access_token !== undefined) invalidateMetaCreds(orgId);
  }

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

  // wa_template_variables lives on a column that isn't guaranteed to exist
  // yet in every environment — save it separately so a missing column can't
  // fail the rest of this otherwise-valid save (name, template name, etc.).
  if (wa_template_variables !== undefined) {
    const { error } = await db
      .from('organizations')
      .update({ wa_template_variables, updated_at: new Date().toISOString() })
      .eq('id', orgId);
    if (error) console.error('[org/settings PATCH] wa_template_variables (column may not exist yet):', error.message);
  }

  // Merge ai_backend / realtime_refresh_pages / notification_toggles into the
  // settings JSONB column. The latter two are themselves objects, so they
  // need a nested merge (current ⊕ incoming) rather than the shallow spread
  // used for every other settings key, or toggling one entry would wipe the rest.
  if (ai_backend !== undefined || realtime_refresh_pages !== undefined || notification_toggles !== undefined) {
    const { data: org } = await db
      .from('organizations').select('settings').eq('id', orgId).single();
    const current = (org?.settings as Record<string, unknown>) ?? {};
    const currentPages    = (current.realtime_refresh_pages as Record<string, boolean>) ?? {};
    const currentToggles  = (current.notification_toggles as Record<string, boolean>) ?? {};
    const { error } = await db
      .from('organizations')
      .update({
        settings: {
          ...current,
          ...(ai_backend !== undefined && { ai_backend }),
          ...(realtime_refresh_pages !== undefined && {
            realtime_refresh_pages: { ...currentPages, ...realtime_refresh_pages },
          }),
          ...(notification_toggles !== undefined && {
            notification_toggles: { ...currentToggles, ...notification_toggles },
          }),
        },
      })
      .eq('id', orgId);
    if (error) {
      console.error('[org/settings PATCH] settings JSONB:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const data = await fetchOrg(db, orgId);
  if (!data) return NextResponse.json({ error: 'Failed to reload organization after save' }, { status: 500 });
  delete (data as { wa_access_token?: string | null }).wa_access_token;
  return NextResponse.json({ data });
}
