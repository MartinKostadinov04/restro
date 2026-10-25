Made by: the ordering lead (Opus), 10-25, for #53 of map #29. Revised the same day after an independent Opus second opinion (§14). For: Martin (the questions at the end), the build tickets of part 2. Decision log: `2026-10-25-guest-payment-decision-log.md`.

# How the guest page pays: the payment commands, the route, the provider's notices, and where each call runs

Built on these, which stand:
- D98 and D126: one `PaymentProvider` interface, no provider name in the platform, Stripe first;
- D124 §1: a bar is optional;
- D121: the guest API, polling, action ids, the knock;
- D122 §8: the route and the order of steps (choice B), safety, the receipt;
- D122 §9: `applyService`, the simulated provider;
- D125: Stripe, direct charges, the restricted key, notices, timeouts, tip;
- round 1:
  - §6.6's invisible deadlines;
  - §6.7's one write at a time per table;
  - §6.10 pay-first on a payment table;
  - §8.1's queue per bar and 60 s wait;
- `stack.md`'s import rules;
- the Stripe facts in `2026-10-22-stripe-knowledge.md`.

Each technical choice below is the lead's. Behaviour, wording and guardrail changes are in "Questions for Martin".

## 1. In one paragraph

1. The guest ticks lines (or the whole bill) and taps **Pay**.
2. The web app records a payment and queues it.
3. The worker reads the real table fresh, prices the lines from the POS's own amounts, and asks the provider for a hold.
4. The paying phone shows the lines, the total and the provider's card form. The guest pays, and the provider holds the money.
5. The worker reads the hold back from the provider, never trusting the phone.
6. It takes a free payment table of the table's bar and moves the lines there.
7. It reads them back (the last check).
8. It closes that bill with the card payment and captures.

**Every write is recorded before it is attempted and after it answers.** Until a close has been attempted, any failure releases the hold and puts the lines back. Once a close has been attempted, Restro never undoes: it either captures or keeps the hold and asks staff.

Other phones see the lines greyed "Being paid", with no name and no timer.

## 2. Where each piece runs

| Piece | Runs in | Why |
|---|---|---|
| Guest commands (start, return, cancel) | `apps/web`, `POST /api/guest/actions` (D121) | The same path as every guest command: table code header, action id, Turnstile, limits. The web never calls the provider or the POS. |
| Pricing, the hold, the route, capture, release | `apps/worker`, pg-boss jobs | `stack.md`: only the worker imports a provider package and calls a provider. The route already needs the worker (POS writes). |
| The provider's notices | `apps/web`, `POST /api/payments/notices/<kind>` | The endpoint must be public; the worker isn't. It is a platform-level inbox with no venue (§8). |
| The card form | The guest page, in the browser | The **page** loads the provider's browser library, from `apps/web/src/connectors/<kind>/`, and hands it to the template as a slot. The face only places the slot (D72: faces only draw). |

