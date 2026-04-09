/**
 * FE-side types for server responses. We don't import Prisma types into
 * the browser bundle (large + drags in Node runtime). When the shape
 * changes on the backend, update here too.
 */

export type SubjectType = 'COMPANY' | 'CONTACT' | 'CLIENT';

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
