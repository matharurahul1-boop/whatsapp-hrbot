'use client';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-200/60 border border-surface-300/50">
          <svg
            className="h-10 w-10 text-surface-500"
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
          >
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M8.5 16.5a5 5 0 0 1 7 0" opacity="0.4" />
            <path d="M5 12.5A9.968 9.968 0 0 1 12 10c1.67 0 3.24.41 4.62 1.13" />
            <path d="M2 8.82A15.949 15.949 0 0 1 12 6c2.12 0 4.14.42 6 1.17" opacity="0.4" />
            <circle cx="12" cy="20" r="1" fill="currentColor" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-surface-950 mb-3">You&apos;re offline</h1>
        <p className="text-sm text-surface-600 mb-8">
          No internet connection detected. Check your network and try again.
        </p>

        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-xl
                     bg-brand-gradient text-white text-sm font-semibold shadow-glow-sm
                     hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
