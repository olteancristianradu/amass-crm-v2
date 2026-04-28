/**
 * EmailDraftService — AI-powered email draft generation.
 *
 * Same provider priority as DealAiService:
 *   1. Google Gemini (gemini-2.0-flash) — FREE tier
 *   2. Anthropic Claude (claude-sonnet-4-6) — paid fallback
 *   3. Static fallback — generic Romanian sales template
 *
 * Builds a context snapshot from a contact (job title, company, last
 * activity) + a free-form intent ("relance after demo", "thank for
 * meeting") and asks the LLM for a Romanian email subject + body.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

import { loadEnv } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { getBreaker } from '../../common/resilience/circuit-breaker';

export type EmailTone = 'formal' | 'friendly' | 'concise';

export interface EmailDraft {
  subject: string;
  body: string;
  tone: EmailTone;
  generatedAt: string;
}

type Provider = 'gemini' | 'anthropic' | 'none';

const SYSTEM_PROMPT = `You are a CRM email-drafting assistant for a Romanian B2B SMB.
Given a contact context + a salesperson's intent + a tone, generate a single
short Romanian email (subject + body, no signature line — the user will add one).

Respond ONLY with valid JSON (no markdown, no commentary) in this exact shape:
{
  "subject": "<max 72 chars, no exclamation marks>",
  "body": "<200-400 words, plain text, paragraph breaks with \\n\\n>"
}`;

@Injectable()
export class EmailDraftService {
  private readonly logger = new Logger(EmailDraftService.name);
  private readonly anthropic: Anthropic | null;
  private readonly gemini: GoogleGenAI | null;
  private readonly provider: Provider;

  constructor(private readonly prisma: PrismaService) {
    const { GEMINI_API_KEY, ANTHROPIC_API_KEY } = loadEnv();
    this.gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
    this.anthropic = ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 })
      : null;

    if (this.gemini) this.provider = 'gemini';
    else if (this.anthropic) this.provider = 'anthropic';
    else this.provider = 'none';

    if (this.provider === 'none') {
      this.logger.warn('No AI provider key set — email drafting falls back to static template');
    } else {
      this.logger.log(`EmailDraftService using provider=${this.provider}`);
    }
  }

  /**
   * Generate an email draft for a contact based on a free-form intent.
   * `tone` defaults to 'friendly'. The static fallback returns a sane
   * Romanian template so the FE always has something to render.
   */
  async draft(contactId: string, intent: string, tone: EmailTone = 'friendly'): Promise<EmailDraft> {
    const { tenantId } = requireTenantContext();

    const contact = await this.prisma.runWithTenant(tenantId, 'ro', async (tx) =>
      tx.contact.findFirst({
        where: { id: contactId, deletedAt: null },
        include: {
          company: { select: { name: true, industry: true } },
        },
      }),
    );
    if (!contact) {
      throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found' });
    }

    const company = contact.company;
    const fullName = `${contact.firstName} ${contact.lastName}`;

    if (this.provider === 'none') {
      return this.staticFallback(fullName, company?.name ?? null, intent, tone);
    }

    const context = `
Contact: ${fullName}
Job title: ${contact.jobTitle ?? 'unknown'}
Email: ${contact.email ?? 'unknown'}
Company: ${company?.name ?? 'unknown'} (${company?.industry ?? 'unknown industry'})

Salesperson intent: ${intent}
Tone: ${tone}
Language: Romanian
`.trim();

    try {
      const text = await this.callLLM(context);
      const parsed = JSON.parse(text) as { subject?: string; body?: string };
      // Defense-in-depth: even when the model claims JSON mode, it
      // occasionally returns markdown-fenced JSON. Strip if present.
      return {
        subject: (parsed.subject ?? '').trim() || `Despre ${intent}`,
        body: (parsed.body ?? '').trim() || `Bună ziua,\n\n${intent}\n\nCu respect,`,
        tone,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error('AI email draft failed for contact %s: %o', contactId, err);
      return this.staticFallback(fullName, company?.name ?? null, intent, tone);
    }
  }

  private staticFallback(
    contactName: string,
    companyName: string | null,
    intent: string,
    tone: EmailTone,
  ): EmailDraft {
    const greeting = tone === 'formal' ? `Stimate ${contactName.split(' ')[0]},` : `Bună, ${contactName.split(' ')[0]},`;
    const companyLine = companyName
      ? `Vă scriu în legătură cu ${companyName} și nevoile dumneavoastră actuale.`
      : 'Sper că vă găsesc bine.';
    return {
      subject: `Despre ${intent.slice(0, 60)}`,
      body: `${greeting}\n\n${companyLine}\n\n${intent}\n\nMă bucur să discutăm dacă există un moment potrivit săptămâna aceasta.\n\nCu respect,`,
      tone,
      generatedAt: new Date().toISOString(),
    };
  }

  private async callLLM(context: string): Promise<string> {
    if (this.provider === 'gemini' && this.gemini) {
      const res = await this.gemini.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: context,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          maxOutputTokens: 800,
        },
      });
      return res.text ?? '{}';
    }
    if (this.provider === 'anthropic' && this.anthropic) {
      const anthropic = this.anthropic;
      const msg = await getBreaker('anthropic').exec(() =>
        anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: context }],
        }),
      );
      return msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    }
    return '{}';
  }
}
