import { NextRequest, NextResponse } from 'next/server';
import { sendSmartText }             from '@/lib/whatsapp/client';
import { createAdminClient }         from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { wa_number, message, organization_id } = body;

  if (!wa_number || !message) {
    return NextResponse.json({ error: 'Missing wa_number or message' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: recipient } = await db.from('users').select('full_name').eq('wa_number', wa_number).maybeSingle();
  const recipientName = recipient?.full_name?.split(' ')[0] ?? 'there';

  await sendSmartText(wa_number, `⏰ *Reminder:* ${message}`, organization_id ?? '', recipientName);

  console.log(`[reminders/custom] ✅ Sent to ${wa_number}: "${message.slice(0, 60)}"`);
  return NextResponse.json({ ok: true });
}
