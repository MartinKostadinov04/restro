# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: Restro's own words, one canonical term each.
- **`docs/decisions/D<n>.md`**: one file per decision. These are this repo's ADRs, in the ADR format (title, status, one to a few paragraphs). Read the ones your ticket names and any D-number cited in the code you touch. `docs/decisions.md` is the index of titles and statuses, for finding a number; never a substitute for the file.

## ADRs are D-numbers in `docs/decisions/`, not `docs/adr/`

The code, briefs and plans cite decisions by D-number (about 1,400 citations), so a decision keeps its number and its file for life. Don't create `docs/adr/`.

When a skill says "record an ADR":

1. Take the next free D-number (the highest in `docs/decisions.md` plus one).
2. Write `docs/decisions/D<n>.md`: frontmatter `status:`, heading `# D<n>: <short title>`, then the decision in the ADR format (what was decided and why; who decided and when, e.g. "Martin 10-17"). Add its row to `docs/decisions.md` in the same commit. `scripts/decisions.test.ts` checks that every file is indexed and every cited number has a file.
3. A decision that changes an older one says so in both files ("refines D<n>", "supersedes D<n>"); the older file's status names the newer one. Never delete or renumber a file.

Only Martin makes product decisions. An agent proposes one in its report with a recommendation; the lead records it once Martin agrees.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a brief, a refactor proposal, a test name, an interface string), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary lists under _Avoid_.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts a decision in force, surface it explicitly rather than silently overriding:

> _Contradicts D89 (POS venues never create items), but worth reopening because…_
