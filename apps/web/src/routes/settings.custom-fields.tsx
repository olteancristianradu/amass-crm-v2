import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Rows3 } from 'lucide-react';
import { authedRoute } from './authed';
import {
  customFieldsApi,
  type CreateCustomFieldDto,
  type CustomFieldEntityType,
  type CustomFieldType,
} from '@/features/custom-fields/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import { TabBar } from '@/components/ui/detail-layout';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const settingsCustomFieldsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/custom-fields',
  component: SettingsCustomFieldsPage,
});

const ENTITY_TYPES: { value: CustomFieldEntityType; label: string }[] = [
  { value: 'COMPANY', label: 'Companii' },
  { value: 'CONTACT', label: 'Contacte' },
  { value: 'CLIENT', label: 'Clienți' },
  { value: 'DEAL', label: 'Deal-uri' },
  { value: 'QUOTE', label: 'Oferte' },
  { value: 'INVOICE', label: 'Facturi' },
];

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: 'Text',
  NUMBER: 'Număr',
  DATE: 'Dată',
  BOOLEAN: 'Da/Nu',
  SELECT: 'Listă valori',
};

function SettingsCustomFieldsPage(): JSX.Element {
  const [activeEntity, setActiveEntity] = useState<CustomFieldEntityType>('COMPANY');
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <PageHeader
        title="Câmpuri personalizate"
        subtitle="Atașează coloane custom la oricare resursă (companie, contact, deal, ofertă, factură etc.)."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Câmp nou'}
          </Button>
        }
      />

      {showForm && (
        <NewCustomFieldForm
          defaultEntityType={activeEntity}
          onDone={() => setShowForm(false)}
        />
      )}

      <TabBar tabs={ENTITY_TYPES} value={activeEntity} onChange={setActiveEntity} />
      <EntityCustomFields entityType={activeEntity} />
    </div>
  );
}

function EntityCustomFields({ entityType }: { entityType: CustomFieldEntityType }): JSX.Element {
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () => customFieldsApi.list(entityType),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      customFieldsApi.toggle(id, isActive),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['custom-fields', entityType] }),
  });

  if (isLoading) {
    return (
      <ListSurface>
        <TableSkeleton rows={3} cols={4} />
      </ListSurface>
    );
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
      </p>
    );
  }

  const fields = data ?? [];

  return (
    <ListSurface>
      {fields.length === 0 ? (
        <EmptyState
          icon={Rows3}
          title="Niciun câmp definit"
          description="Adaugă câmpuri personalizate pentru a colecta date proprii (industrie internă, NPS, semnalmente etc.) la fiecare entitate."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Nume câmp</th>
                <th scope="col" className="px-4 py-3 font-medium">Tip</th>
                <th scope="col" className="px-4 py-3 font-medium">Obligatoriu</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr
                  key={f.id}
                  className={`border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40 ${
                    !f.isActive ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-medium">{f.name}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs">
                      {FIELD_TYPE_LABELS[f.fieldType]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {f.isRequired ? (
                      <StatusBadge tone="amber">Obligatoriu</StatusBadge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={f.isActive ? 'green' : 'neutral'}>
                      {f.isActive ? 'Activ' : 'Inactiv'}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={toggleMut.isPending}
                      onClick={() => toggleMut.mutate({ id: f.id, isActive: !f.isActive })}
                    >
                      {f.isActive ? 'Dezactivează' : 'Activează'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListSurface>
  );
}

function NewCustomFieldForm({
  defaultEntityType,
  onDone,
}: {
  defaultEntityType: CustomFieldEntityType;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateCustomFieldDto>({
    entityType: defaultEntityType,
    name: '',
    fieldType: 'TEXT',
    isRequired: false,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (dto: CreateCustomFieldDto) => customFieldsApi.create(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-fields', form.entityType] });
      onDone();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof ApiError ? err.message : 'Eroare la creare');
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Numele este obligatoriu.');
      return;
    }
    createMut.mutate({ ...form, name: form.name.trim() });
  }

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Câmp personalizat nou</h2>
      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cf-entity">Entitate *</Label>
          <select
            id="cf-entity"
            value={form.entityType}
            onChange={(e) =>
              setForm((f) => ({ ...f, entityType: e.target.value as CustomFieldEntityType }))
            }
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ENTITY_TYPES.map((et) => (
              <option key={et.value} value={et.value}>
                {et.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-name">Nume câmp *</Label>
          <Input
            id="cf-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="ex: Segment client"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-type">Tip câmp *</Label>
          <select
            id="cf-type"
            value={form.fieldType}
            onChange={(e) =>
              setForm((f) => ({ ...f, fieldType: e.target.value as CustomFieldType }))
            }
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input
            id="cf-required"
            type="checkbox"
            checked={form.isRequired ?? false}
            onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.checked }))}
            className="rounded"
          />
          <Label htmlFor="cf-required" className="cursor-pointer">
            Câmp obligatoriu
          </Label>
        </div>
        <div className="md:col-span-2">
          {formError && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Anulează
            </Button>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
