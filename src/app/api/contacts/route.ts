import { NextRequest, NextResponse } from 'next/server';
import { createClient }             from '@/lib/supabase/server';
import { createAdminClient }        from '@/lib/supabase/admin';

function normalizeWa(n: string): string {
  return n.replace(/[\s+\-()]/g, '');
}

// ── GET /api/contacts ─────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });
  // The org address book lets you message any listed contact as the business
  // account — only super_admin retains that reach; everyone else is scoped
  // to their own WhatsApp chat only.
  if (profile.role !== 'super_admin') return NextResponse.json({ contacts: [] });

  const { data, error } = await db
    .from('wa_contacts')
    .select('id, name, wa_number, notes, created_at')
    .eq('organization_id', profile.organization_id)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data ?? [] });
}

// ── POST /api/contacts ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, wa_number, notes } = await req.json();
  if (!name?.trim() || !wa_number?.trim())
    return NextResponse.json({ error: 'Name and WhatsApp number are required' }, { status: 400 });

  const clean = normalizeWa(wa_number.trim());
  if (clean.length < 7)
    return NextResponse.json({ error: 'Invalid WhatsApp number' }, { status: 400 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });
  if (profile.role !== 'super_admin')
    return NextResponse.json({ error: 'Only super_admin can manage contacts' }, { status: 403 });

  const { data, error } = await db
    .from('wa_contacts')
    .insert({
      organization_id: profile.organization_id,
      created_by:      user.id,
      name:            name.trim(),
      wa_number:       clean,
      notes:           notes?.trim() || null,
    })
    .select('id, name, wa_number, notes, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}

// ── DELETE /api/contacts ──────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users').select('organization_id, role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });
  if (profile.role !== 'super_admin')
    return NextResponse.json({ error: 'Only super_admin can manage contacts' }, { status: 403 });

  const { error } = await db
    .from('wa_contacts')
    .delete()
    .eq('id', id)
    .eq('organization_id', profile.organization_id);   // security: can't delete other orgs

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
