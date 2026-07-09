import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils/cn';

const sizeClasses = {
  xs: 'h-6 w-6 text-2xs',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-11 w-11 text-base',
  xl: 'h-14 w-14 text-lg',
};

interface AvatarProps {
  src?:      string | null;
  name?:     string | null;
  size?:     keyof typeof sizeClasses;
  className?: string;
  online?:   boolean;
  title?:    string;
}

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

function Avatar({ src, name, size = 'md', className, online, title }: AvatarProps) {
  return (
    <div className="relative inline-flex shrink-0" title={title}>
      <AvatarPrimitive.Root
        className={cn(
          'relative flex items-center justify-center rounded-full overflow-hidden',
          'bg-brand-500/15 text-brand-400 font-semibold select-none',
          sizeClasses[size],
          className
        )}
      >
        {src && (
          <AvatarPrimitive.Image
            src={src}
            alt={name ?? 'avatar'}
            className="h-full w-full object-cover"
          />
        )}
        <AvatarPrimitive.Fallback
          className="flex items-center justify-center h-full w-full text-brand-400 font-semibold"
          delayMs={0}
        >
          {name ? getInitials(name) : '?'}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {online && (
        <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-success border-2 border-surface-100" />
      )}
    </div>
  );
}

// ── Avatar group ──────────────────────────────────────────────────────
interface AvatarGroupProps {
  users: { id: string; name?: string | null; avatar_url?: string | null }[];
  max?:  number;
  size?: keyof typeof sizeClasses;
}

function AvatarGroup({ users, max = 4, size = 'sm' }: AvatarGroupProps) {
  const visible  = users.slice(0, max);
  const overflow = users.length - max;
  return (
    <div className="flex items-center -space-x-2">
      {visible.map(u => (
        <div key={u.id} className="ring-2 ring-surface-100 rounded-full">
          <Avatar src={u.avatar_url} name={u.name} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <div className={cn(
          'flex items-center justify-center rounded-full ring-2 ring-surface-100',
          'bg-surface-300 text-surface-700 font-medium',
          sizeClasses[size]
        )}>
          +{overflow}
        </div>
      )}
    </div>
  );
}

export { Avatar, AvatarGroup };
