import { NextRequest, NextResponse } from 'next/server';
import { sendText } from '@/lib/whatsapp/client';

export async function POST(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { to, text, organization_id } = body;

  if (!to || !text) {
    return NextResponse.json({ error: 'Missing to or text' }, { status: 400 });
  }

  await sendText(to, text, organization_id ?? '');

  console.log(`[wa/send] ✅ Sent to ${to}: "${String(text).slice(0, 60)}"`);
  return NextResponse.json({ ok: true });
}
