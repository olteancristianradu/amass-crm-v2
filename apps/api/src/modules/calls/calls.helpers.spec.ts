import { describe, expect, it } from 'vitest';
import { mapTwilioStatus, TWIML_EMPTY, TWIML_INBOUND_THANK_YOU } from './calls.helpers';

describe('mapTwilioStatus', () => {
  it('maps the 8 Twilio lifecycle states', () => {
    expect(mapTwilioStatus('queued')).toBe('QUEUED');
    expect(mapTwilioStatus('initiated')).toBe('QUEUED');
    expect(mapTwilioStatus('ringing')).toBe('RINGING');
    expect(mapTwilioStatus('in-progress')).toBe('IN_PROGRESS');
    expect(mapTwilioStatus('completed')).toBe('COMPLETED');
    expect(mapTwilioStatus('busy')).toBe('BUSY');
    expect(mapTwilioStatus('no-answer')).toBe('NO_ANSWER');
    expect(mapTwilioStatus('failed')).toBe('FAILED');
    expect(mapTwilioStatus('canceled')).toBe('CANCELED');
  });

  it('is case-insensitive (Twilio occasionally sends capitalised states)', () => {
    expect(mapTwilioStatus('COMPLETED')).toBe('COMPLETED');
    expect(mapTwilioStatus('In-Progress')).toBe('IN_PROGRESS');
  });

  it('returns undefined for unknown status strings (caller decides how to log)', () => {
    expect(mapTwilioStatus('nonsense')).toBeUndefined();
    expect(mapTwilioStatus('')).toBeUndefined();
  });
});

describe('TwiML responses', () => {
  it('TWIML_EMPTY is valid-looking XML with an empty Response', () => {
    expect(TWIML_EMPTY).toContain('<?xml version="1.0"');
    expect(TWIML_EMPTY).toContain('<Response></Response>');
  });

  it('TWIML_INBOUND_THANK_YOU is Romanian + contains Hangup', () => {
    expect(TWIML_INBOUND_THANK_YOU).toContain('language="ro-RO"');
    expect(TWIML_INBOUND_THANK_YOU).toContain('<Hangup/>');
  });
});
