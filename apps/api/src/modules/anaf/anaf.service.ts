/**
 * ANAF e-Factura service.
 *
 * Generates UBL 2.1 / CIUS-RO XML and submits to the ANAF SPV REST API.
 * Production requires OAuth2 credentials from developer.anaf.ro.
 * Test mode hits the ANAF sandbox at webservicesp.anaf.ro.
 *
 * API docs: https://static.anaf.ro/static/10/Anaf/Informatii_R/API_e-factura.pdf
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { getBreaker } from '../../common/resilience/circuit-breaker';
import { AnafSubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

interface AnafConfig {
  vatNumber: string;
  companyName: string;
  addressLine: string;
  city: string;
  county: string;
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
}

@Injectable()
export class AnafService {
  constructor(private readonly prisma: PrismaService) {}

  private baseUrl(sandbox: boolean) {
    return sandbox
      ? 'https://webservicesp.anaf.ro/prod/FCTEL/rest'
      : 'https://webservices.anaf.ro/prod/FCTEL/rest';
  }

  // ─── Submit invoice ────────────────────────────────────────────────────────

  async submitInvoice(invoiceId: string): Promise<{ uploadIndex: string }> {
    const { tenantId } = requireTenantContext();

    const invoice = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId, tenantId, deletedAt: null },
        include: { lines: true, payments: true },
      }),
    );
    if (!invoice) throw new NotFoundException('Invoice not found');

    const config = await this.getAnafConfig(tenantId);
    const xml = this.buildUblXml(invoice as Parameters<typeof this.buildUblXml>[0], config);
    const token = await this.getAccessToken(config);

    const cif = config.vatNumber.replace(/^RO/i, '');
    const url = `${this.baseUrl(config.sandbox)}/upload?standard=UBL&cif=${cif}`;

    // C-ops: wrap outbound ANAF calls in a breaker — SPV is notoriously
    // flaky near fiscal deadlines and we don't want to chain-fail the whole
    // invoice queue on their downtime.
    const res = await getBreaker('anaf').exec(() =>
      fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/xml',
        },
        body: xml,
      }),
    );

    const data = await res.json() as { index_incarcare?: string; Errors?: { errorMessage: string }[] };

    if (!res.ok || data.Errors?.length) {
      const err = data.Errors?.[0]?.errorMessage ?? `HTTP ${res.status}`;
      await this.upsertSubmission(tenantId, invoiceId, 'FAILED', { errorMessage: err, xmlContent: xml });
      throw new Error(`ANAF upload failed: ${err}`);
    }

    const uploadIndex = data.index_incarcare!;
    await this.upsertSubmission(tenantId, invoiceId, 'UPLOADED', {
      uploadIndex,
      xmlContent: xml,
      submittedAt: new Date(),
    });

    return { uploadIndex };
  }

  // ─── Check status ──────────────────────────────────────────────────────────

  async checkStatus(invoiceId: string) {
    const { tenantId } = requireTenantContext();
    const sub = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.anafSubmission.findUnique({ where: { invoiceId } }),
    );
    if (!sub) throw new NotFoundException('No ANAF submission found for this invoice');
    if (!sub.uploadIndex) return sub;

    const config = await this.getAnafConfig(tenantId);
    const token = await this.getAccessToken(config);
    const url = `${this.baseUrl(config.sandbox)}/stareMesaj?id_incarcare=${sub.uploadIndex}`;

    const res = await getBreaker('anaf').exec(() =>
      fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
    );
    const data = await res.json() as { stare?: string; id_descarcare?: string; Errors?: unknown[] };

    const statusMap: Record<string, AnafSubmissionStatus> = {
      'in prelucrare': 'IN_VALIDATION',
      ok: 'OK',
      nok: 'NOK',
    };
    const newStatus = statusMap[(data.stare ?? '').toLowerCase()] ?? sub.status;

    await this.upsertSubmission(tenantId, invoiceId, newStatus, {
      downloadId: data.id_descarcare ?? sub.downloadId ?? null,
      validatedAt: newStatus === 'OK' ? new Date() : sub.validatedAt ?? undefined,
    });

    return { ...sub, status: newStatus, downloadId: data.id_descarcare };
  }

  async getXml(invoiceId: string): Promise<string> {
    const { tenantId } = requireTenantContext();
    const sub = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.anafSubmission.findUnique({ where: { invoiceId } }),
    );
    if (!sub?.xmlContent) throw new NotFoundException('No XML available');
    return sub.xmlContent;
  }

  // ─── UBL 2.1 CIUS-RO XML generation ───────────────────────────────────────

  private buildUblXml(
    invoice: {
      id: string; series: string; number: number; issueDate: Date; dueDate: Date;
      currency: string; subtotal: { toString(): string }; vatAmount: { toString(): string };
      total: { toString(): string }; notes: string | null;
      lines: Array<{ position: number; description: string; quantity: { toString(): string }; unitPrice: { toString(): string }; vatRate: { toString(): string }; subtotal: { toString(): string }; vatAmount: { toString(): string }; total: { toString(): string } }>;
    },
    config: AnafConfig,
  ): string {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const lines = invoice.lines.map((l) => `
    <cac:InvoiceLine>
      <cbc:ID>${l.position}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">${l.quantity.toString()}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${invoice.currency}">${l.subtotal.toString()}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${invoice.currency}">${l.vatAmount.toString()}</cbc:TaxAmount>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Description>${this.esc(l.description)}</cbc:Description>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>S</cbc:ID>
          <cbc:Percent>${l.vatRate.toString()}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${invoice.currency}">${l.unitPrice.toString()}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${invoice.series}-${invoice.number}</cbc:ID>
  <cbc:IssueDate>${fmt(invoice.issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${fmt(invoice.dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>
  ${invoice.notes ? `<cbc:Note>${this.esc(invoice.notes)}</cbc:Note>` : ''}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="9944">${config.vatNumber}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${this.esc(config.companyName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${this.esc(config.addressLine)}</cbc:StreetName>
        <cbc:CityName>${this.esc(config.city)}</cbc:CityName>
        <cbc:CountrySubentity>${this.esc(config.county)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${config.vatNumber}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${invoice.currency}">${invoice.vatAmount.toString()}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${invoice.currency}">${invoice.subtotal.toString()}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${invoice.subtotal.toString()}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${invoice.total.toString()}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${invoice.currency}">${invoice.total.toString()}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lines}
</Invoice>`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── OAuth2 token ──────────────────────────────────────────────────────────

  private async getAccessToken(config: AnafConfig): Promise<string> {
    const base = config.sandbox
      ? 'https://logincert.anaf.ro/anaf-oauth2/v1'
      : 'https://logincert.anaf.ro/anaf-oauth2/v1';
    const res = await getBreaker('anaf').exec(() =>
      fetch(`${base}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      }),
    );
    const data = await res.json() as { access_token?: string };
    if (!data.access_token) throw new Error('Failed to get ANAF access token');
    return data.access_token;
  }

  private async getAnafConfig(tenantId: string): Promise<AnafConfig> {
    // Config stored in tenant metadata or env vars; for now use env fallback
    return {
      vatNumber: process.env[`ANAF_VAT_${tenantId}`] ?? process.env['ANAF_VAT'] ?? '',
      companyName: process.env[`ANAF_NAME_${tenantId}`] ?? process.env['ANAF_COMPANY_NAME'] ?? '',
      addressLine: process.env['ANAF_ADDRESS'] ?? '',
      city: process.env['ANAF_CITY'] ?? '',
      county: process.env['ANAF_COUNTY'] ?? '',
      clientId: process.env['ANAF_CLIENT_ID'] ?? '',
      clientSecret: process.env['ANAF_CLIENT_SECRET'] ?? '',
      sandbox: process.env['ANAF_SANDBOX'] === 'true',
    };
  }

  private async upsertSubmission(
    tenantId: string,
    invoiceId: string,
    status: AnafSubmissionStatus,
    extra: Partial<{ uploadIndex: string | null; downloadId: string | null; xmlContent: string; errorMessage: string; submittedAt: Date; validatedAt: Date }>,
  ) {
    await this.prisma.anafSubmission.upsert({
      where: { invoiceId },
      create: { tenantId, invoiceId, status, ...extra },
      update: { status, ...extra },
    });
  }
}
