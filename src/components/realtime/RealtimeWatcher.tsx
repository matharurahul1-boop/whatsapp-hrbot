'use client';

import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

/** Renders nothing — just keeps a page's server-fetched data fresh by
 *  calling router.refresh() whenever `table` changes for this org. Drop one
 *  per table a page's data depends on. Pass `enabled={false}` (from
 *  organizations.settings.realtime_refresh_enabled) to turn it off org-wide. */
export default function RealtimeWatcher({ orgId, table, enabled = true }: { orgId: string; table: string; enabled?: boolean }) {
  useRealtimeRefresh(orgId, table, enabled);
  return null;
}
