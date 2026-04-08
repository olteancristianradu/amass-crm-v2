/**
 * GestCom (and most Romanian SMB exports) ship CSV/XLSX files with
 * inconsistent header capitalisation, accents, and a mix of RO/EN labels.
 *
 * This mapper normalises a row (Record<header, value>) to one of our
 * domain entities. The strategy is:
 *
 *   1. Lowercase + strip diacritics + collapse whitespace on every header
 *      so we can match `Nume` / `nume` / `NUME` / `Numele clientului` etc.
 *   2. For each target field we hold an ordered list of candidate header
 *      keys (most specific first, English fallback last).
 *
 * Adding a new column? Append to the candidate list — order matters
 * (first match wins).
 */

export type RawRow = Record<string, unknown>;

const stripDiacritics = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function normaliseHeader(h: string): string {
  return stripDiacritics(String(h ?? '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

/** Build a normalised lookup once per row. */
function indexRow(row: RawRow): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const val = String(v).trim();
    if (val === '') continue;
    out.set(normaliseHeader(k), val);
  }
  return out;
}

function pick(idx: Map<string, string>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const v = idx.get(normaliseHeader(c));
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Split a "First Last" / "Last First" full-name field into parts when the
 * source CSV only has one column. Heuristic: if exactly one space, treat
 * the first token as firstName. Otherwise the last token is lastName.
 */
function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

export interface MappedClient {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  mobile?: string;
  addressLine?: string;
  city?: string;
  county?: string;
  postalCode?: string;
  country?: string;
}

export interface MappedCompany {
  name: string;
  vatNumber?: string;
  registrationNumber?: string;
  industry?: string;
  email?: string;
  phone?: string;
  website?: string;
  addressLine?: string;
  city?: string;
  county?: string;
  postalCode?: string;
  country?: string;
}

export interface MappedContact {
  firstName: string;
  lastName: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  /** Optional company name to look up / create. */
  companyName?: string;
}

export function mapClientRow(row: RawRow): MappedClient | null {
  const idx = indexRow(row);
  let firstName = pick(idx, ['prenume', 'nume mic', 'first name', 'firstname']);
  let lastName = pick(idx, ['nume', 'nume de familie', 'last name', 'lastname', 'surname']);
  const fullName = pick(idx, ['nume complet', 'nume si prenume', 'full name', 'name']);
  if ((!firstName || !lastName) && fullName) {
    const split = splitFullName(fullName);
    firstName ||= split.firstName;
    lastName ||= split.lastName;
  }
  if (!firstName || !lastName) return null;

  return {
    firstName,
    lastName,
    email: pick(idx, ['email', 'e-mail', 'mail']),
    phone: pick(idx, ['telefon', 'tel', 'phone', 'telefon fix']),
    mobile: pick(idx, ['mobil', 'telefon mobil', 'mobile', 'cellphone']),
    addressLine: pick(idx, ['adresa', 'address', 'adresa completa', 'strada']),
    city: pick(idx, ['oras', 'localitate', 'city']),
    county: pick(idx, ['judet', 'county', 'state']),
    postalCode: pick(idx, ['cod postal', 'postal code', 'zip']),
    country: pick(idx, ['tara', 'country']),
  };
}

export function mapCompanyRow(row: RawRow): MappedCompany | null {
  const idx = indexRow(row);
  const name = pick(idx, ['denumire', 'denumire firma', 'nume firma', 'company', 'company name', 'name']);
  if (!name) return null;
  return {
    name,
    vatNumber: pick(idx, ['cui', 'cif', 'vat', 'vat number', 'cod fiscal']),
    registrationNumber: pick(idx, ['nr reg com', 'numar reg com', 'registration', 'j']),
    industry: pick(idx, ['domeniu', 'industrie', 'industry', 'caen']),
    email: pick(idx, ['email', 'e-mail', 'mail']),
    phone: pick(idx, ['telefon', 'tel', 'phone']),
    website: pick(idx, ['website', 'site', 'web', 'url']),
    addressLine: pick(idx, ['adresa', 'address', 'sediu']),
    city: pick(idx, ['oras', 'localitate', 'city']),
    county: pick(idx, ['judet', 'county']),
    postalCode: pick(idx, ['cod postal', 'postal code', 'zip']),
    country: pick(idx, ['tara', 'country']),
  };
}

export function mapContactRow(row: RawRow): MappedContact | null {
  const idx = indexRow(row);
  let firstName = pick(idx, ['prenume', 'first name', 'firstname']);
  let lastName = pick(idx, ['nume', 'last name', 'lastname', 'surname']);
  const fullName = pick(idx, ['nume complet', 'nume si prenume', 'full name']);
  if ((!firstName || !lastName) && fullName) {
    const split = splitFullName(fullName);
    firstName ||= split.firstName;
    lastName ||= split.lastName;
  }
  if (!firstName || !lastName) return null;

  return {
    firstName,
    lastName,
    jobTitle: pick(idx, ['functie', 'pozitie', 'job', 'job title', 'title']),
    email: pick(idx, ['email', 'e-mail', 'mail']),
    phone: pick(idx, ['telefon', 'tel', 'phone']),
    mobile: pick(idx, ['mobil', 'telefon mobil', 'mobile']),
    companyName: pick(idx, ['firma', 'companie', 'company', 'company name', 'denumire firma']),
  };
}
