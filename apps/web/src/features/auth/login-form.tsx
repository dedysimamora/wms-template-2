'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequest, type LoginRequest } from '@wms/contracts';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { api, errorKey } from '@/services/http';

export function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequest),
  });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const { data } = await api<{ me: { user: { must_change_password: boolean } } }>(
        '/api/v1/auth/login',
        { method: 'POST', json: v },
      );
      const dest = data.me.user.must_change_password
        ? '/change-password'
        : next?.startsWith('/') && !next.startsWith('//')
          ? next
          : '/';
      router.replace(dest);
      router.refresh();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg"
        >
          {error}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="username">{t('auth.username')}</Label>
        <Input
          id="username"
          autoComplete="username"
          autoFocus
          aria-invalid={!!formState.errors.username}
          {...register('username')}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!formState.errors.password}
          {...register('password')}
        />
        <FieldError
          id="password-error"
          message={formState.errors.password ? t('errors.VALIDATION_ERROR') : undefined}
        />
      </div>
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        {t('auth.submit')}
      </Button>
    </form>
  );
}
