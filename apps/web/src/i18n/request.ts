import { getRequestConfig } from 'next-intl/server';
import { BRAND } from '@/brand/brand';

/** i18n tanpa routing locale (fase 1: id default; multi-bahasa penuh = SC-6). */
export default getRequestConfig(async () => {
  const locale = BRAND.defaultLocale;
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages, timeZone: 'Asia/Jakarta' };
});
