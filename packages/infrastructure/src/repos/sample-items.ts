import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { schema } from '@wms/db';
import type { SampleItemRepository } from '@wms/application';
import type {
  SampleItemCreate,
  SampleItemDto,
  SampleItemListQuery,
  SampleItemUpdate,
} from '@wms/contracts';
import { iso, likeEscape } from './sql';
import type { Tx } from './tx';

/**
 * CONTOH CRUD NETRAL — adapter Drizzle (query builder bertipe).
 * Tugas repository: terjemahkan port ⇄ SQL dan baris DB (camelCase) ⇄ DTO API (snake_case).
 * Tidak ada aturan bisnis / RBAC di sini — itu tugas use-case.
 */
const { sampleItem, appUser } = schema;

const SORTABLE = {
  code: sampleItem.code,
  name: sampleItem.name,
  created_at: sampleItem.createdAt,
  updated_at: sampleItem.updatedAt,
} as const;

export class DrizzleSampleItemRepository implements SampleItemRepository {
  constructor(private readonly tx: Tx) {}

  private base() {
    return this.tx
      .select({
        id: sampleItem.id,
        code: sampleItem.code,
        name: sampleItem.name,
        description: sampleItem.description,
        status: sampleItem.status,
        createdAt: sampleItem.createdAt,
        updatedAt: sampleItem.updatedAt,
        creatorId: appUser.id,
        creatorUsername: appUser.username,
      })
      .from(sampleItem)
      .leftJoin(appUser, eq(appUser.id, sampleItem.createdBy));
  }

  private static dto(r: Awaited<ReturnType<DrizzleSampleItemRepository['base']>>[number]) {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      status: r.status,
      created_by: r.creatorId ? { id: r.creatorId, username: r.creatorUsername! } : null,
      created_at: iso(r.createdAt)!,
      updated_at: iso(r.updatedAt)!,
    } satisfies SampleItemDto;
  }

  async list(q: SampleItemListQuery) {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(sampleItem.status, q.status));
    if (q.q) {
      const like = likeEscape(q.q);
      conds.push(or(ilike(sampleItem.code, like), ilike(sampleItem.name, like))!);
    }
    const filter = conds.length ? and(...conds) : undefined;
    // sort=name | -updated_at (default: terbaru diubah dulu)
    const key = (q.sort?.replace(/^-/, '') ?? 'updated_at') as keyof typeof SORTABLE;
    const col = SORTABLE[key] ?? SORTABLE.updated_at;
    const dir = q.sort && !q.sort.startsWith('-') ? asc(col) : desc(col);

    const data = await this.base()
      .where(filter)
      .orderBy(dir, asc(sampleItem.id))
      .limit(q.per_page)
      .offset((q.page - 1) * q.per_page);
    const [n] = await this.tx.select({ n: count() }).from(sampleItem).where(filter);
    return { rows: data.map(DrizzleSampleItemRepository.dto), total: n?.n ?? 0 };
  }

  async findById(id: string) {
    const [r] = await this.base().where(eq(sampleItem.id, id)).limit(1);
    return r ? DrizzleSampleItemRepository.dto(r) : null;
  }

  async codeExists(code: string) {
    const [r] = await this.tx
      .select({ id: sampleItem.id })
      .from(sampleItem)
      .where(eq(sampleItem.code, code))
      .limit(1);
    return !!r;
  }

  async insert(p: SampleItemCreate, createdBy: string) {
    const [r] = await this.tx
      .insert(sampleItem)
      .values({ code: p.code, name: p.name, description: p.description ?? null, createdBy })
      .returning({ id: sampleItem.id });
    return r!.id;
  }

  async update(id: string, p: SampleItemUpdate) {
    await this.tx
      .update(sampleItem)
      .set({
        ...(p.name !== undefined && { name: p.name }),
        ...(p.description !== undefined && { description: p.description }),
        ...(p.status !== undefined && { status: p.status }),
      })
      .where(eq(sampleItem.id, id));
  }

  async lock(id: string) {
    const rs = await this.tx
      .select({ id: sampleItem.id })
      .from(sampleItem)
      .where(eq(sampleItem.id, id))
      .for('update');
    return rs.length > 0;
  }

  async delete(id: string) {
    await this.tx.delete(sampleItem).where(eq(sampleItem.id, id));
  }
}
