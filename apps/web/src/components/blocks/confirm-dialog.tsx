'use client';
import { CircleHelp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export type ConfirmDialogVariant = 'default' | 'destructive';

export type ConfirmOptions = {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  variant?: ConfirmDialogVariant;
  /** `hh` = tombol penuh 56px untuk handheld (target sentuh sarung tangan). */
  size?: 'md' | 'hh';
};

export type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
};

/**
 * ConfirmDialog (frontend §4.4): aksi destruktif/final di desktop. `<dialog>` modal = fokus
 * terperangkap & latar inert; `Esc`/klik latar = batal. Fokus awal di tombol batal (aman).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loading = false,
  variant = 'default',
  size = 'md',
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const t = useTranslations('app');
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const destructive = variant === 'destructive';
  const Icon = destructive ? TriangleAlert : CircleHelp;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const dismiss = () => {
    if (!loading) onOpenChange(false);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-surface-1 p-0 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="flex gap-4 p-5">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full border',
            destructive
              ? 'border-danger-border bg-danger-bg text-danger-fg'
              : 'border-info-border bg-info-bg text-info-fg',
          )}
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 space-y-1.5 pt-1.5">
          <h2 id={`${id}-t`} className="text-base font-semibold leading-6">
            {title}
          </h2>
          {description ? (
            <p id={`${id}-d`} className="text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          'flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3',
          size === 'md' && 'sm:flex-row sm:justify-end',
        )}
      >
        <Button
          type="button"
          variant="secondary"
          size={size}
          autoFocus
          disabled={loading}
          onClick={dismiss}
        >
          {cancelLabel ?? t('back')}
        </Button>
        <Button
          type="button"
          variant={destructive ? 'destructive' : 'primary'}
          size={size}
          loading={loading}
          onClick={() => void onConfirm()}
        >
          {confirmLabel ?? t('yes')}
        </Button>
      </div>
    </dialog>
  );
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Satu ConfirmDialog global; `useConfirm()` = pengganti `window.confirm` berbasis Promise. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const current = useRef<Pending | null>(null);
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        current.current?.resolve(false); // permintaan baru menggantikan yang belum dijawab
        current.current = { ...o, resolve };
        setPending(current.current);
        setOpen(true);
      }),
    [],
  );
  const settle = (ok: boolean) => {
    current.current?.resolve(ok);
    current.current = null;
    setOpen(false);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          {...pending}
          open={open}
          onConfirm={() => settle(true)}
          onOpenChange={(o) => {
            if (!o) settle(false);
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm di luar <ConfirmProvider>');
  return fn;
}
