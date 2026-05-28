import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'HRBot — AI Employee Management', template: '%s | HRBot' },
  description: 'Manage tasks, leave, attendance and onboarding via WhatsApp AI',
  // icon is auto-resolved from src/app/icon.tsx
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#16a34a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
