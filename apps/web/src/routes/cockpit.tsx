import { useState, type DragEvent } from 'react';
import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { authedRoute } from './authed';
import { PageHeader } from '@/components/ui/page-header';
import { QueryError } from '@/components/ui/QueryError';
import { cockpitApi } from '@/features/cockpit/api';
import { useCockpitLayout } from '@/features/cockpit/useCockpitLayout';
import { usePageTitle } from '@/hooks/usePageTitle';
import { CockpitWidget } from '@/features/cockpit/CockpitWidget';
import { CockpitWidgetPicker } from '@/features/cockpit/CockpitWidgetPicker';

export const cockpitRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/cockpit',
  component: Cockpit,
});

function Cockpit(): JSX.Element {
  usePageTitle('Pro Cockpit');
  const { layout, toggle, moveUp, moveDown, setEnabled, reset } = useCockpitLayout();
  const [draggingWidget, setDraggingWidget] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleDragStart = (widget: string) => (e: DragEvent<HTMLElement>) => {
    setDraggingWidget(widget);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', widget);
  };

  const handleDragOver = (widget: string) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (widget !== draggingWidget) setDropTarget(widget);
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (target: string) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const source = draggingWidget;
    setDraggingWidget(null);
    setDropTarget(null);
    if (!source || source === target) return;
    const next = [...layout.enabled];
    const fromIdx = next.indexOf(source as (typeof next)[number]);
    const toIdx = next.indexOf(target as (typeof next)[number]);
    if (fromIdx === -1 || toIdx === -1) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, source as (typeof next)[number]);
    setEnabled(next);
  };

  const handleDragEnd = () => {
    setDraggingWidget(null);
    setDropTarget(null);
  };

  const feed = useQuery({
    queryKey: ['cockpit-feed'],
    queryFn: cockpitApi.feed,
    // Poll the feed every 60s. The API merges deals/reminders/tasks so
    // a single request keeps all visible widgets fresh — no per-widget
    // fan-out. WebSocket push will be a future improvement.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pro Cockpit"
        subtitle="Ce trebuie să faci acum, ordonat după urgență. Selectează widget-urile pe care le vrei."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => feed.refetch()}
              disabled={feed.isFetching}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${feed.isFetching ? 'animate-spin' : ''}`} />
              Reîmprospătează
            </button>
            <CockpitWidgetPicker
              enabled={layout.enabled}
              onToggle={toggle}
              onReset={reset}
            />
          </div>
        }
      />

      <QueryError isError={feed.isError} error={feed.error} />
      {feed.isError && (
        <button
          type="button"
          onClick={() => feed.refetch()}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
        >
          Reîncearcă
        </button>
      )}

      {feed.isLoading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl border border-white/10 bg-white/[0.06]"
            />
          ))}
        </div>
      )}

      {feed.data && (
        <>
          {layout.enabled.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
              <p className="text-white/85">Niciun widget activ.</p>
              <p className="mt-1 text-sm text-white/70">
                Folosește butonul „Widget-uri" pentru a adăuga.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {layout.enabled.map((w, idx) => (
                <CockpitWidget
                  key={w}
                  widget={w}
                  items={feed.data ?? []}
                  isFirst={idx === 0}
                  isLast={idx === layout.enabled.length - 1}
                  onMoveUp={() => moveUp(w)}
                  onMoveDown={() => moveDown(w)}
                  onRemove={() => toggle(w)}
                  onDragStart={handleDragStart(w)}
                  onDragOver={handleDragOver(w)}
                  onDrop={handleDrop(w)}
                  onDragEnd={handleDragEnd}
                  isDragging={draggingWidget === w}
                  isDropTarget={dropTarget === w}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
