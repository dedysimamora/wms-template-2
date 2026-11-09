import type { NextConfig } from 'next';
import path from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

// Monorepo: .env tunggal di root (dipakai web, worker, db). Env proses tetap menang.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  /* tidak ada .env (CI/produksi memakai env proses) */
}

const config: NextConfig = {
  output: 'standalone',
  // Paket workspace = TS mentah (just-in-time) → di-transpile Next.
  transpilePackages: [
    '@wms/application',
    '@wms/contracts',
    '@wms/domain',
    '@wms/infrastructure',
    '@wms/config',
    '@wms/db',
  ],
  // Modul native / berat dijalankan apa adanya di Node (bukan di-bundle).
  serverExternalPackages: ['argon2', 'pg', 'pino', 'drizzle-orm'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Diabaikan browser di HTTP polos; berlaku begitu instalasi berada di balik TLS (NFR-SEC-2)
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
