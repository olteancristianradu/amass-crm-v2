import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { fileURLToPath, URL } from 'node:url';

// Bundle analyzer is opt-in: ANALYZE=1 pnpm --filter @amass/web build
// produces dist/stats.html with a tree-map of every chunk.
const isAnalyze = process.env.ANALYZE === '1';

/**
 * Dev setup:
 *  - `@/*` alias mirrors tsconfig.paths so imports look the same at build
 *    time and in the editor.
 *  - `/api/v1` is proxied to the NestJS API at :3000 so we don't need CORS
 *    in dev. The FE always talks to its own origin.
 */
export default defineConfig({
  plugins: [
    react(),
    isAnalyze &&
      visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        open: false,
      }),
  ].filter(Boolean),
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
      '/ws': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    // ES2022 target — esbuild 0.27+ no longer transforms async-iterator and
    // private-field destructuring down to ES2020 (the older default vite
    // "modules" target). All evergreen browsers from 2022+ support ES2022;
    // the CRM is auth-gated B2B, no need for legacy support.
    target: 'es2022',
    // Chunk size warning silenced — ~560KB main gzips to ~145KB, fine for an
    // auth-gated B2B CRM. Route-level lazy imports already cut the main
    // bundle meaningfully; aggressive vendor splitting breaks React
    // ecosystem packages (tanstack needs React.createContext, a split
    // react-vendor leaves the context missing and the SPA renders blank).
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Static manualChunks — Rollup guarantees React-ecosystem packages
        // stay grouped together so cross-chunk `createContext` lookups work.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-dom/client'],
          'tanstack-vendor': [
            '@tanstack/react-router',
            '@tanstack/react-query',
            '@tanstack/react-table',
          ],
          'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
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
