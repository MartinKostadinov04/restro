# Brief CF-09a: the sidebar lists the venues; an organisation Settings area

- **Model:** Sonnet 5.5.
- **Branch:** create `cf/09a-navigation` from `sh/foundation` yourself.
- **Tasks and decisions:** T68; D73, D74 (read their full text in `docs/tracker.md` by number).
- **Runs in parallel with:** CF-16 (worker and sync data). Do not touch `apps/worker/**`, `packages/**` or `apps/web/src/server/integration/**`, `apps/web/src/integration/**`.

## Read first

1. `CLAUDE.md` and `docs/decisions.md`.
2. `apps/web/src/components/admin/{app-sidebar,venue-switcher,workspace-tab-defs,workspace-tabs,new-venue-dialog,user-menu}.tsx` and `apps/web/app/(admin)/layout.tsx`, `apps/web/app/(admin)/venues/page.tsx`, `apps/web/app/(admin)/venues/[venueId]/page.tsx`.
3. `apps/web/src/components/ui/sidebar.tsx` (the shadcn sidebar we use).
4. `docs/platform-reference.md`: only its sidebar / layout entries.

## What to build

### 1. The sidebar (D74)

Today the sidebar has one "Venues" item with the open venue's sections as a dropdown under it, and a venue switcher in the footer. Martin: the venues themselves belong in the sidebar; a venue's sections stay as the tabs at the top of its page, so nothing is shown twice.

- **Group "Venues"** (BG «Заведения»):
  - one item per venue of the organisation, sorted by name, the open one highlighted;
  - a venue item links to `/venues/<id>`, keeping the current `?tab=` when one venue is swapped for another;
  - an "All venues" item for the overview `/venues`;
  - a "New venue" item for owners and admins that opens the existing `NewVenueDialog` (CF-01); members do not see it;
  - in the collapsed (icon) sidebar each venue shows its initial with the name as tooltip;
  - many venues: the group scrolls with the sidebar; no limit.
- **Group "Organisation"** («Организация»): one item **Settings** («Настройки») → `/settings`.
- **Footer:** the user menu stays. The venue switcher goes (the venues are in the list now). If the person belongs to more than one organisation, keep an organisation switcher there (the organisation part of today's `VenueSwitcher`); with one organisation, show its name only.
- **Remove** the venue-section dropdown from the sidebar. The workspace tabs at the top of the venue page stay as they are, the Integration tab included (CF-09b moves it).

### 2. The organisation Settings area

- `apps/web/app/(admin)/settings/layout.tsx`: page title "Settings" and a short sub-navigation of the organisation's settings sections. Today one section: **Integrations** («Интеграции»). Build the sub-navigation from a small list so later sections (members, billing) are one line each.
- `/settings` redirects to `/settings/integrations`.
- `/settings/integrations`: heading and description only, plus a note that the connection is still set up in each venue's Integration tab until the move. CF-09b fills this page; keep it a server component and keep the layout's slot for its content.
- Everyone in the organisation may open Settings; who may change what is decided per section (CF-09b).
- Breadcrumbs (`admin-header.tsx`): "Settings › Integrations".

### 3. Words

BG and EN in `apps/web/messages/{bg,en}.json` (`nav.*`, `settings.*`). Bulgarian first-class; keep the wording plain.

## Tests

- Component tests: venue items and the active one, `?tab=` kept when switching, "New venue" only for owners and admins, the organisation switcher only with more than one organisation, collapsed tooltips.
- e2e: update any spec that relied on the venue dropdown or the footer venue switcher. Add `apps/web/e2e/navigation.spec.ts`: open a venue from the sidebar, switch to another venue on the same tab, open Settings → Integrations.
- Follow CLAUDE.md's two tiers: your own spec with `--reporter=line` while working; the full gate once at the end. DB tests on your own database `restro_cf_09a` (54329).

## Never / scope

- No change to the venue page's tabs, the integration screens or anything server-side outside `apps/web/app/(admin)/settings/**`.
- No new dependency. Guardrails only tighten (D67). Never read `.env.local`. Files LF.
- Commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.

## Report

CLAUDE.md format, at most one page, with one desktop and one collapsed-sidebar screenshot path (scratchpad).
