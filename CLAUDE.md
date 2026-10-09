# Restro — rules for coding agents

Restro is a QR-to-phone menu and ordering web app for Bulgarian nightclubs on the barsy POS. Martin Kostadinov is the product owner; he does not read code. AI agents write all code. The lead agent writes briefs, reviews every diff and reports to Martin. Model per task (D58): Haiku for simple, precisely specified tasks; Sonnet by default; Opus only for complex work.

## Read before any task
1. This file.
2. `docs/tracker.md` — decisions (D1–D50), open questions, tasks. A decision there is binding.
3. `docs/architecture/data-architecture.md` and `stack.md` — mirrors of the live doc (the doc wins: https://claude.ai/code/artifact/2f2ab8b4-61ce-45a3-986b-bf675d8b472a).
4. Your brief in `docs/agent-briefs/`.
5. `docs/platform-reference.md` and the Platform files your brief names (read-only, `C:\Platform`).

Fact precedence: official barsy docs > the architecture doc > the tracker. Never present an assumption as a fact; if something is unknown, stop and ask.

## Scope right now
QR → phone only (D38). Proof of concept on one venue (D39). Stage 1 = set up the ground. No ordering, payment, webhook or barsy-write code until the tracker says so.

## Commands
| Command | What |
|---|---|
| `pnpm install` | Install (pnpm via corepack, Node 24 LTS) |
| `pnpm db:local` | Local Postgres 17 on localhost:54329 (embedded, no Docker — Docker Desktop does not run on this PC); foreground, Ctrl+C stops it |
| `pnpm db:local:stop` / `pnpm db:local:reset` | Stop it from another terminal / stop and delete the local data |
| `pnpm dev` | Web + worker in watch mode |
| `pnpm lint` | Biome (lint + format check) |
| `pnpm format` | Biome write |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest (unit, property, integration, contract) |
| `pnpm test:e2e` | Playwright |
| `pnpm deps:check` | dependency-cruiser import rules |
| `pnpm build` | Build all |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:roles` | Drizzle migrations and the `restro_app` role (owner URL; local / CI only — remote needs `RESTRO_DB_ALLOW_REMOTE=1` and Martin's OK) |
| `pnpm barsy:record` | Record barsy read responses as fixtures (credentials from `.env.local`) |

A task is not done until `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass.

## Repository layout
```
apps/web            Next.js 16.4: venue admin, guest phone shell, small API (/t/[token], /api/events, /api/health)
apps/worker         Node 24 + pg-boss 12: barsy read sync, resolve, publish, assets, backups, health
packages/core       field types + canonical shapes (Zod), field-type registry contract, template-as-data,
                    change sets, apply(), resolver + combinators, validators V1–V12, snapshot builder, money
packages/shell      population rules R1–R14 → view model (pure), face manifest schema, contract-test harness
packages/faces/*    phone faces ("shells"); each = manifest + React components; first: qr-phone
packages/db         Drizzle schema, migrations, roles, RLS, tenant-scoped client (read / write split)
packages/barsy      typed read client, mapping (versioned config), fixture recorder, MSW handlers; write/ is empty
docs/               tracker, architecture mirrors, platform reference, agent briefs, runbooks, research
```

## The nine rules (non-negotiable)
1. **One write path.** Every change from every source goes through `core.apply(changeSet)`. Nothing else writes `field_values`, `events`, resolved documents or snapshots.
2. **Provenance.** Every stored value carries its layer, source and job (NOT NULL). `events` is append-only.
3. **barsy ids stay in the backend.** Snapshots, the shell, faces and URLs use only our prefixed ids (`nd_`, `as_`, `sn_`, `tb_`).
4. **The shell reads only snapshots.** Guest pages never read the database; they read the snapshot, the live overlay and the context.
5. **Our layers only make the menu more cautious than the till.** We can hide or mark sold out; we can never un-hide, put back on sale, or change the price of an orderable item.
6. **Absence is deletion only after a complete full pull.** A pull with any failed page concludes nothing.
7. **Sync never writes into barsy.** `packages/barsy/write/` exports only calls on Martin's allowlist — currently **none**.
8. **Money is integer minor units** with barsy's rounding, through the `money` module only. barsy sends prices as JSON floats: parse losslessly, convert from the decimal string, round half-up. Never `x * 100`, never floats in storage.
9. **barsy accounts:** one API user per integration per environment; staging config refuses production hosts; (later) one POS-registration owner and server-generated order uuids.

## Import boundaries (dependency-cruiser enforces them in CI)
- `packages/shell` and `packages/faces/*` never import `db`, `barsy`, `apps/*`, or anything with I/O.
- Only `core/apply` imports the write side of `db`.
- Only `apps/worker` imports `barsy`.
- `apps/web` never calls barsy.
- Packages never import apps.

## Conventions
- **Next.js 16.4 is newer than your training data.** Before writing Next.js code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).
- **Workspace packages export TypeScript source** (no package build step); conventions in `README.md` → "Scaffold conventions". Biome style: 2 spaces, single quotes, semicolons only where needed.
- **TypeScript strict** everywhere (TypeScript 6.0.3; 7.x is not yet supported by Next.js and dependency-cruiser). Zod at every boundary (barsy responses, change sets, snapshots, server-action inputs).
- **Data fetching (U4):** admin = server components for reads, server actions that call `apply()` for writes. Guest = static shell that reads snapshots from the CDN. TanStack Query only for ordering later.
- **One field-type registry.** Each field type registers `{ schema, Display, Editor, DefinitionEditor }` once. Never write a `switch (type)` over field types in a component (the Platform's main flaw).
- **Layout is separate from schema.** Section membership and order are `placements` with fractional `sort_key`s, not part of the template.
- **i18n:** every interface string goes through next-intl (BG + EN). Menu text comes from the document's `localized_text`, never from interface strings.
- **Time:** always the venue's time zone (Europe/Sofia) and its service day (ends 07:00 by default). Use date-fns + @date-fns/tz.
- **Ids:** opaque, prefixed by kind; never sequential integers in URLs.
- **Logs:** structured (pino), never personal data, never secrets.
- **Platform reference rule:** before building a UI or engine piece, read the matching Platform files in `docs/platform-reference.md`; port the pattern into TypeScript, apply the listed fixes, and say in your report what you ported and what you changed.
- **barsy calls:** every method in `packages/barsy` has a comment with the official doc URL (`https://docs.lukanet.com/barsy.api/methods/...`) and is checked against it before implementation.
- **Tests:** unit for pure logic, fast-check property tests for rules 5, 6 and 8, integration tests on Postgres for `apply()` and RLS, contract tests for every face.

## Never
- Edit, branch or commit in `C:\Platform`.
- Write to barsy, subscribe webhooks, or register a POS.
- Call barsy from `apps/web`.
- Put barsy ids, internal names, cost prices or internal fields in a snapshot or URL.
- Use floats for money or bypass the money module.
- Bypass `apply()`.
- Use the database owner role, `BYPASSRLS`, or disable RLS in app code.
- Enable or use the Supabase Data API / anon keys.
- Commit secrets or `.env*` files (only `.env.example`).
- Push to `main`, merge your own pull request, or deploy anywhere.
- Run migrations against staging or production from a local machine.
- Invent a barsy method, parameter or behaviour the official docs don't state.
- Add a dependency your brief doesn't name — ask first.

## Stop and ask
Stop and put the question in your report (with your recommendation) instead of guessing when: a rule or doc section is ambiguous or conflicts; a barsy behaviour is undocumented; you need a new dependency or a schema change beyond your brief; a UX choice is unspecified; a test can only pass by weakening a rule.

## Report format (final message of every agent task)
1. What changed (files, one line each)
2. What was ported from the Platform and what was changed while porting
3. Test results (commands + pass/fail)
4. Open questions, each with a recommendation
5. Out-of-scope observations worth a follow-up

## Git
- Branch per task: `<stage>/<slug>` (e.g. `s1/core-document-model`). Conventional commit messages.
- Pull requests carry a plain-language summary for Martin (what changed, why, what he can see or test).
- Production deploys never Thursday–Sunday 18:00–08:00 Europe/Sofia, except fixes Martin approves.
