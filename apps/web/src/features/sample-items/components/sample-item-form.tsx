'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sampleItemCreate, type SampleItemCreate, type SampleItemDto } from '@wms/contracts';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/input';
import { Field, FormPanel } from '@/features/shared/panel';
import { errorText } from '@/services/http';
import { createSampleItemApi, sampleItemKeys, updateSampleItemApi } from '../services/sample-items';

/**
 * Form create / edit (bila `item` diisi). Validasi klien memakai schema zod yang SAMA dengan
 * server (@wms/contracts) → aturan input tak ditulis dua kali. Kode tidak bisa diubah saat edit.
 */
export function SampleItemForm({ item, onDone }: { item?: SampleItemDto; onDone: () => void }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const { register, handleSubmit, formState } = useForm<SampleItemCreate>({
    resolver: zodResolver(sampleItemCreate),
    defaultValues: item
      ? { code: item.code, name: item.name, description: item.description ?? '' }
      : { code: '', name: '', description: '' },
  });
  const save = useMutation({
    mutationFn: ({ code, name, description }: SampleItemCreate) =>
      item
        ? updateSampleItemApi({ id: item.id, name, description: description || null })
        : createSampleItemApi({ code, name, ...(description && { description }) }),
    onSuccess: () => {
      toast.success(t(item ? 'sampleItems.updated' : 'sampleItems.created'));
      void qc.invalidateQueries({ queryKey: sampleItemKeys.all });
      onDone();
    },
    onError: (e) => toast.error(errorText(t, e)),
  });
  const err = formState.errors;

  return (
    <FormPanel onSubmit={handleSubmit((v) => save.mutate(v))}>
      <Field id="si-code" label={t('sampleItems.code')}>
        <Input
          id="si-code"
          className="font-mono uppercase"
          readOnly={!!item}
          aria-readonly={!!item}
          aria-invalid={!!err.code}
          aria-describedby="si-code-e"
          autoComplete="off"
          {...register('code', { setValueAs: (v: string) => v.toUpperCase() })}
        />
        <FieldError id="si-code-e" message={err.code?.message} />
      </Field>
      <Field id="si-name" label={t('sampleItems.name')}>
        <Input
          id="si-name"
          aria-invalid={!!err.name}
          aria-describedby="si-name-e"
          {...register('name')}
        />
        <FieldError id="si-name-e" message={err.name?.message} />
      </Field>
      <Field id="si-desc" label={t('sampleItems.descriptionLabel')} className="md:col-span-2">
        <Input id="si-desc" aria-invalid={!!err.description} {...register('description')} />
        <FieldError id="si-desc-e" message={err.description?.message} />
      </Field>
      <div className="flex justify-end gap-2 md:col-span-4">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('app.cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {t('app.save')}
        </Button>
      </div>
    </FormPanel>
  );
}
