# Brief S2-05: Integration tab (connect barsy, choose venue and catalogue, sync, run history)

- **Model:** Sonnet 5.5. **Branch:** your worktree branch from `s2/composer`, after S2-03b is merged.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → D41, D50 (P38), D55, D56, P52, the Stage 2 engineering notes, and acceptance criteria 1–2 in the Stage 2 plan (D55);
  - `docs/architecture/data-architecture.md` → "Onboarding steps";
  - `docs/platform-reference.md` (Settings pages → `Components/FormSection.jsx`; tables; empty states);
  - `packages/core/src/seal/*` (`sealBarsyCredentials`), `packages/core/src/apply/*` (S2-03b's integration, barsy-venue and job-run writers), `packages/core/src/jobs.ts`;
  - `apps/web/src/server/jobs.ts` (`enqueueJob`);
  - `packages/db/src/schema.ts` (`integrations`, `barsy_venues`, `job_runs`);
  - the existing venue workspace (`app/(admin)/venues/[venueId]/page.tsx`, `components/admin/workspace-tab-defs.ts`) and the composer's patterns: server component for reads, server actions for writes (U4).

## Goal
The venue's **Integration** tab replaces today's placeholder. A manager connects the venue to barsy, picks the barsy venue and catalogue root, presses "Sync now", and follows the runs. This is acceptance criteria 1–2 of Stage 2.

## Do
1. **Connect card** (form: host, API user, password).
   - Host: an `https:` URL. The web checks the format only; the worker enforces the allowed hosts.
   - Saving is a server action:
     - Zod-check the input.
     - Seal `{user, password}` with `SEAL_PUBLIC_KEY`. Declare it in the web env schema; the private key must never appear there (an S2-03a test guards this).
     - Write the integration (create, or update host and credentials) through the writers.
     - Enqueue `barsy-connect`.
   - The password never comes back to the browser, is never logged, and is never put in a result or error. After a save the form shows "Credentials saved", with a "Change credentials" action that asks for both values again.
   - Changing the host requires the credentials again: they are sealed for the host.
   - If the web has no `SEAL_PUBLIC_KEY`, the card explains that the operator must set up the sync keys (no stack trace).
2. **Status card.**
   - Shows `new` / `connected` / `error` with `status_detail` and `last_checked_at` (venue time zone).
   - While a connect or pull job is queued or running, refresh about every 3 s (router refresh or an action), and stop once it finishes.
3. **barsy venue picker.** List the integration's `barsy_venues` (cached by `barsy-connect`) by name. Choosing one maps it to *this* venue (`barsy_venues.venue_id`). One barsy venue per venue and one venue per barsy venue; a conflict is a clear error. Never show a `bid` in the UI.
4. **Catalogue root picker.**
   - A tree of the cached public category tree (names from `cat_name_public_ml`, else `cat_name_public`) with a single choice. Show each category's child count; no article fetching.
   - The choice is stored in `barsy_venues.catalogue_root_cat_id`.
   - Explain in one line why it matters: one barsy installation can hold several menus (D56).
5. **Mapping settings** (integration `config`):
   - price source: `actual_price` (default) or `current_price`. P52 is open, so show both with a one-line explanation each and keep the default;
   - the allergen characteristic: auto-detected "Алергени" / "Allergens", changeable from the cached details tree;
   - default locale.
   - Saved through the writer; takes effect on the next pull.
6. **"Sync now"** enqueues `barsy-full-pull` for this venue. It is disabled, with the reason, until connected and both pickers are set, and also while a pull is queued or running (singleton).
7. **Run history.**
   - The latest 20 `job_runs` of this integration, newest first: kind, started (venue time), duration, status.
   - Counters: seen, created, updated, unchanged, missing, deleted, reactivated, failed pages, refused writes. Show "deletion check skipped" when it was.
   - A row expands to the error summary and the refused writes (field and reason; no barsy ids beyond what `job_runs` stores).
   - Empty state: "No sync yet".
8. **Permissions.** Only the organisation's owner or admin can connect, change credentials or settings, or press Sync now. Others see a read-only status and history. Use the existing session and tenant helpers.
9. **i18n:** every string in BG + EN (`integration.*`). The new BG strings go on Martin's review list (T44).

## Tests
- **Unit:**
  - the save action seals with the public key, and the result and logs never contain the password (spy on the logger);
  - host-change rules;
  - picker conflicts;
  - Sync-now gating.
- **Component tests** for each card.
- **DB integration:** writes through the writers under RLS, and another tenant's integration is invisible.
- **Playwright**, with a test key pair generated in global setup into a temp env, and the worker not running:
  - fill the form → "Credentials saved" and status `new`;
  - simulate the worker by writing status `connected`, the venues and the cached tree through the writers in the test setup → pick the venue and root → Sync now is enabled → pressing it queues a job (check the `pgboss` job row) → a seeded `job_runs` row shows in the history with its counters.
- **Screenshots:** BG/EN, light/dark, mobile, saved to `E:\Restro\.local\screenshots\s2\s2-05-*.png`.

## Done when
The full gate passes with DB tests (`CI=true`), and the Playwright spec passes.

## Allowed dependencies
None new.

## Never / scope
- **Scope:** `apps/web/**`, plus small additions to the core writers if one is missing. Ask first if a writer's meaning would change.
- **barsy:** never call barsy from the web, and never import `@restro/barsy` or `@restro/core/seal-open`.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Local DB:** your own database on the running 54329 instance (CLAUDE.md "Database tests").
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`, with the Platform port table.
