import { sql, type SQL } from 'drizzle-orm';
import type { UserAdminRepository } from '@wms/application';
import type { RoleDto, UserDto, UserListQuery, UserStatus } from '@wms/contracts';
import { iso, likeEscape, rows, uuidArray, where } from './sql';
import type { Tx } from './tx';

/**
 * Repository halaman Users. Memakai SQL mentah (drizzle `sql`) karena butuh agregat
 * (json_agg role, hitung sesi aktif) — bandingkan dengan sample-items.ts yang memakai query builder.
 */
type UserRow = {
  id: string;
  username: string;
  full_name: string | null;
  email: string | null;
  status: UserStatus;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  roles: UserDto['roles'];
  sessions: number;
};
const USER_SELECT = sql`
  SELECT u.id, u.username, u.full_name, u.email, u.status, u.must_change_password,
         u.failed_login_count, u.locked_until, u.last_login_at, u.created_at,
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.code)
                     FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]'::json) AS roles,
         (SELECT count(*)::int FROM refresh_token t
           WHERE t.user_id = u.id AND NOT t.revoked AND t.used_at IS NULL AND t.expires_at > now()) AS sessions
    FROM app_user u`;
const userDto = (r: UserRow): UserDto => ({
  id: r.id,
  username: r.username,
  full_name: r.full_name,
  email: r.email,
  status: r.status,
  must_change_password: r.must_change_password,
  failed_login_count: r.failed_login_count,
  locked_until: iso(r.locked_until),
  roles: r.roles,
  active_sessions: r.sessions,
  last_login_at: iso(r.last_login_at),
  created_at: iso(r.created_at)!,
});

export class DrizzleUserAdminRepository implements UserAdminRepository {
  constructor(private readonly tx: Tx) {}

  async list(q: UserListQuery) {
    const c: SQL[] = [];
    if (q.status) c.push(sql`u.status = ${q.status}`);
    if (q.role_id)
      c.push(
        sql`EXISTS (SELECT 1 FROM user_role x WHERE x.user_id = u.id AND x.role_id = ${q.role_id})`,
      );
    if (q.q) {
      const like = likeEscape(q.q);
      c.push(sql`(u.username ILIKE ${like} OR u.full_name ILIKE ${like} OR u.email ILIKE ${like})`);
    }
    const w = where(c);
    const data = await rows<UserRow>(
      this.tx,
      sql`${USER_SELECT} ${w} ORDER BY u.username LIMIT ${q.per_page} OFFSET ${(q.page - 1) * q.per_page}`,
    );
    const [n] = await rows<{ n: number }>(
      this.tx,
      sql`SELECT count(*)::int AS n FROM app_user u ${w}`,
    );
    return { rows: data.map(userDto), total: n?.n ?? 0 };
  }
  async get(id: string) {
    const [r] = await rows<UserRow>(this.tx, sql`${USER_SELECT} WHERE u.id = ${id}`);
    return r ? userDto(r) : null;
  }
  async lock(id: string) {
    const rs = await rows(this.tx, sql`SELECT 1 FROM app_user WHERE id = ${id} FOR UPDATE`);
    return rs.length > 0;
  }
  async identityTaken(p: { username?: string; email?: string | null }, exceptId?: string) {
    const [r] = await rows<{ taken: boolean }>(
      this.tx,
      sql`SELECT EXISTS (
            SELECT 1 FROM app_user
             WHERE (lower(username) = lower(${p.username ?? null}::text)
                    OR lower(email) = lower(${p.email ?? null}::text))
               AND id IS DISTINCT FROM ${exceptId ?? null}::uuid) AS taken`,
    );
    return !!r?.taken;
  }
  async insert(u: Parameters<UserAdminRepository['insert']>[0]) {
    const [r] = await rows<{ id: string }>(
      this.tx,
      sql`INSERT INTO app_user (username, full_name, email, password_hash, must_change_password)
          VALUES (${u.username}, ${u.fullName}, ${u.email}, ${u.passwordHash}, TRUE)
          RETURNING id`,
    );
    return r!.id;
  }
  async update(id: string, p: Parameters<UserAdminRepository['update']>[1]) {
    const set: SQL[] = [];
    if (p.fullName !== undefined) set.push(sql`full_name = ${p.fullName}`);
    if (p.email !== undefined) set.push(sql`email = ${p.email}`);
    if (set.length)
      await this.tx.execute(sql`UPDATE app_user SET ${sql.join(set, sql`, `)} WHERE id = ${id}`);
  }
  async setStatus(id: string, status: UserStatus) {
    await this.tx.execute(
      status === 'ACTIVE'
        ? sql`UPDATE app_user SET status = 'ACTIVE', failed_login_count = 0, locked_until = NULL WHERE id = ${id}`
        : sql`UPDATE app_user SET status = ${status}::user_status, locked_until = NULL WHERE id = ${id}`,
    );
  }
  async resetPassword(id: string, hash: string) {
    await this.tx.execute(
      sql`UPDATE app_user SET password_hash = ${hash}, must_change_password = TRUE,
                              failed_login_count = 0, locked_until = NULL WHERE id = ${id}`,
    );
  }
  async setRoles(id: string, roleIds: string[]) {
    await this.tx.execute(sql`DELETE FROM user_role WHERE user_id = ${id}`);
    if (roleIds.length)
      await this.tx.execute(
        sql`INSERT INTO user_role (user_id, role_id)
            SELECT ${id}, r.id FROM role r WHERE r.id = ANY(${uuidArray(roleIds)})`,
      );
  }
  async adminCount() {
    const [r] = await rows<{ n: number }>(
      this.tx,
      sql`SELECT count(DISTINCT u.id)::int AS n
            FROM app_user u
            JOIN user_role ur ON ur.user_id = u.id
            JOIN role_menu_access a ON a.role_id = ur.role_id
            JOIN menu m ON m.id = a.menu_id
           WHERE u.status = 'ACTIVE' AND m.code = 'admin_users' AND a.can_view AND a.can_edit`,
    );
    return r?.n ?? 0;
  }
  async listRoles() {
    return rows<RoleDto>(this.tx, sql`SELECT id, code, name, description FROM role ORDER BY code`);
  }
  async rolesExist(ids: string[]) {
    const [r] = await rows<{ n: number }>(
      this.tx,
      sql`SELECT count(*)::int AS n FROM role WHERE id = ANY(${uuidArray(ids)})`,
    );
    return (r?.n ?? 0) === new Set(ids).size;
  }
}
