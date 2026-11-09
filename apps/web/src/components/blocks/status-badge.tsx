import { CircleCheck, CircleDashed, CircleDot, Lock, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/** StatusBadge (frontend §4.4): selalu teks + ikon — tidak hanya warna. */
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const TONE: Record<Tone, string> = {
  success: 'bg-success-bg text-success-fg border-success-border',
  warning: 'bg-warning-bg text-warning-fg border-warning-border',
  danger: 'bg-danger-bg text-danger-fg border-danger-border',
  info: 'bg-info-bg text-info-fg border-info-border',
  neutral: 'bg-neutral-bg text-neutral-fg border-neutral-border',
};
/** Status → nada warna + ikon. Tambah status baru fitur di sini. */
const MAP: Record<string, { tone: Tone; icon: LucideIcon }> = {
  ACTIVE: { tone: 'success', icon: CircleCheck },
  INACTIVE: { tone: 'neutral', icon: CircleDashed },
  LOCKED: { tone: 'warning', icon: Lock },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const m = MAP[status] ?? { tone: 'neutral' as const, icon: CircleDot };
  const Icon = m.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-transparent py-0.5 pr-2 pl-1.5 text-xs font-medium whitespace-nowrap hc:border-current',
        TONE[m.tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label ?? status}
    </span>
  );
}
