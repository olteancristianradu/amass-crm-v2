/**
 * DealAiService — AI-powered deal suggestions using Claude claude-sonnet-4-6.
 *
 * Builds a context snapshot for a deal (company name, contact, open tasks)
 * and asks Claude for the next best action.
 *
 * Falls back gracefully when ANTHROPIC_API_KEY is not set.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { loadEnv } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface DealSuggestion {
  action: string;
  reasoning: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedAt: string;
}

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
  private readonly client: Anthropic | null;

  constructor(private readonly prisma: PrismaService) {
    const { ANTHROPIC_API_KEY } = loadEnv();
    this.client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — deal suggestions disabled');
    }
  }

  async suggest(dealId: string): Promise<DealSuggestion> {
    const { tenantId } = requireTenantContext();

    if (!this.client) {
      return {
        action: 'Configure ANTHROPIC_API_KEY to enable AI suggestions',
        reasoning: 'AI suggestions require an Anthropic API key.',
        priority: 'LOW',
        suggestedAt: new Date().toISOString(),
      };
    }

    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
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
        ? this.prisma.company.findFirst({
            where: { id: deal.companyId, tenantId },
            select: { name: true, industry: true },
          })
        : null,
      deal.contactId
        ? this.prisma.contact.findFirst({
            where: { id: deal.contactId, tenantId },
            select: { firstName: true, lastName: true, jobTitle: true, email: true },
          })
        : null,
    ]);

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
      const msg = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: context }],
      });

      const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
      const parsed = JSON.parse(text) as { action: string; reasoning: string; priority: string };

      return {
        action: parsed.action ?? 'Follow up with contact',
        reasoning: parsed.reasoning ?? '',
        priority: (['HIGH', 'MEDIUM', 'LOW'].includes(parsed.priority) ? parsed.priority : 'MEDIUM') as DealSuggestion['priority'],
        suggestedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error('Claude suggestion failed for deal %s: %o', dealId, err);
      return {
        action: 'Review deal status and follow up',
        reasoning: 'AI suggestion unavailable — please review manually.',
        priority: 'MEDIUM',
        suggestedAt: new Date().toISOString(),
      };
    }
  }
}
