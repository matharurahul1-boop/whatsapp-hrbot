/**
 * /setup — Server Component
 *
 * Runs entirely on the server:
 *  - Not authenticated → redirect /login immediately
 *  - Has profile       → redirect /dashboard immediately (zero delay)
 *  - No profile        → render the setup form (client island below)
 *
 * Before: client component with 2 sequential async calls + 1s timeout = ~2-3 s
 * After:  server redirect in a single DB round-trip = instant
 */

import { redirect }          from 'next/navigation';
import { createClient }      from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import SetupForm             from './SetupForm';

export const metadata = { title: 'Setup — HRBot' };

export default async function SetupPage() {
  // ── 1. Auth check ────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // ── 2. Profile check ─────────────────────────────────────────────────
  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  // Already set up → skip the form entirely
  if (profile) redirect('/dashboard');

  // ── 3. No profile yet → show the setup form ──────────────────────────
  const prefillName  = (user.user_metadata?.full_name as string) ?? '';
  const prefillEmail = user.email ?? '';

  return (
    <SetupForm
      userId={user.id}
      email={prefillEmail}
      prefillName={prefillName}
    />
  );
}
