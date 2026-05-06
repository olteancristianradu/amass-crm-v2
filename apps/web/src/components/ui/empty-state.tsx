import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Reusable empty-state component for list pages and entity tabs.
 *
 * Usage:
 *   <EmptyState
 *     icon={Building2}
 *     title="Niciun client încă"
 *     description="Adaugă primul client folosind butonul de mai sus."
 *     action={<button>+ Adaugă</button>}
 *   />
 */
interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: Props): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] px-6 py-12 text-center">
      {Icon && (
        <div className="mb-4 rounded-full border border-white/10 bg-white/[0.03] p-3">
          <Icon className="h-6 w-6 text-white/50" />
        </div>
      )}
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-white/60">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
