// ESLint flat config (paket non-Next). Jalankan dari root: pola `files` relatif terhadap root.
// Menegakkan aturan dependensi Clean Architecture (ADR-002) dengan larangan impor per lapisan.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const FRAMEWORK = [
  'next',
  'next/*',
  'react',
  'react-dom',
  'drizzle-orm',
  'drizzle-orm/*',
  'pg',
  'jose',
  'argon2',
  'pino',
];
const layer = (files, banned, message) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns: [{ group: banned, message }] }] },
});

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      'apps/web/**',
      'packages/db/src/schema.ts',
      'packages/db/.introspect/**',
      'docs/**',
      '**/*.config.ts',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  layer(
    ['packages/domain/src/**/*.ts'],
    [...FRAMEWORK, '@wms/*'],
    'domain tanpa dependensi (ADR-002).',
  ),
  layer(
    ['packages/contracts/src/**/*.ts', 'packages/config/src/**/*.ts'],
    [...FRAMEWORK, '@wms/*'],
    'contracts/config berdiri sendiri (hanya zod).',
  ),
  layer(
    ['packages/application/src/**/*.ts'],
    [...FRAMEWORK, '@wms/db', '@wms/infrastructure', '@wms/config'],
    'application hanya bergantung pada domain + contracts via PORT (ADR-002).',
  ),
  layer(
    ['packages/db/src/**/*.ts'],
    ['@wms/application', '@wms/infrastructure', '@wms/domain', 'next', 'next/*'],
    'db hanya skema/migrasi.',
  ),
  layer(
    ['packages/infrastructure/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    ['next', 'next/*', 'react', 'react-dom'],
    'adapter non-web tidak boleh memakai Next/React.',
  ),
  prettier,
);
