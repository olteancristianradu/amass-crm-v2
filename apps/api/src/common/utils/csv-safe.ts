/**
 * CSV formula-injection sanitization.
 *
 * Excel / LibreOffice / Google Sheets execute cells that START with one of:
 *   =   +   -   @   \t   \r
 * as formulas. If we store user input verbatim and later export it to CSV,
 * the spreadsheet will run the formula when the file is opened — that turns
 * a CRM "notes" field into `=HYPERLINK("https://evil.example/","click")`
 * or worse `=cmd|' /c calc'!A1`.
 *
 * Mitigation per OWASP CSV Injection cheat-sheet: prefix any value starting
 * with a dangerous character with a single leading tick (`'`). The tick is
 * stripped by the spreadsheet app on display and the cell is shown as text.
 *
 * We sanitize on both INPUT (importer) and OUTPUT (exports) as
 * defense-in-depth: sanitizing on export protects data that somehow
 * already got stored; sanitizing on import prevents bad data at rest.
 */

const DANGEROUS = /^[=+\-@\t\r]/;

export function sanitizeCsvCell<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;
  if (!DANGEROUS.test(value)) return value;
  // Prefix with a tick so spreadsheets treat the cell as text.
  return `'${value}`;
}

/**
 * Walk an object, sanitising any string fields. Non-object / primitive
 * values pass through unchanged. Used by the CSV importer to clean rows
 * before they hit the DB.
 */
export function sanitizeCsvRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeCsvCell(v);
  }
  return out as T;
}
