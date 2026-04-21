import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { attachmentsApi, uploadAttachment } from './api';
import { Button } from '@/components/ui/button';
import type { SubjectType } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/QueryError';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

export function AttachmentsTab({ subjectType, subjectId }: Props): JSX.Element {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['attachments', subjectType, subjectId],
    queryFn: () => attachmentsApi.list(subjectType, subjectId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(subjectType, subjectId, file),
    onSuccess: async () => {
      setUploadError(null);
      if (inputRef.current) inputRef.current.value = '';
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['attachments', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['timeline', subjectType, subjectId] }),
      ]);
    },
    onError: (err) => {
      setUploadError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', subjectType, subjectId] }),
  });

  const handleDownload = async (id: string): Promise<void> => {
    const { url } = await attachmentsApi.download(id);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
          }}
          className="text-sm"
        />
        {upload.isPending && <span className="text-sm text-muted-foreground">Se încarcă…</span>}
      </div>
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

      {listQ.isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={listQ.isError} error={listQ.error} label="Nu am putut încărca atașamentele." />
      {listQ.data && listQ.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Niciun fișier atașat.</p>
      )}
      <ul className="space-y-2">
        {listQ.data?.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between rounded-md border bg-background p-3"
          >
            <div>
              <div className="font-medium">{a.fileName}</div>
              <div className="text-xs text-muted-foreground">
                {formatBytes(a.size)} · {a.mimeType} ·{' '}
                {new Date(a.createdAt).toLocaleDateString('ro-RO')}
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => void handleDownload(a.id)}>
                Descarcă
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(a.id)}>
                Șterge
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
