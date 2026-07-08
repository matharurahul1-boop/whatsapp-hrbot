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
      className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 hover:bg-brand-500/20 hover:text-brand-300 transition-colors disabled:opacity-40 shrink-0"
    >
      <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
    </button>
  );
}
