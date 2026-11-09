import { redirect } from 'next/navigation';
import { buildAuthorizedNavigation } from '@/lib/authz/navigation';
import { requireSession } from '@/server/guards';
import type { NavItem } from '@/config/app.config';

const firstHref = (items: NavItem[]): string | undefined =>
  items.map((i) => i.href ?? firstHref(i.children ?? [])).find(Boolean);

/** Beranda: arahkan ke menu pertama yang boleh dilihat user (atau /forbidden bila tidak ada). */
export default async function Home() {
  const s = await requireSession();
  redirect(firstHref(buildAuthorizedNavigation(s.permissions)) ?? '/forbidden');
}
