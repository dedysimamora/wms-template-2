import { defineConfig } from 'vitest/config';
// pool 'forks': Testcontainers (dockerode) tidak stabil di worker_threads.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
