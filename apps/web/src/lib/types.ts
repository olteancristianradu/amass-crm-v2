/**
 * FE-side types for server responses. We don't import Prisma types into
 * the browser bundle (large + drags in Node runtime). When the shape
 * changes on the backend, update here too.
 */

export type SubjectType = 'COMPANY' | 'CONTACT' | 'CLIENT';

export type EntityType = 'company' | 'contact' | 'client';

export interface SearchResult {
  id: string;
  type: EntityType;
  label: string;
  subtitle: string;
  score: number;
}

export type ReminderStatus = 'PENDING' | 'FIRED' | 'DISMISSED' | 'CANCELLED';

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  industry?: string | null;
  size?: 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  county?: string | null;
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Contact {
  id: string;
  tenantId: string;
  companyId?: string | null;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  addressLine?: string | null;
  city?: string | null;
  county?: string | null;
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  tenantId: string;
  subjectType: SubjectType;
  subjectId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  createdById?: string | null;
}

export interface Attachment {
  id: string;
  tenantId: string;
  subjectType: SubjectType;
  subjectId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  tenantId: string;
  subjectType: SubjectType;
  subjectId: string;
  actorId?: string | null;
  title: string;
  body?: string | null;
  remindAt: string;
  status: ReminderStatus;
  firedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export type TimelineItem =
  | {
      kind: 'note';
      id: string;
      createdAt: string;
      body: string;
      createdById?: string | null;
    }
  | {
      kind: 'activity';
      id: string;
      createdAt: string;
      action: string;
      actorId?: string | null;
      metadata?: Record<string, unknown> | null;
    };

export interface TimelinePage {
  data: TimelineItem[];
  nextCursor: string | null;
}

// --- S10: Pipelines / Deals / Tasks ----------------------------------------

export type StageType = 'OPEN' | 'WON' | 'LOST';
export type DealStatus = 'OPEN' | 'WON' | 'LOST';
export type TaskStatus = 'OPEN' | 'DONE';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  type: StageType;
  order: number;
  probability: number;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  order: number;
  stages: PipelineStage[];
}

export interface Deal {
  id: string;
  tenantId: string;
  pipelineId: string;
  stageId: string;
  companyId?: string | null;
  contactId?: string | null;
  ownerId?: string | null;
  title: string;
  description?: string | null;
  /** Prisma Decimal is serialised as a string in JSON. */
  value?: string | null;
  currency: string;
  probability?: number | null;
  expectedCloseAt?: string | null;
  status: DealStatus;
  lostReason?: string | null;
  closedAt?: string | null;
  orderInStage: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  tenantId: string;
  dealId?: string | null;
  subjectType?: SubjectType | null;
  subjectId?: string | null;
  assigneeId?: string | null;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- S11: Email ---------------------------------------------------------------

export type EmailStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';

export interface EmailAccount {
  id: string;
  tenantId: string;
  userId: string;
  label: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  fromName: string;
  fromEmail: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailMessage {
  id: string;
  tenantId: string;
  accountId: string;
  subjectType: SubjectType;
  subjectId: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  status: EmailStatus;
  sentAt?: string | null;
  errorMessage?: string | null;
  messageId?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- S12: Calls ---------------------------------------------------------------

export type CallDirection = 'INBOUND' | 'OUTBOUND';
export type CallStatus =
  | 'QUEUED'
  | 'RINGING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BUSY'
  | 'NO_ANSWER'
  | 'FAILED'
  | 'CANCELED';
export type TranscriptionStatus = 'NONE' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface PhoneNumber {
  id: string;
  tenantId: string;
  userId?: string | null;
  twilioSid: string;
  number: string;
  label?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CallTranscript {
  id: string;
  callId: string;
  language?: string | null;
  rawText: string;
  redactedText?: string | null;
  summary?: string | null;
  actionItems?: string[] | null;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  topics?: string[] | null;
  model?: string | null;
  processedAt: string;
}

// ── S22/S23/S24 Invoices, Projects, Payments ────────────────────────────────

export type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export type InvoiceCurrency = 'RON' | 'EUR' | 'USD';
export type PaymentMethod = 'BANK' | 'CASH' | 'CARD' | 'OTHER';
export type ProjectStatus =
  | 'PLANNED'
  | 'ACTIVE'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'CANCELLED';

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  subtotal: string;
  vatAmount: string;
  total: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: string;
  paidAt: string;
  method: PaymentMethod;
  reference?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  companyId: string;
  dealId?: string | null;
  series: string;
  number: number;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  vatAmount: string;
  total: string;
  currency: InvoiceCurrency;
  status: InvoiceStatus;
  notes?: string | null;
  pdfStorageKey?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: InvoiceLine[];
  payments?: Payment[];
}

export interface Project {
  id: string;
  tenantId: string;
  companyId: string;
  dealId?: string | null;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  budget?: string | null;
  currency: InvoiceCurrency;
  createdAt: string;
  updatedAt: string;
}

export interface Call {
  id: string;
  tenantId: string;
  subjectType: SubjectType;
  subjectId: string;
  phoneNumberId?: string | null;
  userId?: string | null;
  twilioCallSid?: string | null;
  direction: CallDirection;
  status: CallStatus;
  fromNumber: string;
  toNumber: string;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSec?: number | null;
  recordingSid?: string | null;
  recordingUrl?: string | null;
  transcriptionStatus: TranscriptionStatus;
  phoneNumber?: PhoneNumber | null;
  transcript?: CallTranscript | null;
  createdAt: string;
  updatedAt: string;
}
