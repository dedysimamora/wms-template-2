'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USER_STATUSES, type RoleDto, type UserAction, type UserDto } from '@wms/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/blocks/data-table';
import { CodeText, PageHeader } from '@/components/blocks/page-header';
import { StatusBadge } from '@/components/blocks/status-badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field, FormPanel } from '@/features/shared/panel';
import { formatDateTime } from '@/lib/format/date';
import { qs } from '@/lib/qs';
import { api, errorText } from '@/services/http';

const KEY = ['admin-users'] as const;
const PATH = '/api/v1/admin/users';
const PER_PAGE = 50;
const EMPTY = { username: '', full_name: '', email: '', password: '', role_ids: [] as string[] };

/** Terkunci sementara (gagal login berulang) dianggap LOCKED untuk tampilan. */
const displayStatus = (u: UserDto) =>
  u.status === 'ACTIVE' && u.locked_until && new Date(u.locked_until) > new Date()
    ? 'LOCKED'
    : u.status;

function RolePicker({
  roles,
  value,
  onChange,
}: {
  roles: RoleDto[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
      {roles.map((r) => (
        <label key={r.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-(--primary)"
            checked={value.includes(r.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))
            }
          />
          {r.name}
        </label>
      ))}
    </fieldset>
  );
}

/** Panel baris (klik username): role, reset password, aksi status & sesi. */
function UserPanel({ u, roles, self }: { u: UserDto; roles: RoleDto[]; self: boolean }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [roleIds, setRoleIds] = useState(u.roles.map((r) => r.id));
  const [password, setPassword] = useState('');
  const done = () => void qc.invalidateQueries({ queryKey: KEY });
  const fail = (e: unknown) => toast.error(errorText(t, e));
  const act = useMutation({
    mutationFn: (p: { action: UserAction; body?: object }) =>
      api(`${PATH}/${u.id}/${p.action}`, { method: 'POST', json: p.body ?? {} }),
    onSuccess: (_r, p) => {
      toast.success(t(`users.done.${p.action}`));
      setPassword('');
      done();
    },
    onError: fail,
  });
  const saveRoles = useMutation({
    mutationFn: () => api(`${PATH}/${u.id}/roles`, { method: 'PUT', json: { role_ids: roleIds } }),
    onSuccess: () => {
      toast.success(t('users.rolesSaved'));
      done();
    },
    onError: fail,
  });
  const btn = (action: UserAction, variant: 'secondary' | 'destructive' = 'secondary') => (
    <Button
      size="sm"
      variant={variant}
      loading={act.isPending && act.variables?.action === action}
      onClick={() => act.mutate({ action })}
    >
      {t(`users.action.${action}`)}
    </Button>
  );
  const status = displayStatus(u);
  return (
    <div className="grid gap-6 text-sm md:grid-cols-3">
      <div className="space-y-2">
        <p className="font-medium">{t('users.roles')}</p>
        <RolePicker roles={roles} value={roleIds} onChange={setRoleIds} />
        <Button size="sm" loading={saveRoles.isPending} onClick={() => saveRoles.mutate()}>
          {t('users.saveRoles')}
        </Button>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate({ action: 'reset-password', body: { new_password: password } });
        }}
      >
        <label htmlFor={`pw-${u.id}`} className="font-medium">
          {t('users.tempPassword')}
        </label>
        <Input
          id={`pw-${u.id}`}
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('users.passwordHint')}</p>
        <Button
          size="sm"
          type="submit"
          variant="secondary"
          disabled={password.length < 10}
          loading={act.isPending && act.variables?.action === 'reset-password'}
        >
          {t('users.action.reset-password')}
        </Button>
      </form>
      <div className="space-y-2">
        <p className="font-medium">{t('users.statusActions')}</p>
        <div className="flex flex-wrap gap-2">
          {status === 'LOCKED' && btn('unlock')}
          {u.status === 'ACTIVE' && !self && btn('deactivate', 'destructive')}
          {u.status === 'INACTIVE' && btn('activate')}
          {btn('revoke-sessions')}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('users.sessions', { n: u.active_sessions })} · {t('users.lastLogin')}:{' '}
          {formatDateTime(u.last_login_at)}
        </p>
      </div>
    </div>
  );
}

