import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminOrAbove } from '@/lib/rbac';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import ThemeProvider from '@/components/layout/ThemeProvider';
import { SidebarProvider } from '@/components/layout/SidebarProvider';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { ContentShell } from '@/components/layout/ContentShell';
import BottomNav from '@/components/layout/BottomNav';
import PushNotificationManager from '@/components/layout/PushNotificationManager';
import { ToastProvider } from '@/components/ui/Toast';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = createAdminClient();
  const { data: profile } = await db
    .from('users')
    .select('id, full_name, role, avatar_url, organization_id, metadata, organizations(name, is_platform_operator)')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/setup');

  // Founding admin of an org created via New Organization by a DIFFERENT
  // admin never chose their own password (that admin typed it on their
  // behalf) — force a change before letting them into the app at all.
  if ((profile.metadata as { must_change_password?: boolean } | null)?.must_change_password) {
    redirect('/change-password-required');
  }

  const org = (profile as { organizations?: { name?: string; is_platform_operator?: boolean } }).organizations;
  const orgName = org?.name;
  // Org creation and cross-org editing are restricted to admin/super_admin
  // members of the one org flagged is_platform_operator — see
  // src/lib/auth/platform-operator.ts for the matching API/page gate.
  const isPlatformOperator = isAdminOrAbove(profile.role) && !!org?.is_platform_operator;

  return (
    <ThemeProvider>
      <ToastProvider>
      <SidebarProvider>
        <div className="flex h-screen overflow-hidden bg-surface-50">
          {/* Sidebar — fixed, collapses on desktop / slides as overlay on mobile */}
          <Sidebar role={profile.role} orgName={orgName} isPlatformOperator={isPlatformOperator} />

          {/* Mobile/tablet overlay backdrop — hidden on desktop (lg+) where sidebar is inline */}
          <div id="sidebar-overlay" className="fixed inset-0 z-30 bg-black/50 hidden lg:hidden" />

          {/* Main content — tracks sidebar width */}
          <SidebarShell>
            <Header
              userId={profile.id}
              userName={profile.full_name}
              userRole={profile.role}
              userEmail={user.email ?? ''}
              avatarUrl={profile.avatar_url ?? null}
            />
            <main className="flex-1 overflow-hidden flex flex-col">
              {/* Extra bottom padding on mobile so content clears the bottom nav */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
                {/* No overflow utility here (deliberately) — any non-visible overflow
                    value on this div, on either axis, makes it a "scroll container" per
                    the CSS spec even though it never actually scrolls (its height is
                    intrinsic), which makes position:sticky descendants (page headers)
                    anchor to this static div instead of the real scrolling div above and
                    never stick. The outer div's overflow-x-hidden already clips width. */}
                <div className="p-4 pb-24 md:p-6 md:pb-24 lg:p-8 lg:pb-8">
                  <ContentShell>{children}</ContentShell>
                </div>
              </div>
            </main>
          </SidebarShell>
        </div>

        {/* Mobile bottom navigation — hidden on desktop (lg+) */}
        <BottomNav role={profile.role} isPlatformOperator={isPlatformOperator} />

        <PushNotificationManager />
      </SidebarProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
