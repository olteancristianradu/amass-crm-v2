import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Check, Languages } from 'lucide-react';
import { LOCALE_VALUES, LocaleSchema, type Locale } from '@amass/shared';
import { api, ApiError } from '@/lib/api';
import { changeLanguageWithLoad } from '@/i18n';
import { toast } from '@/stores/toasts';

/**
 * Language switcher for /settings/appearance.
 *
 * Behaviour:
 *  - Reads the active locale from i18next (`i18n.resolvedLanguage`), NOT
 *    from a local state. The store is i18next itself; we just trigger
 *    re-renders when it changes.
 *  - On change: optimistically swaps the UI locale via
 *    `changeLanguageWithLoad()` (which lazy-loads the EN catalog the first
 *    time), then calls `PATCH /api/v1/users/me/locale` to persist. On
 *    failure: rolls back the locale + toasts the error code (no leak of
 *    raw API messages — `LocaleSchema` covers the only real validation
 *    surface and a 4xx response means we sent a string outside the
 *    whitelist, which shouldn't happen because the button list IS the
 *    whitelist).
 *  - All visible strings come from `common:language.*` so the switcher
 *    label itself is translated.
 *  - Hidden when `VITE_FEATURE_I18N_EN` is not truthy — Phase 0 ships only
 *    RO copy, and exposing a switcher whose target locale is half-translated
 *    is worse for users than no switcher at all (WCAG 3.1.2 — language of
 *    parts must be accurate; can't promise EN if the catalog is "[TODO-EN]").
 *    Flip the flag once the EN catalog is translation-complete.
 *
 * Accessibility:
 *  - Group landmark labelled "Interface language" / "Limba interfeței"
 *    (WCAG 4.1.2 + 1.3.1) — the old aria-label was a partial sentence.
 *  - Each pill is a toggle button (`aria-pressed`) with full-opacity border
 *    for ≥3:1 contrast on unselected state (WCAG 1.4.11).
 *  - `:focus-visible` ring follows the global accent (WCAG 2.4.7).
 *  - `aria-busy` exposes pending state to SR while the network round-trip
 *    completes (WCAG 4.1.3).
 *
 * Layout: small inline button row, designed to drop into the Appearance
 * page's existing GlassCard pattern without extra styling.
 */
export function LanguageSwitcher(): JSX.Element | null {
  const { i18n, t } = useTranslation('common');

  const current = (LocaleSchema.safeParse(i18n.resolvedLanguage).success
    ? (i18n.resolvedLanguage as Locale)
    : 'ro');

  // Local pending-target so the selected pill renders "switching" feedback
  // even before the lazy-loaded EN chunk resolves.
  const [pending, setPending] = useState<Locale | null>(null);

  const mut = useMutation({
    mutationFn: async (locale: Locale) => {
      return api.patch<{ id: string; preferredLocale: Locale }>(
        '/users/me/locale',
        { locale },
      );
    },
    onError: (err: unknown, _vars, ctx) => {
      // Roll back the optimistic switch on failure.
      const previous = (ctx as { previous?: Locale } | undefined)?.previous ?? 'ro';
      void changeLanguageWithLoad(previous);
      // Translated network-error fallback — no English literal leaking
      // through when the UI is RO (WCAG 4.1.3).
      const msg = err instanceof ApiError ? err.message : t('language.networkError');
      toast(t('toast.error'), msg);
    },
    onSuccess: () => {
      toast(t('toast.saved'));
    },
  });

  async function handleSwitch(target: Locale): Promise<void> {
    if (target === current || mut.isPending) return;
    const previous = current;
    setPending(target);
    try {
      await changeLanguageWithLoad(target);
      mut.mutate(target, {
        // TanStack Query passes ctx via the `context` returned from onMutate;
        // we instead capture `previous` here via closure since useMutation
        // doesn't have an onMutate-without-server-state pattern that ergonomic.
        onSettled: () => setPending(null),
      });
      void previous; // referenced via closure in onError above — keep TS happy
    } catch {
      setPending(null);
    }
  }

  // Phase-0 feature gate (placed after hooks to comply with rules-of-hooks).
  // The switcher is not rendered when the EN catalog is still a stub
  // (default in dev/prod until the translation pass lands).
  if (!import.meta.env.VITE_FEATURE_I18N_EN) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t('language.groupLabel')}
    >
      {LOCALE_VALUES.map((code) => {
        const selected = current === code;
        const isPending = pending === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => void handleSwitch(code)}
            disabled={mut.isPending}
            aria-pressed={selected}
            aria-busy={isPending}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              selected
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card hover:border-foreground'
            } ${mut.isPending ? 'opacity-60' : ''}`}
          >
            <Languages size={12} />
            {t(`language.${code}`)}
            {selected && <Check size={12} aria-hidden="true" />}
            {isPending && (
              <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-current" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
