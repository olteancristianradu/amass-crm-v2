import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e.spec.ts'],
    globalSetup: ['./test/global.setup.ts'],
    setupFiles: ['./test/env.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run test files sequentially. e2e suites share Postgres/Redis/MinIO,
    // and BullMQ in particular hates parallelism here: each test file spins
    // up its own AppModule with workers subscribed to the same queue names,
    // so a job enqueued by one file can be picked up by a worker belonging
    // to another file's already-tearing-down app. Sequential file execution
    // guarantees exactly one worker alive per queue at any moment.
    fileParallelism: false,

    // M-17: coverage is now configured so `pnpm test --coverage` actually
    // produces a report. Provider is v8 (native Node coverage, fastest,
    // no Istanbul instrumentation overhead). Thresholds match CLAUDE.md
    // rule #8 (≥80% on services). They are advisory for now — turn the
    // enforcement on by adding `all: true` + raising `lines` once the
    // baseline catches up to target.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.e2e.spec.ts',
        'src/**/*.dto.ts',
        'src/**/*.module.ts',
        'src/**/index.ts',
        'src/main.ts',
        // Generated code + thin adapters — coverage here is not meaningful.
        'src/**/__mocks__/**',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70,
      },
    },
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
