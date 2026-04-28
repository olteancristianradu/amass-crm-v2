import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import {
  reportBuilderApi,
  type CreateTemplateDto,
  type ReportEntityType,
  type RunTemplateResponse,
} from '@/features/report-builder/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';


const ENTITY_LABELS: Record<ReportEntityType, string> = {
  companies: 'Companii',
  contacts: 'Contacte',
  deals: 'Deal-uri',
  invoices: 'Facturi',
  quotes: 'Oferte',
  activities: 'Activități',
};

interface CreateFormValues {
  name: string;
  entityType: ReportEntityType;
  columnsRaw: string;
  limit: number;
}

export function ReportBuilderPage(): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [runResults, setRunResults] = useState<{ templateId: string; data: RunTemplateResponse } | null>(null);

  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['report-builder', 'templates'],
    queryFn: () => reportBuilderApi.listTemplates(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => reportBuilderApi.deleteTemplate(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['report-builder', 'templates'] });
      // Clear results if we deleted the currently shown template
      if (runResults) setRunResults(null);
    },
  });

  const runMut = useMutation({
    mutationFn: (id: string) => reportBuilderApi.runTemplate(id),
    onSuccess: (res, id) => {
      setRunResults({ templateId: id, data: res });
    },
  });

  const templates = data?.data ?? [];

  function handleDelete(id: string): void {
    if (confirm('Ștergi acest template? Acțiunea este ireversibilă.')) {
      deleteMut.mutate(id);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Report Builder</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Template nou'}
        </Button>
      </div>

      {showForm && <CreateTemplateForm onDone={() => setShowForm(false)} />}

      {isLoading && <div className="animate-pulse h-8 bg-secondary rounded w-full" />}
      {isError && (
        <p className="text-red-500 text-sm">
          {error instanceof ApiError ? error.message : String(error)}
        </p>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Template-uri salvate</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Nume</th>
                  <th scope="col" className="px-4 py-2 font-medium">Entitate</th>
                  <th scope="col" className="px-4 py-2 font-medium">Coloane</th>
                  <th scope="col" className="px-4 py-2 font-medium">Limit</th>
                  <th scope="col" className="px-4 py-2 font-medium">Creat</th>
                  <th scope="col" className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {templates.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun template. Creează primul template folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {templates.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{t.name}</td>
                    <td className="px-4 py-2">
                      {ENTITY_LABELS[t.entityType as ReportEntityType] ?? t.entityType}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground max-w-xs truncate">
                      {t.columns.join(', ')}
                    </td>
                    <td className="px-4 py-2">{t.limit}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString('ro-RO')}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={runMut.isPending && runMut.variables === t.id}
                          onClick={() => runMut.mutate(t.id)}
                        >
                          {runMut.isPending && runMut.variables === t.id
                            ? 'Se rulează…'
                            : 'Rulează'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deleteMut.isPending}
                          onClick={() => handleDelete(t.id)}
                        >
                          Șterge
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {runMut.isError && (
        <p className="text-red-500 text-sm">
          {runMut.error instanceof ApiError ? runMut.error.message : String(runMut.error)}
        </p>
      )}

      {runResults && <RunResultsTable results={runResults.data} />}
    </div>
  );
}

function RunResultsTable({ results }: { results: RunTemplateResponse }): JSX.Element {
  const { columns, rows } = results;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rezultate ({rows.length} rânduri)</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            Niciun rezultat pentru acest template.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                {columns.map((col) => (
                  <th scope="col" key={col} className="px-4 py-2 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  {columns.map((col) => (
                    <td key={col} className="px-4 py-2 text-xs">
                      {row[col] != null ? String(row[col]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function CreateTemplateForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateFormValues>({
    defaultValues: { entityType: 'companies', limit: 100 },
  });

  const createMut = useMutation({
    mutationFn: (values: CreateFormValues) => {
      const dto: CreateTemplateDto = {
        name: values.name,
        entityType: values.entityType,
        columns: values.columnsRaw
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        limit: Number(values.limit),
      };
      return reportBuilderApi.createTemplate(dto);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['report-builder', 'templates'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Template nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => createMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="name">Nume template *</Label>
            <Input
              id="name"
              placeholder="ex: Companii active din Cluj"
              {...register('name', { required: 'Numele este obligatoriu' })}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="entityType">Tip entitate *</Label>
            <select
              id="entityType"
              {...register('entityType', { required: true })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="companies">Companii</option>
              <option value="contacts">Contacte</option>
              <option value="deals">Deal-uri</option>
              <option value="invoices">Facturi</option>
              <option value="quotes">Oferte</option>
              <option value="activities">Activități</option>
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="columnsRaw">Coloane (separate prin virgulă) *</Label>
            <Input
              id="columnsRaw"
              placeholder="ex: id, name, vatNumber, city, createdAt"
              {...register('columnsRaw', { required: 'Specifică cel puțin o coloană' })}
            />
            {errors.columnsRaw && (
              <p className="text-xs text-destructive">{errors.columnsRaw.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="limit">Limită rânduri</Label>
            <Input
              id="limit"
              type="number"
              min={1}
              max={10000}
              {...register('limit', {
                required: true,
                min: { value: 1, message: 'Minim 1' },
                max: { value: 10000, message: 'Maxim 10.000' },
              })}
            />
            {errors.limit && (
              <p className="text-xs text-destructive">{errors.limit.message}</p>
            )}
          </div>

          <div className="md:col-span-2">
            {createMut.isError && (
              <p className="mb-2 text-sm text-destructive">
                {createMut.error instanceof ApiError
                  ? createMut.error.message
                  : 'Eroare la creare'}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting || createMut.isPending}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează template'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
