import { z } from 'zod';
import { listQuery } from './common';

/**
 * CONTOH CRUD NETRAL — kontrak (DTO + validasi) untuk menu `sample_items`.
 * Pola satu fitur: schema zod input (create/update/query) + tipe DTO output.
 * Dipakai bersama oleh API route (validasi server) dan form FE (validasi klien).
 */

export const SAMPLE_ITEM_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SampleItemStatus = (typeof SAMPLE_ITEM_STATUSES)[number];

export const sampleItemCreate = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, 'huruf besar/angka/-, 2–30 karakter'),
  name: z.string().trim().min(1, 'wajib diisi').max(120),
  description: z.string().trim().max(500).optional(),
});
export type SampleItemCreate = z.infer<typeof sampleItemCreate>;

/** Kode = identitas → tidak bisa diubah; field lain opsional (PATCH). */
export const sampleItemUpdate = z
  .object({
    name: z.string().trim().min(1, 'wajib diisi').max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: z.enum(SAMPLE_ITEM_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'tidak ada perubahan');
export type SampleItemUpdate = z.infer<typeof sampleItemUpdate>;

export const sampleItemListQuery = listQuery.extend({
  status: z.enum(SAMPLE_ITEM_STATUSES).optional(),
});
export type SampleItemListQuery = z.infer<typeof sampleItemListQuery>;

export type SampleItemDto = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: SampleItemStatus;
  created_by: { id: string; username: string } | null;
  created_at: string;
  updated_at: string;
};
