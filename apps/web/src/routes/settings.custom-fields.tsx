import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Câmpuri personalizate</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Câmp nou'}
        </Button>
      </div>

      {showForm && (
        <NewCustomFieldForm
          defaultEntityType={activeEntity}
          onDone={() => setShowForm(false)}
        />
      )}

      <Tabs
        defaultValue="COMPANY"
        value={activeEntity}
        onValueChange={(v) => setActiveEntity(v as CustomFieldEntityType)}
      >
        <TabsList className="flex-wrap h-auto gap-1">
          {ENTITY_TYPES.map((et) => (
            <TabsTrigger key={et.value} value={et.value}>
              {et.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {ENTITY_TYPES.map((et) => (
          <TabsContent key={et.value} value={et.value}>
            <EntityCustomFields entityType={et.value} />
          </TabsContent>
        ))}
      </Tabs>
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-fields', entityType] });
    },
  });

  if (isLoading) return <Card><TableSkeleton rows={3} cols={4} /></Card>;
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
      </p>
    );
  }

  const fields = data ?? [];

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Nume câmp</th>
              <th className="px-4 py-2 font-medium">Tip</th>
              <th className="px-4 py-2 font-medium">Obligatoriu</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium w-24"></th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Niciun câmp definit. Creează primul câmp folosind butonul de mai sus.
                </td>
              </tr>
            )}
            {fields.map((f) => (
              <tr
                key={f.id}
                className={`border-b last:border-0 hover:bg-muted/30 ${!f.isActive ? 'opacity-50' : ''}`}
              >
                <td className="px-4 py-2 font-medium">{f.name}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs font-mono">
                    {FIELD_TYPE_LABELS[f.fieldType]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {f.isRequired ? (
                    <span className="text-xs text-orange-600 font-medium">Da</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Nu</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      f.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {f.isActive ? 'Activ' : 'Inactiv'}
                  </span>
                </td>
                <td className="px-4 py-2">
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
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Câmp personalizat nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cf-entity">Entitate *</Label>
            <select
              id="cf-entity"
              value={form.entityType}
              onChange={(e) =>
                setForm((f) => ({ ...f, entityType: e.target.value as CustomFieldEntityType }))
              }
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {ENTITY_TYPES.map((et) => (
                <option key={et.value} value={et.value}>
                  {et.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-name">Nume câmp *</Label>
            <Input
              id="cf-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ex: Segment client"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-type">Tip câmp *</Label>
            <select
              id="cf-type"
              value={form.fieldType}
              onChange={(e) =>
                setForm((f) => ({ ...f, fieldType: e.target.value as CustomFieldType }))
              }
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
            <Label htmlFor="cf-required">Câmp obligatoriu</Label>
          </div>
          <div className="md:col-span-2">
            {formError && (
              <p className="mb-2 text-sm text-destructive">{formError}</p>
            )}
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
