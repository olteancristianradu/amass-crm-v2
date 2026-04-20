/**
 * AI Enrichment — uses Claude claude-sonnet-4-6 (or Gemini fallback) to enrich
 * company and contact records with additional context derived from existing CRM data.
 *
 * What enrichment adds:
 *   - Company: industry guess, size estimate, key topics from notes/calls, relationship health score
 *   - Contact: communication style, preferred contact time, role seniority, topics of interest
 *
 * All suggestions are non-destructive — returned as JSON, not auto-applied.
 * The FE can show them as "AI suggestions" for the user to accept.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface CompanyEnrichment {
  industryGuess: string;
  companySizeEstimate: string;
  relationshipHealth: 'STRONG' | 'NEUTRAL' | 'WEAK' | 'AT_RISK';
  keyTopics: string[];
  suggestedNextStep: string;
  reasoning: string;
}

export interface ContactEnrichment {
  communicationStyle: string;
  seniorityLevel: 'EXECUTIVE' | 'MANAGER' | 'INDIVIDUAL_CONTRIBUTOR' | 'UNKNOWN';
  topicsOfInterest: string[];
  preferredContactChannel: string;
  suggestedNextStep: string;
  reasoning: string;
}

const COMPANY_SYSTEM = `You are a CRM analyst. Given structured data about a company from a CRM, enrich it with inferred insights.
Respond ONLY with valid JSON matching exactly:
{
  "industryGuess": "<sector name>",
  "companySizeEstimate": "<micro|small|medium|large|enterprise>",
  "relationshipHealth": "<STRONG|NEUTRAL|WEAK|AT_RISK>",
  "keyTopics": ["<topic1>", "<topic2>"],
  "suggestedNextStep": "<imperative sentence, max 80 chars>",
  "reasoning": "<1-2 sentences>"
}`;

const CONTACT_SYSTEM = `You are a CRM analyst. Given structured data about a business contact, enrich it with inferred insights.
Respond ONLY with valid JSON matching exactly:
{
  "communicationStyle": "<formal|casual|technical|brief>",
  "seniorityLevel": "<EXECUTIVE|MANAGER|INDIVIDUAL_CONTRIBUTOR|UNKNOWN>",
  "topicsOfInterest": ["<topic1>", "<topic2>"],
  "preferredContactChannel": "<email|phone|sms|in-person>",
  "suggestedNextStep": "<imperative sentence, max 80 chars>",
  "reasoning": "<1-2 sentences>"
}`;

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly anthropic: Anthropic | null;
  private readonly gemini: GoogleGenAI | null;

  constructor(private readonly prisma: PrismaService) {
    const { ANTHROPIC_API_KEY, GEMINI_API_KEY } = loadEnv();
    this.anthropic = ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 })
      : null;
    this.gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
  }

  async enrichCompany(companyId: string): Promise<CompanyEnrichment> {
    const { tenantId } = requireTenantContext();

    const company = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.company.findFirst({
        where: { id: companyId, tenantId, deletedAt: null },
        include: {
          contacts: { where: { deletedAt: null }, take: 5, select: { firstName: true, lastName: true, jobTitle: true } },
        },
      }),
    );
    if (!company) throw new NotFoundException('Company not found');

    const [dealCount, noteCount, callCount] = await Promise.all([
      this.prisma.runWithTenant(tenantId, (tx) => tx.deal.count({ where: { tenantId, companyId, deletedAt: null } })),
      this.prisma.runWithTenant(tenantId, (tx) => tx.note.count({ where: { tenantId, subjectType: 'COMPANY', subjectId: companyId } })),
      this.prisma.runWithTenant(tenantId, (tx) => tx.call.count({ where: { tenantId, subjectType: 'COMPANY', subjectId: companyId } })),
    ]);

    const context = JSON.stringify({
      name: company.name,
      vatNumber: company.vatNumber,
      city: company.city,
      country: company.country,
      contacts: company.contacts.map((c) => ({ name: `${c.firstName} ${c.lastName}`, jobTitle: c.jobTitle })),
      dealCount,
      noteCount,
      callCount,
    });

    const raw = await this.callAI(COMPANY_SYSTEM, `Enrich this company: ${context}`);
    return JSON.parse(raw) as CompanyEnrichment;
  }

  async enrichContact(contactId: string): Promise<ContactEnrichment> {
    const { tenantId } = requireTenantContext();

    const contact = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contact.findFirst({ where: { id: contactId, tenantId, deletedAt: null } }),
    );
    if (!contact) throw new NotFoundException('Contact not found');

    const [emailCount, callCount, noteCount] = await Promise.all([
      this.prisma.runWithTenant(tenantId, (tx) => tx.emailMessage.count({ where: { tenantId, contactId } })),
      this.prisma.runWithTenant(tenantId, (tx) => tx.call.count({ where: { tenantId, subjectType: 'CONTACT', subjectId: contactId } })),
      this.prisma.runWithTenant(tenantId, (tx) => tx.note.count({ where: { tenantId, subjectType: 'CONTACT', subjectId: contactId } })),
    ]);

    const context = JSON.stringify({
      firstName: contact.firstName,
      lastName: contact.lastName,
      jobTitle: contact.jobTitle,
      email: contact.email ? '(email present)' : null,
      phone: contact.phone ? '(phone present)' : null,
      emailCount,
      callCount,
      noteCount,
      createdAt: contact.createdAt,
    });

    const raw = await this.callAI(CONTACT_SYSTEM, `Enrich this contact: ${context}`);
    return JSON.parse(raw) as ContactEnrichment;
  }

  private async callAI(systemPrompt: string, userMessage: string): Promise<string> {
    if (this.anthropic) {
      const res = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const block = res.content[0];
      return block.type === 'text' ? block.text : '{}';
    }

    if (this.gemini) {
      const result = await this.gemini.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
      });
      return result.text ?? '{}';
    }

    throw new Error('No AI provider configured (ANTHROPIC_API_KEY or GEMINI_API_KEY required)');
  }
}
