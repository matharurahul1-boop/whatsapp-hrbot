/**
 * /api/policy
 *
 * GET  — list policy documents for the org
 * POST — upload a new document (multipart: title, category, file or content)
 * DELETE — delete a document by ?id=
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';

const ALLOWED_ROLES = ['super_admin', 'admin', 'hr'];

async function getProfile(userId: string) {
  const db = createAdminClient();
  return db
    .from('users')
    .select('organization_id, role')
    .eq('id', userId)
    .single();
}

// ── GET /api/policy ────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await getProfile(user.id);
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from('policy_documents')
    .select('id, title, file_name, category, is_active, created_at, created_by')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// ── POST /api/policy ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await getProfile(user.id);
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  let title    = '';
  let category = 'general';
  let content  = '';
  let fileName = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    title    = (form.get('title')    as string) ?? '';
    category = (form.get('category') as string) ?? 'general';
    content  = (form.get('content')  as string) ?? '';

    const file = form.get('file') as File | null;
    if (file) {
      fileName = file.name;
      if (!content) {
        // Read text content from uploaded file (TXT / MD)
        content = await file.text();
      }
    }
  } else {
    const body = await req.json();
    title    = body.title    ?? '';
    category = body.category ?? 'general';
    content  = body.content  ?? '';
    fileName = body.file_name ?? '';
  }

  if (!title.trim() || !content.trim()) {
    return NextResponse.json({ error: 'title and content are required' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from('policy_documents')
    .insert({
      organization_id: profile.organization_id,
      created_by:      user.id,
      title:           title.trim(),
      file_name:       fileName || null,
      content:         content.trim(),
      category:        category.trim() || 'general',
    })
    .select('id, title, file_name, category, is_active, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// ── DELETE /api/policy?id= ─────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await getProfile(user.id);
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db
    .from('policy_documents')
    .delete()
    .eq('id', id)
    .eq('organization_id', profile.organization_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
