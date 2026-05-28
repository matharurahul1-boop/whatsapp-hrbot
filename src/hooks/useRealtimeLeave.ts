'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { LeaveRequest } from '@/types/database.types';

export function useRealtimeLeave(orgId: string, initial: LeaveRequest[]) {
  const [requests, setRequests] = useState(initial);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel(`leave:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leave_requests',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setRequests((prev) => [payload.new as LeaveRequest, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setRequests((prev) =>
              prev.map((r) =>
                r.id === (payload.new as LeaveRequest).id
                  ? (payload.new as LeaveRequest)
                  : r
              )
            );
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId, supabase]);

  return requests;
}
