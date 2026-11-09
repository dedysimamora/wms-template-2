import type { ReactNode } from 'react';
import { BRAND } from '@/brand/brand';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt="" className="size-11 rounded-xl shadow-xs" />
          <span className="text-lg font-semibold tracking-tight">{BRAND.name}</span>
        </div>
        <div className="rounded-2xl bg-surface-1 p-6 shadow-sheet sm:p-8">{children}</div>
      </div>
    </main>
  );
}
