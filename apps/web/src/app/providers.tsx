'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/blocks/confirm-dialog';

export function Providers({
  children,
  locale,
  messages,
  defaultTheme,
  timeZone,
}: {
  children: ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
  defaultTheme: string;
  timeZone: string;
}) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
      onError={(e) => {
        if (e.code !== 'MISSING_MESSAGE') console.error(e);
      }}
      getMessageFallback={({ key }) => key}
    >
      <ThemeProvider
        attribute="class"
        themes={['light', 'dark', 'hc']}
        defaultTheme={defaultTheme}
        enableSystem={false}
      >
        <QueryClientProvider client={qc}>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster richColors position="top-right" />
        </QueryClientProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
