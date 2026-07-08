import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { distributedRateLimit } from '@/lib/rate-limit';

// POST /api/auth/check-email
// Used by the password-reset flow to tell the user up front that an email
// isn't registered, instead of silently "succeeding" and leaving them
// waiting on a code that will never arrive.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!await distributedRateLimit(`check-email:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  const { email } = await req.json().catch(() => ({}));
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data } = await db
    .from('users')
    .select('id')
    .ilike('email', email.trim())
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ error: 'No account found for this email' }, { status: 404 });
  return NextResponse.json({ exists: true });
}
