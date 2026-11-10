# Build

Three sizes. Each ends in `ship.md`. The skills decide how each step runs; this file only says which step, who, and Restro's limits.

## Feature

One behaviour, one session.

1. **Grill** with `grill-with-docs`. Done when the skill says so and Martin confirms you share one understanding; new terms in `GLOSSARY.md`, any decision he made recorded (`docs/agents/domain.md`). **Decision log (D114):** from the first answer, keep `docs/deliverables/<date>-<slug>-decision-log.md`, one row per decision as it settles. Martin reviews it before he confirms. The D-numbers, glossary entries and tickets are written from it and wired back to it as `docs/agents/domain.md` → "Decision logs" says; `scripts/decisions.test.ts` must pass before the commit. **Screen plan (D123):** a feature with an operational screen gets its screen plan (`ship.md` §1) here, from the stories, before any ticket; Martin confirms its stories and behaviour choices with the rest.
2. **Prototype** only when a question needs a runnable answer (`prototype` picks the branch). It runs in its own agent session forked from the grilling session, which waits for the verdict and then continues. The prototype stays on a `prototype/<name>` branch; its verdict goes into the ticket.
3. **Ticket:** one GitHub issue, `to-tickets`' issue template plus `ship.md`'s block, with the screen plan when it touches an operational screen; two or three only when the parts build and test apart. No spec issue for a single feature. A new premade Style for the guest menu (D128) is not a Feature: it follows `template.md`. A step that adds, changes or removes anything a guest can do in the menu revises `docs/guides/menu-template-functionality.md` in the same change.
4. **Build and ship:** `ship.md`.

## Feature set

Several features, one clear destination. Keep steps 1–4 in one window.

1. **Grill** with `grill-with-docs`, keeping the decision log (Feature step 1).
2. **Prototype** detours as in Feature.
3. **Spec** with `to-spec`: label the issue `spec` and remove `ready-for-agent` (a spec is not a ticket). Its user stories are the acceptance list for step 7. The lead agrees the test seams.
4. **Tickets** with `to-tickets`, each with `ship.md`'s block, and a screen plan written from the spec's stories for each ticket that touches an operational screen. Show Martin the list in plain words; the lead owns granularity and edges.
5. **Build the frontier** as `implement-spec` describes, with Restro's substitutions: an implementer subagent is an agent session in its own worktree on a branch cut from the stage branch (the integration branch), within `docs/agents/lead.md`'s limits; the merger is the lead through `ship.md` §4, never a subagent.
6. **Review the whole:** after the last ticket, one `mattpocock-skills:code-review` of the stage branch against the spec, and one built-in `code-review` at `high` of the same branch.
7. **Acceptance:** `audit-behaviour.md` steps 3–5 on the spec's user stories, then hand Martin what to try and where.
8. **Retro** if the build went sideways.

## Architecture

A change to the shape: the data model, a seam, a layer, a rule that spans packages.

1. **Foggy?** `wayfinder` when the way can't be seen and its decisions won't fit one session (research tickets run as `research` agents, within the limits; each grilling ticket keeps a decision log, Feature step 1). When the map clears, continue at Feature set step 3.
2. **Clear:** `grill-with-docs`, keeping the decision log (Feature step 1), with `codebase-design` for the vocabulary and its design-it-twice when one interface is worth exploring (three designs at most).
3. **Record** each decision that meets the ADR bar as `docs/decisions/D<n>.md`; update the live architecture doc and its mirror in `docs/architecture/` in the same change.
4. **Tickets:** Feature set steps 3–8. A wide refactor follows `to-tickets`' expand–migrate–contract. Migrations are the lead's to code; a staging migration needs Martin's OK.
