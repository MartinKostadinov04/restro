# Restro — rules for coding agents

Restro is a QR-to-phone menu and ordering web app for venues (pilot: Bulgarian nightclubs). Martin Kostadinov, the product owner, does not read code: AI agents write all of it, and the lead agent writes tickets, reviews every diff and reports to Martin.

## Read before any task
Read only what your task needs; the big documents are for looking things up (Martin 10-11).
1. **Decisions** are binding: `docs/decisions/D<n>.md`, indexed in `docs/decisions.md`. Read those your ticket names or the code you change cites; when one alone is unclear, use `revisit-decision`.
2. **Your ticket** (a GitHub issue) and the `docs/adjustments/` and `docs/deliverables/` files it names. For a T-number still open, search `docs/tracker.md` for `T<n>.`; never read it whole.
3. **Architecture:** only the sections of `docs/architecture/data-architecture.md` and `stack.md` your ticket names; the live doc they mirror wins: https://claude.ai/code/artifact/2f2ab8b4-61ce-45a3-986b-bf675d8b472a.
4. **Platform:** the Platform files your ticket names, through `docs/platform-reference.md` (read-only `C:\Platform`; port a pattern with its listed fixes).
5. **`GLOSSARY.md`** whenever you name a domain concept (code, interface text, reports): use its term.
6. **Folder rules:** in `apps/web`, `packages/faces`, `packages/db` or `packages/barsy`, that folder's `CLAUDE.md` applies too; database tests and migrations in any package follow `packages/db/CLAUDE.md`.
7. **The lead** (the session Martin talks to) starts every new request with `restro-flow` and reads `docs/agents/lead.md` before planning, writing tickets, starting agents or merging.

Fact precedence: official POS docs (barsy: docs.lukanet.com) > the architecture doc > the tracker.

