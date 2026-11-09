/**
 * CONTOH CRUD NETRAL — use-case menu `sample_items`. Salin pola ini untuk fitur baru:
 *
 *   export async function <aksi>(uow, actor, ...input) {
 *     return uow.run(async (r) => {          // 1 transaksi untuk seluruh aksi
 *       await authorize(r, actor, MENU, 'view' | 'create' | 'edit' | 'delete');  // RBAC dulu
 *       ...cek aturan bisnis → throw DomainError(code, reason)
 *       ...tulis lewat repository (port)
 *       await r.audit.log({...})            // audit di transaksi yang sama
 *       return dto;
 *     });
 *   }
 *
 * Use-case TIDAK tahu HTTP/Next/Drizzle — hanya port (interface) & DomainError.
 */
import { DomainError } from '@wms/domain';
import type { SampleItemCreate, SampleItemListQuery, SampleItemUpdate } from '@wms/contracts';
import type { UnitOfWork } from '../ports';
import { authorize } from './authorize';

const MENU = 'sample_items';

export async function listSampleItems(uow: UnitOfWork, actor: string, q: SampleItemListQuery) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'view');
    return r.sampleItems.list(q);
  });
}

export async function getSampleItem(uow: UnitOfWork, actor: string, id: string) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'view');
    const item = await r.sampleItems.findById(id);
    if (!item) throw new DomainError('NOT_FOUND', undefined, 'Item tidak ditemukan');
    return item;
  });
}

export async function createSampleItem(uow: UnitOfWork, actor: string, input: SampleItemCreate) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'create');
    if (await r.sampleItems.codeExists(input.code))
      throw new DomainError('CONFLICT', 'CODE_TAKEN', `Kode ${input.code} sudah dipakai`);
    const id = await r.sampleItems.insert(input, actor);
    const created = (await r.sampleItems.findById(id))!;
    await r.audit.log({
      userId: actor,
      entity: 'sample_item',
      entityId: id,
      action: 'CREATE',
      after: created,
    });
    return created;
  });
}

export async function updateSampleItem(
  uow: UnitOfWork,
  actor: string,
  id: string,
  input: SampleItemUpdate,
) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'edit');
    if (!(await r.sampleItems.lock(id)))
      throw new DomainError('NOT_FOUND', undefined, 'Item tidak ditemukan');
    const before = (await r.sampleItems.findById(id))!;
    await r.sampleItems.update(id, input);
    const after = (await r.sampleItems.findById(id))!;
    await r.audit.log({
      userId: actor,
      entity: 'sample_item',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
    return after;
  });
}

export async function deleteSampleItem(uow: UnitOfWork, actor: string, id: string) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'delete');
    if (!(await r.sampleItems.lock(id)))
      throw new DomainError('NOT_FOUND', undefined, 'Item tidak ditemukan');
    const before = (await r.sampleItems.findById(id))!;
    await r.sampleItems.delete(id);
    await r.audit.log({
      userId: actor,
      entity: 'sample_item',
      entityId: id,
      action: 'DELETE',
      before,
    });
    return { id, deleted: true };
  });
}
