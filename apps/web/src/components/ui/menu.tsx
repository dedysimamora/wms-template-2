'use client';
import type { LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { buttonVariants, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Menu dropdown (frontend §4.4) di atas Popover API: tampil di top layer sehingga tak terpotong
 * `overflow` tabel, light-dismiss & `Esc` bawaan browser. Navigasi panah/Home/End mengikuti pola
 * WAI-ARIA menu button; fokus kembali ke pemicu saat ditutup.
 */
const MenuCtx = createContext<{ close: () => void }>({ close: () => {} });

export function Menu({
  label,
  trigger,
  children,
  align = 'end',
  variant = 'ghost',
  size = 'icon',
  className,
  menuClassName,
}: {
  /** Nama aksesibel pemicu (wajib bila pemicu hanya ikon). */
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  menuClassName?: string;
}) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    const m = pop.current;
    if (!b || !m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const left = align === 'end' ? b.right - w : b.left;
    const below = b.bottom + 4 + h <= window.innerHeight;
    m.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
    m.style.top = `${below ? b.bottom + 4 : Math.max(8, b.top - h - 4)}px`;
  }, [align]);

  const close = useCallback(() => pop.current?.hidePopover(), []);

  useEffect(() => {
    const m = pop.current;
    if (!m) return;
    const onToggle = (e: Event) => {
      const open = (e as ToggleEvent).newState === 'open';
      btn.current?.setAttribute('aria-expanded', String(open));
      if (open) {
        place();
        m.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
      } else {
        window.removeEventListener('resize', close);
        window.removeEventListener('scroll', close, true);
        if (m.contains(document.activeElement) || document.activeElement === document.body)
          btn.current?.focus();
      }
    };
    m.addEventListener('toggle', onToggle);
    return () => {
      m.removeEventListener('toggle', onToggle);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [place, close]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...e.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ),
    ];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') close();
  };

  return (
    <MenuCtx.Provider value={{ close }}>
      <button
        ref={btn}
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls={id}
        aria-label={label}
        className={cn(buttonVariants({ variant, size }), className)}
      >
        {trigger}
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          'fixed inset-auto m-0 min-w-44 rounded-xl border border-border bg-surface-1 p-1 text-sm text-foreground shadow-popover',
          menuClassName,
        )}
      >
        {children}
      </div>
    </MenuCtx.Provider>
  );
}

export function MenuItem({
  icon: Icon,
  tone,
  disabled,
  onSelect,
  children,
}: {
  icon?: LucideIcon;
  tone?: 'danger';
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const { close } = useContext(MenuCtx);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        close();
        onSelect();
      }}
      className={cn(
        'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        tone === 'danger' && 'text-danger-fg hover:bg-danger-bg focus-visible:bg-danger-bg',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0 opacity-80" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}

/** Bagian non-interaktif di kepala menu (mis. identitas user). */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-2">{children}</div>;
}
