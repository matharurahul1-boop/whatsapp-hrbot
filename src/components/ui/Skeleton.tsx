import React from 'react';
import { cn } from '@/lib/utils/cn';

interface SkeletonProps {
  className?: string;
  lines?:     number;
}

function Skeleton({ className, style }: SkeletonProps & { style?: React.CSSProperties }) {
  return <div className={cn('skeleton', className)} style={style} />;
}

function SkeletonText({ lines = 3, className }: SkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3 rounded', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card p-5 flex flex-col gap-4', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-16 rounded" />
      <Skeleton className="h-2 w-20 rounded" />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-300/60">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="flex flex-col gap-1.5 flex-1">
        <Skeleton className="h-3 w-36 rounded" />
        <Skeleton className="h-2.5 w-24 rounded" />
      </div>
      <Skeleton className="h-5 w-16 rounded-md" />
      <Skeleton className="h-5 w-20 rounded-md" />
    </div>
  );
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="table-wrap">
      <div className="bg-surface-200/60 border-b border-surface-300 px-4 py-3 flex gap-6">
        {[40, 100, 60, 80, 60].map((w, i) => (
          <Skeleton key={i} className={`h-3 rounded`} style={{ width: w }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonCard, SkeletonRow, SkeletonTable };
