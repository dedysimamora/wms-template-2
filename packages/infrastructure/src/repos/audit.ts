import { schema } from '@wms/db';
import type { AuditEntry, AuditRepository } from '@wms/application';
import type { Tx } from './tx';

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly tx: Tx) {}
  async log(e: AuditEntry) {
    await this.tx.insert(schema.auditLog).values({
      userId: e.userId,
      entity: e.entity,
      entityId: e.entityId ?? null,
      action: e.action,
      before: e.before ?? null,
      after: e.after ?? null,
      ipAddress: e.ip ?? null,
    });
  }
}
