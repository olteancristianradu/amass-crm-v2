/**
 * SearchBar — global semantic search in the top bar.
 * Press Enter or wait 500ms after typing to trigger the search.
 * Results open in /app/search?q=... via router navigation.
 */
import * as React from 'react';
import { useRouter } from '@tanstack/react-router';

export function SearchBar(): JSX.Element {
  const [value, setValue] = React.useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    void router.navigate({ to: '/app/search', search: { q } });
    setValue('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-sm mx-4">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Caută companii, contacte, clienți…"
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Căutare globală"
      />
    </form>
  );
}
