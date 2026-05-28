import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import ThemeProvider from '@/components/layout/ThemeProvider';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('id, full_name, role, avatar_url, organization_id, organizations(name)')
    .eq('id', user.id)
    .single();

  // No profile means the user signed up but hasn't completed setup yet
  if (!profile) redirect('/setup');

  const orgName = (profile as { organizations?: { name?: string } }).organizations?.name;

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-surface-50">
        {/* Sidebar — fixed on desktop, slides in on mobile */}
        <Sidebar role={profile.role} orgName={orgName} />

        {/* Overlay for mobile sidebar */}
        <div id="sidebar-overlay" className="fixed inset-0 z-30 bg-black/50 hidden md:hidden" />

        {/* Main content — offset by sidebar width on md+ */}
        <div className="flex flex-col flex-1 min-w-0 md:pl-64 overflow-hidden">
          <Header
            userName={profile.full_name}
            userRole={profile.role}
            avatarUrl={profile.avatar_url ?? null}
          />
          <main className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 lg:p-8 max-w-screen-2xl mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
