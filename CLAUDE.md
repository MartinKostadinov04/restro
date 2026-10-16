# Restro — rules for coding agents

Restro is a QR-to-phone menu and ordering web app for venues (pilot: Bulgarian nightclubs). A venue's menu comes from a POS through a connector (barsy today; Mistral next, D79) or is built by hand (D64). Martin Kostadinov is the product owner and does not read code; AI agents write all code. The lead agent writes briefs, reviews every diff and reports to Martin.

## Read before any task
Read only what your task needs: the big documents are for looking things up, not for reading whole (Martin 10-11: agents read too much).
1. Decisions are binding and each is a file: `docs/decisions/D<n>.md`. Read the ones your ticket names and any D-number cited in the code you change; `docs/decisions.md` is only the index of titles, for finding a number. For a task's full text, search `docs/tracker.md` for `T<n>.`; never read the whole tracker.
2. Your ticket (a GitHub issue) and the `docs/adjustments/` file it names; `docs/agent-briefs/` holds the briefs written before 10-16.
3. Only the sections of `docs/architecture/data-architecture.md` and `stack.md` your brief names. They mirror the live doc, which wins: https://claude.ai/code/artifact/2f2ab8b4-61ce-45a3-986b-bf675d8b472a.
4. `docs/platform-reference.md` and the Platform files your brief names (read-only, `C:\Platform`).
5. `GLOSSARY.md` whenever you name a domain concept (code names, interface text, reports): use its term.
6. **If you are the lead** (the session Martin talks to): `docs/agents/lead.md` before planning, briefing, starting agents or merging.

Fact precedence: official POS docs (barsy: docs.lukanet.com) > the architecture doc > the tracker.

## Scope right now
QR → phone only (D38). Current phase (D79): the platform's own functionality, data structure and UI on clean connector data, as planned in `docs/adjustments/adjustments_01.md`. The connector foundation (CF-05 to CF-08) and the Mistral connector are parked. No ordering, payment or webhook **backend** code until the tracker says so.

The guest template's service screens (bag, bill, call a waiter, pay, receipt) exist in the face (D71). Guests see them only once the platform supports them, and they follow D72: no local success.

## Three layers (keep them apart)
1. **Platform:** everything once the data is in our own model: venues, menus, composer, design, tables, publishing, the guest page. It knows no POS: no vendor name, no POS-specific field.
2. **Integration layer:** how any POS, or "by hand", plugs in: POS instances, a venue's source, sync scheduling, what a connector reports. It knows no specific POS.
3. **Connector:** one POS's API, fields and quirks (`packages/barsy` today). Its settings show only inside that system's tab or for its own venues.

**POS venue vs hand-made venue (D87, D89, D90, D92):**
- A venue's source is fixed when it's created.
- On a POS venue, Restro may hide, rename over the POS's text, reorder and move items between sections, add its own sections, and enrich. It never creates, deletes or re-prices items or sections that come from the POS.
- A hand-made venue has full control.

## The nine rules (non-negotiable)
1. **One write path.** Every change from every source goes through `core.apply(changeSet)`. Nothing else writes `field_values`, `events`, resolved documents or snapshots.
2. **Provenance.** Every stored value carries its layer, source and job (NOT NULL). `events` is append-only.
3. **POS ids stay in the backend.** Snapshots, the shell, faces and URLs carry only our prefixed ids (`nd_`, `as_`, `sn_`, `tb_`) and public fields: no POS ids, internal names, cost prices or internal fields. One exception (D75): when barsy has no public name for an item, option or category, its own name (`article_name`, `cat_name`) is shown and the composer warns.
4. **The shell reads only snapshots.** Guest pages never read the database; they read the published files (snapshot, live overlay, indexes) and the context.
5. **Our layers only make the menu more cautious than the POS.** We can hide or mark sold out; we can never un-hide, put back on sale, or change the price of an orderable item.
6. **Absence is deletion only after a complete full read.** A read with any failed page concludes nothing.
7. **Sync never writes into a POS.** `packages/barsy/write/` exports only calls on Martin's allowlist — currently **none**. No webhooks, no POS registration.
8. **Money is integer minor units** with the POS's rounding, through the `money` module only. barsy sends prices as JSON floats: parse losslessly, convert from the decimal string, round half-up. Never `x * 100`, never floats in storage.
9. **POS accounts:** one API user per connection per environment; staging config refuses production hosts; (later) one POS-registration owner and server-generated order uuids.

