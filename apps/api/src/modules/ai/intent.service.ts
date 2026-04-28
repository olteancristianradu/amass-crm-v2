/**
 * IntentService — natural-language → structured CRM action.
 *
 * Powers the Cmd-K AI section. The user types "creează deal pentru Acme"
 * and the FE turns the structured output into a navigation + prefill.
 *
 * Provider order: Gemini → Anthropic → static keyword fallback. The
 * fallback never returns CREATE/NAVIGATE for free-form input — only
 * SEARCH — so a missing API key never silently does the wrong thing.
 */
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

import { loadEnv } from '../../config/env';
import { getBreaker } from '../../common/resilience/circuit-breaker';

export type IntentKind =
  | 'navigate'
  | 'create_company'
  | 'create_contact'
  | 'create_deal'
  | 'create_task'
  | 'search'
  | 'unknown';

export interface ParsedIntent {
  kind: IntentKind;
  /** Page or entity slug, e.g. "companies" for navigate, "Acme SRL" for create_company */
  target?: string;
  /** Free-form params the FE will use to prefill (e.g. { companyName: "Acme" }) */
  params?: Record<string, string>;
  /** What we're going to show as the suggestion line in the palette */
  label: string;
}

type Provider = 'gemini' | 'anthropic' | 'none';

const SYSTEM_PROMPT = `You are a Romanian-language CRM intent classifier. Parse the user's free-text command into a structured action.

Respond ONLY with JSON (no markdown) in this exact shape:
{
  "kind": "navigate" | "create_company" | "create_contact" | "create_deal" | "create_task" | "search" | "unknown",
  "target": "<companies|contacts|clients|leads|deals|tasks|invoices|quotes|reports|... or entity name like 'Acme SRL'>",
  "params": { "<key>": "<value>" }
}

Examples:
- "deschide companiile" → {"kind":"navigate","target":"companies","params":{}}
- "creează deal Vânzare Acme 5000 EUR" → {"kind":"create_deal","target":"Vânzare Acme","params":{"value":"5000","currency":"EUR"}}
- "task sună pe Ion mâine" → {"kind":"create_task","target":"sună pe Ion mâine","params":{}}
- "caută Popescu" → {"kind":"search","target":"Popescu","params":{}}
- "addaug companie Globex SRL" → {"kind":"create_company","target":"Globex SRL","params":{}}

If unclear, default to {"kind":"search","target":"<original input>","params":{}}.`;

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);
  private readonly anthropic: Anthropic | null;
  private readonly gemini: GoogleGenAI | null;
  private readonly provider: Provider;

  constructor() {
    const { GEMINI_API_KEY, ANTHROPIC_API_KEY } = loadEnv();
    this.gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
    this.anthropic = ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 })
      : null;
    if (this.gemini) this.provider = 'gemini';
    else if (this.anthropic) this.provider = 'anthropic';
    else this.provider = 'none';
  }

  async parse(input: string): Promise<ParsedIntent> {
    const trimmed = input.trim();
    if (!trimmed) {
      return { kind: 'unknown', label: 'Scrie o comandă' };
    }

    if (this.provider === 'none') {
      return this.staticFallback(trimmed);
    }

    try {
      const text = await this.callLLM(trimmed);
      const parsed = JSON.parse(text) as { kind?: string; target?: string; params?: Record<string, string> };
      return this.normalize(parsed, trimmed);
    } catch (err) {
      this.logger.warn('Intent parse failed for %s: %o', trimmed, err);
      return this.staticFallback(trimmed);
    }
  }

  /** Map ambiguous LLM output back into the typed shape. */
  private normalize(
    raw: { kind?: string; target?: string; params?: Record<string, string> },
    input: string,
  ): ParsedIntent {
    const validKinds: IntentKind[] = [
      'navigate',
      'create_company',
      'create_contact',
      'create_deal',
      'create_task',
      'search',
      'unknown',
    ];
    const kind = (validKinds as string[]).includes(raw.kind ?? '')
      ? (raw.kind as IntentKind)
      : 'search';
    const target = raw.target?.trim() || input;
    const label = labelFor(kind, target);
    return { kind, target, params: raw.params ?? {}, label };
  }

  /** Last-resort keyword router when no AI is configured. */
  private staticFallback(input: string): ParsedIntent {
    const lower = input.toLowerCase();
    // Cheapest possible keyword routing — if anything looks like a "create"
    // verb we still don't trigger create (would hit the FE without confirming).
    // We just route to global search so the user can see related results.
    if (lower.startsWith('deschide ') || lower.startsWith('mergi la ')) {
      const rest = input.replace(/^(deschide|mergi la)\s+/i, '').trim();
      return {
        kind: 'navigate',
        target: rest.toLowerCase(),
        params: {},
        label: `Deschide ${rest}`,
      };
    }
    return {
      kind: 'search',
      target: input,
      params: {},
      label: `Caută "${input}"`,
    };
  }

  private async callLLM(input: string): Promise<string> {
    if (this.provider === 'gemini' && this.gemini) {
      const res = await this.gemini.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: input,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          maxOutputTokens: 200,
        },
      });
      return res.text ?? '{}';
    }
    if (this.provider === 'anthropic' && this.anthropic) {
      const anthropic = this.anthropic;
      const msg = await getBreaker('anthropic').exec(() =>
        anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: input }],
        }),
      );
      return msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    }
    return '{}';
  }
}

function labelFor(kind: IntentKind, target: string): string {
  switch (kind) {
    case 'navigate':
      return `Deschide: ${target}`;
    case 'create_company':
      return `Companie nouă: ${target}`;
    case 'create_contact':
      return `Contact nou: ${target}`;
    case 'create_deal':
      return `Deal nou: ${target}`;
    case 'create_task':
      return `Task nou: ${target}`;
    case 'search':
      return `Caută: ${target}`;
    default:
      return target;
  }
}
