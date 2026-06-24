import { NextRequest, NextResponse } from 'next/server';
import { sendText, sendButtons, sendList } from '@/lib/whatsapp/client';
import type { WAListAction } from '@/types/whatsapp.types';

export async function POST(req: NextRequest) {
  const auth   = req.headers.get('authorization') ?? '';
  const secret = process.env.APP_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { to, text, organization_id, confirmButtons, listItems, listButtonLabel } = body;

  if (!to || !text) {
    return NextResponse.json({ error: 'Missing to or text' }, { status: 400 });
  }

  try {
    if (Array.isArray(confirmButtons) && confirmButtons.length > 0) {
      await sendButtons(to, text, confirmButtons, organization_id ?? '');
      console.log(`[wa/send] ✅ Sent buttons to ${to}: "${String(text).slice(0, 60)}"`);
    } else if (Array.isArray(listItems) && listItems.length > 0) {
      await sendList(
        to, text,
        listButtonLabel ?? 'Choose',
        listItems as WAListAction['sections'],
        organization_id ?? ''
      );
      console.log(`[wa/send] ✅ Sent list to ${to}: "${String(text).slice(0, 60)}"`);
    } else {
      await sendText(to, text, organization_id ?? '');
      console.log(`[wa/send] ✅ Sent to ${to}: "${String(text).slice(0, 60)}"`);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[wa/send] ❌ Error sending to ${to}:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
