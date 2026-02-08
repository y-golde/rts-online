import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/tests/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@rts/shared': './shared/src/index.ts',
    },
  },
});
