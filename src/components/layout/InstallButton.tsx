'use client';

import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallButton() {
  const [prompt,      setPrompt]      = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS,       setIsIOS]       = useState(false);
  const [showIOSTip,  setShowIOSTip]  = useState(false);
  const [installed,   setInstalled]   = useState(false);

  useEffect(() => {
    // Already running as installed PWA
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone
    ) {
      setInstalled(true);
      return;
    }

    // Detect iOS Safari (doesn't support beforeinstallprompt)
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream;
    const safari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
    setIsIOS(ios && safari);

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setInstalled(true); setPrompt(null); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (installed) return null;

  // Chrome / Android — show button only when prompt is ready
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  }

  return (
    <>
      {/* Chrome / Android install button */}
      {prompt && (
        <button
          onClick={install}
          title="Install HRBot App"
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all',
            'bg-brand-500/15 text-brand-400 border border-brand-500/30 hover:bg-brand-500/25'
          )}
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Install</span>
        </button>
      )}

      {/* iOS Safari — show a manual tip banner */}
      {isIOS && !showIOSTip && (
        <button
          onClick={() => setShowIOSTip(true)}
          title="Add to Home Screen"
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all bg-brand-500/15 text-brand-400 border border-brand-500/30 hover:bg-brand-500/25"
        >
          <Share className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">Install</span>
        </button>
      )}

      {isIOS && showIOSTip && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm
                        rounded-2xl border border-brand-500/30 bg-surface-100 shadow-modal p-4
                        animate-[fadeUp_0.2s_ease-out]">
          <button
            onClick={() => setShowIOSTip(false)}
            className="absolute top-3 right-3 text-surface-500 hover:text-surface-900"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">
              <Share className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-surface-900">Add to Home Screen</p>
              <p className="text-xs text-surface-600 mt-1">
                Tap the <strong className="text-surface-800">Share</strong> button at the bottom of Safari,
                then tap <strong className="text-surface-800">"Add to Home Screen"</strong> to install HRBot.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
