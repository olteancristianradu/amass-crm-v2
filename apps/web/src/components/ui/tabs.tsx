import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Minimal tabs primitive — context stores the active value, triggers set
 * it, content shows conditionally. No radix needed for the level of
 * interaction we have.
 */
interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
}
const Ctx = React.createContext<TabsCtx | null>(null);
function useTabs(): TabsCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('Tabs.* must be used inside <Tabs>');
  return v;
}

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ defaultValue, value, onValueChange, children, className }: TabsProps): JSX.Element {
  const [inner, setInner] = React.useState(defaultValue);
  const current = value ?? inner;
  const setValue = (v: string): void => {
    if (value === undefined) setInner(v);
    onValueChange?.(v);
  };
  return (
    <Ctx.Provider value={{ value: current, setValue }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}): JSX.Element {
  const tabs = useTabs();
  const active = tabs.value === value;
  return (
    <button
      type="button"
      onClick={() => tabs.setValue(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium',
        'ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-background text-foreground shadow-sm',
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element | null {
  const tabs = useTabs();
  if (tabs.value !== value) return null;
  return <div className={cn('mt-4', className)}>{children}</div>;
}
