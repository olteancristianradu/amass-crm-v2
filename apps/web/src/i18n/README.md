# i18n — convenție catalog Amass CRM

**Status:** Phase 0 — RO baseline + EN scaffold. Următoarele locale: GR/IT/ES/FR/PL (post-launch).

**Librărie țintă:** `react-i18next` + `i18next` (NU instalat încă — vezi „Wiring rămas" mai jos).
**Catalog:** JSON, namespace per feature, key flat în obiect dot-path.

---

## Layout pe disc

```
apps/web/src/i18n/
├── README.md                ← acest fișier
├── index.ts                 ← stub gol (wiring în task frontend-engineer)
├── ro/
│   ├── common.json          ← butoane, acțiuni, status generic, copii UI generice
│   ├── errors.json          ← coduri eroare BE + mesaje user-facing
│   ├── auth.json
│   ├── companies.json
│   ├── deals.json
│   ├── invoices.json
│   └── ...                  ← 50 features × 1 namespace = 50 + 2 cross-cutting = 52 total
└── en/
    └── …                    ← paritate 1:1 cu ro/, valori "[TODO-EN] <text RO>"
```

**Per locale → 52 fișiere JSON.** Pentru o nouă locală (ex: `gr/`), copiezi `en/` și traduci.

---

## Convenție chei

**Format:** `<namespace>:<section>.<key>` — colon separator între namespace și restul.

Exemple:
- `common:actions.save` → „Salvează"
- `auth:login.title` → „Conectare"
- `deals:status.won` → „Câștigat"
- `invoices:form.label.dueDate` → „Scadență"
- `errors:auth.invalidCredentials` → „Email sau parolă incorectă"

**Reguli:**

1. **Namespace = un singur folder feature** (ex: `apps/web/src/features/deals/` → `deals.json`). Componentele cross-cutting (Button, Label, AppShell, NotificationsBell) folosesc `common` sau, dacă conțin text de eroare, `errors`.
2. **Section grupează scopul:** `actions`, `labels`, `placeholders`, `form`, `list`, `detail`, `status`, `empty`, `confirm`, `toast`, `aria`, `title`.
3. **Key în camelCase**, descriptiv (`addLine`, nu `addL`).
4. **Plural:** sufix i18next `_zero` / `_one` / `_other` (RO are 3 forme: 0, 1, multe — `_few` poate fi adăugat ulterior).
5. **Interpolare:** `{{var}}` standard i18next, NU template strings.
6. **Brand verbatim, NU traduce:** „Amass", „Stripe", „ANAF", „SmartBill", „Twilio", „Microsoft", „Outlook", „WhatsApp", „Google", „SmartFactura", „e-Factura", „SAF-T", „CUI", „CIF". Frazele mixte (ex: „Conectare la ANAF") intră normal în catalog ca singur string.
7. **Pentru proză lungă** (>200 caractere, paragrafe legale, help pages, pricing copy) NU folosi JSON. Pune-l în `apps/web/src/content/<locale>/{help,privacy,pricing,etc}.mdx`.
8. **Date/numere/monedă** NU intră în catalog — folosește `date-fns` + locale și `Intl.NumberFormat(locale, …)` direct în componente.

---

## Convenție paritate RO ↔ EN

**Regulă strictă:** orice key în `ro/<ns>.json` are counterpart în `en/<ns>.json`.

În Phase 0, valorile EN sunt **placeholder-uri**: `"[TODO-EN] <text RO original>"`. Asta:
- Garantează paritate de chei (CI check va trece).
- Face vizibil în UI ce nu e tradus (apare cu prefix `[TODO-EN]` dacă utilizatorul comută pe EN).
- Permite traducătorului uman să vadă originalul fără a deschide al doilea fișier.

**Workflow traducere EN:**
1. Deschide perechea `ro/<ns>.json` ↔ `en/<ns>.json`.
2. Înlocuiește `"[TODO-EN] <ro>"` cu traducerea reală.
3. Verifică în UI cu `?lng=en` în URL (după wiring).

**Chei ambigue** (text RO scurt cu sens dependent de context — ex: „Aplică", „Trimite") sunt marcate în Phase 0 cu prefix `[_REVIEW_]` în VALOAREA RO ca să forțeze review uman. Vezi „Top chei _REVIEW_" în raportul Phase 0.

---

## Plural — exemplu

```json
// ro/deals.json
{
  "list": {
    "count_zero": "Niciun deal",
    "count_one": "{{count}} deal",
    "count_few": "{{count}} deal-uri",
    "count_other": "{{count}} de deal-uri"
  }
}

// en/deals.json
{
  "list": {
    "count_zero": "No deals",
    "count_one": "{{count}} deal",
    "count_other": "{{count}} deals"
  }
}
```

i18next alege forma corectă pe baza `count` + regulile CLDR pentru locale.

---

## Wiring rămas (NU făcut în acest task)

Următorul task `frontend-engineer` va:

1. `pnpm --filter @amass/web add i18next react-i18next i18next-browser-languagedetector i18next-http-backend`
2. Popula `apps/web/src/i18n/index.ts`:
   - Init `i18next` cu `initReactI18next`, language detector, lazy-load per namespace.
   - Resources statice pentru RO (default) + dynamic import pentru EN.
   - `fallbackLng: 'ro'`, `defaultNS: 'common'`.
3. Wrap `<App>` în `<I18nextProvider i18n={i18n}>` (sau `Suspense` cu `useTranslation`).
4. Adaugă language switcher în pagina Settings (folosește `i18n.changeLanguage('en')`).
5. Migrează componente: înlocuiește string literal cu `t('namespace:section.key')`.
6. Adaugă ESLint rule `i18next/no-literal-string` cu allowlist pentru brand names + valori tehnice (CUI, RON, EUR).
7. CI check: script Node care diff keys între `ro/*.json` și `en/*.json`, fail dacă drift.

---

## Pipeline calitate (în CI, post-wiring)

```jsonc
// package.json (apps/web)
"scripts": {
  "i18n:lint":   "node scripts/i18n-parity.js",        // fail dacă RO/EN diverg
  "i18n:unused": "i18next-extract --dry-run",          // raportează chei orfan
  "i18n:extract": "i18next-parser --config i18next-parser.config.js"
}
```

CI gate `pnpm i18n:lint` rulează la fiecare PR ce atinge `apps/web/src/`.

---

## TODO follow-up (în afara scope-ului Phase 0 i18n catalog)

1. **`packages/shared` Zod messages.** Schemele de validare (LoginSchema, CreateInvoiceSchema, etc) au mesaje hardcodate RO în `.refine()` / `.min().message()`. Trebuie:
   - Audit complet `packages/shared/src/**/*.ts` pentru string-uri RO în `z.*().message(...)` și `.refine(..., { message: ... })`.
   - Decizie: (a) păstrăm RO acolo și traducem mesajul în FE după ce-l primim ca cod (`error.code`), SAU (b) injectăm `t()` în builder Zod și schemele devin i18n-aware.
   - **Recomandare:** (a) — schemele dau coduri (`INVALID_EMAIL`, `PASSWORD_TOO_SHORT`), FE traduce via `errors:validation.<code>`. Backend rămâne locale-agnostic.
   - **Owner:** task separat (`packages/shared-validation-i18n`), nu blochează Phase 0.

2. **BE email templates.** Mutare `.hbs` per locale (ex: `apps/api/src/templates/email/invoice/ro.hbs` + `en.hbs`), serviciu `I18nService.resolveTemplate(name, locale)`. Vezi system prompt secțiunea „Workflow › Backend-emitted strings".

3. **Adăugare coloană `User.preferredLocale`.** Migrare Prisma + endpoint `PATCH /users/me/locale`. Locale resolution: user pref > Accept-Language > tenant default > RO.

4. **`Tenant.defaultLocale`.** Pentru ca admin-ul să forțeze locale pentru toți utilizatorii noi din tenant-ul respectiv.

5. **Audit chei `_REVIEW_`** (vezi raport Phase 0): clarificare context cu screenshot din UI înainte de traducere EN reală.

6. **MDX runtime.** Routes `/help`, `/privacy`, `/pricing` trebuie să citească MDX-ul corect pe baza locale-ului curent. `@mdx-js/react` + dynamic import.
