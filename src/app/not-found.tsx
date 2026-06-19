import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-200/60 border border-surface-300/50">
          <span className="text-4xl font-black text-surface-400 leading-none select-none">?</span>
        </div>

        <p className="text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">404</p>
        <h1 className="text-2xl font-bold text-surface-950 mb-3">Page not found</h1>
        <p className="text-sm text-surface-600 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-xl
                     bg-brand-gradient text-white text-sm font-semibold shadow-glow-sm
                     hover:opacity-90 transition-opacity"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