## Import boundaries (dependency-cruiser enforces them in CI)
- `packages/shell` and `packages/faces/*` never import `db`, a connector, `apps/*`, or anything with I/O.
- A face imports only its own package, `react`, `react-dom` and `@restro/shell` (not `@restro/core`, not `@restro/shell/testing` outside tests); guest pages never import a face's `/preview`, and only a face's `preview/` folder may use `@restro/shell/money`.
- Only `core/apply` imports the write side of `db`.
- Only `apps/worker` imports a connector package (`barsy`).
- Packages never import apps.

## Never
- Edit, branch or commit in `C:\Platform`.
- Call a POS from `apps/web`.
- Use the database owner role, `BYPASSRLS`, or disable RLS in app code.
- Delete rows from app code, except the three row kinds `apply()` removes as the action itself (`placements`, `field_values`, `source_links`) and Better Auth's session and verification rows. Erasing venue data, or anything in bulk, is only the purge job's, through its dedicated role `restro_purge` (D83).
- Enable or use the Supabase Data API / anon keys.
- Commit secrets or `.env*` files (only `.env.example`).
- Push to `main`, merge your own pull request, or deploy anywhere.
- Run migrations against staging or production from a local machine.
- Invent a POS method, parameter or behaviour its official docs don't state.
- Add a dependency your brief doesn't name.

## Stop and ask
Put the question in your report, with your recommendation, when: a rule or doc section is ambiguous or conflicts; a POS behaviour is undocumented; you need a new dependency or a schema change beyond your brief; a UX choice is unspecified; a test can only pass by weakening a rule. State unknowns as unknowns.

## Testing, and when a task is done
**Done** = `pnpm lint && pnpm typecheck && pnpm deps:check` pass, plus the tests of every package you touched (`pnpm vitest run --project <package dir> --reporter=dot`) and any Playwright spec you wrote or changed. CI runs the full gate on the pushed branch; the lead merges only when it is green.

While you work, run only the tests of what you touched, with quiet output:
- `pnpm vitest run --project <package dir> <paths> --reporter=dot`
- `pnpm --filter @restro/web run test:e2e e2e/<spec>.spec.ts --reporter=line` for a spec you wrote or changed (it builds first).

The full `pnpm test`, `pnpm build` and the whole Playwright suite are CI's job: one local round costs 10–15 minutes on this PC and slows the other agents. In reports, quote only failures.

- **Known slow tests:** `apps/worker/tests/worker.integration.test.ts`, `sync-queue.test.ts` and the composer keyboard reorder e2e can time out when the machine is busy (T75). Run a failing one alone once; if it passes alone, say so and move on.
- **Database tests** run only with `CI=true` and `DATABASE_URL`, `DATABASE_URL_OWNER` and `DATABASE_APP_PASSWORD` set (local values in `.env.example`). Reuse the running Postgres on 54329 (`pnpm db:local`, embedded, no Docker) with your own database name: create it, then `pnpm db:migrate` and `pnpm db:roles`. Leave running instances you did not start alone.
- **Migrations** (`pnpm db:generate` / `db:migrate` / `db:roles`) use the owner URL, local / CI only; a remote target needs `RESTRO_DB_ALLOW_REMOTE=1` and Martin's OK.
- **Always go through `pnpm`:** `use-node-version` pins Node 24.21.0, and bare `node` picks the system's Node 22.
- **Guardrails only tighten (D67).** A guardrail test, dependency rule or the vendor-word baseline (`scripts/vendor-words.baseline.json`) that blocks your task is a stop-and-ask, never something to weaken, delete or skip. Vendor names (barsy, Mistral…) belong only in a connector's own package, `packages/core/src/connectors/`, `apps/web/src/connectors/` and `apps/worker/src/connectors.ts` (`scripts/vendor-words.config.ts`); D83's purge role is the one approved exception. After removing vendor words, `pnpm vendor-words:baseline` lowers the baseline (it refuses to raise one).
- **Line endings:** files are LF. Editing from Python on Windows, open files with `newline=''`.
- **Sorting:** CI's Postgres sorts with `en_US`, the local one with `C`, so sort a SQL `order by` result and its JavaScript comparison the same way before comparing.

