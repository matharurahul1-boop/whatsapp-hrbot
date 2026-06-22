import { NextRequest, NextResponse } from 'next/server';
import { sendText }                  from '@/lib/whatsapp/client';

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

  await sendText(wa_number, `⏰ *Reminder:* ${message}`, organization_id ?? '');

  console.log(`[reminders/custom] ✅ Sent to ${wa_number}: "${message.slice(0, 60)}"`);
  return NextResponse.json({ ok: true });
}
