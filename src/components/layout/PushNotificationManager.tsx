'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const DISMISS_KEY = 'push-prompt-dismissed';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribe(reg: ServiceWorkerRegistration) {
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    });
  }
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  }).catch(() => {});
}

export default function PushNotificationManager() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

    navigator.serviceWorker.ready.then(reg => {
      if (Notification.permission === 'granted') {
        subscribe(reg);
      } else if (Notification.permission === 'default' && !localStorage.getItem(DISMISS_KEY)) {
        setShowBanner(true);
      }
    });
  }, []);

  async function handleEnable() {
    setShowBanner(false);
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      await subscribe(reg);
    }
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setShowBanner(false);
  }

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 right-4 z-40 w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-surface-300 bg-surface-100 shadow-modal p-4 flex items-start gap-3 animate-fade-up">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient">
        <Bell className="h-4 w-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-surface-950">Turn on notifications</p>
        <p className="text-xs text-surface-600 mt-0.5">Get notified about task and leave updates right in your browser.</p>
        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" onClick={handleEnable}>Enable</Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss}>Not now</Button>
        </div>
      </div>
      <button onClick={handleDismiss} className="text-surface-500 hover:text-surface-950 transition-colors shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
