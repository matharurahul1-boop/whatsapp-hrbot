import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { distributedRateLimit } from '@/lib/rate-limit';

// POST /api/auth/lookup-email
// Given a WhatsApp/mobile number, returns the associated email so the client can sign in.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!await distributedRateLimit(`lookup-email:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }
  const { identifier } = await req.json();
  if (!identifier) return NextResponse.json({ error: 'identifier required' }, { status: 400 });

  const digits = String(identifier).replace(/\D/g, '');
  // A short digit string (e.g. someone fat-fingering a partial number) can
  // suffix-match a completely unrelated person's number in a different
  // organization — require enough digits that a suffix match is meaningful.
  if (digits.length < 8) return NextResponse.json({ error: 'Enter a valid WhatsApp number' }, { status: 400 });

  const db = createAdminClient();

  // Prefer an exact match. Only fall back to a suffix match (for 10-digit
  // vs. 12-digit-with-country-code variants of the same number) when no
  // exact match exists, and never blindly trust whichever row Postgres
  // happens to return first when multiple accounts could match.
  const { data: exact } = await db
    .from('users')
    .select('email')
    .eq('wa_number', digits)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const match = exact ?? (await db
    .from('users')
    .select('email')
    .like('wa_number', `%${digits}`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()).data;

  if (!match?.email) return NextResponse.json({ error: 'No account found for this number' }, { status: 404 });

  return NextResponse.json({ email: match.email });
}
