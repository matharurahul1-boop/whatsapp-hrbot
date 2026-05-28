'use client';

import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils/cn';

interface HeatmapDay {
  date:           string;
  attendance_pct: number;
  present:        number;
  absent:         number;
}

interface AttendanceHeatmapProps {
  data: HeatmapDay[];
}

function getColor(pct: number): string {
  if (pct >= 90) return 'bg-brand-500';
  if (pct >= 75) return 'bg-brand-400/70';
  if (pct >= 50) return 'bg-warning/60';
  if (pct >= 25) return 'bg-danger/40';
  return 'bg-surface-300';
}

export default function AttendanceHeatmap({ data }: AttendanceHeatmapProps) {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance — Last 30 Days</CardTitle>
        {/* Legend */}
        <div className="flex items-center gap-2 text-2xs text-surface-600">
          <span className="h-2 w-2 rounded-sm bg-surface-300" /> Low
          <span className="h-2 w-2 rounded-sm bg-warning/60" /> 50%
          <span className="h-2 w-2 rounded-sm bg-brand-400/70" /> 75%
          <span className="h-2 w-2 rounded-sm bg-brand-500" /> 90%+
        </div>
      </CardHeader>

      <div className="flex flex-wrap gap-1">
        {sorted.map(day => {
          const label = new Date(day.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          return (
            <div
              key={day.date}
              className={cn(
                'group relative h-7 w-7 rounded cursor-default transition-transform hover:scale-110',
                getColor(day.attendance_pct)
              )}
              title={`${label}: ${day.attendance_pct}% (${day.present} present)`}
            >
              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-10">
                <div className="rounded-lg bg-surface-0 border border-surface-300 px-2 py-1 shadow-modal whitespace-nowrap text-2xs text-surface-900">
                  <p className="font-semibold">{label}</p>
                  <p className="text-surface-600">{day.attendance_pct}% attendance</p>
                  <p className="text-surface-600">{day.present} present · {day.absent} absent</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
