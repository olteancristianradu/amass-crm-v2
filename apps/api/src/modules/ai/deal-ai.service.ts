/**
 * DealAiService — AI-powered deal suggestions.
 *
 * Provider priority (first one with a valid key wins):
 *   1. Google Gemini (gemini-1.5-flash) — FREE tier (1M tokens/day)
 *   2. Anthropic Claude (claude-sonnet-4-6) — paid fallback
 *   3. Static fallback — generic "review deal" message
 *
 * Builds a context snapshot for a deal (company name, contact, open tasks)
 * and asks the LLM for the next best action as JSON.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

import { loadEnv } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { getBreaker } from '../../common/resilience/circuit-breaker';

export interface DealSuggestion {
  action: string;
  reasoning: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedAt: string;
}

type Provider = 'gemini' | 'anthropic' | 'none';

const SYSTEM_PROMPT = `You are a CRM sales assistant. Given a deal context, suggest the single most impactful next action the salesperson should take.

Respond ONLY with valid JSON (no markdown) in this exact shape:
{
  "action": "<imperative sentence, max 80 chars>",
  "reasoning": "<1-2 sentences explaining why this action>",
  "priority": "HIGH" | "MEDIUM" | "LOW"
}`;

@Injectable()
export class DealAiService {
  private readonly logger = new Logger(DealAiService.name);
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
      this.logger.warn('No AI provider key set — deal suggestions disabled');
    } else {
      this.logger.log(`DealAiService using provider=${this.provider}`);
    }
  }

  async suggest(dealId: string): Promise<DealSuggestion> {
    const { tenantId } = requireTenantContext();

    if (this.provider === 'none') {
      return {
        action: 'Configure GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to enable AI suggestions',
        reasoning: 'AI suggestions require an API key. Gemini free tier covers most SMB workloads.',
        priority: 'LOW',
        suggestedAt: new Date().toISOString(),
      };
    }

    // One tenant-scoped read tx for all three lookups — L2 (tenantExtension)
    // + L3 (RLS) apply to every query inside the callback.
    const { deal, company, contact } = await this.prisma.runWithTenant(tenantId, 'ro', async (tx) => {
      const deal = await tx.deal.findFirst({
        where: { id: dealId, deletedAt: null },
        include: {
          stage: { select: { name: true } },
          tasks: {
            where: { status: 'OPEN', deletedAt: null },
            select: { title: true, dueAt: true, priority: true },
            take: 10,
          },
        },
      });
      if (!deal) throw new NotFoundException({ code: 'DEAL_NOT_FOUND' });
      const [company, contact] = await Promise.all([
        deal.companyId
          ? tx.company.findFirst({ where: { id: deal.companyId }, select: { name: true, industry: true } })
          : null,
        deal.contactId
          ? tx.contact.findFirst({
              where: { id: deal.contactId },
              select: { firstName: true, lastName: true, jobTitle: true, email: true },
            })
          : null,
      ]);
      return { deal, company, contact };
    });

    const context = `
Deal: ${deal.title}
Value: ${deal.value?.toString() ?? 'unknown'} ${deal.currency}
Stage: ${deal.stage.name}
Expected close: ${deal.expectedCloseAt?.toISOString().slice(0, 10) ?? 'not set'}
Status: ${deal.status}
Company: ${company?.name ?? 'none'} (${company?.industry ?? 'unknown industry'})
Contact: ${contact ? `${contact.firstName} ${contact.lastName}, ${contact.jobTitle ?? ''}, ${contact.email ?? ''}` : 'none'}

Open tasks:
${deal.tasks.map((t) => `- [${t.priority}] ${t.title}${t.dueAt ? ` (due ${t.dueAt.toISOString().slice(0, 10)})` : ''}`).join('\n') || '(none)'}
`.trim();

    try {
      const text = await this.callLLM(context);
      const parsed = JSON.parse(text) as { action: string; reasoning: string; priority: string };

      return {
        action: parsed.action ?? 'Follow up with contact',
        reasoning: parsed.reasoning ?? '',
        priority: (['HIGH', 'MEDIUM', 'LOW'].includes(parsed.priority) ? parsed.priority : 'MEDIUM') as DealSuggestion['priority'],
        suggestedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error('AI suggestion failed for deal %s: %o', dealId, err);
      return {
        action: 'Review deal status and follow up',
        reasoning: 'AI suggestion unavailable — please review manually.',
        priority: 'MEDIUM',
        suggestedAt: new Date().toISOString(),
      };
    }
  }

  private async callLLM(context: string): Promise<string> {
    if (this.provider === 'gemini' && this.gemini) {
      const res = await this.gemini.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: context,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          maxOutputTokens: 256,
        },
      });
      return res.text ?? '{}';
    }
    if (this.provider === 'anthropic' && this.anthropic) {
      const anthropic = this.anthropic;
      const msg = await getBreaker('anthropic').exec(() =>
        anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: context }],
        }),
      );
      return msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    }
    return '{}';
  }
}
