import { EncryptJWT, jwtDecrypt, base64url } from 'jose';
import type { MeResponse } from '@wms/contracts';

/** Isi cookie user_session (auth-session §5): cache TAMPILAN, bukan dasar otorisasi. */
export type SessionView = Pick<MeResponse, 'user' | 'roles' | 'menuAccess' | 'flags'>;

async function key(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

export async function sealSession(
  view: SessionView,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  // menuAccess diringkas code→bitmask agar cookie < 3 KB (frontend §7.1)
  const compact = {
    u: view.user,
    r: view.roles,
    f: view.flags,
    m: Object.fromEntries(
      Object.entries(view.menuAccess).map(([k, v]) => [
        k,
        (v.view ? 1 : 0) | (v.create ? 2 : 0) | (v.edit ? 4 : 0) | (v.delete ? 8 : 0),
      ]),
    ),
  };
  return new EncryptJWT(compact)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(await key(secret));
}

export async function unsealSession(
  token: string | undefined,
  secret: string,
): Promise<SessionView | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await key(secret));
    const m = payload.m as Record<string, number>;
    return {
      user: payload.u as SessionView['user'],
      roles: payload.r as string[],
      flags: payload.f as SessionView['flags'],
      menuAccess: Object.fromEntries(
        Object.entries(m).map(([k, b]) => [
          k,
          { view: !!(b & 1), create: !!(b & 2), edit: !!(b & 4), delete: !!(b & 8) },
        ]),
      ),
    };
  } catch {
    return null;
  }
}

export const randomToken = () => base64url.encode(crypto.getRandomValues(new Uint8Array(24)));
