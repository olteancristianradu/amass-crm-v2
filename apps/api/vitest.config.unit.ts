import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit-only config — no external services required.
// Run with: pnpm test:unit
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/env.setup.ts'],
    testTimeout: 10000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
