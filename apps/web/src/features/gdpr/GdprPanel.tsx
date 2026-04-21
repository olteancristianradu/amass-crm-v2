import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { downloadGdprExport, eraseGdprSubject, type GdprEraseReceipt } from './api';

/**
 * M-14 — operator-facing GDPR actions for a single subject.
 *
 * Shown on contact/client detail pages. Backend is already OWNER/ADMIN-only
 * (gdpr.controller.ts @Roles), but we also hide the whole card for lower
 * roles so nobody is tempted to click a button they can't use.
 *
 * Two flows:
 *   - Export → downloads a JSON dump (all activities, notes, attachments'
 *     metadata, calls, deals). Exposes the right-of-access under Art. 15.
 *   - Erase  → anonymises the record in place (Art. 17). The backend returns
 *     a receipt with the fields it touched so the operator can paste it in
 *     their GDPR log.
 */
export function GdprPanel({
  kind,
  subjectId,
}: {
  kind: 'contacts' | 'clients';
  subjectId: string;
}): JSX.Element | null {
  const role = useAuthStore((s) => s.user?.role);
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState<GdprEraseReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportMut = useMutation({
    mutationFn: () => downloadGdprExport(kind, subjectId),
    onSuccess: () => setError(null),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Eroare la export.'),
  });

  const eraseMut = useMutation({
    mutationFn: () => eraseGdprSubject(kind, subjectId),
    onSuccess: (r) => {
      setReceipt(r);
      setConfirm(false);
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Eroare la ștergere.'),
  });

  if (role !== 'OWNER' && role !== 'ADMIN') return null;

  const subjectLabel = kind === 'contacts' ? 'acest contact' : 'acest client';

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">GDPR</CardTitle>
        <p className="text-xs text-muted-foreground">
          Export de date (Art. 15) și dreptul la ștergere / anonimizare (Art. 17).
          Acțiunile sunt jurnalizate în audit-log.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMut.mutate()}
            disabled={exportMut.isPending}
          >
            {exportMut.isPending ? 'Se exportă…' : 'Export date (JSON)'}
          </Button>
          {!confirm ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirm(true);
                setError(null);
              }}
              disabled={eraseMut.isPending || receipt !== null}
            >
              Șterge / Anonimizează
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
              <span className="text-xs text-destructive">
                Confirmi ștergerea datelor personale pentru {subjectLabel}? Acțiunea este
                ireversibilă.
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => eraseMut.mutate()}
                disabled={eraseMut.isPending}
              >
                {eraseMut.isPending ? 'Se anonimizează…' : 'Da, șterge'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                Renunță
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {receipt && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <p className="font-medium">
              Ștergere confirmată — {receipt.anonymisedFields.length} câmp(uri) anonimizat(e):
            </p>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {receipt.anonymisedFields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">
              {new Date(receipt.timestamp).toLocaleString('ro-RO')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
