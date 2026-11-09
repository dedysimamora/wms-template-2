import type { FormHTMLAttributes, ReactNode } from 'react';
import { Label } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/** Kartu form/panel desktop (pola yang sama dengan form master M0–M3). */
export function FormPanel({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      noValidate
      className={cn(
        'mb-6 grid gap-4 rounded-xl border border-border bg-surface-2/40 p-4 md:grid-cols-4 md:p-5',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8 md:mb-10">
      <h2 className="mb-3 text-base font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/** Daftar definisi ringkas (label: nilai) untuk panel detail. */
export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
