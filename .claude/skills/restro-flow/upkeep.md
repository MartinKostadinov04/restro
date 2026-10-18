# Upkeep, release, outside questions, human-only steps

Work that isn't a feature but keeps the project moving.

## Codebase health
`improve-codebase-architecture`, scoped to the hot spots in recent commits, one candidate per session. It runs when Martin asks, or when he accepts the lead's offer after a stage branch reaches `main` (`ship.md` §4). The candidate Martin or the lead picks is grilled there, then built through `build.md` → Architecture (or `change.md` when small). The last scan is `docs/reviews/codebase-design-scan.md`; start from it before rescanning.

## Agent environment
- `retro` after work that went sideways, in that session.
- `writing-for-agents` whenever CLAUDE.md, `docs/agents/`, a skill or a ticket template is edited: one place per rule, prune what no longer changes behaviour. A flow file that disagrees with the skill it names is fixed here.
- A **vendored skill** (D106, D109) is a verbatim copy under the `references/` folder of the skill that uses it, with a provenance README and a Restro overrides file. Nothing from a vendored repository is ever installed as a skill or plugin. Its overrides file is read first, wins on every conflict, and opens with a row that neutralises the vendored "Initial Response" (a run that obeys it does nothing). The copy keeps its `disable-model-invocation` flag as it is. An update is an Upkeep ticket: diff the new upstream commit against the copy, review the new lines against the overrides, then change the hashes in the README.
- Keep `docs/decisions.md` and `docs/open-items.md` current: an answered question or a closed task leaves `open-items.md` in the commit that closes it.
- `teach` when Martin wants to understand a concept over several sittings (RLS, the service day, fiscal rules); a one-off question is `decide.md` → Explain.

## Operations
Rehearsals and refreshes with no feature behind them, each a ticket on a cheap model: the purge rehearsal (T79), re-recording barsy fixtures (`pnpm barsy:record`, Martin's credentials), the dev seed, a backup restore drill, a dependency upgrade (one per ticket; read the migration guide in `node_modules` docs first; `pnpm audit`). Anything that touches a real POS or a remote database needs Martin's OK first.

## Incoming reports
Issues filed by someone other than Martin or the lead (a pilot venue, a tester) go through `triage`. The label vocabulary is in `docs/agents/triage-labels.md`. Tickets made by `to-tickets` are agent-ready already and skip it.

## Release (parked)
No deploys from an agent (CLAUDE.md). When the tracker opens a deploy (the Stage 3 deploy, T45): the freeze-window check (`scripts/freeze-window.mjs`, `docs/agents/lead.md`), a migration plan with Martin's OK, `wizard` for every secret or dashboard step, then `audit-behaviour.md` steps 3–5 against staging. An incident on staging or production: restore first (rollback, unpublish), then `bug.md`; reading remote logs needs Martin's OK.

## Outside question
The answer sits outside the repo.
- **Public documents** (barsy docs, a law, a provider's API): `research`, findings with citations in `docs/research/`. Official POS docs outrank everything else (CLAUDE.md, "Fact precedence").
- **A person** (Lukanet, the lawyer or accountant, a pilot owner): `to-questionnaire`. Martin sends it; the lead never does. The open questions per person are in `docs/open-items.md`.
- The answers feed a grilling round, a D-number, or a ticket.

## Human-only step
Accounts, secrets, DNS, third-party dashboards, anything only Martin can operate (e.g. T25): `wizard`. Martin types the secrets himself; an agent never sees or enters them. A leaked secret is this flow too: rotate first, then purge.
