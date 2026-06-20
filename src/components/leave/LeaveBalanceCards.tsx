import { Card } from '@/components/ui/Card';

interface Balance {
  leave_type:     string;
  color:          string | null;
  entitled_days:  number;
  used_days:      number;
  remaining_days: number;
}

export default function LeaveBalanceCards({ balances }: { balances: Balance[] }) {
  if (!balances.length) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {balances.map((b, i) => {
        const usedPct = Math.min(100, Math.round((b.used_days / Math.max(b.entitled_days, 1)) * 100));
        const color   = b.color ?? '#10b981';
        const low     = b.remaining_days <= 2 && b.remaining_days > 0;
        const empty   = b.remaining_days === 0;

        return (
          <Card key={i} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs font-semibold text-surface-700 leading-tight">{b.leave_type}</span>
            </div>

            <div>
              <div className="flex items-end gap-1">
                <span className={`text-2xl sm:text-3xl font-bold tabular leading-none ${empty ? 'text-danger' : low ? 'text-warning' : 'text-surface-950'}`}>
                  {b.remaining_days}
                </span>
                <span className="text-xs text-surface-600 mb-0.5">/ {b.entitled_days} days</span>
              </div>
              <p className="text-xs text-surface-600 mt-0.5">{b.used_days} used</p>
            </div>

            <div className="progress-track">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width:           `${usedPct}%`,
                  backgroundColor: empty ? '#ef4444' : low ? '#f59e0b' : color,
                }}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
