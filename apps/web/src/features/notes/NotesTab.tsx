import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { notesApi } from './api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { SubjectType } from '@/lib/types';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

export function NotesTab({ subjectType, subjectId }: Props): JSX.Element {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  const notesQ = useQuery({
    queryKey: ['notes', subjectType, subjectId],
    queryFn: () => notesApi.list(subjectType, subjectId),
  });

  const create = useMutation({
    mutationFn: (body: string) => notesApi.create(subjectType, subjectId, body),
    onSuccess: async () => {
      setDraft('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['notes', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['timeline', subjectType, subjectId] }),
      ]);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => notesApi.remove(id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['notes', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['timeline', subjectType, subjectId] }),
      ]);
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Adaugă o notă…"
          rows={3}
        />
        <Button
          size="sm"
          onClick={() => draft.trim() && create.mutate(draft.trim())}
          disabled={!draft.trim() || create.isPending}
        >
          {create.isPending ? 'Se salvează…' : 'Adaugă notă'}
        </Button>
      </div>
      {notesQ.isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {notesQ.data && notesQ.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Nicio notă încă.</p>
      )}
      <ul className="space-y-3">
        {notesQ.data?.map((n) => (
          <li key={n.id} className="rounded-md border bg-background p-3">
            <div className="flex items-start justify-between gap-4">
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate(n.id)}
                disabled={remove.isPending}
              >
                Șterge
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {new Date(n.createdAt).toLocaleString('ro-RO')}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
