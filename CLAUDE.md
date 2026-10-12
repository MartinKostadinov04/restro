# Restro — rules for coding agents

Restro is a QR-to-phone menu and ordering web app for venues (pilot: Bulgarian nightclubs). A venue's menu comes from a supported POS through a connector (barsy today; Mistral next, D79) or is built by hand (D64). Martin Kostadinov is the product owner; he does not read code. AI agents write all code. The lead agent writes briefs, reviews every diff and reports to Martin. Model per task (D58): Haiku for exact, mechanical tasks; Sonnet by default; Opus or Fable for complex work. The lead decides per package what it codes itself and what it briefs to simpler agents.

## Read before any task
Read only what your task needs. The big documents are for looking things up, not for reading whole (Martin 10-11: agents read too much).
1. This file.
2. `docs/decisions.md`: every decision in force, one line each. A decision is binding. For the full text of a decision or task your brief names, look it up in `docs/tracker.md` by its number (e.g. search `| D69 |` or `T74.`); never read the whole tracker.
3. Your brief in `docs/agent-briefs/` (and the `docs/adjustments/` file it names, if any).
4. Only the sections of `docs/architecture/data-architecture.md` and `stack.md` your brief names. They mirror the live doc, and the live doc wins: https://claude.ai/code/artifact/2f2ab8b4-61ce-45a3-986b-bf675d8b472a.
5. `docs/platform-reference.md` and the Platform files your brief names (read-only, `C:\Platform`).

Fact precedence: official POS docs (barsy: docs.lukanet.com) > the architecture doc > the tracker. Never present an assumption as a fact; if something is unknown, stop and ask.

## Scope right now
QR → phone only (D38). Current phase (D79): the platform's own functionality, data structure and UI on clean connector data, as planned in `docs/adjustments/adjustments_01.md`. The connector foundation (CF-05 to CF-08) and the Mistral connector are parked. No ordering, payment, webhook or POS-write **backend** code until the tracker says so.

The guest template's service screens (bag, bill, call a waiter, pay, receipt) exist in the face (D71). Guests see them only once the platform supports them, and they follow D72: no local success.

## Three layers (keep them apart)
1. **Platform:** everything once the data is in our own model: venues, menus, composer, design, tables, publishing, the guest page. It knows no POS: no vendor name, no POS-specific field.
2. **Integration layer:** how any POS, or "by hand", plugs in: connections and their instances, a venue's source, sync scheduling, what a connector reports. It knows no specific POS.
3. **Connector:** one POS's API, fields and quirks (`packages/barsy` today). Its settings show only inside that system's tab or for its own venues; every other text names the POS with `{source}` (D82).

**POS data vs hand-made data (D87, D89, D90, D92):**
- A venue's source is fixed when it's created.
- On a POS venue, Restro may hide, rename over the POS's text, reorder and move items between sections, add its own sections, and enrich. It never creates, deletes or re-prices items or sections that come from the POS.
- A hand-made venue has full control.

