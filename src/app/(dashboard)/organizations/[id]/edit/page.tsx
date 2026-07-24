import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkPlatformOperatorAdmin } from '@/lib/auth/platform-operator';
import { EditOrganizationForm } from '@/components/organizations/EditOrganizationForm';

export default async function EditOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { allowed } = await checkPlatformOperatorAdmin(db, user.id);
  if (!allowed) redirect('/dashboard');

  const { data: org } = await db.from('organizations').select('id, name').eq('id', id).single();
  if (!org) notFound();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-bold text-surface-950">Edit {org.name}</h1>
        <p className="text-sm text-surface-600 mt-1">
          Workspace details and attendance policy — the same fields set during New Organization.
        </p>
      </div>
      <EditOrganizationForm orgId={org.id} orgName={org.name} />
    </div>
  );
}
