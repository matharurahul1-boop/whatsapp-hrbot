'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Subscribes to any change on `table` for this org and calls router.refresh()
 * to pull fresh data from the server, instead of patching local state from
 * the realtime payload directly — a postgres_changes payload only carries
 * the raw table row (e.g. leave_requests.employee_id), not the joined
 * display data these pages actually render (employee name/avatar, leave
 * type name/color, reviewer name), so merging it in place would leave those
 * fields blank until the next real reload anyway.
 *
 * Debounced so a burst of changes (e.g. approving several requests in a
 * row) triggers one refresh, not one per row.
 *
 * `enabled` gates the subscription — orgs can turn this off in Settings
 * (organizations.settings.realtime_refresh_enabled) if they'd rather not
 * have pages auto-refresh under them.
 */
export function useRealtimeRefresh(orgId: string, table: string, enabled: boolean = true): void {
  const router = useRouter();
  const supabase = createClient();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel(`${table}:${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `organization_id=eq.${orgId}` },
        () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => router.refresh(), 400);
        }
      )
      .subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, table, enabled, supabase]);
}
