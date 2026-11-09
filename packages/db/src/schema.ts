// GENERATED oleh `pnpm --filter @wms/db introspect` dari DB hasil migrasi — JANGAN edit manual.
// Sumber kebenaran objek DB = migrations/*.sql; regenerasi setelah migrasi baru (lihat README §DB).
import { pgTable, foreignKey, unique, uuid, varchar, text, timestamp, boolean, integer, index, jsonb, inet, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const sampleItemStatus = pgEnum("sample_item_status", ['ACTIVE', 'INACTIVE'])
export const userStatus = pgEnum("user_status", ['ACTIVE', 'INACTIVE', 'LOCKED'])


export const appSetting = pgTable("app_setting", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: varchar({ length: 100 }).notNull(),
	value: text(),
	dataType: varchar("data_type", { length: 20 }).default('string').notNull(),
	description: text(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [appUser.id],
			name: "fk_app_setting_updated_by"
		}).onDelete("restrict"),
	unique("app_setting_key_key").on(table.key),
]);

export const appUser = pgTable("app_user", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	username: varchar({ length: 60 }).notNull(),
	email: varchar({ length: 150 }),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	fullName: varchar("full_name", { length: 150 }),
	status: userStatus().default('ACTIVE').notNull(),
	mustChangePassword: boolean("must_change_password").default(true).notNull(),
	failedLoginCount: integer("failed_login_count").default(0).notNull(),
	lockedUntil: timestamp("locked_until", { withTimezone: true, mode: 'string' }),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("app_user_username_key").on(table.username),
	unique("app_user_email_key").on(table.email),
]);

export const userRole = pgTable("user_role", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	roleId: uuid("role_id").notNull(),
}, (table) => [
	index("idx_user_role_role").using("btree", table.roleId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_role_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [appUser.id],
			name: "user_role_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [role.id],
			name: "user_role_role_id_fkey"
		}).onDelete("cascade"),
	unique("user_role_user_id_role_id_key").on(table.userId, table.roleId),
]);

export const role = pgTable("role", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 50 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("role_code_key").on(table.code),
]);

export const menu = pgTable("menu", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 60 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	route: varchar({ length: 150 }),
	parentId: uuid("parent_id"),
	icon: varchar({ length: 60 }),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	index("idx_menu_parent").using("btree", table.parentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "menu_parent_id_fkey"
		}).onDelete("cascade"),
	unique("menu_code_key").on(table.code),
]);

export const roleMenuAccess = pgTable("role_menu_access", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roleId: uuid("role_id").notNull(),
	menuId: uuid("menu_id").notNull(),
	canView: boolean("can_view").default(false).notNull(),
	canCreate: boolean("can_create").default(false).notNull(),
	canEdit: boolean("can_edit").default(false).notNull(),
	canDelete: boolean("can_delete").default(false).notNull(),
}, (table) => [
	index("idx_rma_menu").using("btree", table.menuId.asc().nullsLast().op("uuid_ops")),
	index("idx_rma_role").using("btree", table.roleId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [role.id],
			name: "role_menu_access_role_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.menuId],
			foreignColumns: [menu.id],
			name: "role_menu_access_menu_id_fkey"
		}).onDelete("cascade"),
	unique("role_menu_access_role_id_menu_id_key").on(table.roleId, table.menuId),
]);

export const sampleItem = pgTable("sample_item", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 30 }).notNull(),
	name: varchar({ length: 120 }).notNull(),
	description: text(),
	status: sampleItemStatus().default('ACTIVE').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_sample_item_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [appUser.id],
			name: "sample_item_created_by_fkey"
		}).onDelete("restrict"),
	unique("sample_item_code_key").on(table.code),
]);

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	entity: varchar({ length: 60 }).notNull(),
	entityId: uuid("entity_id"),
	action: varchar({ length: 40 }).notNull(),
	before: jsonb(),
	after: jsonb(),
	ipAddress: inet("ip_address"),
	at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_audit_at").using("btree", table.at.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("uuid_ops")),
	index("idx_audit_entity").using("btree", table.entity.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("uuid_ops")),
	index("idx_audit_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [appUser.id],
			name: "audit_log_user_id_fkey"
		}).onDelete("restrict"),
]);

export const refreshToken = pgTable("refresh_token", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: varchar("token_hash", { length: 255 }).notNull(),
	familyId: uuid("family_id").notNull(),
	replacedBy: uuid("replaced_by"),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
	revoked: boolean().default(false).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	userAgent: varchar("user_agent", { length: 255 }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_rt_family").using("btree", table.familyId.asc().nullsLast().op("uuid_ops")),
	index("idx_rt_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [appUser.id],
			name: "refresh_token_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.replacedBy],
			foreignColumns: [table.id],
			name: "refresh_token_replaced_by_fkey"
		}).onDelete("set null"),
	unique("refresh_token_token_hash_key").on(table.tokenHash),
]);
