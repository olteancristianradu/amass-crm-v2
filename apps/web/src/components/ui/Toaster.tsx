import { useToastStore } from '@/stores/toasts';

/**
 * Fixed-position toast container. Mount once inside AppShell.
 */
export function Toaster(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex max-w-sm items-start gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg"
        >
          <div className="flex-1 space-y-0.5">
            <p className="text-sm font-medium">{t.title}</p>
            {t.body && <p className="text-xs text-muted-foreground">{t.body}</p>}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Închide notificarea"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
