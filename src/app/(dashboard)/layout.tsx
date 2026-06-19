import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import ThemeProvider from '@/components/layout/ThemeProvider';
import { SidebarProvider } from '@/components/layout/SidebarProvider';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { SidebarToggle } from '@/components/layout/SidebarToggle';
import { ContentShell } from '@/components/layout/ContentShell';
import BottomNav from '@/components/layout/BottomNav';

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

  if (!profile) redirect('/setup');

  const orgName = (profile as { organizations?: { name?: string } }).organizations?.name;

  return (
    <ThemeProvider>
      <SidebarProvider>
        <div className="flex h-screen overflow-hidden bg-surface-50">
          {/* Sidebar — fixed, collapses on desktop / slides as overlay on mobile */}
          <Sidebar role={profile.role} orgName={orgName} />

          {/* Mobile/tablet overlay backdrop — hidden on desktop (lg+) where sidebar is inline */}
          <div id="sidebar-overlay" className="fixed inset-0 z-30 bg-black/50 hidden lg:hidden" />

          {/* Floating toggle pill — sits on sidebar right border, vertically centred */}
          <SidebarToggle />

          {/* Main content — tracks sidebar width */}
          <SidebarShell>
            <Header
              userName={profile.full_name}
              userRole={profile.role}
              avatarUrl={profile.avatar_url ?? null}
            />
            <main className="flex-1 overflow-hidden flex flex-col">
              {/* Extra bottom padding on mobile so content clears the bottom nav */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 md:p-6 md:pb-6 lg:p-8 max-w-screen-2xl mx-auto w-full">
                <ContentShell>{children}</ContentShell>
              </div>
            </main>
          </SidebarShell>
        </div>

        {/* Mobile bottom navigation — hidden on desktop (lg+) */}
        <BottomNav role={profile.role} />
      </SidebarProvider>
    </ThemeProvider>
  );
}
