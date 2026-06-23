import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaRegistrar from '@/components/layout/PwaRegistrar';

export const metadata: Metadata = {
  title: { default: 'HRBot — AI Employee Management', template: '%s | HRBot' },
  description: 'Manage tasks, leave, attendance and onboarding via WhatsApp AI',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HRBot',
  },
  formatDetection: { telephone: false },
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#0c0c1a' },
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html:
          `(function(){try{var c=localStorage.getItem('hrbot-sidebar-collapsed');var s=window.innerWidth<1280;document.documentElement.setAttribute('data-sidebar',(c==='true'||(c===null&&s))?'collapsed':'expanded');}catch(e){}})();`
        }} />
        {/* Splash screen tint for iOS standalone mode */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        {children}
        <PwaRegistrar />
      </body>
    </html>
  );
}
