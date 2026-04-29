import { useState } from 'react';
import { Link } from '@tanstack/react-router';

const STORAGE_KEY = 'amass.cookieConsent.v1';
type ConsentState = 'accepted' | 'rejected' | null;

function readStoredConsent(): ConsentState {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'accepted' || stored === 'rejected') return stored;
  return null;
}

/**
 * Cookie consent banner — required by Romanian Law 506/2004 + GDPR for any
 * non-essential cookies. Currently we only use STRICTLY NECESSARY cookies
 * (auth session, CSRF, UI preferences), so the banner is informational
 * + has Accept/Reject for future analytics. State persisted to localStorage.
 *
 * Once analytics/marketing cookies are added, gate them behind
 * `getCookieConsent() === 'accepted'`.
 *
 * Lazy useState init reads localStorage synchronously on mount (Vite SPA,
 * no SSR), avoiding the React 19 `set-state-in-effect` warning.
 */
export function CookieConsentBanner(): JSX.Element | null {
  const [state, setState] = useState<ConsentState>(readStoredConsent);

  if (state !== null) return null;

  const decide = (choice: 'accepted' | 'rejected') => {
    window.localStorage.setItem(STORAGE_KEY, choice);
    setState(choice);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-50 rounded-lg border border-border bg-background/95 backdrop-blur shadow-lg p-5"
    >
      <h2 id="cookie-banner-title" className="font-semibold text-sm mb-2">
        Cookie-uri
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Folosim doar cookies strict necesare pentru funcționarea aplicației
        (autentificare, sesiune, preferințe UI). Nu folosim tracking sau
        marketing fără acordul tău. Vezi{' '}
        <Link to="/privacy" className="underline">
          politica de confidențialitate
        </Link>
        .
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => decide('rejected')}
          className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted"
        >
          Doar necesare
        </button>
        <button
          onClick={() => decide('accepted')}
          className="px-3 py-1.5 text-sm rounded bg-foreground text-background hover:opacity-90"
        >
          Accept toate
        </button>
      </div>
    </div>
  );
}

export function getCookieConsent(): ConsentState {
  return readStoredConsent();
}
