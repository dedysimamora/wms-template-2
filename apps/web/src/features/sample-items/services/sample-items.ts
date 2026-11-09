'use client';
import type {
  SampleItemCreate,
  SampleItemDto,
  SampleItemListQuery,
  SampleItemUpdate,
} from '@wms/contracts';
import { qs } from '@/lib/qs';
import { api } from '@/services/http';

/**
 * Lapisan service FE: satu-satunya tempat fitur ini memanggil API.
 * Query key dikumpulkan di sini agar invalidasi cache TanStack Query konsisten.
 */
const PATH = '/api/v1/sample/items';

export const sampleItemKeys = {
  all: ['sample-items'] as const,
  list: (q: Partial<SampleItemListQuery>) => ['sample-items', 'list', q] as const,
};

export const fetchSampleItems = (q: Partial<SampleItemListQuery>) =>
  api<SampleItemDto[]>(`${PATH}?${qs(q)}`);

export const createSampleItemApi = (p: SampleItemCreate) =>
  api<SampleItemDto>(PATH, { method: 'POST', json: p }).then((r) => r.data);

export const updateSampleItemApi = ({ id, ...p }: SampleItemUpdate & { id: string }) =>
  api<SampleItemDto>(`${PATH}/${id}`, { method: 'PATCH', json: p }).then((r) => r.data);

export const deleteSampleItemApi = (id: string) =>
  api<{ id: string; deleted: boolean }>(`${PATH}/${id}`, { method: 'DELETE' }).then((r) => r.data);
