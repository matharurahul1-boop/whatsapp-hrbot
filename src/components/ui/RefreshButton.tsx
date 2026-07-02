'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';

export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      title="Refresh"
      className="p-1.5 rounded-lg text-surface-500 hover:text-surface-950 hover:bg-surface-200 transition-colors disabled:opacity-40"
    >
      <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
    </button>
  );
}
