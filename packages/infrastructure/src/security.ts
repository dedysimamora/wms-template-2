import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';
import type { AccessClaims, PasswordHasher, TokenService } from '@wms/application';

/** argon2id utama; bcrypt (seed/impor) diverifikasi lalu ditandai perlu rehash (auth-session §2). */
export class Argon2Hasher implements PasswordHasher {
  private dummy: Promise<string> | undefined;
  hash(plain: string) {
    return argon2.hash(plain, { type: argon2.argon2id });
  }
  async verify(hash: string, plain: string) {
    if (hash.startsWith('$2')) return { ok: await bcrypt.compare(plain, hash), needsRehash: true };
    if (hash.startsWith('$argon2')) {
      const ok = await argon2.verify(hash, plain);
      return { ok, needsRehash: ok && argon2.needsRehash(hash) };
    }
    return { ok: false, needsRehash: false };
  }
  async dummyVerify(plain: string) {
    this.dummy ??= this.hash('dummy-password-for-timing');
    await argon2.verify(await this.dummy, plain).catch(() => false);
  }
}

export class JoseTokenService implements TokenService {
  private readonly key: Uint8Array;
  constructor(
    secret: string,
    private readonly accessTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }
  async signAccess(c: AccessClaims) {
    const expiresAt = new Date(Date.now() + this.accessTtlSeconds * 1000);
    const token = await new SignJWT({
      roles: c.roles,
      mcp: c.mustChangePassword,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.sub)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .setIssuer('wms')
      .sign(this.key);
    return { token, expiresAt };
  }
  async verifyAccess(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'wms',
        algorithms: ['HS256'],
      });
      if (!payload.sub || !payload.jti) return null;
      return {
        sub: payload.sub,
        jti: payload.jti,
        roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
        mustChangePassword: payload.mcp === true,
      };
    } catch {
      return null;
    }
  }
  newRefreshToken() {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashRefresh(raw) };
  }
  hashRefresh(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }
}
