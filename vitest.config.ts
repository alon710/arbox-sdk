import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __ARBOX_SDK_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    coverage: { include: ['src/**'], exclude: ['src/generated/schema.ts'], reporter: ['text', 'lcov'] },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/live/**'],
          typecheck: { enabled: true, include: ['tests/**/*.test-d.ts'], tsconfig: './tsconfig.json' },
        },
      },
      { extends: true, test: { name: 'live', include: ['tests/live/**/*.test.ts'], testTimeout: 60_000 } },
    ],
  },
});
