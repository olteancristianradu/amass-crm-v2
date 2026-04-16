// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow console only in bootstrap/entry-point files (main.ts).
      'no-console': 'error',
      // Enforce no `any` — use `unknown` and narrow.
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow unused vars with _ prefix (conventional ignore marker).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty catch blocks are intentional in some places (idempotent ops).
      '@typescript-eslint/no-empty-function': 'off',
    },
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'],
  },
);
