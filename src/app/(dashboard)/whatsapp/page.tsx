import { createClient }      from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect }          from 'next/navigation';
import WAInterface           from '@/components/whatsapp/WAInterface';

export const metadata = { title: 'WhatsApp — HRBot' };
export const revalidate = 0;

/** Strip +, spaces, dashes so "91 98765-43210" → "919876543210" */
function normalizeWa(n: string | null | undefined): string | null {
  if (!n) return null;
  const clean = n.replace(/[\s+\-()]/g, '');
  return clean || null;
}

export default async function WhatsAppLogsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, role, wa_number')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/dashboard');

  // Fetch org's WhatsApp business number
  const { data: org } = await db
    .from('organizations')
    .select('whatsapp_number, name')
    .eq('id', profile.organization_id)
    .single();

  // Normalize the user's wa_number (remove +, spaces, dashes)
  const userWaNumber = normalizeWa(profile.wa_number);
  const canViewOrganizationChats = profile.role !== 'employee';

  // No wa_number linked → show empty state with Meta number prompt
  if (!userWaNumber && !canViewOrganizationChats) {
    return (
      <WAInterface
        logs={[]}
        orgId={profile.organization_id}
        orgName={org?.name ?? 'HRBot'}
        metaNumber={org?.whatsapp_number ?? null}
        userRole={profile.role}
        userWaNumber={null}
      />
    );
  }

  // Fetch logs for:
  //  1. This user's own WA number (their personal WhatsApp conversations)
  //  2. Outgoing messages they sent to contacts via the dashboard (user_id = their id)
  // This ensures contact-initiated chats appear in the Chats tab.
  let logsQuery = db
    .from('wa_logs')
    .select(`
      id, wa_number, contact_name, direction, message_type,
      message_text, delivery_status, wa_timestamp, created_at,
      user:users!wa_logs_user_id_fkey(id, full_name, avatar_url)
    `)
    .eq('organization_id', profile.organization_id);

  if (!canViewOrganizationChats && userWaNumber) {
    logsQuery = logsQuery.or(`wa_number.eq.${userWaNumber},and(direction.eq.outgoing,user_id.eq.${user.id})`);
  }

  const { data: logs } = await logsQuery
    .order('created_at', { ascending: false })
    .limit(1000);

  return (
    <WAInterface
      logs={(logs ?? []) as unknown as Parameters<typeof WAInterface>[0]['logs']}
      orgId={profile.organization_id}
      orgName={org?.name ?? 'HRBot'}
      metaNumber={org?.whatsapp_number ?? null}
      userRole={profile.role}
      userWaNumber={userWaNumber}
    />
  );
}
