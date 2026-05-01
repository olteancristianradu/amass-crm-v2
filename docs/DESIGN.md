# DESIGN.md — AMASS CRM v2 Design System

**Versiune:** 1.0 · **Data:** 2026-04-30 · **Statut:** sursă canonică

This is the single source of truth for the AMASS CRM v2 visual design. Every
new screen, every feature, every refactor must align with the tokens, primitives
and patterns documented here. Updates to this file are themselves a design
decision — propose, review, then update.

The system is already implemented in code. This document describes what exists
and locks the rules. Verified file paths are referenced inline; do not invent
components that are not in the codebase.

> **Tech anchor.** Tailwind + shadcn/ui + custom CSS tokens in
> `apps/web/src/styles.css`. State for theme/density/accent in
> `apps/web/src/stores/ui-preferences.ts` (zustand, persisted as
> `amass-ui-prefs`). Theme is applied via `<html data-theme="...">`,
> density via `<html data-density="...">`. Tokens are HSL channels
> (`H S% L%`), composed at runtime as `hsl(var(--token) / alpha)`.

---

## Table of contents

1. [Brand identity](#1-brand-identity)
2. [Color system](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing & layout](#4-spacing--layout)
5. [Component primitives](#5-component-primitives)
6. [Information architecture](#6-information-architecture)
7. [Voice intelligence UX (differentiator)](#7-voice-intelligence-ux-differentiator)
8. [Empty states & onboarding](#8-empty-states--onboarding)
9. [Forms & validation](#9-forms--validation)
10. [Tables & data density](#10-tables--data-density)
11. [Notifications & feedback](#11-notifications--feedback)
12. [Accessibility](#12-accessibility)
13. [Motion & micro-interactions](#13-motion--micro-interactions)
14. [North-star references](#14-north-star-references)
15. [Anti-patterns](#15-anti-patterns)
16. [Implementation roadmap](#16-implementation-roadmap)

---

## 1. Brand identity

### 1.1 Product personality

AMASS is a tool, not a friend. It speaks like a competent Romanian colleague who
respects your time: direct, factual, never performative. No mascots, no
exclamation marks, no false enthusiasm. Errors are stated, not apologized for.
Successes are acknowledged once, not celebrated.

The aesthetic codename is **Liquid Glass** — translucent surfaces, soft shadows,
quiet hierarchy, large radii. Lifted from macOS Sonoma / iPadOS, adapted for
work that lasts eight hours a day. The dark theme is first-class because
Romanian SMB work hours are typically long and end after sunset.

### 1.2 Voice & tone

- **Limba:** romana corecta, cu diacritice (ă, â, î, ș, ț). Diacriticele nu
  sunt opționale — ele semnalează un produs autohton, nu un import tradus.
- **Persoana a 2-a:** "Ai 3 task-uri de azi", nu "Utilizatorul are 3 task-uri".
- **Imperativ scurt pentru CTA:** "Salvează", "Anulează", "Trimite la ANAF",
  "Marchează plătită". Nu "Click aici pentru a salva".
- **Fără jargon tehnic in UI:** spunem "Sesiunea a expirat. Re-autentifică-te.",
  nu "Missing bearer token" (vezi BUG-002 din `.gstack/qa-reports/REAL/FINAL-REAL-REPORT.md`).
- **Fără emoji in copy de produs.** Iconurile (Lucide) acoperă tot ce
  emoji-urile ar acoperi, mai consistent.
- **Fără padding emoțional:** nu "Super!", nu "Felicitări că ai creat prima
  companie!". Doar confirmarea: "Companie creată."
- **Engleză:** doar in cod, comentarii, log-uri tehnice, audit log entries
  destinate inginerilor.

### 1.3 Naming conventions

| Layer | Limba | Exemplu | Note |
|---|---|---|---|
| Etichete entități (UI) | RO | "Companii", "Contacte", "Oferte", "Pipeline" | vezi `AppShell.tsx:248-313` |
| Status badges (UI) | RO | "În curs", "Finalizat", "Eșuat", "Anulat" | vezi `call-card.tsx:336-358` |
| Verbe pe butoane (UI) | RO imperativ | "Salvează", "Trimite", "Anulează", "Aprobă" | nu infinitiv |
| Numele coloanelor in DB | EN snake_case | `tenant_id`, `created_at` | Prisma convertește la camelCase in TS |
| Cod, identificatori, clase CSS | EN | `GlassCard`, `runWithTenant`, `glass-card` | rule #1 din CLAUDE.md |
| Mesaje de eroare API | EN tehnic + RO traducere FE | `{code: "AUTH_EXPIRED"}` → "Sesiunea a expirat." | exception filter mapează |
| Audit log entries | EN | "user.login.success", "deal.stage.changed" | machine-readable |
| Comentarii in cod | EN | `// inject tenantId before query` | CLAUDE.md rule #10 |

### 1.4 Logo & wordmark

Logotype: "AMASS" în system-ui semibold tracking-tight, mărime adaptată la
context (sidebar 16px, login 32px). Nu există un mark separat la momentul
v1 — wordmark + accent color al tenantului fac brand-ul. Un logo grafic
poate fi adăugat post-launch; până atunci typography-only este intenționat
(menține flexibilitatea de rebranding pentru tenanți).

---

## 2. Color system

Toate culorile sunt HSL channels (`H S% L%`) stocate în CSS custom properties.
Compoziția se face inline cu `hsl(var(--token) / alpha)`. Tokenii reali sunt în
`apps/web/src/styles.css:23-149` — orice modificare începe acolo.

### 2.1 Light theme — "Liquid Glass — Lumină"

Aplicat când `<html data-theme="light">`. Implicit pentru utilizatori noi.

| Token | HSL | Folosit pentru |
|---|---|---|
| `--background` | `220 16% 92%` | canvas global (cool light gray) |
| `--foreground` | `222 47% 11%` | text principal |
| `--card` | `0 0% 100%` | suprafață card (combinat cu `--surface-alpha`) |
| `--card-foreground` | `222 47% 11%` | text pe card |
| `--surface-alpha` | `0.65` | opacitate glass surface |
| `--surface-blur` | `20px` | `backdrop-filter: blur()` |
| `--primary` | `222 47% 11%` | near-black; nav activ + CTA primar |
| `--primary-foreground` | `0 0% 100%` | text pe primary |
| `--secondary` | `220 14% 96%` | hover ghost surface, nav inactiv |
| `--muted` | `220 14% 96%` | divider, fundal subtil |
| `--muted-foreground` | `215 16% 47%` | text secundar (subtitle, helper) |
| `--border` | `220 13% 88%` | hairline 1px |
| `--input` | `220 13% 88%` | border inputs |
| `--ring` | `222 47% 11%` | focus ring |
| `--radius` | `1rem` | colțuri card vizibil rotunjite |

### 2.2 Dark theme — "Liquid Glass — Întuneric"

Aplicat când `<html data-theme="dark">`. First-class — nu o variantă derivată.

| Token | HSL | Note |
|---|---|---|
| `--background` | `222 24% 8%` | deep cool slate |
| `--foreground` | `210 40% 96%` | aproape alb |
| `--card` | `222 24% 12%` | translucent dark card |
| `--surface-alpha` | `0.55` | mai puțin opac decât light |
| `--surface-blur` | `22px` | blur mai puternic — compensează contrastul redus |
| `--primary` | `210 40% 96%` | invers — alb pe negru pe selected/CTA |
| `--secondary` | `222 20% 16%` | hover surface dark |
| `--muted-foreground` | `215 16% 70%` | trecut prin contrast checker — WCAG AA pe `--background` |
| `--border` | `222 18% 22%` | vizibil dar nu agresiv |
| `--ring` | `217 91% 60%` | albastru viu — singura abatere de la primary |

> ⚠️ **Audit dark contrast** (BLUE3 a semnalat acest punct). Înainte de
> launch trebuie verificat că `text-muted-foreground` pe `bg-card` și
> pe `bg-secondary` trec WCAG AA (4.5:1 pentru body normal). Vezi §16.

### 2.3 High Contrast theme — "Pro"

Aplicat când `<html data-theme="contrast">`. Pentru monitoare ieftine, ochi
obosiți, AT screen-readers care nu se descurcă cu translucent surfaces.

| Token | HSL | Diferență față de light |
|---|---|---|
| `--surface-alpha` | `1` | **opac complet** — dezactivează glass |
| `--surface-blur` | `0px` | fără blur |
| `--primary` | `217 91% 38%` | Salesforce-blue (nu near-black) |
| `--border` | `220 13% 75%` | mult mai vizibil decât în light |
| `--radius` | `0.375rem` | colțuri mai sharp |

Glass effect dezactivat este **parte din intenție** — utilizatorul cere
predictibilitate, nu refracție. Nu adăuga blur "decorativ" în acest temă.

### 2.4 System theme

Aplicat când utilizatorul alege "Urmează sistemul" — citează `prefers-color-scheme`
prin `@media` în `styles.css:154-170`. Store-ul `useUiPreferencesStore` setează
`data-theme="system"` și media-query-ul preia restul.

### 2.5 Accent presets

Implementate în `apps/web/src/routes/settings.appearance.tsx:74-81`. Independent
de temă — accentul se aplică pe focus ring, butoane primare, elemente active.

| Preset | HSL | Caz tipic |
|---|---|---|
| `default` | `222 47% 11%` | near-black — implicit |
| `blue` | `217 91% 55%` | tenanți tech / financial |
| `purple` | `268 78% 58%` | agencies, creative SMB |
| `green` | `152 60% 42%` | accounting, fiscal |
| `amber` | `32 92% 50%` | hospitality, retail |
| `rose` | `345 82% 58%` | health, beauty, fashion |

Plus un picker HEX custom (`hslToHex` / `hexToHsl` helpers la liniile 250-288)
care îi permite tenantului să-și seteze culoarea brandului. Stocată în
`--accent-tenant`. Nu se aplică la status badges (acelea rămân semantice).

### 2.6 Status accent dots

Patru tonuri semantice, definite în `styles.css:57-61` și folosite peste tot
ca status pills, kanban tags, dot indicators.

| Token (light) | Token (dark) | HSL light | HSL dark | Semantică |
|---|---|---|---|---|
| `--accent-blue` | `--accent-blue` | `217 91% 60%` | `217 91% 65%` | info / in progress |
| `--accent-green` | `--accent-green` | `142 71% 45%` | `142 71% 50%` | success / done |
| `--accent-amber` | `--accent-amber` | `38 92% 50%` | `38 92% 60%` | pending / warning |
| `--accent-pink` | `--accent-pink` | `339 90% 67%` | `339 90% 70%` | blocked / lost / failed |

`--destructive` (`0 84% 60%` light / `0 72% 56%` dark) este separat — folosit
**doar** pentru acțiuni destructive (delete, force-revoke), nu pentru status
"failed" curent. Status FAILED folosește `pink` din accent dots. Această
distincție e critică: o factură eșuată nu trebuie să arate ca un buton de
ștergere.

### 2.7 Semantic mapping (status colors în domeniu)

Mapping-ul real e în `call-card.tsx:336-358` (apeluri) și replicat consistent
în restul list pages. Toate mapping-urile noi trebuie să respecte aceeași
gramatică:

#### Deal stages (Pipeline)
| Stadiu | Tone |
|---|---|
| `LEAD` | `neutral` |
| `QUALIFIED` | `blue` |
| `PROPOSAL` | `blue` |
| `NEGOTIATION` | `amber` |
| `WON` | `green` |
| `LOST` | `pink` |

#### Invoice statuses
| Status | Tone |
|---|---|
| `DRAFT` | `neutral` |
| `ISSUED` | `blue` |
| `PAID` | `green` |
| `PARTIAL` | `amber` |
| `OVERDUE` | `pink` |
| `CANCELLED` | `neutral` |

#### Lead sources (etichete colorate, nu status)
Folosim `neutral` pentru toate, cu un dot mic în culoare distinctă —
sursa nu este o stare, e o categorie. Categorical color e diferit de status
color.

#### ANAF submission status
| Status | Etichetă RO | Tone |
|---|---|---|
| `DRAFT` | "Draft" | `neutral` |
| `PENDING` | "Trimisă" | `blue` |
| `IN_VALIDATION` | "În validare" | `amber` |
| `VALIDATED` | "Validată" | `green` |
| `REJECTED` | "Respinsă" | `pink` |
| `ERROR_LOCAL` | "Eroare locală" | `pink` |

### 2.8 Per-tenant accent

`--accent-tenant` permite fiecărui tenant să-și aplice culoarea brandului fără
să strice contrast-ul global. Aplicată pe: ring, link-uri active, butoane
"brand" (e.g. portal client). NU pe: status badges, destructive, errors.

---

## 3. Typography

### 3.1 Font stack

Toate platformele: stack system-ui pentru a evita FOUT și pentru a se simți
nativ pe macOS, Windows, Linux, iOS, Android.

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
             "Helvetica Neue", Arial, sans-serif;
```

Pentru numere, ID-uri, sume, telefoane, MAC adrese, hash-uri — mono stack:

```css
font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
font-variant-numeric: tabular-nums;
```

> Tabular numerals sunt deja folosite pe `CallCard` (`tabular-nums` pe
> counterparty + timestamp în `call-card.tsx:129-134`). Replică pattern-ul:
> orice listă de numere care se aliniază vertical primește `tabular-nums`.

### 3.2 Scala

Bazată pe Tailwind default. Nu inventa mărimi noi — dacă lipsește o mărime,
revizuiește layout-ul.

| Clasa Tailwind | Px | Folosit pentru |
|---|---|---|
| `text-xs` | 12px | timestamps, helper text, status badge label |
| `text-sm` | 14px | body principal, table cell, form input |
| `text-base` | 16px | empty state title, modal body |
| `text-lg` | 18px | section heading în card (rar) |
| `text-xl` | 20px | sub-page heading |
| `text-2xl` | 24px | `PageHeader` h1 (vezi `page-header.tsx:35`) |

Heading mai mari de 24px sunt rezervate pentru pagini publice (login,
register, marketing, pricing). În-app, 24px este maxim.

### 3.3 Greutăți

| Weight | Folosit pentru |
|---|---|
| `font-normal` (400) | body, descrieri |
| `font-medium` (500) | label de form, status badge text, action item |
| `font-semibold` (600) | `PageHeader` title, section heading, primary button |
| `font-bold` (700) | rezervat — folosit numai în empty state title sau marketing |

Nu folosi `font-light` (300) — la 14px arată anemic pe densitate compactă.

### 3.4 Line-height

| Clasa | Valoare | Folosit pentru |
|---|---|---|
| `leading-tight` | 1.2 | h1, h2 (Tailwind: `tracking-tight` cumulativ) |
| `leading-snug` | 1.375 | bubble transcript (vezi `call-card.tsx:295`) |
| `leading-normal` | 1.5 | body text default |
| `leading-relaxed` | 1.625 | sumar AI lung, copy marketing |

### 3.5 Romanian text considerations

- **Diacriticele se afișează** corect în system-ui pe toate platformele
  testate (verificat empiric pe macOS Safari/Chrome, Windows Edge, Android
  Chrome). Nu e nevoie de fallback.
- **`font-feature-settings: 'rlig' 1, 'calt' 1`** este setat global pe `body`
  în `styles.css:177` — activează contextual ligatures, util pentru "ț" + "i"
  în "ţi"-uri vechi (rar, dar gratuit).
- **Lungimea cuvintelor:** RO are cuvinte mai lungi decât EN ("Înregistrează"
  vs "Sign up"). Pe butoane, planifică lățime de 1.4× lățimea EN echivalentă.
  Pe sidebar, label-uri >18 caractere se trunchiază (vezi pattern din
  `AppShell.tsx`).
- **Search insensitiv la diacritice:** command palette face deja matching
  diacritic-insensitive (`startsWith > includes > keyword`, vezi `command-palette.tsx`).
  Aplicăm același pattern oriunde căutăm pe text RO.

---

## 4. Spacing & layout

### 4.1 Grid base

**4-pixel grid.** Toate paddingurile, margin-urile, gap-urile sunt multiple
de 4px (Tailwind `0.5` = 2px e excepție pentru detalii sub-pixel pe icon-uri).

Scala folosită:

| Tailwind | Px | Caz |
|---|---|---|
| `gap-1` | 4 | icon + label inline |
| `gap-2` | 8 | inline pills, action item |
| `gap-3` | 12 | toolbar items |
| `gap-4` | 16 | form fields |
| `gap-6` | 24 | secțiuni majore în card |
| `gap-8` | 32 | secțiuni majore în pagină |

### 4.2 Density scale

Implementat ca CSS custom property `--density-scale` (vezi `styles.css:69`).
Default `1` (comfortable), compact `0.875`. Driven de `useUiPreferencesStore`
care scrie `<html data-density="...">`.

Utilități care îl consumă (în `styles.css:312-316`):

- `.dense-px` — padding orizontal scalat
- `.dense-py` — padding vertical scalat
- `.dense-h` — înălțime row scalată
- `.dense-gap-y` — gap vertical scalat

> ⚠️ **Density NU multiplică font-size.** Fontul rămâne 14px / 12px indiferent
> de densitate — doar spațierea se schimbă. Asta e consistent cu Linear,
> Notion, GitHub — și e necesar pentru lizibilitate.

Cazuri tipice:
- **Compact:** preferat de contabili, ops, manageri care scanează 200 de
  rânduri pe ecran.
- **Comfortable:** preferat de salespeople, agenții care lucrează cu
  conversie one-by-one. Implicit.

### 4.3 Container widths

| Context | Max-width | Note |
|---|---|---|
| Conținut pagină în `<main>` | 1280px | wrap-uit pe ecrane mari, nu full-bleed |
| Sidebar | `w-64` (256px) | fix, nu se redimensionează |
| Topbar | full-width | sticky top, înălțime `h-14` (56px) |
| Modal default | `max-w-md` (448px) | form scurt |
| Modal mediu | `max-w-2xl` (672px) | form lung sau preview |
| Drawer | `w-72` mobile (288px) | slide-in din stânga |
| Detail page | full | tabs interne |

### 4.4 Card padding

Patternuri standard (NU bake-uite în `GlassCard` — vezi comentariu la
`glass-card.tsx:11-14`):

- **`p-6`** (24px) — standard, listă/dashboard cards
- **`p-4`** (16px) — tight, când densitatea e compactă sau cardul e mic
- **`p-8`** (32px) — modaluri primary, login forms
- **`p-3`** (12px) — sidebar group, internal pill containers

### 4.5 Sidebar layout

`AppShell.tsx:160-166`:
- Width: `w-64` desktop, `w-72` mobile drawer
- Sticky `top-0`, full height (`h-screen`)
- Padding `p-3` exterior + `glass-card` interior cu `overflow-hidden`
- Brand block + nav scroll independent

### 4.6 Topbar layout

- Sticky, glass-elev (more blur, more shadow than card)
- Înălțime `h-14` (56px)
- Conține: hamburger (mobile only) · search trigger (`⌘K`) · density
  toggle · theme toggle · notifications bell · user avatar
- Actions sunt dreapta, alinare `ml-auto`

---

## 5. Component primitives

Toate primitivele live în `apps/web/src/components/ui/`. Lista completă
existentă:

```
apps/web/src/components/ui/
├── InlineEditCell.tsx
├── OfflineBanner.tsx
├── QueryError.tsx
├── Skeleton.tsx
├── Toaster.tsx
├── button.tsx
├── call-card.tsx          ← differentiator
├── card.tsx
├── command-palette.tsx
├── detail-layout.tsx
├── glass-card.tsx
├── input.tsx
├── label.tsx
├── page-header.tsx        ← exports PageHeader, ListSurface, Toolbar, EmptyState, StatusBadge, BulkActionsBar
├── tabs.tsx
└── textarea.tsx
```

Nu inventa primitive noi fără cerere explicită. Dacă apare nevoia, adaug-o
aici și actualizează acest document.

### 5.1 GlassCard

**Sursă:** `apps/web/src/components/ui/glass-card.tsx`.

Primitiv pe care stă tot restul. Trei variante:

```tsx
<GlassCard className="p-6">…</GlassCard>                       // default
<GlassCard elevation="elevated" className="p-8">…</GlassCard>  // modal/popover
<GlassCard inset className="p-6">…</GlassCard>                 // top edge highlight
```

**Reguli de folosire:**
- Padding NU este built-in — adaugă-l inline (rule din comentariu, liniile
  11-14).
- `elevation="elevated"` doar pentru lucruri care plutesc deasupra altor
  glass cards (modal, popover, drawer interior).
- NU stiva mai mult de 2 nivele de glass — al treilea devine ilizibil.
  Dacă ai nevoie de un al treilea, schimbă tema la `contrast` pentru acel
  ecran sau aplică `bg-card` opac.

**`GlassPill`** — pill button în toolbar/sidebar, folosit cu `data-active="true"`
pentru selected state.

**`StatusDot`** — 8px coloured circle. Decorativ; pentru text + culoare
folosește `StatusBadge`.

### 5.2 PageHeader

**Sursă:** `apps/web/src/components/ui/page-header.tsx:31-45`.

```tsx
<PageHeader
  title="Companii"
  subtitle="Toate organizațiile cu care lucrezi."
  actions={
    <>
      <Button variant="outline">Export</Button>
      <Button>+ Companie nouă</Button>
    </>
  }
/>
```

- Title este `text-2xl font-semibold tracking-tight`.
- Subtitle este `text-sm text-muted-foreground` (14px gri-mediu).
- Actions slot acceptă orice — în practică 0-3 butoane.
- Pe mobile, layout-ul devine vertical (`flex-col sm:flex-row`).

**Regula 3 acțiuni primare:** vezi §15. Dacă ai nevoie de mai mult, grupează
în dropdown "Mai mult".

### 5.3 ListSurface

**Sursă:** `apps/web/src/components/ui/page-header.tsx:52-65`.

Wrapper glass pentru tabele și kanban. Aplică `overflow-hidden` ca tabelul
să respecte `border-radius`.

```tsx
<ListSurface>
  <Toolbar>…</Toolbar>
  <table>…</table>
  {empty && <EmptyState … />}
</ListSurface>
```

### 5.4 StatusBadge

**Sursă:** `page-header.tsx:117-153`.

Pill rotunjit cu text + tone. Cinci tonuri:

```tsx
<StatusBadge tone="neutral">Draft</StatusBadge>  // gri
<StatusBadge tone="blue">În curs</StatusBadge>   // info
<StatusBadge tone="green">Plătită</StatusBadge>  // success
<StatusBadge tone="amber">În așteptare</StatusBadge>  // warning
<StatusBadge tone="pink">Eșuat</StatusBadge>     // error / lost
```

Mapping-urile sunt în `TONE_CLASSES` (linia 125). Foreground + background
pe același ton, opacitate 15% pe background pentru contrast subtil.

### 5.5 Button

**Sursă:** `apps/web/src/components/ui/button.tsx`.

Variante (shadcn-style):

| Variant | Folosire |
|---|---|
| `default` (primary) | acțiunea principală a paginii — un singur primary per zonă |
| `secondary` | acțiuni secundare ne-destructive |
| `outline` | toolbar, export, filtre, "deselectează" |
| `ghost` | inline links, "× Anulează" în modal |
| `destructive` | delete confirmation, force-revoke, "Șterge definitiv" |
| `link` | rar — text-only, underline pe hover |

**Reguli:**
- Maxim **un singur `default` primary** vizibil într-un viewport.
- `destructive` apare DOAR în confirmation dialogs sau pe acțiuni cu
  consecințe ireversibile. Nu pentru "cancel form".
- Verbe imperative scurte: "Salvează", "Trimite", "Confirmă", "Anulează".
- Pe focus: ring 2px `--ring`, vizibil. Nu dezactiva `:focus-visible`.

### 5.6 Input

**Sursă:** `apps/web/src/components/ui/input.tsx` + `textarea.tsx`.

Tipuri suportate: `text`, `email`, `password`, `number`, `tel`, `url`,
`date`, `datetime-local`, `time`, `search`.

Pattern de form field:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="email">Email *</Label>
  <Input
    id="email"
    type="email"
    autoComplete="email"
    aria-invalid={!!errors.email}
    aria-describedby={errors.email ? "email-error" : "email-help"}
  />
  {errors.email ? (
    <p id="email-error" className="text-xs text-destructive">{errors.email}</p>
  ) : (
    <p id="email-help" className="text-xs text-muted-foreground">Folosit pentru notificări.</p>
  )}
</div>
```

- `*` după label = câmp obligatoriu (Romanian convention).
- Helper text default; eroarea îl înlocuiește când apare.
- `aria-invalid` + `aria-describedby` pentru screen readers.

### 5.7 EmptyState

**Sursă:** `page-header.tsx:95-110`.

```tsx
<EmptyState
  icon={Building2}
  title="Nu ai încă nicio companie"
  description="Adaugă prima companie ca să începi să urmărești contactele și deal-urile."
  action={<Button>+ Companie nouă</Button>}
/>
```

**Reguli:**
- Icon Lucide, 22px, fundal secondary cu rotunjire completă.
- Title: text-base font-medium — propoziție scurtă, fără punctuație.
- Description: text-sm muted, max 1-2 propoziții, terminând cu punct.
- Action: butonul care **rezolvă** lipsa datelor.

**Anti-pattern:** empty state cu mesaj "Nu există date" fără acțiune
(vezi UX-001 din QA report — `/app/tasks`, `/app/reminders`,
`/app/invoices`, `/app/projects` au empty state fără create button —
trebuie remediat, vezi §16).

### 5.8 DetailLayout, Tabs

**Sursă:** `apps/web/src/components/ui/detail-layout.tsx` + `tabs.tsx`.

Pattern detail page:

```tsx
<DetailLayout
  header={<PageHeader … />}
  sticky={<DetailActions … />}  // edit, delete, share
>
  <Tabs defaultValue="cronologie">
    <TabsList>
      <TabsTrigger value="cronologie">Cronologie</TabsTrigger>
      <TabsTrigger value="note">Note</TabsTrigger>
      <TabsTrigger value="apeluri">Apeluri</TabsTrigger>
      <TabsTrigger value="atasamente">Atașamente</TabsTrigger>
    </TabsList>
    <TabsContent value="cronologie">…</TabsContent>
    …
  </Tabs>
</DetailLayout>
```

**Convenție RO pentru taburi entități:**
- "Cronologie" (timeline activities)
- "Note"
- "Apeluri" (CallCard list)
- "Email-uri"
- "Task-uri"
- "Reminder-uri"
- "Atașamente"
- "Detalii" (custom fields, raw fields)
- "Audit" (activity log specific entității)

### 5.9 Modal vs Drawer

| Pattern | Folosire | Mărime tipică |
|---|---|---|
| **Modal** | confirmare destructive, form scurt (<5 câmpuri), preview rapid | `max-w-md` / `max-w-2xl` |
| **Drawer** | form lung (>5 câmpuri), edit deal/contact, preview document, timeline | full height, `w-[480px]` desktop |
| **Inline panel** | edit cu o singură valoare (status, owner, stage) | inline, fără overlay |

**Reguli:**
- Modal: blocator, fundal `bg-black/40 backdrop-blur-sm`, ESC închide.
- Drawer: din dreapta, fundal `bg-black/30`, ESC închide. Pentru mobile,
  full-screen.
- Niciodată modal-in-modal. Dacă apare nevoia, refactorizează la wizard.

### 5.10 CommandPalette

**Sursă:** `apps/web/src/components/ui/command-palette.tsx`.

Diferentiator UX. Trigger: `⌘K` / `Ctrl+K` global, sau `/` oriunde în afara
form-urilor (`AppShell.tsx:104-122`).

Două secțiuni:
1. **Navigare** — 37 link-uri, ranking diacritic-insensitive
   (`startsWith > includes > keyword`).
2. **Căutare globală** — debounced 220ms hit pe `/ai/search`.

Tastatură:
- ↑ / ↓ wraps
- Enter execută
- Esc închide

Toate paginile care caută trebuie să respecte același pattern — nu inventa
shortcut-uri specifice pentru o singură pagină.

### 5.11 InlineEditCell

**Sursă:** `apps/web/src/components/ui/InlineEditCell.tsx`.

Folosit pe tabele pentru câmpuri "una-pe-rând" (industrie companii, status
deal). Click pe celulă → input apare → blur sau Enter salvează → toast
confirmă.

Vezi §10 pentru reguli mai detaliate despre când inline edit vs modal.

---

## 6. Information architecture

### 6.1 Sidebar — 9 grupuri

Definiția canonică e în `AppShell.tsx:248-345`. Grupurile:

| # | Grup | Conținut | Cine vede |
|---|---|---|---|
| 1 | **Lucru** | Dashboard, Task-uri, Reminder-uri, Calendar, Notificări | toți |
| 2 | **Clienți** | Companii, Contacte, Clienți (B2C), Leads, Segmente | toți |
| 3 | **Vânzări** | Pipeline, Prognoze, Oferte, Comenzi, Contracte, Abonamente, Comisioane, Teritorii | toți |
| 4 | **Service** | Tichete suport, Aprobări | toți |
| 5 | **Marketing** | Campanii, Secvențe email, Evenimente | toți |
| 6 | **Operațional** | Facturi, Proiecte, Produse | toți |
| 7 | **Insights** | Rapoarte, Automatizări, Jurnal audit | toți |
| 8 | **Administrare** | Utilizatori, Câmpuri custom, Webhook-uri, Facturare, Setări email, Telefonie, Securitate (2FA) | OWNER + ADMIN |
| 9 | **Resurse** | Ajutor & tutoriale | toți |

**Reguli de adăugare:**
- Un feature nou trebuie să încapă în exact unul din aceste grupuri.
- Dacă pare că nu încape, întreabă-te dacă e cu adevărat nou sau e o
  extensie a unei pagini existente.
- Maxim 9 itemi într-un grup. Dacă depășești, sub-divide grupul (sau
  acceptă că grupul a devenit prea încărcat și trebuie split).
- Aspect (theme/density) NU este în sidebar — e accesibil prin UserMenu.
  Aceasta e intenția: setări personale ≠ navigare.

### 6.2 Page hierarchy

Trei nivele consistent peste tot:

```
List (e.g. /app/companies)
  └── Detail (e.g. /app/companies/:id)
        └── Tab content (Cronologie / Note / Apeluri / …)
```

NU adăuga al patrulea nivel (sub-detail page). Dacă apare nevoia, fă-l tab
sau drawer.

### 6.3 Dashboard structure

`/app` (dashboard) compune de sus în jos:

1. **AI Morning Brief** (`BriefStrip`) — 2-3 propoziții personalizate +
   3 priority actions. Refresh button. Vezi `STATUS.md:43-47`.
2. **KPI cards** — 4 tile-uri (deals open, MRR, calls today, tasks overdue),
   din `/reports/dashboard`.
3. **Activity feed** — ultimele 10 activități timeline-style cu user avatar.
4. **Quick actions** — 3 butoane: + Deal, + Contact, + Task.

Layout: 12-col grid, KPI cards `col-span-3`, brief `col-span-12`,
activity feed `col-span-8`, quick actions `col-span-4`.

### 6.4 Detail page pattern

Header sticky cu PageHeader + acțiuni primare (Edit / Marchează / Mai mult).
Sub el, tabs. Tabul activ persistă în URL (`?tab=cronologie`) ca să poți
share link.

```
┌────────────────────────────────────────────────────┐
│ ← Back                                             │
│ ACME SRL                              [Edit] [⋮]   │
│ companie · CIF RO12345 · creată 2026-03-12         │
├────────────────────────────────────────────────────┤
│ [Cronologie][Note][Apeluri][Email][Tasks][Detalii] │
├────────────────────────────────────────────────────┤
│ <tab content>                                      │
└────────────────────────────────────────────────────┘
```

---

## 7. Voice intelligence UX (differentiator)

Acesta e moat-ul produsului (vezi §3 din `docs/research/DIFFERENTIATION_STRATEGY.md`).
UX-ul trebuie să-l reflecte — voice nu e un add-on, e un cetățean de clasa
întâi în timeline.

### 7.1 CallCard primitive

**Sursă:** `apps/web/src/components/ui/call-card.tsx` (379 linii — citește
fișierul, nu reinventa).

Anatomie:

```
┌──────────────────────────────────────────────┐
│ ↗ +40712… — 4:32 — 2 oct, 14:31  [Finalizat] │ ← header
│ ─── waveform divider ─────────────────────── │
│ ✨ Sumar AI                                   │ ← AI hero
│   "Clientul a întrebat despre prețul…"        │
│   • Trimite oferta pentru 50 abonamente       │ ← action items
│     [→ Task]                                  │
│   • Setează reminder follow-up vineri         │
│     [→ Task]                                  │
│ ─────────────────────────────────────────── │
│ [▾ Transcript]              [→ Ofertă]        │ ← footer
└──────────────────────────────────────────────┘
```

Cardul se compune cu `<GlassCard className="overflow-hidden">` — toolbar-ul
ascuns de marginea cardului.

### 7.2 PII redacted ca pill negru

Server-ul (Presidio + regex stub) returnează texte cu marker
`[CNP_REDACTAT]`, `[IBAN_REDACTAT]`, `[EMAIL_REDACTAT]`, `[TELEFON_REDACTAT]`.
Funcția `renderRedactions()` (linia 313) le transformă în pills negre cu
text alb, uppercase mic.

**De ce negru:** semnalează vizual "aici a fost ceva sensibil care nu
trebuie expus". Negru ≠ status badge tone, deci nu există confuzie. Pentru
contrast theme, păstrăm negru — e singura culoare care comunică "redactat"
indiferent de fundal.

```tsx
<span className="mx-0.5 inline-block rounded bg-black px-1.5 py-0
                 text-[10px] font-medium uppercase tracking-wide text-white">
  CNP
</span>
```

NU schimba la `--destructive` (roșu) — redaction nu e o eroare. NU schimba
la `--muted` (gri) — nu se distinge suficient. Negru rămâne.

### 7.3 Action items ca checkbox-uri

Fiecare action item în array-ul `actionItems` (extras de Claude din
transcript) primește un checkbox vizual + buton "→ Task" inline care
prefill-ează un task form cu textul item-ului.

Vezi `call-card.tsx:181-209`. Pattern-ul de "AI extrage → user confirmă"
este recurent: nu auto-creem task-uri, lăsăm utilizatorul să confirme.

### 7.4 Transcript bubbles

Când utilizatorul face click pe "Transcript ▾", apare lista de segmente
ca chat bubbles:

- **Agent (stânga):** `bg-secondary text-foreground`, `rounded-bl-sm`
- **Customer (dreapta):** `bg-primary text-primary-foreground`,
  `rounded-br-sm`
- Timestamp `00:24` în mono `text-[10px] tabular-nums`
- Speaker chip "Agent" / "Client" / "Vorbitor"

Această asimetrie este intenționată: ecranul "vorbeste cu" agentul tău,
deci el e pe stânga (mai aproape), clientul e pe dreapta (interlocutor).

### 7.5 Listen / play

`onPlay` callback render-ează un play button în header. Inline player real
(scrub bar, viteză, download) este pentru o pagină viitoare "call detail
full-screen" — în timeline rămâne minimalist (un buton ▶).

### 7.6 Transcription status

Trei stări intermediare (când transcript nu e gata):

- `PENDING` → badge "Transcriere în așteptare" tone `neutral`
- `IN_PROGRESS` → badge "Se transcrie…" tone `neutral`
- `FAILED` → badge "Transcriere eșuată" tone `pink`

Când `COMPLETED` dar AI n-a extras nimic util, afișează:

> "Transcriere finalizată; AI nu a extras un sumar (apel scurt sau audio
> neclar)."

(Vezi `call-card.tsx:215-219`.) Aceasta e diferența între "produs onest"
și "produs care minte că a făcut ceva". Nu fabricăm sumar.

### 7.7 Onestitate față de utilizator

Per `STATUS.md:106-107`, Whisper este DEFAULT OFF și Presidio este NU
instalat în artifact-ul curent. Când nu sunt activate, transcript = stub.

În UI, această realitate trebuie să fie vizibilă:

- Dacă tenant-ul are `WHISPER_MODEL=off`, NU afișa CallCard cu transcript
  fals. Afișează: "Transcrierea automată nu este activată pentru tenantul
  tău. Contactează-ne ca s-o activăm." cu CTA "Activează".

NU minți utilizatorul cu un transcript stub. Politica ține de tonul
anti-sycophancy din CLAUDE.md.

---

## 8. Empty states & onboarding

### 8.1 First-tenant empty state

Pe primul login după register (de la `/register` — vezi `STATUS.md:50-52`),
dashboard-ul afișează un wizard scurt:

1. "Bun venit, {prenume}." (NU "Bună!")
2. "Începe prin a adăuga primul contact" — CTA care deschide modalul
   `/app/contacts/new`.
3. Sample data option discret: "Sau adaugă date demo (10 companii,
   25 contacte, 3 deal-uri)" — link mic gri sub CTA.

Wizard-ul dispare după prima entitate creată — NU re-apare la fiecare
sesiune (vezi UX-002 / UX-003 din QA report — banner-uri repetitive sunt
anti-pattern).

### 8.2 Per-list empty state

Fiecare list page **trebuie** să aibă empty state cu:

- Icon Lucide reprezentativ
- Title clar (max 30 chars)
- Description scurt (max 80 chars)
- **Action button cu CTA-ul care creează prima entitate**

Vezi `EmptyState` component — pattern este standardizat.

**Excepție acceptată:** `/app/audit` și `/app/notifications` — entități
read-only generate de sistem. Pentru ele, empty state spune doar:
"Nu există încă activitate înregistrată" fără CTA.

**Excepție problematică (de remediat — vezi §16):** `/app/tasks`,
`/app/reminders`, `/app/invoices`, `/app/projects` — derivate din parent
entities. Empty state actual spune "Mergi la un deal" care e prost UX.
Soluție: subject-picker modal care lansează din empty state.

### 8.3 Sample data

Pentru tenanți noi, oferim un seed cu date demo realiste românești:

- 10 companii (mix de SRL / SA / PFA)
- 25 contacte cu nume+telefoane RO valid
- 3 deal-uri în stadii diferite
- 1 ofertă, 1 factură (cu CIF demo)
- 1 apel cu transcript+sumar AI mock

Activabil din wizard sau din `/app/settings → Date demo`. Idempotent — nu
duplică dacă rulează de două ori. Marcat ca "demo" în field `tags` pentru
ștergere ușoară.

---

## 9. Forms & validation

### 9.1 Required vs optional

- **Obligatoriu:** `*` după label, helper text "Obligatoriu" pe focus.
- **Opțional:** label fără semn, fără helper.

Justificare: utilizatorii RO sunt obișnuiți cu `*` (folosit în formulare
guvernamentale, ANAF). Nu folosim "(opțional)" în paranteze — încarcă
formularul vizual.

### 9.2 Inline errors

Mesajul de eroare apare **sub input**, înlocuiește helper-ul, în
`text-destructive text-xs`.

**Tonul mesajelor:** "blame the system, not the user".

| Bun | Rău |
|---|---|
| "Email-ul nu pare valid. Verifică formatul." | "Email invalid!" |
| "Parola trebuie să aibă minim 12 caractere." | "Parolă prea scurtă, repară-o." |
| "Acest CIF există deja pentru altă companie." | "CIF duplicate!" |
| "Sesiunea a expirat. Re-autentifică-te." | "Missing bearer token" (BUG-002) |
| "Nu putem salva acum — încearcă din nou peste un minut." | "ERR_NET_FAILED" |

### 9.3 Submit states

Buton submit cu 4 stări:

| Stare | UI |
|---|---|
| `idle` | "Salvează" |
| `pending` | "Se salvează..." cu spinner integrat, butonul disabled |
| `success` | "Salvat ✓" tine 1.5s apoi închide modal / redirect |
| `error` | "Salvează" + banner roșu deasupra butonului cu mesajul concret |

Toast-ul redundant cu success in-form **nu** e necesar — confirmația vine
prin redirect / closed modal. Toast-ul e pentru background operations
(send email, generate PDF) unde user-ul a navigat altundeva.

### 9.4 Multi-step forms (wizard)

Pentru flow-uri >7 câmpuri (ex: register, ANAF e-Factura setup):

- Stepper sus: `1 ▶ 2 ▶ 3` cu titlu pe fiecare pas.
- Buton "Înapoi" și "Continuă" pe fiecare pas; "Finalizează" pe ultimul.
- Validate per-pas, NU global la final.
- State persistat în URL params sau local store ca user-ul să poată
  refresh pagina fără să piardă progresul.

Exemplu existent: `/register` (3 pași — companie, owner, plan).

---

## 10. Tables & data density

### 10.1 Inline edit vs modal

| Caz | Pattern |
|---|---|
| Schimbare unei singure valori (status, owner, stage, industry) | **Inline edit** prin `InlineEditCell` |
| Schimbare a 2-5 câmpuri | **Inline drawer** din dreapta cu form scurt |
| Schimbare a mai mult de 5 câmpuri sau cu validări complexe | **Modal full** sau pagină dedicată `/edit` |
| Bulk actions pe 2+ rânduri | **BulkActionsBar** sub toolbar |

Inline edit pattern verificat pe `/app/companies` (industrie editată inline,
PATCH 200) — vezi QA report rândul "Inline edit cell".

### 10.2 Row hover & selection

- Hover row: `bg-secondary/40` subtil — semnalează interactivitate.
- Click row (în zona ne-action): deschide detail page.
- Click pe checkbox first-col: selectează rând. Multi-select via
  Shift+Click.
- Selected row: `bg-primary/[0.04]` și border-left 2px primary.
- "Select all" în header sticky.

### 10.3 Bulk action bar

Apare sub Toolbar când count > 0. Pattern din `BulkActionsBar`:

```
┌──────────────────────────────────────────────┐
│ 7 selectate · deselectează │ [Export][Șterge] │
└──────────────────────────────────────────────┘
```

- Stânga: count + link "deselectează"
- Dreapta: max 4 acțiuni — restul în dropdown "Mai mult"
- "Șterge" e `variant="destructive"`, restul `outline`

### 10.4 Sticky headers & virtual scroll

- Header `<thead>` are `sticky top-0` cu `bg-card backdrop-blur` peste
  scroll.
- **Virtual scroll** (TanStack Virtual) când count > 100 rows. Pentru sub
  100, render natural — virtual scroll cu prea puține rows e overkill.
- Footer cu paginare cursor: "Anterior" / "Următoarele 50" — NU paginare
  numerică (cursor pagination, vezi `CLAUDE.md` API rules).

### 10.5 Saved Views

Pe orice list page (Companies, Contacts, Deals, Invoices etc.):

- Buton "Vizualizări" în toolbar (alături de Search).
- Click → dropdown cu views salvate ("Companii fără telefon", "Deal-uri
  închise luna asta", etc.) + "+ Salvează vederea curentă".
- Saved view = combinație de filtre + sort + columns (în URL params).
- Stocate per-user în `SavedView` table cu `tenantId` + `userId`.

---

## 11. Notifications & feedback

### 11.1 Toast

**Sursă:** `apps/web/src/components/ui/Toaster.tsx`.

- Poziție: top-right (consistent cu pattern-uri SaaS).
- Default duration: 4s. Acțiuni manuale (undo): 8s.
- Maxim 3 toast-uri stacked. Al 4-lea îl înlocuiește pe cel mai vechi.
- Variante: `success` (verde dot), `error` (pink dot + close manual),
  `info` (blue dot).
- Close button în colțul dreapta-sus ALWAYS — nu blocăm pe auto-dismiss.

**Anti-pattern:** toast pentru fiecare câmp salvat în inline edit. Folosește
in-cell confirmation (subtle dot + flash) pentru high-frequency actions.

### 11.2 Banner

Pentru erori la nivel de pagină (auth expirat, conexiune offline, tenant
suspendat):

- Sticky deasupra topbar
- Background `bg-destructive/10` + border-left 2px `border-destructive`
- Text `text-destructive-foreground` cu mesaj concret + acțiune ("Re-autentifică-te")
- `OfflineBanner` (`apps/web/src/components/ui/OfflineBanner.tsx`) e
  exemplul real — apare când `navigator.onLine === false`.

### 11.3 Inline confirmation

Pentru save success într-un câmp inline edit:

- Dot verde 6px lângă valoare, fade-out după 1.2s.
- Eventual border-bottom flash pe input (200ms verde → 200ms transparent).

NU toast pentru fiecare cell save — too noisy.

### 11.4 Notifications dropdown peek

**Sursă:** `apps/web/src/components/layout/NotificationsBell.tsx`.

Click pe icon Bell în topbar → dropdown cu:

- Header: "Notificări" + link "Marchează toate ca citite"
- Listă (max 5 cele mai recente) cu avatar + mesaj scurt + timestamp relativ
- Footer: link "Vezi toate notificările" → navigează la `/app/notifications`

Page `/app/notifications` are tab-uri: Toate / Necitite + filtre + bulk
mark-read.

> ⚠️ **Status real (din QA report):** dropdown peek-ul EXISTĂ (vezi rândul
> "Notifications bell — Dropdown peek + link `Vezi toate`"). Totuși,
> sidebar-ul are item separat `/app/notifications` care duplică intrarea.
> Verifică în S20 dacă păstrăm ambele sau eliminăm sidebar entry —
> redundanța nu e gravă, dar e ne-economică.

---

## 12. Accessibility

### 12.1 Standardul țintă

**WCAG 2.1 AA minimum.** Tot ce e shipped trebuie să treacă AA. Pentru
componente critice (login, register, plata), țintim AAA dacă efortul e
rezonabil.

| Verificare | Țintă |
|---|---|
| Contrast text normal | ≥ 4.5:1 |
| Contrast text mare (≥18px sau ≥14px bold) | ≥ 3:1 |
| Contrast UI components / borders | ≥ 3:1 |
| Touch target | ≥ 24×24 CSS px (verificat în `styles.css:233-237`) |
| Form labels | toate input-urile au `<label htmlFor>` sau `aria-label` |

### 12.2 Keyboard navigation

`⌘K` palette este modul **principal** de navigare. Restul:

| Tastă | Acțiune |
|---|---|
| `⌘K` / `Ctrl+K` | Deschide command palette |
| `/` | Same (când nu ești într-un input) |
| `Tab` | Next focusable |
| `Shift+Tab` | Prev focusable |
| `Esc` | Închide modal/drawer/palette |
| `Enter` | Submit form / activează item selectat |
| `↑` / `↓` | Navighează listă în palette / dropdown |

**Rule:** orice acțiune accesibilă cu mouse trebuie să fie accesibilă cu
tastatura. Nu există drag-only (drag-and-drop pe Kanban are paralel
keyboard: focus card → `Space` lift → ↑↓ move → `Space` drop).

### 12.3 Focus rings

- **Niciodată** `outline: none` fără înlocuire.
- Default focus-visible ring: `ring-2 ring-ring ring-offset-2 ring-offset-background`.
- Pe glass surfaces, ring-offset garantează vizibilitate.

### 12.4 Screen reader labels

- Icon-only buttons: `aria-label="Închide meniul"` (vezi `AppShell.tsx:186`).
- Decorative icons: `aria-hidden="true"`.
- Status badges: text vizibil (NU emoji-only).
- Live regions pentru toast: `role="status"` + `aria-live="polite"`.
- Toolbar groups: `role="toolbar"` cu `aria-label`.

### 12.5 Reduced motion

Respectăm `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Tour overlays (driver.js) se dezactivează automat când reduced motion e
preferat.

---

## 13. Motion & micro-interactions

### 13.1 Tranziții standard

| Eveniment | Durată | Easing |
|---|---|---|
| Hover background | 150ms | `ease-out` |
| Hover scale (icon-only buttons) | 150ms | `ease-out`, max scale `1.05` |
| State change (selected, expanded) | 200ms | `ease-out` |
| Modal/drawer open | 250ms | `cubic-bezier(0.16, 1, 0.3, 1)` (slight overshoot) |
| Toast slide-in | 220ms | `ease-out` |
| Page transition | nu — folosim `<Suspense>` skeleton, nu cross-fade |

**Reguli:**
- Niciodată tranziții > 300ms pentru UI funcțional. Senzație de "lent".
- `transform` și `opacity` sunt OK; `width` / `height` doar dacă măsurate.
- NU face animation-loop infinit pe ceva care nu e activ (loading spinner OK,
  pulse pe un avatar idle NU OK).

### 13.2 Loading states

**Hierarchy:** skeleton > spinner > progress bar.

- **Skeleton** (`apps/web/src/components/ui/Skeleton.tsx`): folosit pentru
  list pages, detail pages, dashboard cards. Match approximat layout-ul
  final ca să nu sară pagina la hidratare.
- **Spinner**: doar pentru button submit pending sau pentru zone mici
  (<60×60).
- **Progress bar**: pentru upload-uri MinIO (presigned PUT) — măsurabil real,
  nu fake.

### 13.3 Tour overlays (driver.js)

Pentru onboarding contextual:

- **First-visit only** per pagină (verifică flag în localStorage `tour:{path}`).
- Tour dimissed → flag set → nu mai apare.
- **Niciodată peste empty state** (vezi UX-003 — anti-pattern). Dacă pagina
  e goală, empty state-ul are deja propriul CTA — tour-ul ar fi redundant.
- 5 pași max per tour. Mai mult înseamnă pagina e prea complicată.
- Buton "Skip tour" întotdeauna vizibil în colțul dreapta-jos.
- "Re-vezi tour-ul" în `/app/help` (există deja — vezi QA report rând 37).

---

## 14. North-star references

Pe ce-i copiem și ce facem mai bine:

### 14.1 Linear

**Învățăm:** keyboard-first navigation. `⌘K` palette ca singur entry-point
sufuc pentru navigare. Shortcuts pentru fiecare acțiune.

**Diferențe:** ei sunt issue tracker, noi suntem CRM. Densitatea lor ne
inspiră, dar tabelele noastre au coloane mai variate.

### 14.2 Attio

**Învățăm:** modern table UX. Inline edit fără modal pentru orice câmp.
Colormat owner avatars. Quick filter chips deasupra tabelului.

**Diferențe:** ei sunt design-forward dar fără voice intelligence. Noi
amăsturăm voice ca cetățean de clasa întâi în timeline.

### 14.3 Pipedrive

**Învățăm:** pipeline-first simplicity. Kanban-ul e prima cosa pe care o
vezi când intri. Pipeline visualization clară, drag-drop natural.

**Diferențe:** ei sunt ramași în 2018 vizual. Noi avem glass + dark theme +
density toggle.

### 14.4 SmartBill

**Învățăm:** RO market expectations pentru invoice flow. ANAF e-Factura
e UX-ul lor central — noi îl facem nativ în CRM, nu opțiune separată.

**Diferențe:** ei sunt facturare-out (CRM e secundar). Noi suntem CRM-in
cu facturare nativă.

### 14.5 Ce facem mai bine decât toți

1. **Voice intelligence priced like CRM, not like Gong.** CallCard primitive
   inline în timeline. Vezi §7 din `docs/research/DIFFERENTIATION_STRATEGY.md`.
2. **Multi-tenant defense in depth visibil în architecture-as-evidence.**
   3 layers: ALS + Prisma extension + Postgres RLS. `/cso` audit verificat
   2026-04-28. Linkăm la commit-uri în marketing.
3. **ANAF e-Factura nativ.** UBL 2.1 / CIUS-RO XML emis direct din invoice
   service, nu printr-un connector terț. Vezi
   `apps/api/src/modules/anaf/anaf.service.ts:198-268`.
4. **Romanian-first product, not localized.** Built-in RO, nu Crowdin
   layer over EN. Vezi §4 din `docs/research/DIFFERENTIATION_STRATEGY.md`.

Aceste 4 sunt poziționarea — design-ul trebuie să le reflecte. Voice cards
nu sunt ascunse într-un tab "Calls" — ele sunt parte din timeline-ul
contactului.

---

## 15. Anti-patterns

Lucruri pe care le-am văzut sau le-am scris și NU le mai facem.

### 15.1 Tone & copy

- **Fără mascote prietenoase.** Niciun "Bună!", "Hi there!", "Salut, noi
  suntem AMASS!", "Mulțumim că ești cu noi!".
- **Fără emoji în UI text.** Niciun "🎉 Felicitări!", "🔥 Vânzare nouă!".
  Iconurile Lucide sunt suficient.
- **Fără "Sper că asta ajută!" / "Voi încerca cu plăcere!"** (regula
  CLAUDE.md mod operațional anti-sycophancy).
- **Fără padding emoțional** la confirmări: "Companie creată." nu
  "Super! Felicitări că ai creat prima companie!".

### 15.2 Mesaje de eroare

- **Niciodată leak tehnic.** "Missing bearer token" → "Sesiunea a expirat.
  Re-autentifică-te." (BUG-002 — de remediat, vezi §16).
- **Niciodată trace ID-uri în UI.** Mergem cu mesaj user-friendly + buton
  "Copiază ID-ul incidentului" pentru support.
- **Niciodată "Try again later"** fără context. Spunem "Nu putem salva
  acum — server-ul răspunde lent. Date-le tale sunt în siguranță, încearcă
  din nou peste un minut."

### 15.3 UX

- **Tour overlays peste empty state.** Anti-pattern actual (UX-003) — de
  remediat. Tour-ul presupune că există ceva de explicat; pe empty state
  CTA-ul lui empty state este suficient.
- **Cookie banner re-apare la fiecare pagină.** Anti-pattern actual
  (UX-002) — de remediat. Consent salvat în `localStorage` cu cheie clară
  (`amass-cookie-consent-v1`).
- **Mai mult de 3 acțiuni primare per pagină.** Dacă ai 4-5 acțiuni
  importante, una nu e importantă. Grupează în "Mai mult".
- **Label-uri >30 caractere.** Trunchiază sau redenumește. Sidebar-ul pe
  mobile sare la wrap urât.
- **Form-uri lungi fără secțiuni.** Peste 8 câmpuri → wizard sau secțiuni
  cu titluri.
- **Status badge fără text** (doar dot). Use `StatusDot` pentru decorativ;
  oriunde transmite informație, folosește `StatusBadge` cu text.

### 15.4 Glass overuse

- **3+ glass surfaces stivate** devine ilizibil. Maxim 2 nivele.
- **Glass peste imagine cu contrast înalt** (avatar fundal etc.) creează
  haos vizual. Folosește `bg-card` opac în acel context.
- **Glass în contrast theme.** Theme-ul `contrast` are `--surface-alpha: 1`
  și `--surface-blur: 0px` — NU adăuga blur "decorativ" peste.

### 15.5 Component anti-patterns

- **Modal-in-modal.** Niciodată. Refactorizează la wizard sau drawer.
- **Inline edit pentru câmpuri cu validare complexă.** Folosește drawer.
  CIF cu validare ANAF NU e inline-edit-friendly.
- **Toast pentru fiecare cell save.** In-cell confirmation (dot flash) e
  suficient.
- **Skeleton mismatching real layout.** Skeleton-ul trebuie să aibă
  aceeași înălțime cu layout-ul real, altfel pagina sare la hidratare.

---

## 16. Implementation roadmap

Priorități pentru sprint-urile imediate, ordonate după impact. Toate
referențiate la QA report
(`.gstack/qa-reports/REAL/FINAL-REAL-REPORT.md`).

### P0 — Bloketori de launch

1. **BUG-001: Salvează la `/app/companies` create modal este no-op.**
   Root cause în `apps/web/src/routes/companies.tsx` (probabil RHF
   resolver fail silent). Comparație cu `/app/contacts` (funcționează)
   pentru diff. **Fix înainte de orice altceva** — utilizatorul nu poate
   crea prima companie.
2. **BUG-002: "Missing bearer token" leak.** API exception filter
   trebuie să mapeze 401 la `{code: "AUTH_EXPIRED", message: "Sesiunea a
   expirat. Re-autentifică-te."}` (sau echivalent localizat). FE: ascunde
   mesajul tehnic pe transient 401-uri când refresh-ul are succes.
3. **BUG-003: Strict-auth rate limit 5/min prea agresiv.** Bump la 30/min
   sau exclude `/auth/refresh` din strict-auth. Plus: NU rate-limit
   `/health` deloc.

### P1 — UX gaps importante

4. **UX-001: 4 list pages fără create button.** Adaugă subject-picker modal
   pe `/app/tasks`, `/app/reminders`, `/app/invoices`, `/app/projects`.
   Pattern: click "+ Task nou" → modal cu select "Asociază cu companie /
   contact / deal" + form fields. Salvează cu subjectType + subjectId.
5. **UX-004: "Setări cont" în UserMenu duce la `/app/settings/2fa`.**
   Creează pagină dedicată `/app/settings/profile` cu nume, email, schimbă
   parolă, link la 2FA, link la sesiuni active. UserMenu point-uiește la
   `/profile`.
6. **UX-002: Cookie banner persist.** Verifică unde se salvează choice —
   probabil sessionStorage în loc de localStorage. Fix: localStorage cu
   cheie versionată `amass-cookie-consent-v1`. Plus server-side proof:
   POST `/auth/cookie-consent` care logghează în `CookieConsent` table
   (tenantId + userId + ip + userAgent + timestamp + choice JSON).
7. **Granular cookie consent tiers.** Banner curent e binary (Accept/Deny).
   Înlocuiește cu modal cu 3 toggle-uri: Funcționale (always on),
   Analitice (default off), Marketing (default off). Persistă fiecare
   alegere separat.

### P2 — Polish

8. **Tour first-visit-only — documentat.** Implementarea pare să fie
   corectă (flag per-pagină în localStorage). Verifică pe rute reale și
   documentează în `docs/UNFINISHED.md` dacă mai are bug-uri.
9. **Empty state pentru `/app/audit` când nu există entries.** Curent
   afișează tabel gol; trebuie EmptyState cu mesaj "Jurnalul de audit e
   gol — nicio acțiune înregistrată încă."
10. **Mobile audit.** Sidebar collapse OK (hamburger drawer există). De
    verificat: dialog-uri sizing pe < 640px, table horizontal scroll, glass
    cards padding-ul potrivit. Folosește `/qa` pe mobile viewport.
11. **Dark theme contrast audit.** BLUE3 a semnalat. Rulează contrast
    checker pe toate combinațiile token în dark theme. Atenție specială
    la `--muted-foreground` pe `--card` și `--secondary`.

### P3 — Differentiator polish (post-launch sprint)

12. **CallCard real waveform.** Decorativ acum (40 bare hardcoded). Înlocuiește
    cu real waveform extras din audio (lucru pentru AI worker — Python deja
    are librarii audio).
13. **Listen inline player.** Curent e doar buton ▶ care trigger-ează
    `onPlay` callback. Pentru detail page, scrub bar full + viteza
    (1× / 1.25× / 1.5×) + download recording (presigned MinIO).
14. **Action items → bulk Task creation.** Curent fiecare action item are
    "→ Task". Adaugă "Creează toate ca task-uri" în footer-ul AI block.
15. **Voice search în CommandPalette.** Push-to-talk pe `⌘K` deschis,
    transcribe în RO, caută. Diferentiator suplimentar.

### P4 — Roadmap viziune (S21+)

- **Tenant theme builder UI.** Acum tenantul își poate seta `--accent-tenant`
  custom HEX, dar nu și logo, nu și override-uri pe specific tokens. Adaugă
  pagină `/app/settings/branding` cu logo upload + accent + density default
  pentru tenant.
- **Saved Views shared.** Acum saved views sunt per-user. Adaugă opțiunea
  "Vizibilă pentru toată echipa" → tenant-wide saved view.
- **Bulk import wizard.** GestCom importer există backend, dar UI-ul e
  rudimentar. Wizard de 4 pași: upload CSV → map columns → preview → import.

---

## Appendices

### A. Referințe code

| Concept | Path |
|---|---|
| CSS tokens | `apps/web/src/styles.css` |
| UI prefs store | `apps/web/src/stores/ui-preferences.ts` |
| GlassCard primitive | `apps/web/src/components/ui/glass-card.tsx` |
| PageHeader + ListSurface + EmptyState + StatusBadge | `apps/web/src/components/ui/page-header.tsx` |
| CallCard primitive | `apps/web/src/components/ui/call-card.tsx` |
| AppShell sidebar grouping | `apps/web/src/components/layout/AppShell.tsx:248-345` |
| Settings appearance page | `apps/web/src/routes/settings.appearance.tsx` |
| Command palette | `apps/web/src/components/ui/command-palette.tsx` |
| Inline edit cell | `apps/web/src/components/ui/InlineEditCell.tsx` |
| Notifications bell | `apps/web/src/components/layout/NotificationsBell.tsx` |
| Tabs primitive | `apps/web/src/components/ui/tabs.tsx` |
| Detail layout | `apps/web/src/components/ui/detail-layout.tsx` |
| Toaster | `apps/web/src/components/ui/Toaster.tsx` |
| Offline banner | `apps/web/src/components/ui/OfflineBanner.tsx` |
| Skeleton | `apps/web/src/components/ui/Skeleton.tsx` |

### B. Documente conexe

- `CLAUDE.md` — reguli proiect + tone anti-sycophancy
- `STATUS.md` — ce e shipped real
- `docs/research/DIFFERENTIATION_STRATEGY.md` — poziționare strategică
- `docs/SCALING.md` — primitives wired (multi-tenancy, scaling)
- `.gstack/qa-reports/REAL/FINAL-REAL-REPORT.md` — UX state cu evidence
- `LAUNCH_CHECKLIST.md` — verificări pre-launch
- `docs/UNFINISHED.md` — known gaps

### C. Versionare

- **1.0 (2026-04-30):** versiune inițială canonică, sincronizată cu codebase
  după sprint design v2 (frosted glass) finalizat 2026-04-27.

Următoarea revizuire: după primii 10 utilizatori reali, integrăm feedback-ul
într-o versiune 1.1.

---

*Sfârșit DESIGN.md. Pentru întrebări sau propuneri, deschide PR cu modificarea
și acest doc actualizat.*
