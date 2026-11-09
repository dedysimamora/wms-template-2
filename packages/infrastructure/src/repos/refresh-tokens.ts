import { and, eq } from 'drizzle-orm';
import { schema } from '@wms/db';
import type { RefreshTokenRepository } from '@wms/application';
import { toDate, type Tx } from './tx';

const { refreshToken } = schema;

export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly tx: Tx) {}
  async insert(r: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
  }) {
    const [row] = await this.tx
      .insert(refreshToken)
      .values({ ...r, expiresAt: r.expiresAt.toISOString() })
      .returning({ id: refreshToken.id });
    return row!.id;
  }
  async lockByHash(hash: string) {
    const [r] = await this.tx
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.tokenHash, hash))
      .for('update');
    if (!r) return null;
    return {
      id: r.id,
      userId: r.userId,
      familyId: r.familyId,
      replacedBy: r.replacedBy,
      usedAt: toDate(r.usedAt),
      revoked: r.revoked,
      expiresAt: new Date(r.expiresAt),
    };
  }
  async markUsed(id: string, replacedBy: string, at: Date) {
    await this.tx
      .update(refreshToken)
      .set({ replacedBy, usedAt: at.toISOString() })
      .where(eq(refreshToken.id, id));
  }
  async revokeFamily(familyId: string, at: Date) {
    await this.tx
      .update(refreshToken)
      .set({ revoked: true, revokedAt: at.toISOString() })
      .where(and(eq(refreshToken.familyId, familyId), eq(refreshToken.revoked, false)));
  }
  async revokeAllForUser(userId: string, at: Date) {
    await this.tx
      .update(refreshToken)
      .set({ revoked: true, revokedAt: at.toISOString() })
      .where(and(eq(refreshToken.userId, userId), eq(refreshToken.revoked, false)));
  }
}
