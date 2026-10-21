# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: Restro's own words, one canonical term each.
- **When a decision alone is not clear** (why it was taken, what was rejected, what was left open, whether a small point was decided at all): use the `revisit-decision` skill.
- **`docs/decisions/D<n>.md`**: one file per decision. These are this repo's ADRs, in the ADR format (title, status, one to a few paragraphs). Read the ones your ticket names and any D-number cited in the code you touch. `docs/decisions.md` is the index of titles and statuses, for finding a number; never a substitute for the file.

## ADRs are D-numbers in `docs/decisions/`, not `docs/adr/`

The code, briefs and plans cite decisions by D-number (about 1,400 citations), so a decision keeps its number and its file for life. Don't create `docs/adr/`.

When a skill says "record an ADR":

1. Take the next free D-number (the highest in `docs/decisions.md` plus one).
2. Write `docs/decisions/D<n>.md`: frontmatter `status:`, heading `# D<n>: <short title>`, then the decision in the ADR format (what was decided and why; who decided and when, e.g. "Martin 10-17"; the decision log it came from, when a grilling made it). Add its row to `docs/decisions.md` in the same commit. `scripts/decisions.test.ts` checks that every file is indexed and every cited number has a file.
3. A decision that changes an older one says so in both files ("refines D<n>", "supersedes D<n>"); the older file's status names the newer one. Never delete or renumber a file.

Only Martin makes product decisions. An agent proposes one in its report with a recommendation; the lead records it once Martin agrees.

## Deliverables

Research, an opinion, a process map or a review made by a session, worktree or subagent is one file `docs/deliverables/<date>-<slug>.md` (D114), never only a chat message, a notes folder or an unmerged branch. The lead files it with its row in `docs/deliverables.md`; files are kept and revisited, never rewritten.

## Decision logs

Every grilling keeps a **decision log** (D114): `docs/deliverables/<date>-<slug>-decision-log.md`. The model is `docs/deliverables/2026-10-18-bill-decision-log.md`.

- **Rows:** one row per decision, kept from the first answer, grouped by topic: `| # | Decision | Why | Status | Recorded in |`.
  - **Status** is one of: firm, later, on request, out, open.
  - **Recorded in** names where the binding text lives: a D-number, a ticket (`#n`), `GLOSSARY`, `CQ` (`docs/connector-questions.md`), `CLAUDE.md` or a `restro-flow` file.
  - A decision Martin changes during the grilling is marked as replaced, never deleted.
- **Martin reviews the log** before he confirms the shared understanding.
- **Wiring, when the decisions are written up:**
  1. Every **firm** row points to binding text, never to the log alone. A decision too small for its own D-number is folded into the nearest D-file or ticket. `scripts/decisions.test.ts` checks this.
  2. Every new D-file names its log in its sources line, so a reader can go from the binding text to the decisions behind it.
  3. Every **open**, **later** and **on request** row points to a ticket, a D-file or `docs/open-items.md`.
  4. The resolution comment (wayfinder) and the map's pointer link the log.
- **Closing:** a log is final once its ticket is resolved and its decisions are committed. After that it is kept as is (D114). A later change is a new D-number that supersedes the old one, and the log stays as the record of what was decided then.
- **Revisiting:** when a D-number alone does not say enough, the `revisit-decision` skill reads its log and the deliverables behind it.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a brief, a refactor proposal, a test name, an interface string), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary lists under _Avoid_.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts a decision in force, surface it explicitly rather than silently overriding:

> _Contradicts D89 (POS venues never create items), but worth reopening because…_
