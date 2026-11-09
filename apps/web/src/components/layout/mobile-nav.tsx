'use client';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type MouseEvent } from 'react';
import { AppSidebar, SidebarBrand } from '@/components/layout/app-sidebar';
import { Button } from '@/components/ui/button';
import type { NavItem } from '@/config/app.config';

/** Menu layar sempit (< md): tombol burger di header membuka laci sidebar dengan scroll sendiri. */
export function MobileNav({ items }: { items: NavItem[] }) {
  const t = useTranslations('app');
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(path);

  // Navigasi (mis. tombol back) menutup laci — disesuaikan saat render, bukan lewat effect.
  if (openedAt !== path) {
    setOpenedAt(path);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Klik tautan menu (termasuk halaman aktif, yang tak mengubah pathname) menutup laci.
  const closeOnLink = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 md:hidden"
        aria-label={t('menu')}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </Button>
      {open && (
        <div className="fixed inset-0 z-(--z-dialog) md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <aside
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label={t('menu')}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-popover"
            onClick={closeOnLink}
          >
            <SidebarBrand>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label={t('close')}
                onClick={() => setOpen(false)}
                autoFocus
              >
                <X className="size-5" aria-hidden />
              </Button>
            </SidebarBrand>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <AppSidebar items={items} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
