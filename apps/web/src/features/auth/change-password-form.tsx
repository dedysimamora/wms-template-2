'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordRequest } from '@wms/contracts';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { api, errorKey } from '@/services/http';

type Form = z.infer<typeof changePasswordRequest>;

export function ChangePasswordForm() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(changePasswordRequest),
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api('/api/v1/auth/change-password', { method: 'POST', json: v });
      toast.success(t('auth.changed'));
      router.replace('/login');
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
        <Label htmlFor="current_password">{t('auth.currentPassword')}</Label>
        <Input
          id="current_password"
          type="password"
          autoComplete="current-password"
          {...register('current_password')}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new_password">{t('auth.newPassword')}</Label>
        <Input
          id="new_password"
          type="password"
          autoComplete="new-password"
          aria-describedby="new_password-error"
          aria-invalid={!!formState.errors.new_password}
          {...register('new_password')}
        />
        <FieldError id="new_password-error" message={formState.errors.new_password?.message} />
      </div>
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        {t('auth.changePassword')}
      </Button>
    </form>
  );
}
