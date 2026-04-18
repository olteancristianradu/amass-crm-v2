import React from 'react';
import * as Sentry from '@sentry/react';

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
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
            <h1 className="text-xl font-semibold text-red-600 mb-2">
              Ceva nu a mers bine
            </h1>
            <p className="text-sm text-gray-600 mb-4">
              Aplicația a întâmpinat o eroare neașteptată. Reîncarcă pagina pentru a continua.
            </p>
            <details className="text-xs text-gray-500 mb-4">
              <summary className="cursor-pointer">Detalii tehnice</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </details>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm hover:bg-blue-700"
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