## Repository layout
```
apps/web            Next.js 16.4: venue admin (composer, Design tab, settings), guest phone shell with the
                    template registry (src/faces), small API (/t/[token], /api/events, /api/health)
apps/worker         Node 24 + pg-boss 12: POS read sync, resolve, publish, assets, backups, purge, health
packages/core       field types and canonical shapes (Zod), item schema ("template-as-data" in code), change
                    sets, apply(), resolver, validators, snapshot builder, money, theme
packages/shell      population rules R1–R15 → view model (pure), face manifest schema, services contract (D72),
                    contract-test harness (`@restro/shell/testing`)
packages/faces/*    phone faces = templates (D69): manifest + React components; default editorial-market (with a
                    `./preview` demo host for the admin); qr-phone = hidden test reference
packages/db         Drizzle schema, migrations, roles, RLS, tenant-scoped client (read / write split)
packages/barsy      the barsy connector: typed read client, mapping (versioned), fixture recorder
                    (`pnpm barsy:record`, credentials from `.env.local`), MSW handlers
docs/               tracker, decisions index, adjustments, architecture mirrors, agent briefs, runbooks, research
```

## Conventions
- **Next.js 16.4 is newer than your training data.** Before writing Next.js code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).
- **Workspace packages export TypeScript source,** with no build step (`README.md` → "Scaffold conventions"). Zod at every boundary (POS responses, change sets, snapshots, server-action inputs).
- **Data fetching (U4):** admin = server components for reads, server actions that call `apply()` for writes. Guest = static shell that reads published files from the CDN.
- **Templates (D69):** a face is added to `MANIFESTS` in `apps/web/src/faces/manifests.ts` and gets a loader in `apps/web/src/faces/registry.ts`. Server code reads `manifests.ts`; only client code imports `registry.ts`. Checklist: the designer guide's "A new template". `pnpm test:e2e` with `FACES_VISUAL=1` adds the templates' screenshot matrix (`apps/web/e2e/faces-visual.spec.ts`).
- **One field-type registry.** Each field type registers `{ schema, Display, Editor, DefinitionEditor }` once; components look a type up in the registry rather than switching over field types.
- **Layout is separate from the item schema.** Section membership and order are `placements` with fractional `sort_key`s.
- **i18n:** every interface string goes through next-intl (BG + EN) and names the POS with `{source}` (D82). Menu text comes from the document's `localized_text`.
- **Time:** always the venue's time zone and its service day (ends 07:00 by default), with date-fns + @date-fns/tz.
- **Ids:** opaque, prefixed by kind; never sequential integers in URLs.
- **Logs:** structured (pino), never personal data, never secrets.
- **Platform reference rule:** before building a UI or engine piece, read the matching Platform files in `docs/platform-reference.md`; port the pattern, apply the listed fixes, and say in your report what you ported and changed.
- **POS calls:** every method in a connector has a comment with the official doc URL (barsy: `https://docs.lukanet.com/barsy.api/methods/...`) and is checked against it before implementation.
- **Tests:** unit for pure logic, fast-check property tests for rules 5, 6 and 8, integration tests on Postgres for `apply()` and RLS, contract tests for every face.
- **Git:** a branch per task, `<stage>/<slug>` (e.g. `ad/01-menus`); conventional commit messages.

## Report format (final message of every agent task)
At most about one page (400 words). The diff shows the details; the report says what the lead cannot see in it.
1. **Branch and final commit.**
2. **What changed:** by area, one line each. List single files only where they matter (new files, migrations, guardrails, anything outside your brief).
3. **Ported from the Platform:** what was ported and what changed while porting, if anything.
4. **Test results:** the commands and pass/fail. Only failures in detail.
5. **Open questions,** each with a recommendation.
6. **Out-of-scope observations** worth a follow-up, one line each.

## Agent skills
New work starts with the `restro-flow` skill (lead only). Specs and tickets: GitHub Issues via `gh` (`docs/agents/issue-tracker.md`); triage labels: the five defaults (`docs/agents/triage-labels.md`). Domain docs: `GLOSSARY.md` for the language; decisions are D-numbers in `docs/decisions.md`, with no `docs/adr/` (`docs/agents/domain.md`).
