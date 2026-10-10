# Brief S1-05: venue admin shell (ported from the Platform), auth, i18n, field rows

- **Model:** Sonnet 5.5
- **Branch:** your worktree branch, based on `s1/ground` after S1-02 (core) and S1-03 (db) are merged
- **Read first:** `CLAUDE.md` (incl. the Next.js 16.4 docs rule); `docs/platform-reference.md` (whole); `docs/tracker.md` → D38, D44, D47, D49–D51, U1–U4, U9; `README.md` → "Scaffold conventions"; the `@restro/core` field-type exports (S1-02) and `@restro/db` client (S1-03)

## Goal
The venue admin's frame, so Stage 2 can drop the composer into it: sign-in, organisation = tenant, a sidebar shell with a venue switcher and breadcrumbs, a venue card grid, a venue workspace whose tabs live in the URL, the field-row + side-Sheet primitives driven by **one field-type registry**, and BG/EN interface text. It must look and feel like the Synex Platform's app (Martin's reference) with its listed flaws fixed.

## Platform files to port (read-only, `C:\Platform\resources\js\…`) — reuse code is allowed (D51), convert to TypeScript
| Restro piece | Port from | Fix (see platform-reference.md) |
|---|---|---|
| App shell | `Layouts/SidebarLayout.jsx` (134-224 nav, 226-277 team switcher, 279-332 user menu, 337-371 breadcrumbs) | Venue switcher (and organisation switcher only if the user belongs to several); one Toaster at the root; next-intl strings |
| Venue grid | `Pages/Sku/Index.jsx` 91-125 (schema cards) | Cards per venue: name, slug chip, languages, "Open" |
| Workspace tabs | `Pages/Passport/Internal/Partials/PassportEdit.jsx` 27-75, 157-179 | Declare tabs once (`{value, labelKey, icon, content}`); render TabsList on ≥ lg and Select below from the same list; `?tab=` via `useSearchParams` + `router.replace` (no setState during render) |
| Field rows | `Components/ValueField.jsx` 43-165 (5-col row, hover card with field key, category divider pill) | Values rendered by the registry, never a type switch; provenance badge slot (From barsy / Owned here / Overridden / Stale) |
| Field editors | `Components/DrawerInput.jsx` 108-305 | Side `Sheet` (shadcn) instead of bottom Drawer on desktop, Drawer on mobile; Cmd/Ctrl+Enter saves via a scoped key handler (no global window listener) |
| Status/empty | `Components/ui/badge.jsx` 18-22, `Components/ui/empty.jsx` | — |
| Settings layout | `Components/FormSection.jsx` | — |
| Look & feel | `components.json` (shadcn new-york, zinc), `tailwind.config.js` radius 0.5rem, Instrument Sans | Tailwind 4 + shadcn CSS variables as **semantic tokens** (light + dark, dark actually wired); a Cyrillic-capable self-hosted font via `next/font/local` or `next/font` with only the weights used (Instrument Sans has no Cyrillic — pick one that does, e.g. Inter, Manrope or Geist, and say which) |

## Done when
- [ ] **Auth:** Better Auth with email + password and the organization plugin; organisation id **is** the tenant id (`tn_` prefix via `advanced.database.generateId` using `@restro/core` `newId`), and creating an organisation also creates the `restro.tenants` row (organization hook, inside `withTenant`). Auth tables live in schema `restro` with an `auth_` table prefix, added through `packages/db`'s migration pipeline (new migration; follow S1-03's conventions; auth tables are not tenant-scoped but the app role must be able to use them). Sign-up is **off** in the UI (invite-only later); a local seed script `pnpm db:seed:dev` creates a demo organisation "Demo Club", a venue "Demo Club Sofia" (slug `demo-club`) and an owner user from `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` in `.env.local` (refuses to run unless `NODE_ENV=development` and the database host is localhost)
- [ ] **Routes:** `/login`; `/venues` (card grid); `/venues/[venueId]` workspace with tabs **Composer · Tables & QR · Publishing · Integration · Settings** (each an Empty state saying in BG/EN what arrives in which stage; Settings shows the venue's read-only settings: timezone, service day end, languages, currency); unauthenticated users are redirected to `/login`; a user only sees venues of the organisation they are in (the query goes through `withTenant` — RLS does the isolation)
- [ ] **Field registry (UI side):** `apps/web/src/fields/registry.tsx` maps **every** `FieldType` from `@restro/core` to `{ Display, Editor }` with `satisfies Record<FieldType, …>` so a missing type fails typecheck. Full editors for: short_text, long_text, localized_text (one tab per enabled locale), number, boolean, money (amount in major units → minor via core money), enum, enum_set (chips; allergens show the EU-14 labels in BG/EN), tags, measurement. The rest (date, datetime, range, image, file, availability, reference) get a Display plus an Editor that renders a disabled "Coming in Stage 2" notice
- [ ] **Field row + Sheet primitives:** `FieldRow` (label, value via registry Display, provenance badge, edit button) and `FieldEditorSheet` (registry Editor, react-hook-form + Zod using the core value schema, Cmd/Ctrl+Enter save, Esc cancel). In Stage 1 saving only updates local state — **no database writes** (writes arrive with `apply()` in Stage 2)
- [ ] **Dev preview page** `/dev/fields` (only when `NODE_ENV=development`): an item-like Sheet showing one `FieldRow` per field of the default template's Item node with sample values, so Martin can see every field type; screenshot it for the report (Playwright `page.screenshot` into the report folder, not committed)
- [ ] **i18n:** next-intl, BG default + EN, locale from a cookie switched in the user menu (no URL prefix in admin); every visible string in `messages/{bg,en}.json`; a test fails if the two files have different keys
- [ ] **Tests:** component tests (Vitest + Testing Library + jsdom) for the tabs↔URL sync, the registry exhaustiveness, money editor conversion; Playwright e2e on a local build with `pnpm db:local`: log in → venue grid → open venue → switch tabs (URL updates, reload keeps the tab) → switch language → log out
- [ ] `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass; e2e passes locally

## Binding facts from S1-02 (core) and S1-03 (db) — read their code before starting
- `@restro/db`: `createPool(url)` returns an opaque handle; `withTenant(pool, tenantId, fn)` is a **READ ONLY** transaction (RLS-scoped); `withSystem(pool, fn)` for system tables; `@restro/db/write` → `withTenantWrite(pool, tenantId, fn)`. The import rule allows `@restro/db/write` **only from `packages/core/src/apply/`**.
- Therefore tenant/venue creation goes through core: add `packages/core/src/apply/provision.ts` with `provisionTenant(pool, { tenantId, name })` and `provisionVenue(pool, tenantId, { name, slug, … })`, exported from a **new subpath `@restro/core/apply`** (never re-exported from `@restro/core`, so pure consumers like the shell never pull in `pg`). Integration-test both against local Postgres.
- Every table must be declared in `packages/db/src/table-access.ts` (tenancy + exact app-role privileges) or the RLS guard test fails. Auth tables: schema `restro`, prefix `auth_`, declared as system tables (not tenant-scoped) with the privileges Better Auth needs (no DELETE unless required — say which).
- Better Auth talks to Postgres through its own `pg` Pool on `DATABASE_URL` (the `restro_app` role) with Drizzle schema objects for the auth tables; it never uses the owner role.
- Ids: `newId('tn')` etc. from `@restro/core`; the db checks `tn_|vn_|tp_` + base62. Organisation id must be produced by `newId('tn')`.
- Local DB: `pnpm db:local`, then `pnpm db:migrate && pnpm db:roles` with `DATABASE_URL_OWNER` / `DATABASE_APP_PASSWORD` from `.env.example`. If port 54329 is already serving (another agent), use your own database name; stop only what you started.
- Log `error.cause` (Postgres message/code), never the Drizzle error message — it contains query parameters.

## Allowed dependencies
`better-auth`, `next-intl`, shadcn/ui via its CLI (and what it installs: Radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, `vaul`, `sonner`), `react-hook-form`, `@hookform/resolvers`, `zod` (already used), `@testing-library/react`, `@testing-library/user-event`, `jsdom`. Exact versions, ≥ 7 days old unless a security patch. Anything else → ask.

## Out of scope / never do
- No composer, no menu data, no `apply()`, no barsy, no guest pages, no venue-settings writes.
- Do not weaken RLS or add owner-role access for the app; Better Auth uses the app role.
- Do not edit CLAUDE.md, the tracker or architecture docs. Nothing from CLAUDE.md "Never". Commit on your branch only (end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).

## Stop and ask if
- Better Auth's organization plugin cannot use our id generator or table prefix/schema
- the auth tables need RLS decisions beyond "not tenant-scoped, app role may read/write"
- a Platform pattern conflicts with Next.js 16.4 conventions in the bundled docs

## Report back
CLAUDE.md report format, the Platform port table (what you took, what you changed), the font chosen and why, and the path of the `/dev/fields` and workspace screenshots.
