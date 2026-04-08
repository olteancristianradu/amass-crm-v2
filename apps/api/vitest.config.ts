import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run test files sequentially. e2e suites share Postgres/Redis/MinIO,
    // and BullMQ in particular hates parallelism here: each test file spins
    // up its own AppModule with workers subscribed to the same queue names,
    // so a job enqueued by one file can be picked up by a worker belonging
    // to another file's already-tearing-down app. Sequential file execution
    // guarantees exactly one worker alive per queue at any moment.
    fileParallelism: false,
  },
  plugins: [
    // SWC is required so TypeScript decorator metadata is emitted —
    // NestJS DI relies on it (esbuild doesn't emit it).
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
