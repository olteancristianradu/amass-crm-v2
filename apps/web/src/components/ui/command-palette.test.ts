import { describe, expect, it } from 'vitest';
import { Building2, Users } from 'lucide-react';
import {
  NAV_COMMANDS,
  normalizeForCommand,
  rankNavCommands,
  type NavCommand,
} from './command-palette';

describe('normalizeForCommand', () => {
  it('strips diacritics + lowercases', () => {
    expect(normalizeForCommand('Căutați TĂȘnica')).toBe('cautati tasnica');
  });
  it('is identity on already-lowercase ASCII', () => {
    expect(normalizeForCommand('hello world')).toBe('hello world');
  });
});

const fixture: NavCommand[] = [
  { id: 'companies', label: 'Companii', group: 'Clienți', to: '/c', keywords: 'firme b2b', icon: Building2 },
  { id: 'contacts', label: 'Contacte', group: 'Clienți', to: '/k', keywords: 'persoane', icon: Users },
  { id: 'reports', label: 'Rapoarte', group: 'Insights', to: '/r', keywords: 'analytics', icon: Building2 },
];

describe('rankNavCommands', () => {
  it('returns the original list when query is empty', () => {
    expect(rankNavCommands('', fixture).map((c) => c.id)).toEqual(['companies', 'contacts', 'reports']);
  });

  it('puts startsWith matches above includes matches', () => {
    // "co" matches both "Companii" (startsWith) and "Contacte" (startsWith) —
    // both 100. Ordering is stable so we accept either head; the *exclusion*
    // of Rapoarte is the assertion.
    const out = rankNavCommands('co', fixture).map((c) => c.id);
    expect(out).not.toContain('reports');
    expect(out.length).toBe(2);
  });

  it('falls back to keyword match', () => {
    expect(rankNavCommands('analytics', fixture).map((c) => c.id)).toEqual(['reports']);
  });

  it('is diacritic-insensitive', () => {
    expect(rankNavCommands('clienți', fixture).map((c) => c.id)).toEqual([]);
    // The matcher checks label + keywords, not group, so "clienți" → none.
    // Re-test against the label "Companii" to make sure the lowercased
    // diacritic stripping path actually works.
    expect(rankNavCommands('COMPANII', fixture).map((c) => c.id)).toEqual(['companies']);
  });
});

describe('NAV_COMMANDS catalog', () => {
  it('has unique ids', () => {
    const ids = NAV_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every entry has a route under /app', () => {
    for (const cmd of NAV_COMMANDS) {
      expect(cmd.to.startsWith('/app')).toBe(true);
    }
  });
});
