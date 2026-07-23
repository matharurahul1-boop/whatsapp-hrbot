import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { sendSmartText }             from '@/lib/whatsapp/client';

// POST /api/wa-send
// Body: { to, message, orgId, contactName? }
// sendSmartText proactively checks the recipient's actual 24h window (via
// wa_logs) and routes straight to the org's approved template when they're
// outside it, instead of reactively retrying after a free-form send that
// Meta may have already accepted (200) but will fail asynchronously.

export async function POST(req: NextRequest) {

  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Sending AS the business account TO another contact — only super_admin
  // retains this. Every other role is scoped to their own chat, where
  // messages go through /api/wa-simulate instead (see WAInterface's
  // isSelfConvo branch).
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only super_admin can send WhatsApp messages to other contacts' }, { status: 403 });
  }

  const body = await req.json();
  const { to, message, orgId, contactName } =
    body as { to: string; message: string; orgId: string; contactName?: string };

  if (!to || !message?.trim() || !orgId)
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

  if (orgId !== profile.organization_id)
    return NextResponse.json({ error: 'Org mismatch' }, { status: 403 });

  // ── Org config ────────────────────────────────────────────────────────────
  const { data: org } = await db
    .from('organizations')
    .select('wa_message_template, wa_template_lang, wa_template_variables')
    .eq('id', orgId)
    .single();

  const templateName = org?.wa_message_template?.trim() || null;

  // Resolve contact name — from request body or look up from wa_contacts
  let recipientName = contactName?.trim() || '';
  if (!recipientName) {
    const { data: contact } = await db
      .from('wa_contacts')
      .select('name')
      .eq('organization_id', orgId)
      .eq('wa_number', to.replace(/^\+/, ''))
      .maybeSingle();
    recipientName = contact?.name || 'there';
  }

  let sent = false;
  let lastError = '';

  try {
    await sendSmartText(to, message.trim(), orgId, recipientName);
    sent = true;
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  if (!sent) {
    let userMsg = lastError;
    if (lastError.includes('131047'))
      userMsg = templateName
        ? `⚠️ Template send failed: ${lastError}`
        : '⏰ 24-hour window expired. Configure a message template in Settings → Organization to send to new contacts.';
    if (lastError.includes('131021'))
      userMsg = '🔒 Test mode: add this number as a test contact in Meta Business → WhatsApp → API Setup.';
    if (lastError.includes('132001') || lastError.includes('template name does not exist'))
      userMsg = `❌ Template "${templateName}" not found or not yet approved in Meta Business Manager.`;

    return NextResponse.json({ error: userMsg }, { status: 500 });
  }

  // ── Return saved log row (best-effort; log may not be written yet) ───────
  const { data: logRow } = await db
    .from('wa_logs')
    .select(`
      id, wa_number, contact_name, direction, message_type,
      message_text, delivery_status, wa_timestamp, created_at,
      user:users!wa_logs_user_id_fkey(id, full_name, avatar_url)
    `)
    .eq('organization_id', orgId)
    .eq('wa_number', to.replace(/^\+/, ''))
    .eq('direction', 'outgoing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ success: true, log: logRow });
}
