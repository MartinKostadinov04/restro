# Change

An existing feature should behave, read or look different. Ends in `ship.md`.

1. **Find what exists:** the feature's original issue, brief or adjustments plan, the decisions behind it (`docs/decisions.md`), its code, its tests and its `GLOSSARY.md` terms. These are facts: read them, and never ask Martin what the code does. Done when you can name the decisions, the code and the tests that make today's behaviour.
2. **Size the change:**
   - **Wording or visual tweak** inside current decisions → one ticket, no grilling, no screen plan.
   - **New behaviour inside current decisions** → a short `grilling` round on the difference only, plus `domain-modeling` when it names a concept or makes a decision (recorded as in `decide.md` step 2), and the screen plan (`ship.md` §1) when an operational screen changes, written in that round.
   - **Contradicts a decision** → say so ("Contradicts D89, but…"); Martin decides; the new decision refines or supersedes the old D-number.
3. **Open look?** Several layouts or wordings possible → `prototype` UI variations Martin can click through before the ticket.
4. **A feedback list** (acceptance notes, a call with Martin): one ticket per independent item, with blocking links where one waits on another. Martin's own items skip triage; reports filed by others go through `upkeep.md` → Incoming reports first.
5. **Tickets** in `ship.md`'s format. Each ticket changes the tests that encode the old behaviour together with the code. A guardrail test that encodes it is a stop-and-ask (D67). A ticket that adds, changes or removes anything a guest can do in the menu revises `docs/guides/menu-template-functionality.md` in the same change.
6. **Ship:** `ship.md`; for anything a guest or owner sees, finish with `audit-behaviour.md` steps 3–5 on the changed stories.
