import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkPlatformOperatorAdmin } from '@/lib/auth/platform-operator';
import { OrganizationsTable } from '@/components/organizations/OrganizationsTable';

export default async function OrganizationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { allowed } = await checkPlatformOperatorAdmin(db, user.id);
  if (!allowed) redirect('/dashboard');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-surface-950">Organizations</h1>
          <p className="text-sm text-surface-600 mt-1">Every workspace on the platform.</p>
        </div>
        <Link
          href="/organizations/new"
          className="flex items-center gap-2 shrink-0 rounded-lg bg-brand-gradient text-white text-sm font-semibold px-4 py-2.5 transition-all shadow-glow-sm hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Organization
        </Link>
      </div>
      <OrganizationsTable />
    </div>
  );
}
