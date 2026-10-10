# Brief S1-01: monorepo scaffold, tooling and CI

- **Model:** Sonnet 5.5
- **Branch:** your worktree branch (the lead merges it into `s1/ground`); never touch `main`
- **Read first:** `CLAUDE.md` (whole), `docs/architecture/stack.md` → "Choices", "Repository and boundaries", "How the nine rules are enforced", "Environments and delivery"; `docs/tracker.md` → D36, D38–D50

## Goal
Create the empty-but-working pnpm monorepo that every later agent builds in: workspace layout, strict TypeScript, Biome, dependency-cruiser import rules, Vitest (+ fast-check), Playwright, local Postgres via Docker, GitHub Actions CI and the production deploy-freeze check. No product logic.

## Environment facts (verified by the lead)
- Windows 11 dev PC; shells are Git Bash and PowerShell. **All package.json scripts must be cross-platform** (no `rm -rf`, `&&`-chains are fine, no bash-only syntax; use `rimraf`/node scripts if needed).
- `package.json` already pins `"packageManager": "pnpm@10.34.6"`; `.npmrc` has `use-node-version=24.21.0` → pnpm runs scripts on Node 24.21.0 although the system Node is 22. Keep both. Run everything through `pnpm` (`pnpm exec`, `pnpm -r`, `pnpm --filter`).
- Docker 29 is installed. GitHub repo: `MartinKostadinov04/restro` (private, personal account).

## Done when
- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` all pass from a clean clone
- [ ] `docker compose up -d` starts Postgres 17 on localhost:5432 and `pnpm dev` starts web (http://localhost:3000, page shows "Restro") and worker (logs a startup line)
- [ ] `GET /api/health` on web returns `{"status":"ok"}`
- [ ] dependency-cruiser fails on a deliberate forbidden import (prove it in a test or a documented manual check, then remove the violation)
- [ ] CI workflow file is valid (run `actionlint` if available via `pnpm dlx`, or explain)

## In scope (create)
```
pnpm-workspace.yaml          apps/*, packages/*, packages/faces/*
package.json                 extend: scripts dev, build, lint, format, typecheck, test, test:e2e, deps:check,
                             db:generate, db:migrate, barsy:record (last three may print "not implemented yet")
tsconfig.base.json           strict, noUncheckedIndexedAccess, noImplicitOverride, verbatimModuleSyntax, ES2023 target, moduleResolution bundler
biome.json                   lint + format (2-space, single quotes, semicolons as needed — pick and document), ignore build dirs
.dependency-cruiser.cjs      rules below
vitest.config.ts (root)      projects/workspace covering every package and app; fast-check available
docker-compose.yml           postgres:17 (pinned minor), db "restro", user/password for LOCAL dev only, healthcheck, named volume
.env.example                 DATABASE_URL (local), placeholders with comments for every later secret (no real values)
.github/workflows/ci.yml     see CI below
.github/workflows/freeze-check.yml  see Freeze below
apps/web                     Next.js 16.4.x (App Router, TypeScript, Tailwind CSS), placeholder home page "Restro", app/api/health/route.ts
apps/worker                  Node + TypeScript entry src/index.ts (logs "worker started"), dev via tsx watch, build via tsc or tsup
packages/core, packages/shell, packages/db, packages/barsy, packages/faces/qr-phone
                             each: package.json (name @restro/<name>, "type":"module", exports src or dist — pick one approach for the whole repo and document it), tsconfig.json extending base, src/index.ts placeholder export, one trivial passing test
packages/barsy/src/write/index.ts   exports nothing (comment: allowlist empty, see CLAUDE.md rule 7)
```
Playwright: config in `apps/web` with one smoke test (home page shows "Restro"); `pnpm test:e2e` runs it against `next build && next start`.

## Import rules (.dependency-cruiser.cjs) — must exist now and pass
1. `packages/shell` and `packages/faces/*` must not import `@restro/db`, `@restro/barsy`, anything under `apps/`, or Node built-ins with I/O (`fs`, `net`, `http`, `child_process`, `pg`).
2. Only files under `packages/core/src/apply/` may import `@restro/db/write` (the path may not exist yet; write the rule for it).
3. Only `apps/worker` may import `@restro/barsy`.
4. `apps/web` must not import `@restro/barsy`.
5. Nothing under `packages/` may import from `apps/`.
6. No circular dependencies.

## CI (.github/workflows/ci.yml)
- Triggers: pull_request (any branch) and push to `main` and `s1/**`.
- Ubuntu, Node 24.21.0 (`actions/setup-node`), pnpm via `pnpm/action-setup` (reads `packageManager`), pnpm store cache.
- Service: `postgres:17` with health check; expose `DATABASE_URL` to steps.
- Steps: install (frozen lockfile) → lint → typecheck → deps:check → gitleaks (`gitleaks/gitleaks-action@v2`, full history checkout) → test → build → Playwright (install chromium only) e2e.
- Pin third-party actions to a major tag at least; prefer full commit SHA with a version comment if you can look it up.

## Freeze (.github/workflows/freeze-check.yml)
- Runs on pull_request targeting branch `production`.
- Fails when Europe/Sofia local time is in a freeze window: Thu, Fri, Sat or Sun at or after 18:00, or Fri, Sat, Sun or Mon before 08:00.
- Passes if the PR has the label `freeze-override` (Martin adds it for approved fixes).
- Put the time logic in a small script (`scripts/freeze-window.mjs`) with unit tests for the window edges (Thu 17:59 pass, Thu 18:00 fail, Mon 07:59 fail, Mon 08:00 pass, Wed 23:00 pass), and DST (use `Intl`/`@date-fns/tz`, not fixed offsets).

## Versions
- Look up current versions with `pnpm view <pkg> version` / `dist-tags`. Pin **exact** versions (no `^`/`~`).
- Required: Next.js 16.4.x (latest patch), React matching Next's peer range, TypeScript (latest version Next 16.4 supports), Tailwind CSS (what `create-next-app` for 16.4 uses), Biome 2.x latest, dependency-cruiser latest, Vitest latest, fast-check latest, Playwright latest, tsx latest.
- Prefer a release at least 7 days old unless it is a security patch; list every chosen version in your report.
- Allowed dependencies: only those named in this brief (plus their required peers, `rimraf`/`cross-env` if needed). Anything else → ask.

## Out of scope / never do
- No database schema, no auth, no shadcn components, no barsy calls, no product UI beyond the placeholder page.
- Nothing listed under "Never" in CLAUDE.md. Do not edit CLAUDE.md, docs/tracker.md or docs/architecture (suggest changes in your report instead).
- Do not push to GitHub and do not open pull requests; commit on your worktree branch only (conventional commits, ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).

## Stop and ask if
- Next.js 16.4 needs a TypeScript/React/Tailwind combination that conflicts with this brief
- `use-node-version` does not apply to a tool you need (e.g. Playwright browsers) and you would have to change the system Node
- any CI step cannot run on a private personal-account repo without a paid licence

## Report back
Use the report format in CLAUDE.md, plus: the exact versions chosen, the commands you ran with pass/fail, and anything in CLAUDE.md's command table that no longer matches reality.
