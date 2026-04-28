/**
 * Token-based status color helpers. Replace ad-hoc `bg-green-100 text-green-800`
 * scattered across list pages. Tailwind static classes prevented us from
 * pulling these from CSS vars directly, so we ship a tiny lookup that yields
 * the same className strings everywhere — but anchored to design tokens
 * (semantic accent variables) so the contrast theme stays consistent.
 *
 * Usage:
 *   const cls = statusBadgeClasses('SUCCESS');  // → 'bg-emerald-50 text-emerald-700 ...'
 *   <span className={cls}>{label}</span>
 *
 * For HIGH-CONTRAST theme: the bg-* classes still render but the underlying
 * `--accent-*` HSL values shift to higher-saturation versions, so badge
 * legibility holds. Hardcoded -50/-100 background variants stay subtle in
 * either theme; -700 text passes WCAG AA on either.
 */

/** Semantic intent of a status — maps to a color palette. */
export type StatusTone =
  | 'success'   // green: PAID, ACTIVE, SENT, COMPLETED, OK
  | 'warning'   // amber: PENDING, OVERDUE, DRAFT, RETRY
  | 'danger'    // red: FAILED, CANCELLED, REJECTED, ERROR
  | 'info'      // blue: NEW, INFO, RUNNING
  | 'neutral'   // gray: ARCHIVED, INACTIVE, EXPIRED
  | 'accent';   // brand: SCHEDULED, FOCUS

/** className string for a small status pill. Stable across themes via tokens. */
export function statusBadgeClasses(tone: StatusTone): string {
  const base = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium';
  switch (tone) {
    case 'success':
      return `${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/50 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20`;
    case 'warning':
      return `${base} bg-amber-50 text-amber-800 ring-1 ring-amber-200/50 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20`;
    case 'danger':
      return `${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200/50 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20`;
    case 'info':
      return `${base} bg-blue-50 text-blue-700 ring-1 ring-blue-200/50 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/20`;
    case 'accent':
      return `${base} bg-violet-50 text-violet-700 ring-1 ring-violet-200/50 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20`;
    case 'neutral':
    default:
      return `${base} bg-secondary text-secondary-foreground ring-1 ring-border/50`;
  }
}

/**
 * Map a string status to a tone. Use for shared status enums. Pages can
 * still pass their own mapping via the `tone` prop directly when the
 * default doesn't fit.
 */
export function defaultToneFor(status: string): StatusTone {
  const s = status.toUpperCase();
  if (['SUCCESS', 'PAID', 'ACTIVE', 'SENT', 'COMPLETED', 'APPROVED', 'WON', 'CONVERTED', 'CONNECTED', 'ENABLED', 'OK', 'DELIVERED', 'CONFIRMED', 'FULFILLED'].includes(s)) {
    return 'success';
  }
  if (['PENDING', 'OVERDUE', 'DRAFT', 'RETRY', 'WARNING', 'PENDING_APPROVAL', 'PROCESSING', 'QUEUED', 'IN_PROGRESS', 'CONTACTED', 'OPEN'].includes(s)) {
    return 'warning';
  }
  if (['FAILED', 'CANCELLED', 'REJECTED', 'ERROR', 'LOST', 'DISQUALIFIED', 'EXPIRED', 'BOUNCED', 'BLOCKED', 'INVALID'].includes(s)) {
    return 'danger';
  }
  if (['NEW', 'INFO', 'RUNNING', 'SCHEDULED', 'PLANNED', 'OPEN_LEAD', 'QUALIFIED'].includes(s)) {
    return 'info';
  }
  if (['ACCENT', 'FOCUS', 'PINNED', 'RECOMMENDED', 'STARRED'].includes(s)) {
    return 'accent';
  }
  return 'neutral';
}