## Scope right now
QR → phone only (D38). Current phase (D79): ordering from the menu is open (Martin 10-21, map #29). Part 1, ordering onto the table's bill and the Tonight screen, is built on the stage branch `or/foundation` from spec #64 and its tickets, against the simulated POS (`sim-pos`) until Mistral answers. Paying in the app (part 2) follows its own spec, with Stripe as the provider (D126, D125). Parked: the connector foundation (CF-05 to CF-08) and the Mistral connector (#48). Never: POS webhooks or POS-registration code (D41; a payment provider's notices are fine, D125), or any write to a live venue's POS (rule 7).

The guest template's service screens (bag, bill, call a waiter, pay, receipt) exist in the face (D71). Guests see them only once the platform supports them, and they follow D72: no local success.

## Three layers (keep them apart)
1. **Platform:** everything once the data is in our own model (venues, menus, composer, design, tables, publishing, the guest page); no vendor name, no POS-specific field.
2. **Integration layer:** how any POS, or "by hand", plugs in (POS instances, a venue's source, sync scheduling, what a connector reports); no specific POS.
3. **Connector:** one POS's API, fields and quirks (`packages/barsy` today); its settings show only in that system's tab or for its own venues.

**POS venue vs hand-made venue (D64, D87, D89, D90, D92):** a venue's source is fixed at creation. On a POS venue, Restro may hide, rename over the POS's text, reorder, move items between sections, add its own sections and enrich, but never creates, deletes or re-prices the POS's items or sections. A hand-made venue has full control.

## The nine rules (non-negotiable)
1. **One write path.** Every change from every source goes through `core.apply(changeSet)`. Nothing else writes `field_values`, `events`, resolved documents or snapshots.
2. **Provenance.** Every stored value carries its layer, source and job (NOT NULL). `events` is append-only. Service data (orders, payments, the Log) has no layer: it carries its source, actor and job (D122 §9).
3. **POS ids stay in the backend.** Snapshots, the shell, faces and URLs carry only our prefixed ids (`nd_`, `as_`, `sn_`, `tb_`) and public fields: no POS ids, internal names, cost prices or internal fields. One exception (D75): when barsy has no public name for an item, option or category, its own name (`article_name`, `cat_name`) is shown and the composer warns.
4. **The shell reads only snapshots.** Guest pages never read the database; they read the published files (snapshot, live overlay, indexes) and the context.
5. **Our layers only make the menu more cautious than the POS.** We can hide or mark sold out; we can never un-hide, put back on sale, or change the price of an orderable item.
6. **Absence is deletion only after a complete full read.** A read with any failed page concludes nothing.
7. **Restro writes into a POS only as a waiter would (D110).** Through the API it does what a waiter does at the POS's front end: open a bill, add a round, split or move a bill, take a payment, ask for the bill or a receipt, cancel within the POS's own rules. Never back-office work (items, prices, settings, users). Menu sync stays read-only. No POS webhooks or registration (D41); provider notices are fine (D125). Development and tests never run against a live venue's POS.
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
- Add a dependency your ticket doesn't name.

## Stop and ask
Put the question in your report, with your recommendation, when: a rule or doc section is ambiguous or conflicts; a POS behaviour is undocumented; you need a new dependency or a schema change beyond your ticket; a UX choice is unspecified; a test can only pass by weakening a rule. State unknowns as unknowns.

## Testing, and when a task is done
**Done** = `pnpm lint && pnpm typecheck && pnpm deps:check` pass, plus the tests of every package you touched (`pnpm vitest run --project <package dir> [<paths>] --reporter=dot`) and any Playwright spec you wrote or changed (`pnpm --filter @restro/web run test:e2e e2e/<spec>.spec.ts --reporter=line`; it builds first). CI runs the full gate on the pushed branch, or only the docs checks (`.github/workflows/docs-checks.yml`) for a change to `docs/`, Markdown or `.claude/` alone.

The full `pnpm test`, `pnpm build` and the whole Playwright suite are CI's job, never local: one local round costs 10–15 minutes on this PC and slows the other agents.

- **A test that times out on a busy machine** (known: T75's worker queue tests, the composer keyboard reorder e2e): run it alone once; if it passes alone, say so and move on.
- **Always go through `pnpm`:** `use-node-version` pins Node 24.21.0, and bare `node` picks the system's Node 22.
- **Guardrails only tighten (D67).** A guardrail test, dependency rule or the vendor-word baseline (`scripts/vendor-words.baseline.json`) that blocks your task is a stop-and-ask, never something to weaken, delete or skip. Vendor names (barsy, Mistral…) stay where `scripts/vendor-words.config.ts` allows them; D83's purge role is the one approved exception. After you remove some, `pnpm vendor-words:baseline` lowers the baseline (it refuses to raise one).
- **Line endings:** files are LF. Editing from Python on Windows, open files with `newline=''`.

## Conventions
- **Zod at every boundary** (POS responses, change sets, snapshots, server-action inputs).
- **Layout is separate from the item schema.** Section membership and order are `placements` with fractional `sort_key`s.
- **Time:** the venue's time zone and service day (ends 07:00 by default), with date-fns + @date-fns/tz.
- **Ids:** opaque, prefixed by kind; never sequential integers in URLs.
- **Logs:** structured (pino), never personal data, never secrets.
- **Tests:** unit for pure logic, fast-check property tests for rules 5, 6 and 8, integration tests on Postgres for `apply()` and RLS, contract tests for every face.
- **Deliverables (D114):** research, an opinion, a process map or a review is a file in `docs/deliverables/` (`docs/agents/domain.md` → Deliverables).
- **Git:** a branch per task, `<stage>/<slug>` (e.g. `ad/01-menus`); conventional commit messages.

## Report format (final message of every agent task)
At most about one page (400 words). The diff shows the details; the report says what the lead cannot see in it.
1. **Branch and final commit.**
2. **What changed:** by area, one line each. List single files only where they matter (new files, migrations, guardrails, anything outside your ticket).
3. **Ported from the Platform:** what was ported and what changed while porting, if anything.
4. **Test results:** the commands and pass/fail. Only failures in detail.
5. **Open questions,** each with a recommendation.
6. **Out-of-scope observations** worth a follow-up, one line each.

## Agent skills
Issue tracker: `docs/agents/issue-tracker.md` (GitHub, `gh`). Triage labels: `docs/agents/triage-labels.md`. Domain docs: `docs/agents/domain.md`.
