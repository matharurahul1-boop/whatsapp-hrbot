import type { createAdminClient } from '@/lib/supabase/admin';

export const REALTIME_PAGES = ['leave', 'tasks', 'attendance', 'team', 'dashboard', 'escalation'] as const;
export type RealtimePage = (typeof REALTIME_PAGES)[number];

/** Reads organizations.settings.realtime_refresh_pages[page] — defaults to true (on) when unset. */
export async function isRealtimeRefreshEnabled(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
  page: RealtimePage,
): Promise<boolean> {
  const { data } = await db.from('organizations').select('settings').eq('id', orgId).single();
  const settings = (data?.settings as Record<string, unknown>) ?? {};
  const pages = (settings.realtime_refresh_pages as Record<string, boolean>) ?? {};
  return pages[page] !== false;
}
