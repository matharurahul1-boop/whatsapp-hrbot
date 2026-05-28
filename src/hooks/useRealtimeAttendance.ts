'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AttendanceRecord } from '@/types/database.types';

export function useRealtimeAttendance(orgId: string, initial: AttendanceRecord[]) {
  const [records, setRecords] = useState(initial);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel(`attendance:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_records',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setRecords((prev) => [payload.new as AttendanceRecord, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setRecords((prev) =>
              prev.map((r) =>
                r.id === (payload.new as AttendanceRecord).id
                  ? (payload.new as AttendanceRecord)
                  : r
              )
            );
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId, supabase]);

  return records;
}
