Made by: lead session (Opus), 10-21. For: the next lead session, and Martin. A handover of the ordering planning (map #29) after D122.

> **Update, later on 10-21:** Martin settled both choices. **A is declined:** the pilot runs the whole workflow, ordering and paying in the app, and demo and staging use the provider's sandbox and a POS test installation. Nothing is designed around a pilot without paying unless he says so. **B is the reviewers' order.** Both are in D122 and the addendum of `2026-10-21-board-review-answers-2.md`; the "Still open" section below is superseded on these two points. With paying in the pilot, the parked law points matter before the pilot, not after.

# Ordering: where the planning stands (handover, 10-21)

## In one paragraph

Ordering from the phone is planned, not built. Map #29 "Ordering from the menu" ran its grillings (#35–#40, D110–D121). Martin then checked the whole story twice, with three outside reviews and a board review in between. Everything he settled on 10-21 is **D122**, which refines D111–D113 and D115–D121. Two choices are still his (A and B below). Nothing can be built for the pilot until Mistral answers: the pilot club runs Mistral, which has no public API (T69). The next piece of work is a calmer redesign of the "Tonight" staff screen prototype.

## Where to read, in this order

1. `docs/decisions/D122.md`: the current rules. Each older D-file (D111–D113, D115–D121) has a "Refined by D122" note at the top saying what changed.
2. `GLOSSARY.md`: the words were changed by D122.
   - "Order" is now the unsent order (`tableOrder`), and "Sent order" is what leaves it (`sentOrder`). "Bag" and "round" are retired.
   - New terms: Open for phones, Sitting, Bar, Payment table, Tonight, Connection pause, Capability.
3. `docs/deliverables/2026-10-21-mistral-questions.md`: every question for Mistral in one list, with "send first" at the top. Question 21 is the legal authorisation.
4. Only when a point is unclear, Martin's answers in this order:
   - `2026-10-20-ordering-check-round-1.md`;
   - `2026-10-21-board-review-answers.md`;
   - `2026-10-21-board-review-answers-2.md`.

   The reasons behind them are in `2026-10-20-ordering-review-merged.md`, `2026-10-21-board-review-final.md`, `2026-10-21-dispute-traceability.md` and `2026-10-21-receipt-and-payment-law.md`.

`2026-10-20-ordering-what-we-decided.md`, and its Claude Doc "Ordering: what we decided" (https://claude.ai/artifact/MQU9FZDVhx4KDY2LLGNTg9), describe the state before D122. They are out of date wherever D122 differs. Don't rewrite them: D122 wins (D114).

## Still open

**Martin's two choices.**
- **A. Phases.**
  - The proposal: the pilot opens with ordering onto the table's bill only. The guest pays the waiter as today.
  - Paying in the app (pay-first items, paying your own lines) comes as phase 2, once Mistral confirms moving lines, card payment types and the receipt.
  - The lead recommends yes.
- **B. The order of steps when a guest pays their own lines (phase 2).**
  - Martin's round-1 order: move the lines to a payment table, read them back, the guest confirms, the card, close.
  - The reviewers' fix: the guest confirms from a fresh read of the real table, the card is approved (held), then move, read back, close and capture within seconds.
  - With the fix, nothing is moved off the table until money is promised, and a dropped card leaves the table untouched.
  - Martin's 10-21 "last check after the guest confirms the payment" is already in D122 §8. It fits the fix.

**Waiting on others.**
- **Mistral's answers.** Martin sends the list himself and records the date. The "send first" four decide whether Restro can connect at all.
- **The pilot venue's answers:** the five questions at the bottom of the Mistral list.

**Law, deliberately left for later (Martin, 10-21).** The lead must remind Martin of these when ordering moves toward a build, or when Mistral answers:
- the lawyer's and accountant's questions in `2026-10-21-receipt-and-payment-law.md`;
- allergens: ПМС 97/2021 as amended in 2025, and whether a QR menu counts as "distance communication";
- whether Mistral's product is on the NRA list (ЗДДС чл. 118, ал. 16);
- the lawyer's open point L3 (`2026-10-17-fiscal-rules-in-app-payments.md`): whether a guest's session without an account counts as a "profile" for an electronic receipt.

## Next step: the Tonight prototype, redesigned

The static prototype is `2026-10-21-staff-screen-prototype.html` (published at https://claude.ai/artifact/JduiV7f6EpgV9G5LD85cwY).

Martin, 10-21:
- the direction is right: what a waiter can do during the night;
- the design is not what he imagined:
  - it is hard to take in at first sight;
  - it is cluttered;
  - it uses several neon-bright colours that confuse further;
  - it drifts away from even the temporary design system.

For the redesign:
- Use the admin's design system (shadcn, D107): neutral surfaces, one accent, colour only for what needs action.
- Show fewer things at once: what needs a tap now comes first, the rest one tap away.
- Keep the operational surface grandma-simple, with the fewest clicks.
- Keep the content the old prototype's `.md` lists. Its scope (what a waiter may tap) still stands.
- Work through it with Martin before anything is built: show one screen, then iterate. Keep the old file: a new version is a new deliverable.

## Loose ends outside ordering

- **PR #46** (Adjustments 01 into main) is Martin's to merge. Nothing for ordering gets built before T79 is on main.
- The tracker change "T69 ahead of #47" was proposed and never approved. Don't apply it without Martin's yes.
- Staging migrations need Martin's OK.
- `transaction-processing-rules.pdf` sits untracked at the repo root. Never commit it.
