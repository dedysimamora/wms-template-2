import { describe, expect, it } from 'vitest';
import {
  can,
  DomainError,
  menuCodeFromRoute,
  mergeMenuAccess,
  toBitmask,
  toPermissionMap,
} from '../src';

const none = { view: false, create: false, edit: false, delete: false };

describe('rbac', () => {
  it('deny-by-default & bitmask', () => {
    expect(toBitmask({ view: true, create: false, edit: true, delete: false })).toBe(5);
    const map = toPermissionMap({ sample_items: { ...none, view: true }, admin_users: none });
    expect(map).toEqual({ sample_items: 1 }); // baris all-false tidak dikirim
    expect(can(map, 'sample_items', 'view')).toBe(true);
    expect(can(map, 'sample_items', 'delete')).toBe(false);
    expect(can(map, 'admin_users', 'view')).toBe(false);
    expect(can(null, 'sample_items', 'view')).toBe(false);
  });

  it('union multi-role', () => {
    const merged = mergeMenuAccess([
      { menuCode: 'sample_items', ...none, view: true },
      { menuCode: 'sample_items', ...none, delete: true },
    ]);
    expect(merged.sample_items).toEqual({ view: true, create: false, edit: false, delete: true });
  });

  it('konvensi kode menu dari route', () => {
    expect(menuCodeFromRoute('/admin/users')).toBe('admin_users');
    expect(menuCodeFromRoute('/sample/items')).toBe('sample_items');
    expect(menuCodeFromRoute('/master/reason-codes')).toBe('master_reason_codes');
  });
});

describe('DomainError', () => {
  it('memetakan code → HTTP status', () => {
    expect(new DomainError('FORBIDDEN').httpStatus).toBe(403);
    expect(new DomainError('CONFLICT', 'CODE_TAKEN').reason).toBe('CODE_TAKEN');
  });
});
