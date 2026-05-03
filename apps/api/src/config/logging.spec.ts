import { describe, expect, it } from 'vitest';
import { resolveLogLevel } from './logging';

describe('resolveLogLevel', () => {
  it('falls back when LOG_LEVEL is an empty string', () => {
    expect(resolveLogLevel({ LOG_LEVEL: '', NODE_ENV: 'test' })).toBe('debug');
  });

  it('trims configured LOG_LEVEL', () => {
    expect(resolveLogLevel({ LOG_LEVEL: ' warn ', NODE_ENV: 'test' })).toBe('warn');
  });

  it('uses info as the production default', () => {
    expect(resolveLogLevel({ NODE_ENV: 'production' })).toBe('info');
  });
});
