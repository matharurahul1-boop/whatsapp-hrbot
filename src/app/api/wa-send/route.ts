import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';
import { sendText, sendTemplate }    from '@/lib/whatsapp/client';
import { isManagerOrAbove }          from '@/lib/rbac';

// POST /api/wa-send
// Body: { to, message, orgId, contactName? }
// Strategy:
//   1. Try free-form sendText  (works within 24h window)
//   2. If 24h window expired → auto-fallback to org's approved template
//      Template variables: {{1}} = contactName, {{2}} = message
//      (also supports single-variable templates where {{1}} = message)

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

  // Only managers and above can send WhatsApp messages via this endpoint
  if (!isManagerOrAbove(profile.role)) {
    return NextResponse.json({ error: 'Only managers and above can send WhatsApp messages' }, { status: 403 });
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

  const templateName      = org?.wa_message_template?.trim() || null;
  const templateLang      = org?.wa_template_lang?.trim()    || 'en';
  // How many variables does the template use? (1 = message only, 2 = name + message)
  const templateVarCount  = (org?.wa_template_variables as number) || 2;

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

  // Fetch org name for {{3}}
  const { data: orgData } = await db
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single();

  const orgName = orgData?.name ?? 'HR Team';

  // Build template variables array:
  // 1 var  → [ message ]
  // 2 vars → [ name, message ]
  // 3 vars → [ name, message, orgName ]   ← {{1}}=name  {{2}}=message  {{3}}=org
  const templateVars: string[] =
    templateVarCount === 1
      ? [message.trim()]
      : templateVarCount === 3
      ? [recipientName, message.trim(), orgName]
      : [recipientName, message.trim()];

  // ── Try 1: Free-form text (24h window) ───────────────────────────────────
  let sent = false;
  let lastError = '';

  try {
    await sendText(to, message.trim(), orgId);
    sent = true;
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
    const is24h      = lastError.includes('131047');
    const isTestMode = lastError.includes('131021');

    // ── Try 2: Template fallback ─────────────────────────────────────────
    if ((is24h || isTestMode) && templateName) {
      console.log(`[wa-send] Falling back to template "${templateName}" — vars: ${JSON.stringify(templateVars)}`);
      try {
        await sendTemplate(to, templateName, templateVars, templateLang, orgId);
        sent = true;
      } catch (tplErr: unknown) {
        lastError = tplErr instanceof Error ? tplErr.message : String(tplErr);
      }
    }
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
