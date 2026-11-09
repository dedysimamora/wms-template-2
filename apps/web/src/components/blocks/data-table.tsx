'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { errorKey } from '@/services/http';
import { EmptyState } from './page-header';

/** Kelas bersama tabel (dipakai juga oleh tabel rakitan sendiri di fitur) agar gaya seragam. */
export const tableFrame = 'relative overflow-x-auto rounded-xl border border-border bg-surface-1';
export const tableHead =
  'border-b border-border bg-surface-2/60 text-left text-xs font-medium text-muted-foreground';
export const tableRow =
  'border-t border-border align-middle transition-colors duration-(--duration-fast) first:border-t-0 hover:bg-surface-2/50';

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
};

/** DataTable (frontend §4.4): state loading/empty/error/stale + pagination + baris expandable. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  fetching,
  error,
  onRetry,
  emptyTitle,
  page,
  perPage,
  total,
  onPage,
  expanded,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle: string;
  page?: number;
  perPage?: number;
  total?: number;
  onPage?: (p: number) => void;
  expanded?: (row: T) => ReactNode | null;
  caption?: string;
}) {
  const t = useTranslations();
  if (error)
    return (
      <EmptyState
        title={t(errorKey(error))}
        action={
          onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              {t('app.retry')}
            </Button>
          )
        }
      />
    );
  if (!loading && rows && rows.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <div className={tableFrame} aria-busy={fetching || loading}>
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className={tableHead}>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('h-10 px-3 font-medium whitespace-nowrap', c.className)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading || !rows
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="border-t border-border first:border-t-0">
                  <td colSpan={columns.length} className="h-(--row-compact) px-3">
                    <div
                      className="h-3 animate-pulse rounded-full bg-surface-2"
                      style={{ width: `${60 - i * 8}%` }}
                    />
                  </td>
                </tr>
              ))
            : rows.map((r) => {
                const extra = expanded?.(r);
                return (
                  <Fragment key={rowKey(r)}>
                    <tr className={tableRow}>
                      {columns.map((c) => (
                        <td key={c.key} className={cn('h-(--row-compact) px-3 py-2', c.className)}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                    {extra && (
                      <tr className="border-t border-border bg-surface-2/40">
                        <td colSpan={columns.length} className="px-4 py-4">
                          {extra}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
        </tbody>
      </table>
      {onPage && page && perPage && (
        <Pager page={page} perPage={perPage} total={total ?? 0} onPage={onPage} />
      )}
    </div>
  );
}

/** Kaki tabel: jumlah item + navigasi halaman (tombol 40px, ikon berlabel). */
export function Pager({
  page,
  perPage,
  total,
  onPage,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-sm text-muted-foreground">
      <span className="tabular">{t('app.items', { n: total })}</span>
      <div className="flex items-center gap-1">
        <span className="mr-2 hidden tabular sm:inline">
          {t('app.pageOf', { page, pages: Math.max(1, Math.ceil(total / perPage)) })}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-10"
          aria-label={t('app.prev')}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-10"
          aria-label={t('app.next')}
          disabled={page * perPage >= total}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
