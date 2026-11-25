# Decision log: "How the guest page pays" (#53)

Made by: the ordering lead session (Opus), 10-25. For: anyone who needs every decision of #53 at a glance. Map #29 "Ordering from the menu". The design is `2026-10-25-guest-payment-design.md`; the binding text is D127. Rows marked "(review)" came from the independent Opus second opinion (design §14).

Every decision, one row each. **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope;
- **open:** waits on Martin, a fact or a ticket.

Only D-numbers bind; this log is the index to them. #53 says the lead decides technical points and Martin decides behaviour and wording, so most rows are the lead's. Martin's rows are marked "(Martin)".

**Read before deciding:**
- D98, D121, D122 (§8 paying, §9 platform), D124 (a bar is optional), D125, D126 (Stripe first);
- round 1 (§6.6, §6.10, §8.1);
- `stack.md` (the import rule for payment packages, the notice secret);
- `2026-10-22-stripe-knowledge.md`, `2026-10-25-stripe-plugin-check.md`.

**Settled before #53, not asked again:**
- the order hold → move → last check → close → capture (D122 §8, choice B);
- "Being paid" with no countdown; the invisible deadlines (round 1);
- pay-first on a free payment table, "for Table 7" (round 1, 6.10);
- the queue per bar and the 60 s wait (round 1, 8.1);
- Stripe with direct charges and the restricted key (D125).

## Where things run

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | Guest pay commands go through `POST /api/guest/actions`, like every guest command | One path: table code, action id, Turnstile, limits (D121) | firm | D127 |
| 1.2 | The worker makes every provider call; the web never does | `stack.md`; the saga already lives in the worker | firm | D127 |
| 1.3 | The hold is created by a pg-boss job while the phone shows "Preparing your bill…", on its own fast queue | Keeps provider calls off web requests; one route into the saga | firm | D127 |
| 1.4 | Notices arrive at the web, signatures are checked by hand (no provider SDK in web), stored once, then a worker job | The endpoint must be public; the web stays free of the provider SDK | firm | D127 |
| 1.5 | The card form is loaded by the page into a slot the template places; templates never load a provider library | Faces only draw (D72) | firm | D127 |
| 1.6 | CLAUDE.md's import line names payment provider packages too (Martin, yes 10-25) | Matches `stack.md`; CLAUDE.md edits need Martin | firm | D127, CLAUDE.md |
| 1.7 | The notice route may import `core/service` for one function, `recordProviderNotice`, into a platform-level inbox with no venue (Martin yes 10-25, review) | The route is no guest, admin or worker path; widening an import rule is a guardrail change | firm | D127 |
| 1.8 | One job per payment at a time (pg-boss `singletonKey`) (review) | A notice and `pay.returned` can't queue it twice | firm | D127 |

## The commands and what phones see

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | Commands: `pay.start`, `pay.returned`, `pay.cancel`; pay-first starts from Send | Covers the issue's list: own lines, whole bill, pay-first, return, cancel | firm | D127 |
| 2.6 | ~~`pay.confirming` extends the deadline~~ replaced: at 2 min Restro reads the provider's payment and extends if the guest's bank is still asking (review) | Drops a command the phone controls | firm | D127 |
| 2.2 | The paying phone holds a random payment handle; only its hash is stored | No phone identity; friends can't act on another's payment | firm | D127 |
| 2.3 | The phone's "returned" is a nudge; Restro reads the hold from the provider | Never trust the phone | firm | D127 |
| 2.4 | Other phones see `beingPaid` per line, with no payer, amount or timer | Round 1, 3.2 and 6.6 | firm | D127 |
| 2.5 | The tip is a separate amount inside the hold, in minor units through `money` | D125 3.10; rule 8 | firm | D127 |

## The route

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | States: requested, priced, awaiting_guest, held, queued, isolated, checked, closed, captured; final: captured, released, unconfirmed, stranded | D122 §8's order, each step recorded first | firm | D127 |
| 3.2 | The price is the POS's own line amounts from a fresh real-table read, never price × quantity | Rule 5; the knock | firm | D127 |
| 3.3 | Pay-first is priced from the published menu, entered with `addLines` on the payment table; a lower POS amount is captured, a higher one releases and alerts | Rule 5; round 1, 6.10 | firm | D127 |
| 3.4 | Timeouts are read back: provider calls by idempotency key, POS writes by reading the tables | D122 §8; D125 timeouts | firm | D127 |
| 3.5 | An unknown close keeps the hold and asks a manager: "Receipt printed" captures, "No receipt" releases | Merged fix 1 (D122) | firm | D127 |
| 3.6 | `capture_before` is stored; unconfirmed reminders at half the time left and with 24 h left (review: not fixed hours); an expired hold lists on the end-of-night page | D122 plans for 7-day holds; wallet windows are unknown | firm | D127 |
| 3.7 | A recovery job at worker start and every 30 s finishes or undoes stuck payments | No payment table left unknown (round 1, 8.1) | firm | D127 |
| 3.9 | Every POS and provider write is recorded `attempting` before the call (review) | Round 1 §8.1 "before and after"; recovery can't undo a close it didn't see | firm | D127 |
| 3.10 | Once a close is attempted, never undo or release: capture on proof, else `unconfirmed`. `already_done` counts as closed; an empty table alone is no proof (review) | A receipt may have printed | firm | D127 |
| 3.11 | State changes are compare-and-set; a payment owns its payment table until final and the table reads empty, with no lock that runs out (review) | Two payments can't share a payment table | firm | D127 |
| 3.12 | Moves and undos hold the real table's write turn (review) | Round 1, 6.7 | firm | D127 |
| 3.13 | Pay-first: after the round is entered, never release on its own; offered only where the connector opens a bill on an empty table and returns its reference (review) | The round has printed (D122 §1) | firm | D127, part 2 ticket |
| 3.14 | `capture_failed`: closed but capture refused → owner alert (review) | The venue is owed money | firm | D127 |
| 3.15 | A stuck hold creation is released, never retried with the same key for ever (review) | Stripe replays stored server errors | firm | D127 |
| 3.16 | Tables with no bar use the venue's queue (review) | D124 §1 | firm | D127 |
| 3.8 | The provider breaker follows D120's rule (60 s, ≥3 attempts) per venue account; lost access pauses at once | D125 2.4 | firm | D127 |

