import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { emailAccountsApi, emailMessagesApi } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { EmailStatus, SubjectType } from '@/lib/types';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

/**
 * Email tab for Company/Contact/Client detail pages. Shows a compose form
 * (if the user has an email account configured) and a list of sent emails.
 */
export function EmailTab({ subjectType, subjectId }: Props): JSX.Element {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');

  const { data: accounts } = useQuery({
    queryKey: ['email-accounts'],
    queryFn: () => emailAccountsApi.list(),
  });

  const { data: messages, isLoading } = useQuery({
    queryKey: ['email-messages', { subjectType, subjectId }],
    queryFn: () =>
      emailMessagesApi.list({ subjectType, subjectId, limit: 50 }),
  });

  const defaultAccount = accounts?.find((a) => a.isDefault) ?? accounts?.[0];

  const sendMut = useMutation({
    mutationFn: () => {
      if (!defaultAccount) throw new Error('No email account configured');
      return emailMessagesApi.send({
        accountId: defaultAccount.id,
        subjectType,
        subjectId,
        toAddresses: to
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        subject,
        bodyHtml,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['email-messages'] });
      setTo('');
      setSubject('');
      setBodyHtml('');
    },
  });

  return (
    <div className="space-y-4 pt-4">
      {!accounts || accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nu ai un cont de email configurat. Mergi la{' '}
          <a href="/app/email-settings" className="text-primary hover:underline">
            Setări email
          </a>{' '}
          pentru a adăuga unul.
        </p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (to.trim() && subject.trim() && bodyHtml.trim()) sendMut.mutate();
          }}
        >
          <div className="text-xs text-muted-foreground">
            De la: {defaultAccount?.fromName} &lt;{defaultAccount?.fromEmail}&gt;
          </div>
          <div className="space-y-1">
            <Label htmlFor="email-to" className="sr-only">
              Către
            </Label>
            <Input
              id="email-to"
              placeholder="Către (email-uri separate prin virgulă)"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email-subject" className="sr-only">
              Subiect
            </Label>
            <Input
              id="email-subject"
              placeholder="Subiect"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email-body" className="sr-only">
              Conținut
            </Label>
            <Textarea
              id="email-body"
              placeholder="Conținut email (HTML)…"
              rows={5}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
            />
          </div>
          {sendMut.isError && (
            <p className="text-xs text-destructive">
              Eroare: {sendMut.error instanceof Error ? sendMut.error.message : 'necunoscută'}
            </p>
          )}
          <Button
            type="submit"
            disabled={sendMut.isPending || !to.trim() || !subject.trim() || !bodyHtml.trim()}
          >
            {sendMut.isPending ? 'Se trimite…' : 'Trimite'}
          </Button>
        </form>
      )}

      <div className="border-t pt-4">
        <h3 className="mb-2 text-sm font-medium">Email-uri trimise</h3>
        {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
        {messages && messages.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Niciun email trimis.</p>
        )}
        <ul className="divide-y">
          {messages?.data.map((m) => (
            <li key={m.id} className="space-y-1 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{m.subject}</span>
                <StatusBadge status={m.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                Către: {m.toAddresses.join(', ')} ·{' '}
                {new Date(m.createdAt).toLocaleString('ro-RO')}
              </p>
              {m.status === 'FAILED' && m.errorMessage && (
                <p className="text-xs text-destructive">{m.errorMessage}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: EmailStatus }): JSX.Element {
  const base = 'rounded-sm px-2 py-0.5 text-xs font-medium';
  const cls: Record<EmailStatus, string> = {
    QUEUED: `${base} bg-secondary text-foreground`,
    SENDING: `${base} bg-primary/10 text-primary`,
    SENT: `${base} bg-primary/10 text-primary`,
    FAILED: `${base} bg-destructive/10 text-destructive`,
  };
  const labels: Record<EmailStatus, string> = {
    QUEUED: 'În coadă',
    SENDING: 'Se trimite',
    SENT: 'Trimis',
    FAILED: 'Eșuat',
  };
  return <span className={cls[status]}>{labels[status]}</span>;
}