/** Users: tanpa hard-delete (user dirujuk audit) → nonaktifkan. */
export function UsersFeature({
  me,
  canCreate,
  canEdit,
}: {
  me: string;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  const query = { q, status, page, per_page: PER_PAGE };
  const list = useQuery({
    queryKey: [...KEY, query],
    queryFn: () => api<UserDto[]>(`${PATH}?${qs(query)}`),
    placeholderData: keepPreviousData,
  });
  const roles = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api<RoleDto[]>('/api/v1/admin/roles').then((r) => r.data),
  });
  const create = useMutation({
    mutationFn: (d: typeof EMPTY) =>
      api(PATH, {
        method: 'POST',
        json: {
          username: d.username.trim(),
          password: d.password,
          role_ids: d.role_ids,
          ...(d.full_name.trim() && { full_name: d.full_name.trim() }),
          ...(d.email.trim() && { email: d.email.trim() }),
        },
      }),
    onSuccess: () => {
      toast.success(t('users.created'));
      setDraft(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errorText(t, e)),
  });
  return (
    <>
      <PageHeader
        title={t('nav.admin_users')}
        description={t('users.description')}
        actions={
          canCreate && !draft ? (
            <Button onClick={() => setDraft(EMPTY)}>{t('users.new')}</Button>
          ) : null
        }
      />
      {draft && (
        <FormPanel
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(draft);
          }}
        >
          <Field id="u-name" label={t('users.username')}>
            <Input
              id="u-name"
              className="font-mono"
              required
              autoComplete="off"
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            />
          </Field>
          <Field id="u-full" label={t('users.fullName')}>
            <Input
              id="u-full"
              value={draft.full_name}
              onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
            />
          </Field>
          <Field id="u-email" label="Email">
            <Input
              id="u-email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </Field>
          <Field id="u-pw" label={t('users.tempPassword')}>
            <Input
              id="u-pw"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('users.passwordHint')}</p>
          </Field>
          <div className="space-y-1.5 md:col-span-4">
            <p className="text-sm font-medium">{t('users.roles')}</p>
            <RolePicker
              roles={roles.data ?? []}
              value={draft.role_ids}
              onChange={(role_ids) => setDraft({ ...draft, role_ids })}
            />
          </div>
          <div className="flex items-end justify-end gap-2 md:col-span-4">
            <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
              {t('app.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t('app.save')}
            </Button>
          </div>
        </FormPanel>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          type="search"
          className="max-w-xs"
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
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('app.all')}</option>
          {USER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable<UserDto>
        caption={t('nav.admin_users')}
        rows={list.data?.data}
        loading={list.isPending}
        fetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('users.empty')}
        rowKey={(r) => r.id}
        page={page}
        perPage={PER_PAGE}
        total={list.data?.meta?.total}
        onPage={setPage}
        expanded={(r) =>
          canEdit && r.id === open ? (
            <UserPanel
              key={`${r.id}:${r.status}:${r.roles.length}`}
              u={r}
              roles={roles.data ?? []}
              self={r.id === me}
            />
          ) : null
        }
        columns={[
          {
            key: 'u',
            header: t('users.username'),
            cell: (r) =>
              canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={open === r.id}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  <CodeText>{r.username}</CodeText>
                </Button>
              ) : (
                <CodeText>{r.username}</CodeText>
              ),
          },
          { key: 'n', header: t('users.fullName'), cell: (r) => r.full_name ?? '—' },
          {
            key: 'r',
            header: t('users.roles'),
            cell: (r) => r.roles.map((x) => x.name).join(', ') || '—',
          },
          {
            key: 's',
            header: t('app.status'),
            cell: (r) => {
              const s = displayStatus(r);
              return <StatusBadge status={s} label={t(`status.${s}`)} />;
            },
          },
          {
            key: 'l',
            header: t('users.lastLogin'),
            cell: (r) => formatDateTime(r.last_login_at),
          },
        ]}
      />
    </>
  );
}
