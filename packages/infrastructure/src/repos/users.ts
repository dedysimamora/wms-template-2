import { eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@wms/db';
import type { UserRecord, UserRepository } from '@wms/application';
import { toDate, type Tx } from './tx';

const { appUser } = schema;

/** Akses data user untuk alur AUTH (login/refresh/me/change-password). */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly tx: Tx) {}

  private async one(where: SQL): Promise<UserRecord | null> {
    const [u] = await this.tx.select().from(appUser).where(where).limit(1);
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      passwordHash: u.passwordHash,
      status: u.status,
      mustChangePassword: u.mustChangePassword,
      failedLoginCount: u.failedLoginCount,
      lockedUntil: toDate(u.lockedUntil),
    };
  }

  findByUsername(username: string) {
    return this.one(eq(appUser.username, username));
  }
  findById(id: string) {
    return this.one(eq(appUser.id, id));
  }
  async recordLoginSuccess(id: string, at: Date, newPasswordHash?: string) {
    await this.tx
      .update(appUser)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: at.toISOString(),
        ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
      })
      .where(eq(appUser.id, id));
  }
  async recordLoginFailure(id: string, failedCount: number, lockedUntil: Date | null) {
    await this.tx
      .update(appUser)
      .set({ failedLoginCount: failedCount, lockedUntil: lockedUntil?.toISOString() ?? null })
      .where(eq(appUser.id, id));
  }
  async updatePassword(id: string, hash: string) {
    await this.tx
      .update(appUser)
      .set({ passwordHash: hash, mustChangePassword: false, updatedAt: sql`now()` })
      .where(eq(appUser.id, id));
  }
}
