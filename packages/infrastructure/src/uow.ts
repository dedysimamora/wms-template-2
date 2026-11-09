import type { Db } from '@wms/db';
import type { Repos, UnitOfWork } from '@wms/application';
import { DomainError } from '@wms/domain';
import { DrizzleAccessRepository, DrizzleSettingsRepository } from './repos/access';
import { DrizzleAuditRepository } from './repos/audit';
import { DrizzleRefreshTokenRepository } from './repos/refresh-tokens';
import { DrizzleSampleItemRepository } from './repos/sample-items';
import type { Tx } from './repos/tx';
import { DrizzleUserAdminRepository } from './repos/user-admin';
import { DrizzleUserRepository } from './repos/users';

/** Wiring port → adapter. Repository baru WAJIB didaftarkan di sini. */
function repos(tx: Tx): Repos {
  return {
    users: new DrizzleUserRepository(tx),
    access: new DrizzleAccessRepository(tx),
    settings: new DrizzleSettingsRepository(tx),
    refreshTokens: new DrizzleRefreshTokenRepository(tx),
    audit: new DrizzleAuditRepository(tx),
    userAdmin: new DrizzleUserAdminRepository(tx),
    sampleItems: new DrizzleSampleItemRepository(tx),
  };
}

/** Terjemahkan error Postgres yang bermakna domain (lock_timeout → 409 LOCK_TIMEOUT, dst.). */
function mapPgError(e: unknown): unknown {
  const code =
    (e as { code?: string; cause?: { code?: string } })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  if (code === '55P03')
    return new DomainError('CONFLICT', 'LOCK_TIMEOUT', 'Sistem sibuk, coba lagi');
  if (code === '40P01')
    return new DomainError('CONFLICT', 'LOCK_TIMEOUT', 'Deadlock terdeteksi, coba lagi');
  if (code === '23505') {
    const constraint =
      (e as { constraint?: string }).constraint ??
      (e as { cause?: { constraint?: string } }).cause?.constraint;
    // Jaring terakhir saat dua request paralel lolos cek "kode sudah dipakai"
    return new DomainError('CONFLICT', 'CODE_TAKEN', 'Data duplikat', { constraint });
  }
  // FK RESTRICT = jaring terakhir hapus data yang masih dirujuk
  if (code === '23503')
    return new DomainError('CONFLICT', 'IN_USE', 'Data masih dirujuk data lain');
  return e;
}

/** UnitOfWork (ADR-002): satu transaksi READ COMMITTED; semua repo berbagi tx yang sama. */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Db) {}
  async run<T>(fn: (r: Repos) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction((tx) => fn(repos(tx)));
    } catch (e) {
      throw mapPgError(e);
    }
  }
}
