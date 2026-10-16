# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root: Restro's own words, one canonical term each.
- **`docs/decisions.md`**: every decision in force, one line each (D1, D2, …). These D-numbers are this repo's ADRs. Read the ones that touch the area you're about to work in; for a decision's full text, search `docs/tracker.md` for `| D<n> |`. Never read the whole tracker.

If `GLOSSARY.md` doesn't exist, proceed silently.

## Decisions are D-numbers, not `docs/adr/`

Restro does not use `docs/adr/`. Don't create it. The code, briefs and plans cite decisions by D-number, so a decision keeps its number for life.

When a skill says "record an ADR":

1. Take the next free D-number (the highest in `docs/decisions.md` plus one).
2. Write the full text as a row in the tracker's `## Decisions` table, and its one line with a status in `docs/decisions.md`, in the same commit (CLAUDE.md, "Lead workflow").
3. A decision that changes an older one says so in both rows ("refines D<n>", "supersedes D<n>"); the older row's status names the newer one. Never delete or renumber a row.

Only Martin makes product decisions. An agent proposes one in its report with a recommendation; the lead records it once Martin agrees.

## File structure

```
/
├── GLOSSARY.md            ← the language
├── CLAUDE.md              ← rules for agents, the nine rules
└── docs/
    ├── decisions.md       ← one line per decision (the index)
    └── tracker.md         ← full decision text, questions, tasks, research
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a brief, a refactor proposal, a test name, an interface string), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary lists under _Avoid_.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts a decision in force, surface it explicitly rather than silently overriding:

> _Contradicts D89 (POS venues never create items), but worth reopening because…_
