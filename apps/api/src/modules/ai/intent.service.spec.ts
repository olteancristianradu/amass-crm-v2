import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentService } from './intent.service';

vi.mock('../../config/env', () => ({
  loadEnv: () => ({ GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined }),
}));

describe('IntentService.parse — static fallback (no AI key)', () => {
  let svc: IntentService;
  beforeEach(() => {
    svc = new IntentService();
  });

  it('returns search-only on free-form input (does NOT spuriously trigger create)', async () => {
    const out = await svc.parse('Popescu de la Acme');
    expect(out.kind).toBe('search');
    expect(out.target).toBe('Popescu de la Acme');
    expect(out.label).toContain('Caută');
  });

  it('routes "deschide companii" to navigate', async () => {
    const out = await svc.parse('deschide companiile');
    expect(out.kind).toBe('navigate');
    expect(out.target).toBe('companiile');
  });

  it('routes "mergi la facturi" to navigate', async () => {
    const out = await svc.parse('mergi la facturi');
    expect(out.kind).toBe('navigate');
    expect(out.target).toBe('facturi');
  });

  it('returns unknown on empty input', async () => {
    const out = await svc.parse('   ');
    expect(out.kind).toBe('unknown');
  });
});
