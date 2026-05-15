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
    coverage: {
      // NOTE: vitest replaces (not merges) its default exclude list when
      // this key is set. So we re-declare the v8 provider defaults that
      // exclude spec files / type defs / build configs, then add ours:
      //   *.module.ts  — Nest DI declarations (decorators + class wiring)
      //   dto.ts / *.dto.ts — Zod schemas (testing them tests Zod, not us)
      //   main.ts      — bootstrap (covered by e2e)
      //   prisma/      — generated client
      exclude: [
        // Defaults from @vitest/coverage-v8 (keep in sync with vitest docs):
        'coverage/**',
        'dist/**',
        '**/[.]**',
        'packages/*/test?(s)/**',
        '**/*.d.ts',
        '**/virtual:*',
        '**/__x00__*',
        '**/\x00*',
        'cypress/**',
        'test?(s)/**',
        'test?(-*).?(c|m)[jt]s?(x)',
        '**/*{.,-}{test,spec}.?(c|m)[jt]s?(x)',
        '**/__tests__/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/vitest.{workspace,projects}.[jt]s?(on)',
        '**/.{eslint,mocha,prettier}rc.{?(c|m)js,yml}',
        // Our additions:
        '**/*.module.ts',
        '**/dto.ts',
        '**/*.dto.ts',
        'src/main.ts',
        '**/prisma/**',
      ],
    },
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
