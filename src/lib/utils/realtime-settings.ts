import type { createAdminClient } from '@/lib/supabase/admin';

/** Reads organizations.settings.realtime_refresh_enabled — defaults to true (on) when unset. */
export async function isRealtimeRefreshEnabled(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<boolean> {
  const { data } = await db.from('organizations').select('settings').eq('id', orgId).single();
  const settings = (data?.settings as Record<string, unknown>) ?? {};
  return settings.realtime_refresh_enabled !== false;
}
