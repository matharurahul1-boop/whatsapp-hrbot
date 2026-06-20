'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Renders text truncated with an ellipsis by default.
 * Tap / click to expand the full text in place; tap again to collapse.
 * Works inside server components because it is a self-contained client island.
 */
export function ExpandText({
  children,
  className,
  style,
}: {
  children: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span
      title={expanded ? undefined : children}
      style={style}
      onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
      className={cn(
        'cursor-pointer',
        !expanded && 'truncate',
        expanded && 'break-words whitespace-normal',
        className,
      )}
    >
      {children}
    </span>
  );
}
