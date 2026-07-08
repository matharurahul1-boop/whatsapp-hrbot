import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyInvite } from '@/lib/utils/invite-token';

// GET /api/auth/verify-invite?token=... — public. Lets the /join page show
// "Joining as <role> @ <org>" before signup. This is purely for display —
// /api/auth/join re-verifies the token itself server-side before ever
// creating a profile, so nothing here needs to be trusted downstream.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const payload = verifyInvite(token);
  if (!payload) return NextResponse.json({ error: 'Invite link is invalid or has expired' }, { status: 400 });

  const db = createAdminClient();
  const { data: org } = await db.from('organizations').select('name').eq('id', payload.orgId).single();
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

  return NextResponse.json({ orgName: org.name, role: payload.role });
}
