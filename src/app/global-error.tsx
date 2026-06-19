'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0c0c1a', color: '#e8e8f6', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>App crashed</h1>
          <p style={{ fontSize: 14, color: '#9494c8', marginBottom: 24 }}>
            A critical error occurred. Try refreshing the page.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '10px 24px', borderRadius: 12, border: 'none',
              background: '#00A884', color: 'white', fontSize: 14, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