## Commands
| Command | What |
|---|---|
| `pnpm install` | Install (pnpm via corepack, Node 24 LTS) |
| `pnpm db:local` | Local Postgres 17 on localhost:54329 (embedded, no Docker); foreground, Ctrl+C stops it |
| `pnpm db:local:stop` / `pnpm db:local:reset` | Stop it from another terminal / stop and delete the local data |
| `pnpm dev` | Web + worker in watch mode |
| `pnpm lint` / `pnpm format` | Biome check / Biome write |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest (unit, property, integration, contract) |
| `pnpm test:e2e` | Playwright (`FACES_VISUAL=1` adds the templates' screenshot matrix for review; see `apps/web/e2e/faces-visual.spec.ts`) |
| `pnpm deps:check` | dependency-cruiser import rules |
| `pnpm build` | Build all |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:roles` | Drizzle migrations and the `restro_app` role (owner URL; local / CI only — remote needs `RESTRO_DB_ALLOW_REMOTE=1` and Martin's OK) |
| `pnpm barsy:record` | Record barsy read responses as fixtures (credentials from `.env.local`) |
| `pnpm vendor-words:baseline` | Lower the vendor-word baseline after removing vendor words (it refuses to raise one; raising is the lead's call, D67) |

## When a task is done, and testing
An agent's task is done when `pnpm lint && pnpm typecheck && pnpm deps:check` and the tests of what it touched pass. The full gate (`pnpm test`, `pnpm build`, every Playwright spec) runs in CI on the pushed branch, and the lead merges only when CI is green.

**Two tiers** (Martin 10-11: keep the work fast and lean):
1. **While you work,** run only the tests of what you touched, with quiet output:
   - `pnpm vitest run --project <package dir> <paths> --reporter=dot`
   - `pnpm --filter @restro/web run test:e2e e2e/<spec>.spec.ts --reporter=line`, only for a spec you wrote or changed (it builds first).
2. **Once, at the end:** `pnpm lint && pnpm typecheck && pnpm deps:check`, the tests of every package you touched (`pnpm vitest run --project <package dir> --reporter=dot`), and a Playwright spec only if you wrote or changed it.

**Never run the full `pnpm test`, `pnpm build` or the whole Playwright suite locally:** one round costs 10–15 minutes on this PC, and agents slow each other down. Never paste long test output into a report; quote only failures.

- **Known slow tests:** `apps/worker/tests/worker.integration.test.ts`, `sync-queue.test.ts` and the composer keyboard reorder e2e can time out when the machine is busy (T75). Run a failing one alone once. If it passes alone, say so and move on.
- **Database tests** run only with `CI=true` and `DATABASE_URL`, `DATABASE_URL_OWNER` and `DATABASE_APP_PASSWORD` set (local values in `.env.example`). Reuse the running Postgres on 54329 with your own database name: create it, then `pnpm db:migrate` and `pnpm db:roles`. Never stop an instance you did not start.
- **Always go through `pnpm`,** never bare `node`: `use-node-version` pins Node 24.21.0.
- **Guardrails only tighten (D67).** Never weaken, delete or skip a guardrail test, dependency rule or the vendor-word baseline (`scripts/vendor-words.baseline.json`) to pass a task: stop and ask.
  - Vendor names (barsy, Mistral…) belong only in a connector's own package, `packages/core/src/connectors/`, `apps/web/src/connectors/` and `apps/worker/src/connectors.ts` (`scripts/vendor-words.config.ts`).
  - One approved exception is D83's purge role (see Never).
- **Line endings:** files are LF. Editing from Python on Windows, open files with `newline=''`.
- **Never compare a SQL `order by` result with a JavaScript `.sort()` result:** CI's Postgres sorts with `en_US`, the local one with `C`. Sort both sides the same way.

## Repository layout
```
apps/web            Next.js 16.4: venue admin (composer, Design tab, Publishing), guest phone shell with the template
                    registry (src/faces), small API (/t/[token], /api/events, /api/health)
apps/worker         Node 24 + pg-boss 12: POS read sync, resolve, publish, assets, backups, health
packages/core       field types + canonical shapes (Zod), template-as-data, change sets, apply(), resolver,
                    validators, snapshot builder, money, theme (colour roles, fonts, presentation, guest features)
packages/shell      population rules R1–R15 → view model (pure), face manifest schema, services contract (D72),
                    contract-test harness (`@restro/shell/testing`)
packages/faces/*    phone faces ("templates", D69): manifest + React components; default editorial-market
                    (with a `./preview` demo host for the admin); qr-phone = hidden test reference
packages/db         Drizzle schema, migrations, roles, RLS, tenant-scoped client (read / write split)
packages/barsy      the barsy connector: typed read client, mapping (versioned), fixture recorder, MSW handlers;
                    write/ is empty
docs/               tracker, decisions index, adjustments, architecture mirrors, agent briefs, runbooks, research
```

## The nine rules (non-negotiable)
1. **One write path.** Every change from every source goes through `core.apply(changeSet)`. Nothing else writes `field_values`, `events`, resolved documents or snapshots.
2. **Provenance.** Every stored value carries its layer, source and job (NOT NULL). `events` is append-only.
3. **POS ids stay in the backend.** Snapshots, the shell, faces and URLs use only our prefixed ids (`nd_`, `as_`, `sn_`, `tb_`).
4. **The shell reads only snapshots.** Guest pages never read the database; they read the published files (snapshot, live overlay, indexes) and the context.
5. **Our layers only make the menu more cautious than the till.** We can hide or mark sold out; we can never un-hide, put back on sale, or change the price of an orderable item.
6. **Absence is deletion only after a complete full pull.** A pull with any failed page concludes nothing.
7. **Sync never writes into a POS.** `packages/barsy/write/` exports only calls on Martin's allowlist — currently **none**.
8. **Money is integer minor units** with the POS's rounding, through the `money` module only. barsy sends prices as JSON floats: parse losslessly, convert from the decimal string, round half-up. Never `x * 100`, never floats in storage.
9. **POS accounts:** one API user per connection per environment; staging config refuses production hosts; (later) one POS-registration owner and server-generated order uuids.

## Import boundaries (dependency-cruiser enforces them in CI)
- `packages/shell` and `packages/faces/*` never import `db`, a connector, `apps/*`, or anything with I/O.
- A face imports only its own package, `react`, `react-dom` and `@restro/shell` (not `@restro/core`, not `@restro/shell/testing` outside tests); guest pages never import a face's `/preview`, and only a face's `preview/` folder may use `@restro/shell/money`.
- Only `core/apply` imports the write side of `db`.
- Only `apps/worker` imports a connector package (`barsy`); `apps/web` never calls a POS.
- Packages never import apps.

## Conventions
- **Next.js 16.4 is newer than your training data.** Before writing Next.js code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).
- **Workspace packages export TypeScript source** (no build step; `README.md` → "Scaffold conventions"). Biome: 2 spaces, single quotes, semicolons only where needed.
- **TypeScript strict** everywhere (TypeScript 6.0.3). Zod at every boundary (POS responses, change sets, snapshots, server-action inputs).
- **Data fetching (U4):** admin = server components for reads, server actions that call `apply()` for writes. Guest = static shell that reads published files from the CDN.
- **Templates (D69):** a face is added to `MANIFESTS` in `apps/web/src/faces/manifests.ts` and gets a loader in `apps/web/src/faces/registry.ts`. Server code reads `manifests.ts` and never imports `registry.ts`; only client code imports the registry. Checklist: the designer guide's "A new template".
- **One field-type registry.** Each field type registers `{ schema, Display, Editor, DefinitionEditor }` once. Never write a `switch (type)` over field types in a component.
- **Layout is separate from schema.** Section membership and order are `placements` with fractional `sort_key`s, not part of the template.
- **i18n:** every interface string goes through next-intl (BG + EN), and names the POS with `{source}`, never "barsy". Menu text comes from the document's `localized_text`.
- **Time:** always the venue's time zone and its service day (ends 07:00 by default). Use date-fns + @date-fns/tz.
- **Ids:** opaque, prefixed by kind; never sequential integers in URLs.
- **Logs:** structured (pino), never personal data, never secrets.
- **Platform reference rule:** before building a UI or engine piece, read the matching Platform files in `docs/platform-reference.md`; port the pattern, apply the listed fixes, and say in your report what you ported and changed.
- **POS calls:** every method in a connector has a comment with the official doc URL (barsy: `https://docs.lukanet.com/barsy.api/methods/...`) and is checked against it before implementation.
- **Tests:** unit for pure logic, fast-check property tests for rules 5, 6 and 8, integration tests on Postgres for `apply()` and RLS, contract tests for every face.

## Never
- Edit, branch or commit in `C:\Platform`.
- Write to any POS, subscribe webhooks, or register a POS.
- Call a POS from `apps/web`.
- Put POS ids, internal names, cost prices or internal fields in a snapshot or URL. One exception (D75): when barsy has no public name for an item, option or category, its own name (`article_name`, `cat_name`) is shown, and the composer warns.
- Use floats for money or bypass the money module.
- Bypass `apply()`.
- Use the database owner role, `BYPASSRLS`, or disable RLS in app code.
- Delete rows from app code, except the three row kinds `apply()` removes as the action itself (`placements`, `field_values`, `source_links`) and Better Auth's session and verification rows. Erasing venue data, or anything in bulk, is only the purge job's, through its dedicated role `restro_purge` (D83).
- Enable or use the Supabase Data API / anon keys.
- Commit secrets or `.env*` files (only `.env.example`).
- Push to `main`, merge your own pull request, or deploy anywhere.
- Run migrations against staging or production from a local machine.
- Invent a POS method, parameter or behaviour its official docs don't state.
- Add a dependency your brief doesn't name — ask first.

## Stop and ask
Stop and put the question in your report (with your recommendation) instead of guessing when: a rule or doc section is ambiguous or conflicts; a POS behaviour is undocumented; you need a new dependency or a schema change beyond your brief; a UX choice is unspecified; a test can only pass by weakening a rule.

## Report format (final message of every agent task)
At most about one page (400 words). The diff shows the details; the report says what the lead cannot see in it.
1. **Branch and final commit.**
2. **What changed:** by area, one line each. List single files only where they matter (new files, migrations, guardrails, anything outside your brief).
3. **Ported from the Platform:** what was ported and what changed while porting, if anything.
4. **Test results:** the commands and pass/fail. Only failures in detail.
5. **Open questions,** each with a recommendation.
6. **Out-of-scope observations** worth a follow-up, one line each.

## Lead workflow
- At most two agents run at once (Martin 10-11): more load the one PC until tests time out.
- **The lead decides per package** what it codes itself (data model, migrations, core rules, guardrail changes) and what it briefs to simpler agents (screens, forms, wording, small connector changes); it reviews every diff either way.
- **CI runs the full check.** After review the lead pushes the task branch (`cf/**`, `sh/**`, `ad/**`), waits for CI to go green, then merges it into the stage branch and pushes that. Locally the lead runs only typecheck and the tests of the merged areas.
- **Briefs say which decisions and doc sections to read**, by number, and state the testing rule above.
- **Every new decision or task goes in two places:** the tracker gets the full text, and `docs/decisions.md` gets its one line, in the same commit.
- **Never enter plan mode while agents run.** It stops their edits too.

## Git
- Branch per task: `<stage>/<slug>` (e.g. `ad/01-menus`). Conventional commit messages.
- Pull requests carry a plain-language summary for Martin (what changed, why, what he can see or test).
- Production deploys never Thursday–Sunday 18:00–08:00 Europe/Sofia, except fixes Martin approves.
