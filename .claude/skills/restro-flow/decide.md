# Explain, Decide

Two flows with no code change. Both end in plain language, `GLOSSARY.md` terms, and no code in the answer.

## Explain

Martin asks how something works today, or why it is the way it is.

1. **Facts from the repo, never from Martin:** the code, its tests, the decisions it cites (`docs/decisions/D<n>.md`), the adjustments plan, the glossary. Read what the question needs, not the area.
2. **Answer** in a few short paragraphs: what happens, in whose terms (guest, owner, manager), and which decision made it so (cite the D-number). Offer `/mattpocock-skills:wait-what` if it did not land.
3. **Reclassify** when the explanation exposes a problem: a bug → `bug.md`; a contradiction with a decision → Decide; a wish → `change.md`.

## Decide

A product or business decision that is Martin's to make: pricing, pilot order, a rule for owners, anything in `docs/open-items.md` under his name.

1. **Grill** with `grilling`, plus `domain-modeling` when the decision names or renames a concept. Every question carries a recommendation; the lead supplies the facts (research in `docs/research/`, the code, the decisions already in force).
2. **Record** the outcome as `domain-modeling`'s ADR: a new `docs/decisions/D<n>.md` with its index row (`docs/agents/domain.md`), or a one-line answer in `docs/open-items.md` when it does not meet the ADR bar (hard to reverse, surprising without context, a real trade-off). A decision that adds, changes or removes anything a guest can do in the menu revises `docs/guides/menu-template-functionality.md` in the same change.
3. **Tickets** only when the decision changes code: continue in `change.md` or `build.md`.
