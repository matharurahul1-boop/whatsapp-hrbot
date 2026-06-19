import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HRBot — AI Employee Management',
    short_name: 'HRBot',
    description: 'Manage tasks, leave, attendance and onboarding via WhatsApp AI',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0c0c1a',
    theme_color: '#0c0c1a',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icon-192',   sizes: '192x192', type: 'image/png', purpose: 'any'      },
      { src: '/icon-512',   sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png'                       },
    ],
    shortcuts: [
      { name: 'Tasks',      short_name: 'Tasks', url: '/tasks',      icons: [{ src: '/icon-192.svg', sizes: '192x192' }] },
      { name: 'Leave',      short_name: 'Leave', url: '/leave',      icons: [{ src: '/icon-192.svg', sizes: '192x192' }] },
      { name: 'Dashboard',  short_name: 'Home',  url: '/dashboard',  icons: [{ src: '/icon-192.svg', sizes: '192x192' }] },
    ],
  };
}
