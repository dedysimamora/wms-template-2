'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SAMPLE_ITEM_STATUSES, type SampleItemDto, type SampleItemStatus } from '@wms/contracts';
import { CircleCheck, CircleSlash, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/blocks/confirm-dialog';
import { DataTable } from '@/components/blocks/data-table';
import { CodeText, PageHeader } from '@/components/blocks/page-header';
import { StatusBadge } from '@/components/blocks/status-badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { formatDateTime } from '@/lib/format/date';
import { errorText } from '@/services/http';
import {
  deleteSampleItemApi,
  fetchSampleItems,
  sampleItemKeys,
  updateSampleItemApi,
} from '../services/sample-items';
import { SampleItemForm } from './sample-item-form';

const PER_PAGE = 20;

/**
 * CONTOH HALAMAN CRUD — pola yang dipakai halaman lain:
 *  - state filter/paging lokal → query key → useQuery (data server, cache TanStack Query);
 *  - mutasi (useMutation) → toast + invalidasi query key fitur;
 *  - tombol aksi hanya dirender bila hak-nya ada (props dari page.tsx);
 *  - DataTable menangani loading / kosong / error / paging.
 */
export function SampleItemsFeature({
  canCreate,
  canEdit,
  canDelete,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | SampleItemStatus>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SampleItemDto | null>(null);

  const query = { q: q || undefined, status: status || undefined, page, per_page: PER_PAGE };
  const list = useQuery({
    queryKey: sampleItemKeys.list(query),
    queryFn: () => fetchSampleItems(query),
    placeholderData: keepPreviousData,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: sampleItemKeys.all });
  const fail = (e: unknown) => toast.error(errorText(t, e));
  const toggle = useMutation({
    mutationFn: (i: SampleItemDto) =>
      updateSampleItemApi({ id: i.id, status: i.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: (i) => {
      toast.success(t(i.status === 'ACTIVE' ? 'sampleItems.activated' : 'sampleItems.deactivated'));
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (i: SampleItemDto) => deleteSampleItemApi(i.id),
    onSuccess: (_r, i) => {
      toast.success(t('sampleItems.deleted', { code: i.code }));
      if (editing?.id === i.id) setEditing(null);
      refresh();
    },
    onError: fail,
  });

  const actions = (i: SampleItemDto) =>
    (canEdit || canDelete) && (
      <Menu label={`${t('app.actions')} ${i.code}`} trigger={<Ellipsis aria-hidden />}>
        {canEdit && (
          <>
            <MenuItem
              icon={Pencil}
              onSelect={() => {
                setCreating(false);
                setEditing(i);
              }}
            >
              {t('app.edit')}
            </MenuItem>
            <MenuItem
              icon={i.status === 'ACTIVE' ? CircleSlash : CircleCheck}
              disabled={toggle.isPending}
              onSelect={() => toggle.mutate(i)}
            >
              {t(i.status === 'ACTIVE' ? 'app.deactivate' : 'app.activate')}
            </MenuItem>
          </>
        )}
        {canEdit && canDelete && <MenuSeparator />}
        {canDelete && (
          <MenuItem
            icon={Trash2}
            tone="danger"
            disabled={remove.isPending}
            onSelect={async () => {
              const yes = await confirm({
                title: t('sampleItems.confirmDelete', { code: i.code }),
                description: t('sampleItems.confirmDeleteDesc'),
                confirmLabel: t('app.delete'),
                variant: 'destructive',
              });
              if (yes) remove.mutate(i);
            }}
          >
            {t('app.delete')}
          </MenuItem>
        )}
      </Menu>
    );

  return (
    <>
      <PageHeader
        title={t('nav.sample_items')}
        description={t('sampleItems.description')}
        actions={
          canCreate && !creating ? (
            <Button
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              {t('sampleItems.new')}
            </Button>
          ) : null
        }
      />
      {creating && <SampleItemForm onDone={() => setCreating(false)} />}
      {editing && (
        <>
          <h2 className="mb-2 text-sm font-medium">
            {t('sampleItems.editTitle', { code: editing.code })}
          </h2>
          <SampleItemForm key={editing.id} item={editing} onDone={() => setEditing(null)} />
        </>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          type="search"
          placeholder={t('app.search')}
          aria-label={t('app.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          className="max-w-44"
          aria-label={t('app.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="">{t('app.all')}</option>
          {SAMPLE_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <DataTable<SampleItemDto>
        caption={t('nav.sample_items')}
        rows={list.data?.data}
        loading={list.isPending}
        fetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('sampleItems.empty')}
        rowKey={(r) => r.id}
        page={page}
        perPage={PER_PAGE}
        total={list.data?.meta?.total}
        onPage={setPage}
        columns={[
          {
            key: 'code',
            header: t('sampleItems.code'),
            cell: (r) => <CodeText>{r.code}</CodeText>,
          },
          {
            key: 'name',
            header: t('sampleItems.name'),
            cell: (r) => (
              <>
                <span className="font-medium">{r.name}</span>
                {r.description && (
                  <span className="block max-w-md truncate text-xs text-muted-foreground">
                    {r.description}
                  </span>
                )}
              </>
            ),
          },
          {
            key: 'status',
            header: t('app.status'),
            cell: (r) => <StatusBadge status={r.status} label={t(`status.${r.status}`)} />,
          },
          {
            key: 'by',
            header: t('sampleItems.createdBy'),
            cell: (r) => r.created_by?.username ?? '—',
          },
          {
            key: 'updated',
            header: t('sampleItems.updatedAt'),
            cell: (r) => formatDateTime(r.updated_at),
          },
          {
            key: 'act',
            header: <span className="sr-only">{t('app.actions')}</span>,
            cell: actions,
            className: 'w-12 text-right',
          },
        ]}
      />
    </>
  );
}
