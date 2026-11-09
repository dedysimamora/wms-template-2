import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const field =
  'h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-foreground shadow-xs transition-[border-color,box-shadow] duration-(--duration-fast) placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none disabled:opacity-60 aria-invalid:border-danger-fg aria-invalid:focus-visible:ring-danger-fg/20';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}
/** Chevron bawaan browser tak menghormati padding (menempel ke tepi) — diganti chevron kustom per tema. */
const selectField =
  'appearance-none bg-(image:--select-chevron) bg-size-[1rem] bg-position-[right_0.75rem_center] bg-no-repeat pr-9';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, selectField, className)} {...props} />;
}
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-danger-fg">
      {message}
    </p>
  );
}
