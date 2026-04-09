import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Canonical `cn()` helper used by every shadcn-style component. Combines
 * clsx (conditional class names) with tailwind-merge (dedupes conflicting
 * Tailwind utilities so `cn('p-2', 'p-4')` → `'p-4'`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
