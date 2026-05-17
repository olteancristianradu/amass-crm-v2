import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import './styles.css';
import { router } from './router';
import { queryClient } from './lib/queryClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initI18n } from './i18n';

// Init i18next BEFORE the first render so RO is available synchronously.
// The function is idempotent — HMR / StrictMode double-mount is fine.
initI18n();

// Sentry: dynamic-imported only when VITE_SENTRY_DSN is set. Without
// this, `import * as Sentry` would pull @sentry/react (~120KB gzip)
// into the main bundle even on dev/local previews where the DSN is
// absent. The init is fire-and-forget — captureException calls before
// init returns will be queued by the SDK and re-emitted once it loads.
if (import.meta.env.VITE_SENTRY_DSN) {
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN as string,
      environment: import.meta.env.MODE,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    });
  });
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
