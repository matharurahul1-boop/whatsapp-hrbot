import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  // ── Always-public routes — never redirect these ──────────────────────
  const publicPrefixes = [
    '/login',
    '/join',
    '/setup',
    '/forgot-password',
    '/reset-password',
    '/api/webhooks',
    '/api/auth',
    '/api/organizations/info',
    '/api/health',
    '/api/policy/ask',       // called server-to-server from WA webhook (no session)
    '/api/agent',            // called by n8n / services with Bearer APP_SECRET
    '/api/wa',               // called by n8n with Bearer APP_SECRET
    '/api/escalate-leaves',  // called by cron with x-escalation-secret header
    '/api/reminders/run',    // called by cron with Bearer APP_SECRET
    '/api/reminders/task',   // called by n8n reminder cron with Bearer APP_SECRET
    // PWA assets — must be public so browsers can install without being logged in
    '/manifest.webmanifest',
    '/sw.js',
    '/icon-192',
    '/icon-512',
    '/apple-icon',
  ];
  const isPublic = publicPrefixes.some(p => pathname.startsWith(p));

  // ── Not logged in → /login ───────────────────────────────────────────
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // ── Logged in + on /login → /dashboard ──────────────────────────────
  // The dashboard layout (server component) handles the /setup redirect
  // if the profile doesn't exist yet — middleware doesn't need to know.
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
