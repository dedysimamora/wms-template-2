import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authorize } from '@wms/application';
import { isDomainError, toPermissionMap, type PermissionMap } from '@wms/domain';
import { container } from './container';
import { COOKIE } from './cookies';
import { unsealSession, type SessionView } from './session-seal';

export type PageSession = SessionView & { userId: string; permissions: PermissionMap };

/** Sesi untuk Server Component: access token WAJIB valid + user_session ter-unseal (frontend §7.2). */
export async function getSession(): Promise<PageSession | null> {
  const jar = await cookies();
  const c = container();
  const claims = await c.tokens.verifyAccess(jar.get(COOKIE.access)?.value ?? '');
  if (!claims) return null;
  const view = await unsealSession(jar.get(COOKIE.session)?.value, c.env.SESSION_SECRET);
  if (!view || view.user.id !== claims.sub) return null;
  return { ...view, userId: claims.sub, permissions: toPermissionMap(view.menuAccess) };
}

export async function requireSession(): Promise<PageSession> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.user.must_change_password) redirect('/change-password');
  return s;
}

/**
 * Guard per page (frontend §6.3) — dipanggil di SETIAP page.tsx terlindung (layout tidak
 * re-render saat soft navigation). Otoritatif: cek DB, bukan cookie.
 */
export async function requirePageAccess(menuCode: string): Promise<PageSession> {
  const s = await requireSession();
  try {
    await container().uow.run((r) => authorize(r, s.userId, menuCode, 'view'));
  } catch (e) {
    if (isDomainError(e) && e.code === 'FORBIDDEN') redirect('/forbidden');
    throw e;
  }
  return s;
}
