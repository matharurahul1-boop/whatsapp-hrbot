import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ChangeRequiredPasswordForm } from './ChangeRequiredPasswordForm';

export default async function ChangePasswordRequiredPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db.from('users').select('metadata').eq('id', user.id).maybeSingle();
  const mustChange = (profile?.metadata as { must_change_password?: boolean } | null)?.must_change_password;
  if (!mustChange) redirect('/dashboard');

  return <ChangeRequiredPasswordForm />;
}
