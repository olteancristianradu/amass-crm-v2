import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes anywhere below it and shows a fallback UI
 * instead of a white screen. Wraps the entire app in main.tsx.
 *
 * Async errors (fetch/Promise rejections) are NOT caught here — those
 * surface through TanStack Query's error states.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);

    // Stale lazy chunk after deploy. The cached index.html references
    // route-bundle hashes that no longer exist on the new build. Browser
    // attempts the dynamic import, the response is a 404 (sometimes an
    // HTML 200 that fails to parse as JS), Vite raises one of these.
    // Auto-reload once — index.html re-fetches and the next render uses
    // the fresh asset filenames. Guard against an infinite loop via
    // sessionStorage so a *genuine* render crash doesn't reload forever.
    const msg = error.message || '';
    const isStaleChunk =
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      /Loading chunk \d+ failed/.test(msg);
    if (isStaleChunk) {
      const flag = 'amass:stale-chunk-reload-at';
      const last = Number(sessionStorage.getItem(flag) ?? '0');
      const now = Date.now();
      // Only auto-reload if we haven't already tried in the last 30s.
      if (now - last > 30_000) {
        sessionStorage.setItem(flag, String(now));
        window.location.reload();
        return;
      }
    }

    // Dynamic import — keeps @sentry/react out of the main bundle. Only
    // fetched when a render-time crash actually fires (rare). If the
    // SDK never loaded (no DSN), the import resolves but Sentry.init
    // never ran — captureException is a no-op then.
    if (import.meta.env.VITE_SENTRY_DSN) {
      void import('@sentry/react').then((Sentry) =>
        Sentry.captureException(error, {
          extra: { componentStack: info.componentStack },
        }),
      );
    }
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private isStaleChunkError(): boolean {
    const msg = this.state.error?.message ?? '';
    return (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      /Loading chunk \d+ failed/.test(msg)
    );
  }

  render(): React.ReactNode {
    if (this.state.error) {
      const staleChunk = this.isStaleChunkError();
      // Special-case the stale-chunk story since the fallback should
      // explain why the user is seeing it (not "ceva nu a mers bine")
      // and reload should be the only obvious next step.
      if (staleChunk) {
        return (
          <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
            <div className="max-w-md w-full bg-card border border-border/70 rounded-lg shadow-md p-6">
              <h1 className="text-xl font-semibold mb-2">
                Aplicația a fost actualizată
              </h1>
              <p className="text-sm text-muted-foreground mb-4">
                A apărut o versiune nouă a CRM-ului. Reîncarcă pagina pentru a continua.
              </p>
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium hover:bg-primary/90"
              >
                Reîncarcă acum
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
          <div className="max-w-md w-full bg-card border border-border/70 rounded-lg shadow-md p-6">
            <h1 className="text-xl font-semibold text-destructive mb-2">
              Ceva nu a mers bine
            </h1>
            <p className="text-sm text-muted-foreground mb-4">
              Aplicația a întâmpinat o eroare neașteptată. Reîncarcă pagina pentru a continua.
            </p>
            <details className="text-xs text-muted-foreground mb-4">
              <summary className="cursor-pointer">Detalii tehnice</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </details>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              Reîncarcă pagina
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
