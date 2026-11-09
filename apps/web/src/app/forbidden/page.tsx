import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/server/guards';

export default async function Forbidden() {
  await requireSession();
  const t = await getTranslations();
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-2xl font-semibold">{t('forbidden.title')}</h1>
        <p className="text-muted-foreground">{t('forbidden.body')}</p>
        <Link href="/" className={buttonVariants({ variant: 'secondary' })}>
          {t('app.back')}
        </Link>
      </div>
    </main>
  );
}
