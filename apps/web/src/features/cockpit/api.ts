import { api } from '@/lib/api';

export interface CockpitFeedItem {
  id: string;
  widget: 'deals-in-danger' | 'reminders-due-today' | 'tasks-overdue' | 'leads-hot';
  score: number;
  title: string;
  subtitle?: string;
  dueAt?: string;
  href: string;
  entityId: string;
  entityType: 'deal' | 'reminder' | 'task' | 'lead';
}

export const cockpitApi = {
  feed: () => api.get<CockpitFeedItem[]>('/cockpit/feed'),
};

export const WIDGET_LABELS: Record<CockpitFeedItem['widget'], string> = {
  'deals-in-danger': 'Deal-uri în pericol',
  'reminders-due-today': 'Reminder-uri azi',
  'tasks-overdue': 'Task-uri restante',
  'leads-hot': 'Lead-uri fierbinți',
};

export const WIDGET_DESCRIPTIONS: Record<CockpitFeedItem['widget'], string> = {
  'deals-in-danger': 'Deal-uri deschise fără activitate de >7 zile, ordonate după valoare',
  'reminders-due-today': 'Reminder-uri programate să se declanșeze în următoarele 24h',
  'tasks-overdue': 'Task-uri trecute de termen, prioritizate după nivel HIGH',
  'leads-hot': 'Lead-uri noi cu scor mare (în construcție)',
};

export const ALL_WIDGETS: CockpitFeedItem['widget'][] = [
  'deals-in-danger',
  'reminders-due-today',
  'tasks-overdue',
  'leads-hot',
];
