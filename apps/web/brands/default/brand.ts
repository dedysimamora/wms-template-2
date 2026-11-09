/**
 * Brand bawaan produk: Levytech WMS. Klien dengan branding sendiri: salin folder ini ke
 * brands/<klien>/ lalu build dengan BRAND_ID=<klien>.
 */
export const BRAND = {
  id: 'default',
  name: 'Levytech WMS',
  logo: '/branding/logo.svg',
  defaultLocale: 'id',
  defaultMode: 'light',
  themeColorHex: '#09736c', // ≈ --brand-600 (manifest PWA tak bisa membaca var CSS/OKLCH)
  backgroundHex: { light: '#f8f7f4', dark: '#141412' }, // ≈ --background (kanvas)
} as const;
export type Brand = typeof BRAND;
