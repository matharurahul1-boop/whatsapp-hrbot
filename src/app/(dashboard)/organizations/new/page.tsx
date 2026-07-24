import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminOrAbove } from '@/lib/rbac';
import { NewOrganizationForm } from '@/components/organizations/NewOrganizationForm';

export default async function NewOrganizationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('role').eq('id', user.id).single();
  // Server-side gate — the sidebar/bottom-nav links are also role-filtered,
  // but hiding a link isn't access control on its own; this redirect (and
  // the matching check in /api/auth/register) is what actually enforces it.
  if (!profile || !isAdminOrAbove(profile.role)) redirect('/dashboard');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-bold text-surface-950">New Organization</h1>
        <p className="text-sm text-surface-600 mt-1">
          Set up a brand-new workspace with its own admin account, leave types, and onboarding defaults.
        </p>
      </div>
      <NewOrganizationForm />
    </div>
  );
}
