'use client';
import { Check, Contrast, LogOut, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { api } from '@/services/http';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Tema hanya diketahui di klien (next-themes); tanda centang dirender setelah hidrasi. */
const noop = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

const THEMES = [
  { id: 'light', key: 'themeLight', icon: Sun },
  { id: 'dark', key: 'themeDark', icon: Moon },
  { id: 'hc', key: 'themeHc', icon: Contrast },
] as const;

export function UserMenu({ name, roles }: { name: string; roles: string[] }) {
  const t = useTranslations('app');
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <Menu
      label={t('account')}
      variant="ghost"
      size="sm"
      className="h-10 gap-2.5 px-1.5 sm:pr-3"
      menuClassName="w-60"
      trigger={
        <>
          <span
            className="grid size-7 place-items-center rounded-full bg-primary-subtle text-xs font-semibold text-primary"
            aria-hidden
          >
            {initials(name)}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium sm:block">{name}</span>
        </>
      }
    >
      <MenuLabel>
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{roles.join(', ')}</p>
      </MenuLabel>
      <MenuSeparator />
      <p className="px-2.5 pt-1 pb-1 text-xs text-muted-foreground">{t('theme')}</p>
      {THEMES.map((m) => (
        <MenuItem key={m.id} icon={m.icon} onSelect={() => setTheme(m.id)}>
          <span className="flex items-center justify-between gap-2">
            {t(m.key)}
            {mounted && theme === m.id && <Check className="size-4 text-primary" aria-label="✓" />}
          </span>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        icon={LogOut}
        onSelect={async () => {
          await api('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
          router.replace('/login');
        }}
      >
        {t('logout')}
      </MenuItem>
    </Menu>
  );
}
