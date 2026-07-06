import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'APP_SECRET',
  ];
  const missing = required.filter(name => !process.env[name]);
  let database = false;
  try {
    const { error } = await createAdminClient().from('organizations').select('id').limit(1);
    database = !error;
  } catch { database = false; }
  const healthy = missing.length === 0 && database;
  return NextResponse.json({
    status: healthy ? 'ok' : 'degraded',
    checks: { database, configuration: missing.length === 0 },
    timestamp: new Date().toISOString(),
  }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
