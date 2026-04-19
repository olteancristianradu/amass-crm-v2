import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { companiesApi } from './api';

interface Props {
  companyId: string;
}

/**
 * Lists direct subsidiaries of a company (rows where parentId === companyId).
 * Goes one level only — for a deep tree, recurse via company detail pages.
 */
export function SubsidiariesTab({ companyId }: Props): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['companies', companyId, 'subsidiaries'],
    queryFn: () => companiesApi.subsidiaries(companyId),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Nu există subsidiare.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left">
          <tr>
            <th className="px-4 py-2 font-medium">Nume</th>
            <th className="px-4 py-2 font-medium">Industrie</th>
            <th className="px-4 py-2 font-medium">Oraș</th>
            <th className="px-4 py-2 font-medium">Email</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">
                <Link to="/app/companies/$id" params={{ id: c.id }} className="hover:underline text-primary">
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-2">{c.industry ?? '—'}</td>
              <td className="px-4 py-2">{c.city ?? '—'}</td>
              <td className="px-4 py-2">{c.email ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
