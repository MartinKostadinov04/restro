# Build

Three sizes. Each ends in `ship.md`. The skills decide how each step runs; this file only says which step, who, and Restro's limits.

## Feature

One behaviour, one session.

1. **Grill** with `grill-with-docs`. Done when the skill says so and Martin confirms you share one understanding; new terms in `GLOSSARY.md`, any decision he made recorded (`docs/agents/domain.md`).
2. **Prototype** only when a question needs a runnable answer (`prototype` picks the branch). The prototype stays on a `prototype/<name>` branch; its verdict goes into the ticket.
3. **Ticket:** one GitHub issue, `to-tickets`' issue template plus `ship.md`'s block. No spec issue for a single feature. A new template (D69) uses the designer guide's "A new template" checklist as its acceptance criteria.
4. **Build and ship:** `ship.md`.

## Feature set

Several features, one clear destination. Keep steps 1–4 in one window.

1. **Grill** with `grill-with-docs`.
2. **Prototype** detours as in Feature.
3. **Spec** with `to-spec`: label the issue `spec` and remove `ready-for-agent` (a spec is not a ticket). Its user stories are the acceptance list for step 7. The lead agrees the test seams.
4. **Tickets** with `to-tickets`, each with `ship.md`'s block. Show Martin the list in plain words; the lead owns granularity and edges.
5. **Build the frontier** as `implement-spec` describes, with Restro's substitutions: an implementer subagent is an agent session in its own worktree on a branch cut from the stage branch (the integration branch); at most two running tests at once; the merger is the lead through `ship.md` §4, never a subagent.
6. **Review the whole:** after the last ticket, one `mattpocock-skills:code-review` of the stage branch against the spec.
7. **Acceptance:** `audit-behaviour.md` steps 3–5 on the spec's user stories, then hand Martin what to try and where.
8. **Retro** if the build went sideways.

## Architecture

A change to the shape: the data model, a seam, a layer, a rule that spans packages.

1. **Foggy?** `wayfinder` when the way can't be seen and its decisions won't fit one session (research tickets run as `research` agents, within the limits). When the map clears, continue at Feature set step 3.
2. **Clear:** `grill-with-docs`, with `codebase-design` for the vocabulary and its design-it-twice when one interface is worth exploring (three designs at most).
3. **Record** each decision that meets the ADR bar as `docs/decisions/D<n>.md`; update the live architecture doc and its mirror in `docs/architecture/` in the same change.
4. **Tickets:** Feature set steps 3–8. A wide refactor follows `to-tickets`' expand–migrate–contract. Migrations are the lead's to code; a staging migration needs Martin's OK.
