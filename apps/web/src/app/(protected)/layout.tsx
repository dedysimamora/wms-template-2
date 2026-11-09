import type { ReactNode } from 'react';
import { AppSidebar, Breadcrumb, SidebarBrand } from '@/components/layout/app-sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { UserMenu } from '@/components/layout/user-menu';
import { buildAuthorizedNavigation } from '@/lib/authz/navigation';
import { requireSession } from '@/server/guards';

/**
 * Layout HANYA memeriksa sesi + merender shell (frontend §6.1). Guard RBAC ada di tiap page
 * (requirePageAccess) karena layout tidak di-render ulang saat soft navigation.
 *
 * Shell "calm workspace" (DS v0.2): sidebar menyatu dengan kanvas; konten di lembar membulat yang
 * di layar ≥ md menjadi wadah scroll sendiri (header lengket di dalamnya, sudut tetap terlihat).
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const nav = buildAuthorizedNavigation(s.permissions);
  return (
    <div className="min-h-dvh bg-background md:grid md:h-dvh md:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="hidden md:flex md:h-dvh md:flex-col">
        <SidebarBrand />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <AppSidebar items={nav} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col md:h-dvh md:py-2 md:pr-2">
        <div className="flex min-h-dvh flex-1 flex-col bg-surface-1 md:min-h-0 md:overflow-y-auto md:rounded-2xl md:shadow-sheet">
          <header className="sticky top-0 z-(--z-dropdown) flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-4 md:px-8">
            <MobileNav items={nav} />
            <Breadcrumb items={nav} />
            <div className="ml-auto">
              <UserMenu name={s.user.full_name ?? s.user.username} roles={s.roles} />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-6 md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
