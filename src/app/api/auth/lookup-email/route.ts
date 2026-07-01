import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/auth/lookup-email
// Given a WhatsApp/mobile number, returns the associated email so the client can sign in.
export async function POST(req: NextRequest) {
  const { identifier } = await req.json();
  if (!identifier) return NextResponse.json({ error: 'identifier required' }, { status: 400 });

  const digits = String(identifier).replace(/\D/g, '');
  if (!digits) return NextResponse.json({ error: 'No digits found in identifier' }, { status: 400 });

  const db = createAdminClient();

  // Try exact match first, then suffix match (e.g. 10-digit vs 12-digit with country code)
  const { data } = await db
    .from('users')
    .select('email, wa_number')
    .or(`wa_number.eq.${digits},wa_number.like.%${digits}`)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!data?.email) return NextResponse.json({ error: 'No account found for this number' }, { status: 404 });

  return NextResponse.json({ email: data.email });
}