**The worker creates the hold while the guest waits.**
- The paying phone shows "Preparing your bill…" and polls every 2 s (D121).
- Payments get their own pg-boss queue with a short check interval, so a job starts within about a second.
- Each payment's jobs run one at a time: a pg-boss `singletonKey` per payment.
- Calling the worker directly over the private network (the reveal pattern, #70) was rejected. It would put a provider call on a web request's path and add a second route into the payment.

**CLAUDE.md and `stack.md` need two changes**, both Q3 (guardrails only tighten, so Martin decides):
1. **The import line** today says "Only `apps/worker` imports a connector package (`barsy`)". Proposed:
   > Only `apps/worker` imports a connector package or a payment provider package. The web app checks a provider's notice signatures and loads its card form only through `apps/web/src/connectors/<kind>/`.
2. **`stack.md`'s list of who may import `@restro/core/service`** ("the guest API routes, the admin's server actions and the worker") gains the provider notice route. It may call one function only, `recordProviderNotice`, which writes only `provider_notices`.

dependency-cruiser and the write-target guard get the matching rules.

**Rule 3 is unchanged:** no POS id reaches the browser, and no URL carries a provider value (§11, redirects). The two provider values the card form needs travel only to the paying phone, in that payment's answer:
- the payment's client secret;
- the venue's provider account id, which Stripe's library requires for a direct charge.

Neither is ever in a snapshot, a URL or another phone's state, and neither is a POS id.

## 3. The guest commands

All go through `POST /api/guest/actions` with an action id (D121). Each refusal has a code the template turns into words.

| Command | What it carries | What it does | Refused with |
|---|---|---|---|
| `pay.start` | The lines and a quantity per line (or `wholeBill`), the lines as the phone saw them (the knock), the tip, the Turnstile token | Records a payment `requested`, greys the lines for every phone, queues `payment.prepare`. Answers with the payment id and a **payment handle**: a random secret only this phone holds, used to read and act on its own payment. | `paying_not_offered`, `paying_paused`, `being_paid` (a picked line is already in a payment), `bill_changed` (knock), `below_minimum`, `ask_waiter_to_split` (whole-bill discount, D122 §8), `turnstile`, `rate_limited`, `sitting_ended` |
| `pay.returned` | The payment handle | The phone is back from the card form, a 3-D Secure step or a redirect. Queues `payment.check`, which reads the hold from the provider. The phone's word is a nudge, never a fact. | `unknown_payment` |
| `pay.cancel` | The payment handle | Only before the hold. It moves the payment to `cancelling` (compare-and-set, §7), then the worker cancels the provider's payment and the grey goes. If the hold won the race, the cancel is refused. | `too_late`, `unknown_payment` |
| `send` (D121), with pay-first lines | As today, plus the tip for the pay-first part | On-the-bill lines are sent as now. The pay-first lines become a payment of their own (§5.2), started as `pay.start` is. | As `send` and `pay.start` |

**The tip** is chosen before Pay and is part of the hold (D125 3.10).
- It is carried as its own amount: `amount = lines + tip`.
- All amounts are integer minor units through the `money` module (rule 8). A percentage tip is computed there and rounded half-up.
- It reaches the POS as `tipMinor` on the close (§10), only where the connector declares `recordTipOnClose`: the connector puts the tip **on the same bill and fiscal receipt**, its own way (a tip field, or a "Бакшиш" line in tax group А with no VAT). The NRA's opinion of 23.10.2025 requires a card tip on the fiscal receipt (`2026-10-25-tips-research.md` §6). Elsewhere no tip is offered (Q1).
- The tip starts at zero: presets are allowed, none is preselected (consumer law, ЗЗП чл. 62д). The guest is told it goes to the venue. It is never called a service charge, which would carry VAT.
- Where and how tips are offered on screen is #45.

**The payment handle** is a 128-bit random value.
- The web stores only its hash, as with table codes (D122 §9).
- It is never logged and never in a URL; the page keeps it in `sessionStorage`.
- It replaces any phone identity: other phones at the table never get it.

**`GET /api/guest/payment`** (handle in a header) answers the paying phone. It carries:
- the state;
- the priced lines and total, once known;
- while the hold is being collected, the form's two values.

The phone polls it every 2 s while the payment isn't final.

## 4. What every other phone sees

The table's state (D121) gains `beingPaid: true` on each line while that line is in a payment that isn't final.
- It carries no payer, no amount and no timer (round 1, 3.2 and 6.6).
- When the payment is captured, the line reads as paid from the next reading. When it is released, the grey goes.
- A friend's `pay.start` on a greyed line is refused with `being_paid`.
- Lines are picked whole wherever the connector can't move part of a line's quantity.

## 5. The route

### 5.1 On-the-bill lines (D122 §8, choice B)

**How steps are recorded.**
- Every state change is a compare-and-set through `applyService`, from the state the job expects. Two jobs racing for the same change (a notice and `pay.returned`, or a cancel and the hold) can't both win.
- Every POS or provider write is recorded as `attempting` in `payment_steps` before the call, and as `done`, `refused` or `unknown` after.

| # | State | Who | What happens |
|---|---|---|---|
| 1 | `requested` | web, `pay.start` | The knock is checked against the latest reading, the lines are greyed, and `payment.prepare` is queued in the same transaction. |
| 2 | `priced` | worker | Restro reads the real table fresh (`readTable`). A picked line that changed or went → `bill_changed`, as the knock does. A partial reading concludes nothing: retry, never refuse (D122 §6). The amount is the POS's own line amounts for the picked quantities, never price × quantity, plus the tip. Below the provider's minimum → `below_minimum`. |
| 3 | `awaiting_guest` | worker | The provider creates the payment as a hold (`createHold`), with an idempotency key made from the payment id. The form's values go to the paying phone. |
| 4 | `held` | worker | Triggered by `pay.returned` or the provider's notice, whichever comes first. Restro reads the payment from the provider (`readPayment`) and needs a hold for exactly the amount. Anything else stays `awaiting_guest` until the deadline. |
| 5 | `queued` | worker | The payment joins its bar's queue (the venue's queue where the table has no bar, D124 §1). It takes a free payment table of that bar after reading the table empty. All tables busy → it waits. After 60 s of waiting: released, `busy` ("Paying in the app is busy, try again in a minute or call a waiter"). Every wait over 10 s is counted. |
| 6 | `isolated` | worker | `isolateLines` moves the picked quantities to the payment table, holding the real table's write turn (round 1, 6.7), so no Send writes that bill at the same moment. |
| 7 | `checked` | worker | The last check (D122 §8): `readIsolated` must show exactly the confirmed lines and amounts, and the table still open. Any extra line, missing line or earlier close → `undoIsolate` (again holding the real table's turn), release, staff alert. A lower amount is captured only after a fresh read of the real table shows the missing line was voided. |
| 8 | `closed` | worker | `payAndClose` with the amount, `tipMinor` and the card payment type. |
| 9 | `captured` | worker | `capture` with the closed amount and an idempotency key. The guest sees "Paid". |

**What counts as closed (step 8):**
- `payAndClose` answered done;
- or the connector refused with `already_done` (a second close of the same bill);
- or a read of the payment table shows a closed bill carrying Restro's reference or a receipt number.

An empty payment table alone is not proof: a waiter may have moved the lines.

**Once a close has been attempted,** the payment never goes back:
- it is captured on proof of the close;
- or it becomes `unconfirmed` (§5.3).

**Owning the payment table.** A payment owns its payment table from step 5 until it reaches a final state and a read shows the table empty again. No lock runs out while the payment is still open. A payment the worker lost is finished or undone by the recovery job (§6), never overtaken by another payment.

**Final states:**
- `captured`;
- `released` (with a reason);
- `unconfirmed`: held, waiting for staff;
- `stranded`: lines couldn't be moved back; staff alert (round 1 9.11);
- `capture_failed`: the bill is closed but the provider refused the capture; an alert to the owner, because the venue is owed money.

### 5.2 Pay-first lines (round 1, 6.10)

Nothing pay-first is on the POS before it is paid.

**Offered only where the connector can do it:** it must declare that the first items on an empty table open a bill, and that `addLines` there returns the new bill's reference. The connector interface needs that return value (a part 2 ticket). Elsewhere pay-first items can only be ordered to the bill or through a waiter.

**The steps:**
1. **`priced`:** from the published menu's prices for those items. On a POS venue these are the POS's own prices (rule 5: Restro never re-prices).
2. **`awaiting_guest`, `held` and `queued`:** as in §5.1.
3. **`entered`:** `addLines` puts the round on the free payment table, with the note "for Table 7" where notes reach the ticket. The round now prints at the bar (D122 §1), so it can't be taken back.
4. **`checked`:** the last check, as in §5.1.
5. **`closed`** and **`captured`:** as in §5.1.

**After `entered`, Restro never releases on its own.** If the POS's amount on the payment table differs from the hold:
- **Lower:** capture the POS's amount.
- **Higher,** or any check that fails: the hold is kept and staff decide, as `unconfirmed` (§5.3).

### 5.3 Unknown outcomes and staff answers

| Step | Unknown outcome | What happens |
|---|---|---|
| `createHold` | timeout or a server error | Read back by the payment's metadata. If none exists, release whatever the key created and refuse "Try again". No client secret has reached a phone, so a leftover payment is harmless. Stripe replays a stored server error for the same key, so the key is never retried for ever. |
| `isolateLines`, `undoIsolate` | timeout | Read both tables back and resume or undo from what the reading shows. |
| `addLines` (pay-first) | timeout | Read the payment table. Found → continue. Not found → it may still print, so `unconfirmed`. |
| `payAndClose` | timeout, and the read-back shows no proof either way | **`unconfirmed`:** the hold is kept, and staff get "Payment unconfirmed" (merged fix 1, D122). A manager's or owner's answer decides: "Receipt printed" → capture; "No receipt" → release and move the lines back. |
| `capture` | timeout | Read the payment back; retry with the same key (round 2 §5.2). |
| `capture` | refused | `capture_failed` (§5.1). |

**The hold's expiry.** `capture_before` is read from the provider and stored.
- An `unconfirmed` payment reminds staff again at half the time left and with 24 h left.
- A hold that expires uncaptured becomes `released` with reason `expired`, and the end-of-night page lists it.

## 6. Deadlines, the queue and recovery

| Deadline | Value | From | When it passes |
|---|---|---|---|
| Confirm | 2 min | the form's values reach the phone | Restro reads the provider's payment. Still waiting for the guest's bank (`requires_action`) or already held → extended to the session limit. Otherwise cancel and ungrey (round 1 §6.6). |
| Provider session | 10 min | the form's values reach the phone | Cancel and ungrey |
| Wait for a payment table | 60 s | `held` | Release, `busy` (round 1 §8.1) |

**The recovery job** runs at worker start and every 30 s.
- It finds payments whose last step has been `attempting` or unchanged for too long, and acts from the last recorded step:
  - before a close was attempted: finish or undo;
  - after: prove the close and capture, or `unconfirmed`.
- Every provider call carries an idempotency key and every POS write carries Restro's own reference (D122 §3), so repeating a step is safe.
- A payment table is never left in an unknown state (round 1 §8.1).

**The provider breaker** (D125 2.4) is per venue account and follows D120's rule:
- no provider call has succeeded for 60 s, with at least 3 attempts → paying pauses;
- it lifts the same way;
- ordering to the bill goes on;
- lost access (`account.application.deauthorized`, or the account losing card payments) pauses paying at once.

## 7. The records (service data, D122 §9)

New tables, written only through `applyService`, with `source`, `actor` and `job_id` NOT NULL. The write-target guard test pins them to `core/service`.

| Table | One row per | Holds |
|---|---|---|
| `payments` (`py_` ids) | payment | venue, real table, bar, sitting, kind (`on_bill`, `pay_first`), state, the handle's hash, amount and tip in minor units, currency, deadlines, payment table, provider kind, the provider's payment reference, `capture_before`, the receipt number and fiscal memory number (once the close or a read shows them), the retention date. Tenant RLS. |
| `payment_lines` | picked line | the POS line reference (backend only, rule 3), the quantity, the POS's amount, the name the guest saw. Tenant RLS. |
| `payment_steps` | write attempt, append-only | step, outcome (`attempting`, `done`, `refused`, `unknown`), the connector's or provider's answer in short, the idempotency key, time. Tenant RLS. |
| `provider_notices` | provider event | provider kind, event id (unique), live or test, the provider's account reference, type, received time, handled time. **Platform-level, no venue:** the web role may only insert into it. The worker maps the account to the venue when it handles the notice. |

**Dispute evidence** (D122 §8) is read from these rows plus the 3-D Secure result and the authorisation code, read from the provider at capture.
- Retention is 18 months, as D122 says, set by the service path.
- No card digits and no phone, device or IP identifier are stored (D111).

**The Log** records each step that staff should see: held, moved, closed, captured, released, unconfirmed, capture failed, and staff answers.

## 8. The provider's notices

**Receiving:**
- **The endpoint:** `POST /api/payments/notices/<kind>`. It reads the raw body and checks the signature with the provider's web part.
- **Refused and counted:** anything unsigned, stale (Stripe's 5-minute tolerance), or whose live/test flag doesn't match this environment. While a secret is being rolled, any of the signatures in the header may match.
- **Storing:** `recordProviderNotice` inserts the notice by its event id and queues a worker job in the same transaction. A duplicate is answered 200 and dropped.

**Acting.** The job never trusts the event's copy: it reads the object back from the provider (D125 3.8), so events arriving out of order do no harm. The events Restro acts on, always by reading back (Stripe names):

| Events | What Restro does |
|---|---|
| `payment_intent.amount_capturable_updated` | A hold arrived: run step 4 |
| `payment_intent.canceled`, `payment_intent.payment_failed` | Check against the record |
| `charge.refunded` | Record a refund the venue made in its dashboard and add the storno to-do (#54) |
| `charge.dispute.created` | Mark the payment "Disputed" (#54) |
| `account.updated` | Check the connection; pause or lift paying |
| `account.application.deauthorized` | Lost access: pause paying at once (D125 2.4) |

**The signing secret** lives only in the web app's environment, like the other notice secrets (`stack.md`).

**A missed notice** is covered by the recovery job, which reads every open payment back. A provider that sends refund notices needs no daily list (D122 §8).

## 9. Limits

- **Turnstile** at `pay.start` and at a Send that has pay-first lines, the same rule as Send (D121). It fails open only when Cloudflare itself can't answer, and every such case is counted.
- **Per phone** (D122 §4's random value):
  - one `pay.start` per 15 s, five per 10 minutes;
  - at most one payment that isn't final.
- **Per table:**
  - at most 3 payments that aren't final;
  - a line can be in only one payment at a time (the grey).
- **The smallest card payment** is a venue setting (Martin, Q2). It starts at the provider's declared minimum (€0.50 for Stripe) and can be raised, never set below that minimum. Below it, Pay is greyed with the line in Q2. The setting sits with paying in Settings (#61).
- The table-code and Cloudflare limits of D122 §4 and D121 apply unchanged.

## 10. The interfaces (the platform's view, D98)

**`PaymentProvider`** is POS-neutral and provider-neutral. It sits in the integration layer beside the service connector; the worker holds the implementations, and the web holds the notice part.

```ts
interface PaymentProvider {
  readonly kind: string                       // 'stripe', 'sim'
  readonly capabilities: {
    holdDays: number                          // the shortest hold window the provider promises
    partialCapture: boolean
    wallets: readonly ('apple_pay' | 'google_pay')[]
    refundNotices: boolean                    // false → the daily list of D122 §8 is needed
    minimumMinor(currency: string): number
  }
  // Connection (D125 2.1–2.4; #61 designs the screens)
  startConnection(venue): Promise<{ redirectUrl: string; accountRef: ProviderRef }>
  readConnection(accountRef): Promise<{ canTakePayments: boolean; missing: readonly string[] }>
  prepareDomain(accountRef, host: string): Promise<WriteOutcome>   // wallets
  // Paying
  createHold(req: { paymentId; accountRef; amountMinor; currency; idempotencyKey; description })
    : Promise<WriteOutcome<{ paymentRef: ProviderRef; form: ProviderFormValues }>>
  findByPaymentId(accountRef, paymentId): Promise<Reading<ProviderPayment | null>>  // read-back after a timeout
  readPayment(accountRef, paymentRef): Promise<Reading<ProviderPayment>>  // status, held, captured, capture_before, 3DS, auth code
  capture(req: { accountRef; paymentRef; amountMinor; idempotencyKey }): Promise<WriteOutcome<ProviderPayment>>
  release(req: { accountRef; paymentRef; idempotencyKey }): Promise<WriteOutcome<ProviderPayment>>
}

// In apps/web/src/connectors/<kind>/ only:
interface ProviderNoticeVerifier {
  verify(rawBody: string, headers: Headers, secret: string, now: Date, live: boolean)
    : { ok: true; notice: { id; type; accountRef; objectRef } } | { ok: false; reason }
}
```

**Notes on the provider interface:**
- **There is no refund.** D122 §8 and D125 3.5 take refunds out of Restro's key, which narrows D98's list. Refunds are observed through notices.
- **Statuses:** `ProviderPayment.status` is the platform's own set:
  - `awaiting_guest`, with `needsGuestAction` while the guest's bank asks for a step;
  - `held`, `captured`, `released`, `failed`.
- **Unknowns:** a timeout is `unknown`, and a partial reading concludes nothing, as in the service connector.
- **Tests:** one conformance suite runs on `sim-pay` and on the Stripe package, the latter against the sandbox, like the connector suites (D122 §9).
- **The page's form part** is the provider's browser code. It mounts the form into the template's slot from `ProviderFormValues`, reports `returned`, and never decides an outcome.

**The service connector changes** (part 2 tickets, in `packages/core/src/connectors/service/`):
- `PayAndCloseRequest` gains `tipMinor`;
- capabilities gain `recordTipOnClose`: the tip lands on the same bill and fiscal receipt. barsy has a built-in "Бакшиш" item, added as a line; whether its API can add it, and its fiscal setup, are connector questions for Lukanet and for Mistral;
- `addLines` on an empty payment table returns the new bill's reference, where the capability "first items open a bill" is declared.

## 11. Stripe in this design

- **Payment Intents, not Checkout Sessions.** Stripe's guide recommends Checkout Sessions with the Payment Element. But completing a Checkout Session needs a valid customer email, and D125 3.7 forbids sending the guest's email. Payment Intents also keep the route's state in Restro alone and the key smaller.
- **`createHold`:** `POST /v1/payment_intents` with:
  - the venue's account in the `Stripe-Account` header;
  - `amount`, `currency=eur`, `capture_method=manual`;
  - `payment_method_types=[card]`: cards, which include Apple Pay and Google Pay. Other methods have other hold windows or need redirects;
  - `payment_method_options[card][request_three_d_secure]=any`: the bank's check on every payment (Martin, Q4);
  - `metadata[restro_payment]=py_…`;
  - an `Idempotency-Key`;
  - no `receipt_email`, no customer.

  The form values are the client secret and the venue's account id, for `loadStripe(..., { stripeAccount })`.
- **The browser:**
  - `@stripe/stripe-js` is loaded by the page, with the Payment Element and `confirmPayment({ redirect: 'if_required' })`. With cards only, 3-D Secure opens inside the page and nothing redirects.
  - A `return_url` on the guest page covers a redirect if one ever happens. Stripe adds the payment's id and client secret to that address, so the page strips them with `history.replaceState` before it makes any request or loads anything else. Then it reads the handle and table code from `sessionStorage` and sends `pay.returned`.
  - The page's Content-Security-Policy allows Stripe's script, frame and API hosts.
- **`readPayment`:** `GET /v1/payment_intents/{id}?expand[]=latest_charge`. It reads `amount_capturable`, `capture_before`, the 3-D Secure result and the authorisation code. **`findByPaymentId`:** the search by `metadata['restro_payment']`.
- **`capture`:** `POST …/capture` with `amount_to_capture`. A partial capture releases the rest; only one capture is allowed. **`release`:** `POST …/cancel`.
- **The key** (D125 3.5, refined):

  | Resource | Access |
  |---|---|
  | Payment Intents | write |
  | Charges, Disputes | read: `capture_before`, the 3-D Secure result and refunds sit on the charge |
  | Refunds | none |
  | Payment Method Domains | write |
  | Connected accounts | as the connection needs (#61) |

  Sandbox test 1 checks that this key refuses a refund and still reads the charge.
- **Notices:** one Connect endpoint ("Events from connected accounts"). Signatures are checked by hand per Stripe's documented scheme: HMAC-SHA256 over `timestamp.body`, any `v1` signature in the header matching. The web needs no Stripe SDK.
- **Packages** (the tickets will name them):
  - `stripe` (stripe-node) in `packages/payments/stripe`;
  - `@stripe/stripe-js` in `apps/web`;
  - `@stripe/react-stripe-js`, if the form part uses React.

## 12. For the template contract (D122: the template agent comes last)

`packages/shell/src/services.ts` and `docs/guides/menu-template-functionality.md` gain:
- the pay commands and their refusal codes;
- `beingPaid` on bill lines;
- the paying phone's payment state;
- the tip input;
- a **form slot** the face places and the page fills.

The face never loads a provider library.

## 13. Before the pilot, in the sandbox

1. **The key:** refuses `POST /v1/refunds`; still creates, captures and cancels with `Stripe-Account`; reads the charge through `expand[]=latest_charge`.
2. **The hold, captured:** reaches `requires_capture` and captures, partially too.
3. **The hold, released:** a cancelled hold costs nothing in the balance.
4. **Notices:** a test connected account's events reach the endpoint with valid signatures; the live/test check holds.
5. **Wallets:** Apple Pay and Google Pay show on a real phone with the domain registered through the API. Read `capture_before` on a wallet payment.
6. **3-D Secure:** Stripe's 3-D Secure test cards complete inside the page with no redirect.

## 14. What the second opinion changed

The independent Opus review found nine points to fix and several smaller ones; all are folded in above:
1. Writes are recorded before they are attempted; once a close is attempted Restro never undoes, `already_done` counts as closed, and "closed" needs proof (§5.1, §5.3).
2. A payment owns its payment table until final and empty; state changes are compare-and-set; one job per payment at a time (§2, §5.1).
3. Moves take the real table's write turn (§5.1).
4. Pay-first never releases after the round is entered, and is offered only where the connector returns the new bill (§5.2, §10).
5. `tipMinor` and `recordTipOnClose` (§10).
6. The key reads Charges and Disputes (§11).
7. The notice inbox has no venue and needs Martin's guardrail answer (§2, §7, Q3).
8. 3-D Secure (Q4); receipt and fiscal memory numbers stored (§7).
9. Cards only, and the redirect address cleaned before use (§11).

Smaller points taken:
- read the hold window from `capture_before`;
- release a stuck hold instead of retrying its key;
- a partial reading retries;
- tables with no bar use the venue's queue;
- whole lines where partial moves aren't possible;
- `capture_failed`;
- several signatures accepted during a secret roll.

Cuts:
- the phone's "confirming" command (replaced by reading the payment at the 2-minute mark);
- the daily list for Stripe;
- the one-call pay-first branch.

Kept as Martin decided in round 1: the 60 s wait for a payment table releases the hold. The reviewer notes a longer wait would be safe while the hold lasts; that is Martin's to reopen if the pilot shows it.

## Questions for Martin

- **Q1. Tips where the till can't record a tip.** Martin (10-25): research how barsy, Square and pay-at-table apps handle tips first. Done: `2026-10-25-tips-research.md`. Square, Toast and Stripe's readers put the tip on the card payment; barsy adds a "Бакшиш" line to the bill; Sunday keeps it in its own system where the till can't. In Bulgaria a card tip must be on the fiscal receipt (NRA, 23.10.2025), so keeping it only in Restro would leave the venue without a receipt line. Updated recommendation:
  - tips show wherever the till can put the tip on the same receipt (barsy's "Бакшиш" line, once Lukanet confirms its API can add it);
  - elsewhere no tip in the app for now. A day-end tip receipt is possible, but only if the venue's accountant confirms it;
  - the tip starts at zero, with presets and none preselected, and says it goes to the venue.

  **Answered yes (10-25).** Binding text: D127.
- **Q2. Below the smallest card payment.** **Answered yes (10-25)**, and the amount is adjustable: Pay is greyed with "Card payments start at €0.50. Add an item or ask your waiter.", the amount being the venue's setting (§9).
- **Q3. Let the web app take Stripe's messages.** Two rule lines change:
  - CLAUDE.md: the web app may check Stripe's message signatures and show Stripe's card form, only through its own `connectors` folder;
  - `stack.md`: the one route that receives Stripe's messages may write them into a single inbox table and nothing else.

  Every Stripe call still runs in the background worker. **Answered yes (10-25).**
- **Q4. The bank's check on every card payment.** The bank's check (3-D Secure, the confirm-in-your-bank-app step) can be asked for on every payment, or left to the bank, which often skips it under €30. Asking every time protects the venue if a guest later disputes the charge: the bank, not the venue, then carries the loss. Sometimes it adds one tap in the guest's bank app. **Answered yes (10-25):** ask every time.
