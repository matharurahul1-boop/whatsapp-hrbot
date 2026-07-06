/**
 * GET /api/wa-logs
 *
 * Returns paginated wa_logs for the authenticated user's organisation.
 * Only accessible to admin / super_admin / hr roles.
 *
 * Query params:
 *   limit     number   (default 50, max 200)
 *   offset    number   (default 0)
 *   direction incoming | outgoing | all (default all)
 *   status    pending | sent | delivered | read | failed | received | all
 *   wa_number string   (filter by specific number)
 *   search    string   (full-text search on message_text)
 *   from_date ISO date string
 *   to_date   ISO date string
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { createAdminClient }         from '@/lib/supabase/admin';

const ALLOWED_ROLES = ['super_admin', 'admin', 'hr', 'manager', 'employee'];

export async function GET(req: NextRequest) {
  try {
    // Auth
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createAdminClient();
    const { data: profile } = await db
      .from('users')
      .select('organization_id, role, wa_number')
      .eq('id', user.id)
      .single();

    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query params
    const sp        = req.nextUrl.searchParams;
    const limit     = Math.min(parseInt(sp.get('limit')  ?? '50', 10), 1000);
    const offset    = Math.max(parseInt(sp.get('offset') ?? '0',  10),  0);
    const direction = sp.get('direction') ?? 'all';
    const status    = sp.get('status')    ?? 'all';
    const waNumber  = sp.get('wa_number') ?? '';
    const search    = sp.get('search')    ?? '';
    const fromDate  = sp.get('from_date') ?? '';
    const toDate    = sp.get('to_date')   ?? '';

    // Normalize user's own wa_number for scoped filtering
    const userWaNumber = profile.wa_number
      ? profile.wa_number.replace(/[\s+\-()]/g, '')
      : null;

    // Build query
    let query = db
      .from('wa_logs')
      .select(`
        id, organization_id, user_id, wa_number, contact_name,
        meta_message_id, direction, message_type, message_text,
        media_id, media_mime_type, media_filename, media_caption,
        delivery_status, sent_at, delivered_at, read_at,
        failed_at, failure_code, failure_reason,
        wa_timestamp, created_at,
        user:users!wa_logs_user_id_fkey(id, full_name, avatar_url, department)
      `, { count: 'exact' })
      .eq('organization_id', profile.organization_id);

    // Employees: scope to own wa_number + outgoing messages they sent.
    // Everyone else (manager/hr/admin/super_admin) sees the whole organization.
    if (profile.role === 'employee' && userWaNumber) {
      query = query.or(`wa_number.eq.${userWaNumber},and(direction.eq.outgoing,user_id.eq.${user.id})`);
    }

    if (direction !== 'all') query = query.eq('direction', direction);
    if (status    !== 'all') query = query.eq('delivery_status', status);
    if (waNumber)            query = query.eq('wa_number', waNumber);
    if (search)              query = query.ilike('message_text', `%${search}%`);
    if (fromDate)            query = query.gte('created_at', fromDate);
    if (toDate)              query = query.lte('created_at', toDate + 'T23:59:59Z');

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[wa-logs API]', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    return NextResponse.json({
      data:   data ?? [],
      count:  count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[wa-logs API] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
