# How Matt's skills sit in restro-flow (process map, 10-17)

Made by the lead session (Opus) on 10-17, answering Martin's questions about the grilling skills, Matt's "main flow" and how work is split. Read from mattpocock-skills 1.3.1 and restro-flow as they stood that day. It informs; restro-flow and the decisions bind. The model-tier part became D104 (since refined by D108).

## 1. The grilling family

| Skill | What it is | Who starts it |
|---|---|---|
| `grilling` | The engine. Interviews in rounds; each round asks every question whose prerequisites are settled, numbered, each with a recommended answer ("yes" accepts it). Facts are the agent's job, decisions the user's. Done when nothing is left to decide and the user confirms one shared understanding. | the agent or the user |
| `grill-me` | A user-typed shortcut whose whole text is "run `grilling`". Same behaviour. | user only |
| `grill-with-docs` | `grilling` plus `domain-modeling`: new terms go to `GLOSSARY.md`, decisions to `docs/decisions/D<n>.md` while the grilling runs. | user only |
| `wayfinder` | Not a conversation but a planning project over several sessions, for an idea too big and foggy for one. A map issue names the destination; child decision tickets (research, prototype, grilling, task) are resolved one per session; unclear questions wait under "Not yet specified". Produces decisions, not code. | user only |

In Restro the user-only skills need no typing: approving the plan card starts every skill on it.

## 2. Where restro-flow used them (10-17)

| Flow | Skill |
|---|---|
| Quick, Explain | none |
| Decide | `grilling`, plus `domain-modeling` when a concept is named or renamed |
| Build › Feature, Build › Feature set | `grill-with-docs` |
| Build › Architecture, foggy | `wayfinder`, then Feature set from the spec step |
| Build › Architecture, clear | `grill-with-docs` with `codebase-design` |
| Change | tweak: none; new behaviour inside current decisions: a short `grilling` round on the difference; contradicts a decision: Martin decides |
| Upkeep | the picked architecture candidate is grilled; outside answers feed a grilling round |

`grill-me` appears nowhere; the lead calls `grilling` directly.

## 3. Matt's main flow against ours

Matt's main flow is grill-with-docs → to-spec → to-tickets → implement → code-review → retro. It matches **Build › Feature set**, with Restro's additions: restro-flow and the plan card first; an optional `prototype` after the grilling; a Restro block on each ticket (model, who codes, branch, what to read, when to stop); one agent session per ticket in its own worktree, at most two running tests, the frontier built in parallel (`implement-spec`); tiered tests instead of the full suite; three reviews (the session's own, the lead's with built-in code and security reviews where needed, and one of the whole stage branch against the spec); the lead merges after green CI, Martin merges to `main`; an acceptance round; `retro` only when the build went sideways.

A **Build › Feature** is the short form: no spec, no parallel frontier, no whole-branch review, no formal acceptance; the lead's report says what to try.

**Feature vs Feature set:** a Feature is one behaviour a user can see whose grilling, ticket and build fit one session (~150k tokens) and land as at most three tickets; a Feature set is several features toward one destination, more than one session. On 10-17 `SKILL.md` allowed three tickets while `build.md` said one; `build.md` has since been aligned ("two or three only when the parts build and test apart").

## 4. How work is split

- `to-tickets` decides the cut: tracer-bullet vertical slices, each verifiable alone and sized for one fresh session, with blocking edges; prefactoring first; wide refactors as expand–migrate–contract.
- `implement-spec` decides who and when: the tickets are a task graph; every unblocked ticket gets an implementer, merged as each finishes, which frees the next.
- Restro adds what neither decides: the model per ticket (D58), who codes it, at most two agents testing at once, and the lead as the only merger.

## 5. Opinions given that day

- **Ordering from the menu** is more than a Feature set: Build › Architecture, foggy, so `wayfinder` first (POS writes, payments, D72, outside the phase then). This is what happened: the ordering map was charted 10-18.
- **Reviewing the codebase and past decisions is not a `retro`.** A retro improves the agents' environment after a session. The codebase is Upkeep › Codebase health (`improve-codebase-architecture`, which treats decisions as fixed). Decisions have no flow; the proposal was a fact pass by the lead (contradictions, stale or overtaken decisions, ones the code does not follow, "directions" never firmed) and then grilling on that short list, one topic per round, as a `wayfinder` map if large. Not adopted; Martin did not answer it.
- **Model tiers for planning** were agreed and recorded as D104.
