import { NextRequest, NextResponse } from 'next/server';
import { runMasterAgent } from '@/lib/ai/agent';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Called by n8n or internal services
export async function POST(req: NextRequest) {
  const appSecret = process.env.APP_SECRET;
  // Reject if secret is not configured (prevents 'Bearer undefined' bypass)
  if (!appSecret) {
    console.error('[/api/agent] APP_SECRET env var is not set — rejecting all requests');
    return NextResponse.json({ error: 'Service not configured' }, { status: 503 });
  }
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${appSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { message: string; wa_number: string; org_id: string };
  const { message, wa_number, org_id } = body;

  if (!message || !wa_number || !org_id) {
    return NextResponse.json({ error: 'message, wa_number, and org_id are required' }, { status: 400 });
  }

  try {
    const result = await runMasterAgent(message, wa_number, org_id);
    return NextResponse.json({ reply: result.reply, context: result.new_context });
  } catch (err) {
    console.error('[/api/agent]', err);
    return NextResponse.json({ error: 'Agent error' }, { status: 500 });
  }
}

// Health check / session info for dashboard (authenticated)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('full_name, role, organization_id')
    .eq('id', user.id)
    .single();

  return NextResponse.json({ status: 'ready', user_id: user.id, profile });
}