## Records and notices

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | New service tables `payments`, `payment_lines`, `payment_steps`, `provider_notices`, written only through `applyService` | D122 §9; the write-target guard | firm | D127 |
| 4.2 | No card digits, no phone, device or IP identifier stored; 18 months' retention | D111; D122 §8 | firm | D127 |
| 4.3 | Notices are triggers: the worker reads the object back; events acted on are listed in the design §8 | D125 3.8; order doesn't matter | firm | D127 |
| 4.5 | The receipt number and fiscal memory number are stored on the payment (review) | D122 §8 dispute evidence | firm | D127 |
| 4.6 | Notices from the wrong environment (live/test) are refused; any `v1` signature may match during a secret roll (review) | Stripe's scheme | firm | D127 |
| 4.7 | No daily list for Stripe (review) | D122 §8 needs it only where no refund notice exists | firm | D127 |
| 4.4 | Refunds and disputes are observed by notice, never made by Restro | D122 §8; D125 3.5 | firm | D127, #54 |

## Limits

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | Turnstile at `pay.start` and at a Send with pay-first lines | D121's rule | firm | D127 |
| 5.2 | Per phone: one start per 15 s, five per 10 min, one open payment; per table: three open payments | Best practice; the lead's call (no thresholds asked of Martin) | firm | D127 |
| 5.3 | ~~The minimum is the provider's declared one; Restro adds none~~ replaced: the smallest card payment is a venue setting, starting at and never below the provider's minimum (€0.50 for Stripe) (Martin 10-25) | Martin: "the under amount is adjustable" | firm | D127, #61 |
| 5.4 | Below it, Pay is greyed: "Card payments start at €0.50. Add an item or ask your waiter." (Martin, yes 10-25) | Wording is Martin's | firm | D127 |

## The interface and Stripe

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 6.1 | `PaymentProvider` as in the design §10; no refund method | D98 narrowed by D122 §8 | firm | D127 |
| 6.2 | One conformance suite for `sim-pay` and Stripe (sandbox) | As the connector suites (D122 §9) | firm | D127 |
| 6.3 | Stripe: Payment Intents with manual capture, not Checkout Sessions | Checkout Sessions need a customer email (D125 3.7); Restro keeps its own state; smaller key | firm | D127 |
| 6.6 | Cards only (`payment_method_types=[card]`; wallets still show) (review) | Other methods have other hold windows or redirect | firm | D127 |
| 6.7 | A redirect's address is cleaned before any request; the handle lives in `sessionStorage` (review) | Rule 3: no provider value in a URL | firm | D127 |
| 6.8 | The key reads Charges and Disputes; Refunds stay none (review; refines D125 3.5) | `capture_before`, 3-D Secure and refunds sit on the charge | firm | D127 |
| 6.9 | Ask for 3-D Secure on every payment (Martin yes 10-25, review) | D122 §8 left it to now; protects the venue in disputes | firm | D127 |
| 6.4 | Dependencies named by the tickets: `stripe` in `packages/payments/stripe`, `@stripe/stripe-js` in web (and `@stripe/react-stripe-js` if needed) | CLAUDE.md: tickets name dependencies | firm | D127 |
| 6.5 | Five sandbox tests before the pilot (key refuses refunds, hold and capture, release, notices, wallets) | Knowledge file, Open 3 | later | D127 |

## Tips

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 7.2 | The connector's close carries `tipMinor`; capability `recordTipOnClose` (review) | No tip field exists today | firm | D127, part 2 ticket |
| 7.1 | Tips show only where the POS puts the tip on the same bill and fiscal receipt; elsewhere none for now; the tip starts at zero and goes to the venue (Martin, yes 10-25; researched in `2026-10-25-tips-research.md`) | NRA 23.10.2025: a card tip goes on the fiscal receipt, group А, no VAT; consumer law forbids a preselected tip | firm | D127 |
