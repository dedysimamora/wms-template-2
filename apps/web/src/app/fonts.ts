import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * Font di-self-host oleh next/font (diunduh saat build, disajikan dari origin sendiri — tanpa
 * panggilan ke Google saat runtime). Variabel dipakai --font-*-stack di globals.css.
 */
export const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});
export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});
