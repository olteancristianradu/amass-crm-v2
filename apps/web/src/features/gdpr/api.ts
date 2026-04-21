import { useAuthStore } from '@/stores/auth';

/**
 * GDPR is a sensitive admin-only flow. For export we bypass the `api` wrapper
 * because the backend streams a JSON file with a Content-Disposition header —
 * the JSON parsing in `api.ts` would swallow the filename and turn the download
 * into an in-memory string we'd have to Blob-ify again.
 *
 * The erase endpoint is a normal JSON call; it returns an anonymisation
 * receipt we just display inline.
 */
export interface GdprEraseReceipt {
  ok: boolean;
  anonymisedFields: string[];
  subjectType: 'CONTACT' | 'CLIENT';
  subjectId: string;
  timestamp: string;
}

type SubjectKind = 'contacts' | 'clients';

export async function downloadGdprExport(kind: SubjectKind, id: string): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`/api/v1/gdpr/${kind}/${id}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Export eșuat (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gdpr-${kind.slice(0, -1)}-${id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function eraseGdprSubject(kind: SubjectKind, id: string): Promise<GdprEraseReceipt> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`/api/v1/gdpr/${kind}/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Ștergere eșuată (${res.status})`);
  }
  return (await res.json()) as GdprEraseReceipt;
}
