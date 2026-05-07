import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    env: {
      NODE_ENV: 'test',
    },
  },
  resolve: {
    alias: {
      '@pod-life/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
