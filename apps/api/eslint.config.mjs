// @ts-check
import tseslint from 'typescript-eslint';
import securityPlugin from 'eslint-plugin-security';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    plugins: { security: securityPlugin },
    rules: {
      // Allow console only in bootstrap/entry-point files (main.ts).
      'no-console': 'error',
      // Enforce no `any` — use `unknown` and narrow.
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow unused vars with _ prefix (conventional ignore marker).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty catch blocks are intentional in some places (idempotent ops).
      '@typescript-eslint/no-empty-function': 'off',
      // Security rules — cherry-picked from eslint-plugin-security with the
      // noisy heuristic rules disabled (non-literal-fs-filename, object
      // injection). The remaining set catches REAL bugs without drowning
      // us in false positives.
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-bidi-characters': 'error',
    },
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'],
  },
  // Test files: relax no-explicit-any — partial mocks legitimately need it
  {
    files: ['**/*.spec.ts', '**/*.e2e.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
