import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Dev setup:
 *  - `@/*` alias mirrors tsconfig.paths so imports look the same at build
 *    time and in the editor.
 *  - `/api/v1` is proxied to the NestJS API at :3000 so we don't need CORS
 *    in dev. The FE always talks to its own origin.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // @amass/shared builds to CJS for the NestJS API, but Rollup can't
      // statically extract named exports through its __exportStar wrapper.
      // Point directly at the TS source — Vite transpiles it fine.
      '@amass/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
