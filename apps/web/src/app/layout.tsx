import type { Metadata, Viewport } from 'next';
import { getLocale, getMessages, getTimeZone } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BRAND } from '@/brand/brand';
import { fontMono, fontSans } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  icons: { icon: BRAND.logo },
};
export const viewport: Viewport = { themeColor: BRAND.themeColorHex };

/** Root layout: TANPA baca DB — brand dari codebase (frontend §3.5). */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, messages, timeZone] = await Promise.all([
    getLocale(),
    getMessages(),
    getTimeZone(),
  ]);
  return (
    <html
      lang={locale}
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <Providers
          locale={locale}
          messages={messages}
          timeZone={timeZone}
          defaultTheme={BRAND.defaultMode}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
