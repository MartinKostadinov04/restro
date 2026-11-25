# A10b: Decision reader for PAYING (D113, D125, D126, D127, D122 §8, rules 7 and 8)

Pinned commit `16b59a82` (checked: `git rev-parse HEAD` in `rr-pinned` = `16b59a823d3a27c72bd2031bd7b44588df3ba366`). Read-only: no test, build, migration, POS or Stripe call was made. Decision files D113, D122, D125, D126, D127 all exist on this branch. No two decisions contradict each other (one overlap, D122 §8's daily refund check vs D127 4.7, is a refinement D127 states itself).

Paths are relative to the pinned worktree. `payments.ts` = `apps/worker/src/jobs/payments.ts`; `pay-route.ts`, `pay.ts`, `pay-first.ts`, `payment-refunds.ts` = `packages/core/src/service/`; `provider.ts` = `packages/payments/stripe/src/provider.ts`.

Verdicts: **holds** (code does what the statement says), **MISMATCH** (code differs; a candidate row below), **partial**, **not checked** (named in §4).

---

## 1. Statements per decision, with verdicts

### D113: payment mode per item, one switch per table (refined by D122 §5)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Each item has a payment mode, on the bill or pay first, venue default with a per-item override | holds | `packages/core/src/pay-first-settings.ts:88-94` (`itemPaymentMode`: own, else `settings.itemMode`); `send.ts:136-139` |
| 2 | One switch per table "Disable prepayments", off by default; when on, everything at that table goes on the bill (widened by D122 §5 to venue, bar/hall, table, most specific wins) | holds | `pay-first-settings.ts:70-81` (table, bar, area, venue); `send.ts:131-138` (`applies` false: no line is pay-first); `read.ts:498`. Default `applies: true`, i.e. the switch is off (`pay-first-settings.ts:33-38`) |
| 3 | The rule lives only in Restro; the POS only ever sees bills and payments | holds | the connector calls get no mode: `payments.ts:1197-1204` (`addLines` request), `payments.ts:1514-1531` (`payAndClose`) |
| 4 | Pay-first only where the POS can open a bill on an empty table (D122/D127) | holds | `pay-first.ts:96-103` (`firstItemsOpenBill`), `pay-first.ts:244-246` refuses `paying_not_offered` |
| 5 | Supersedes "an order is paid when placed": payment depends on item and table | holds | `send.ts:150-152` keeps pay-first lines off the bill part |

5 checked: 5 hold, 0 mismatch.

### D125: how a venue connects Stripe and how Restro uses it

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | One "Connect Stripe" button opening Stripe's hosted form; Restro never sees a password or key | holds | `provider.ts:386-413` (v2 account link, `account_onboarding`); web only relays the link: `apps/web/src/server/payments-connection.ts:43-88` (provider call is the worker's) |
| 2 | Each venue gets a NEW account through Restro, Accounts v2, full Dashboard, Stripe collects fees, venue carries losses | holds | `provider.ts:362-376` (`dashboard:'full'`, `fees_collector:'stripe'`, `losses_collector:'stripe'`) |
| 3 | Connecting an existing account is rejected; a removed-access account is never reused | holds | `payment-connection.ts:390-394` (`abandoned` → `keepRef` false → new account) |
| 4 | Connect/change/disconnect is a permission, Owner has it by default, needs a sign-in within 15 minutes | holds | `commands.ts:533-588` (`freshSignIn: true` on connect, disconnect, tick, `settings.paying_set`); `context.ts:171` (`FRESH_SIGN_IN_MINUTES = 15`); `permissions.ts:120` (owner holds all). `payment_account.return` has no fresh sign-in on purpose (`commands.ts:541-547`) |
| 5 | Paying on only when Stripe allows cards, card type chosen in the till, payment tables marked, Stripe receipt emails off | holds, with a note | `packages/core/src/payment-connection.ts:141-167`. Two of the four checks cannot be read and are the owner's own tick (`cardTypeInTill`, `receiptEmailsOff`, `:10-14`); a fifth, `legalDetails`, is added (D127 log 1.6) |
| 6 | Stripe slow: retry, pause by D120's breaker (no call succeeded for 60 s, at least 3 attempts); ordering goes on | holds | `breaker.ts:35-36` (`tripWindowMs 60 s`, `tripMinAttempts 3`); pause is `paying_paused_at`, never a `pauses` row (`paying-pause.ts:1-12`); `pay.ts:408`, `payments.ts:488` |
| 7 | Access removed or account cannot take payments: paying pauses at once, owners alerted with Reconnect | holds | `payment-connection.ts:665-718` (`accountLost`), `:580-652` (`accountObserved`); `pay.ts:403` refuses `paying_paused` |
| 8 | A held, unfinished payment is never charged after access is lost | **MISMATCH** (partial) | RR-A10b-5: the route past `held` has no account-state gate; the code relies on Stripe refusing the capture (`payment-connection.ts:17-19`, `pay-route.ts:34-35`) |
| 9 | Owner's Disconnect waits until no guest is mid-payment | holds | `payment-connection.ts:455-465` (refused `payment_in_flight` while any payment has `settled_at` null). Unconfirmed payments are final and do not block it; their capture still works after disconnect (`payments.ts:1660-1666` needs only `accountRef`) |
| 10 | Restro's key cannot refund; Restro's code has no refund call; a guardrail keeps it so | partial | no refund call anywhere in `packages/payments/stripe/src` or the worker (only `refunds.retrieve`, row 16). Nothing in code enforces a restricted key: Observation O2 |
| 11 | Apple Pay / Google Pay: guest domain registered on each venue's account by API at connection | holds | `provider.ts:429-448`; worker `payments/connection.ts:266-297` (`wallet-domain` retry) |
| 12 | No Stripe receipt: Restro never passes the guest's email to Stripe | holds | `provider.ts:472-483` (no `customer`, no `receipt_email`; metadata is only `restro_payment`) |
| 13 | One endpoint, signature-checked, each event stored once; act on the object read back, never the event's copy | holds | `apps/web/app/api/payments/notices/[kind]/handle.ts:85-105`; `signed-notices.ts:42-62`; `core/service/notices.ts:49-72` (`on conflict do nothing`); worker `provider-notices.ts:231-317` |
| 14 | Idempotency key on every create and capture; after any timeout the payment is read back | holds, one small gap | hold `payments.ts:502`; capture `:350-369`, `:1709-1738`; release `:634-660`. The wallet-domain create uses a fresh `randomUUID()` key each time (`worker/src/payments/connection.ts:272`): O7 |
| 15 | The tip is fixed before the hold and is part of it | holds | `pay.ts:489-503`, `holdAmountMinor` `:197-200` |
| 16 | Restricted key: Payment Intents write; Charges and Disputes read; Refunds none; Payment Method Domains write | **MISMATCH** | RR-A10b-4: `provider.ts:337` calls `stripe.refunds.retrieve` |
| 17 | Testing on Stripe's sandbox, never a venue's live account | holds | `config.ts:25-42` (live key only in production, test key never there) |

17 checked: 14 hold, 2 mismatch (rows 8, 16), 1 partial (row 10).

### D126: Stripe is the first provider; the pretend till stays

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Stripe is the first provider, one `PaymentProvider` interface, one package per provider | holds | `packages/payments/stripe`, `packages/payments/sim-pay`; `apps/worker/src/connectors.ts:45-62` |
| 2 | Direct charges on the venue's account, Restro never holds money (D98) | holds | `provider.ts:144-148` (`Stripe-Account` on every call), `:472-483` |
| 3 | Restro's key creates, captures and cancels only, never refunds | holds (code) | no refund method on the seam, none in the package; key enforcement is not code: O2 |
| 4 | Tests on the provider's test mode, never a live account | holds | `config.ts:35-40` |
| 5 | The pretend till (`sim-pos`) stays; refused in production | holds | `payments.ts:761` (`assertSimAllowed` for a `sim` integration) |
| 6 | The simulated payment provider stays as the test double; never in production | holds | `sim-pay/src/env.ts:12-16`; `connectors.ts:54-59` (built only with `WORKER_PAYMENTS_SIM=on`) |
| 7 | Going live needs the club's till connected (a payment is matched against the actual bill) | holds | `payment-connection.ts:232-244` (`readPayingOffer` needs `closeWithPaymentType && moveLinesToTable`) |

7 checked: 7 hold, 0 mismatch.

### D127: how the guest page pays

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Tips only where the till puts the tip on the same bill and fiscal receipt (`recordTipOnClose`) | holds | `pay.ts:496-498`, `pay-first.ts:277`, `payment.price` `pay.ts:696`, connector `toy-pos.ts` refuses a tip without the capability |
| 2 | Tip starts at zero, presets 5/10/15 % of the chosen lines, half-up, plus "Other amount", none preselected | holds, one looseness | `shell/src/paying.ts:42-54,127-146`; server `percentOfMinor` = `ratioOfMinor`, BigInt half-up (`money.ts` `ratioOfMinor`). The server takes any whole percent 1-100 (`pay.ts:161`): O4 |
| 3 | Smallest card payment is a venue setting, starts at the provider's minimum, never lower; measured on lines plus tip | holds | `paying-settings.ts:45`, `pay.ts:505-506` (venue floor), `pay.ts:701-706` (provider minimum at pricing), `read.ts:519`; duplicate floor constant `CARD_FLOOR_MINOR = 50`: O11 |
| 4 | 3-D Secure requested on every card payment | holds | `provider.ts:478` (`request_three_d_secure: 'any'`) |
| 5 | Web app takes notices and loads the form only through `apps/web/src/connectors/<kind>/`; notice route imports only `recordProviderNotice` | holds | `route.ts:111-134`; `connectors/stripe/card-form.ts:1-5,18` (only `@stripe/stripe-js` importer). The dependency rule itself was not run: not checked |
| 6 | `pay.start`, `pay.returned`, `pay.cancel` through `POST /api/guest/actions`; payment handle random, only its hash stored, never in a URL or log | holds | `guest.ts:1184-1190,1274-1280`; `pay.ts:119-127` stores `handle_hash`; header `X-Restro-Payment` (`guest-api.ts:122-125`) |
| 7 | Other phones see `beingPaid` per line, no payer, amount or timer | holds | `guest.ts:241` (projection comment and field); not read beyond that: partial coverage |
| 8 | Worker makes every provider call in pg-boss jobs, one job per payment (`singletonKey`) | holds | `payments.ts:2176-2221` (`policy: 'stately'`), `queuePrepare` `:2038-2044`; web only queues (`guest-api.ts:318-324`) |
| 9 | "Returned" is a nudge; Restro reads the hold from the provider | holds | `pay.ts:572-592` (no state change); `payments.ts:2085-2147` |
| 10 | Notices: hand-rolled HMAC-SHA256 over `timestamp.body`, any `v1`, 5-minute tolerance, live/test flag checked, stored once by event id, then a worker job reads the object back | holds | `signed-notices.ts:11-62`; `stripe/notices.ts:134-148` (`event.livemode !== live` → `wrong_mode`); `provider-notices.ts` (worker) |
| 11 | A notice arriving late or twice changes nothing | holds | `core/service/notices.ts:69` (dedupe), `payment-observe.ts:72-88` (absolute readings; equal reading → `changed:false`) |
| 12 | The route: priced from a fresh real-table read, the POS's own line amounts plus the tip (never price × quantity) | holds | `payments.ts:421-448` (`price` reads the table), `pay.ts:676-706` (compares quantity and POS amount per picked line), `holdAmountMinor` |
| 13 | held read back from the provider, never the phone's word | holds | `pay.ts:812-835` (status `held` and `heldMinor`, `amountMinor`, currency equal the payment's) |
| 14 | Order: held → queued → lines moved (real table's write turn) → last check → closed → captured | holds | `payments.ts:1976-1991` (`routeStep`), `pay-route.ts:518-568` (`payment.turn`), `:640-696` (`lastCheck`) |
| 15 | The queue: 60 s wait, then released "busy"; tables with no bar use the venue's queue; payment owns its table until final and read empty, no lock deadline | holds | `pay.ts:91`, `pay-route.ts:447-459`, `leases.ts:232-257` (`deadline` null), `pay-route.ts:473-501`, `payments.ts:1937-1944` |
| 16 | Every POS and provider write recorded `attempting` before the call; every state change a compare-and-set | holds | `payments.ts:813-859` (`writePos`), `:671-704` hold step, `pay.ts:993-1052` (`payment.step`); each command checks `payment.state` under row lock |
| 17 | Once a close is attempted, never undone or released; capture on proof (a done answer, `already_done`, or a closed bill read with Restro's reference or a receipt number); otherwise "unconfirmed"; an empty payment table alone is no proof | **MISMATCH** (two points) | RR-A10b-1 (`already_done`), RR-A10b-2 (the third proof is never read). Never-undo itself holds: `pay.ts:895-901`, `pay-route.ts:945-947`, `payments.ts:1378-1407` |
| 18 | Final states: captured, released (with a reason), unconfirmed, stranded, capture_failed | holds | `packages/db/src/schema.ts:2576-2582`, `pay-route.ts:226-251` |
| 19 | Timeouts are read back, never guessed (3.4) | partial | move, undo, release, capture: read back (`payments.ts:1059-1102`, `:648-660`, `:1708-1738`). Close: deliberately not read back (RR-A10b-2) |
| 20 | A stuck hold creation is released, not retried with the same key forever (3.15) | holds | `payments.ts:508-516,533-537`; `pay.ts:916-940` (`payment.hold_unknown`) |
| 21 | A closed bill whose capture is refused alerts the owner (3.14) | holds | `payments.ts:1698-1706`, `pay-route.ts:913-915` (`PAYMENT_CAPTURE_FAILED_KIND`, `money.follow_up`) |
| 22 | `capture_before` tracked; recovery job every 30 s; hold expiry settles `released`, reason `expired` | holds | `pay.ts:826`; `payment-recovery.ts:62,89-110`; `pay-route.ts:1174-1252` |
| 23 | Provider breaker per venue account; lost access pauses paying at once | holds | `payment-breaker.ts` (header), `payment-connection.ts:665-718` |
| 24 | New service tables written only through `applyService`; `payment_steps` append-only; no card digits, phone, device or IP stored; kept 18 months | holds | `table-access.ts:166-181` (`payment_steps` SELECT, INSERT only); `pay-route.ts:1235-1243` (`recordRetainUntil`); stored columns checked in `pay.ts:510-527`. Receipt number stored; fiscal memory number never: RR-A10b-3 |
| 25 | The receipt number and fiscal memory number are stored for dispute evidence (4.5) | **MISMATCH** (half) | RR-A10b-3 |
| 26 | Refunds and disputes observed by notice, never made by Restro (4.4); no daily list with Stripe's notices (4.7) | holds | `payment-observe.ts:1-8`; `stripe/provider.ts:9`. The `refundNotices` capability is declared but never read: O6 |
| 27 | Limits: Turnstile at `pay.start` and a Send with pay-first lines; per phone one start per 15 s, five per 10 min, one open payment; per table three open payments | holds | `guest.ts:1255-1272`, `guest.ts:1032-1044`, `guest-limits.ts:30,32`, `pay.ts:89,483-487`, `pay-first.ts:283-287`. Per-phone state is in memory (O3) |
| 28 | A line in one payment at a time | holds | `pay.ts:470-482` and the DB index `payment_lines_open_line_unique` (`0032_payment_commands.sql:16`), `pay.ts:546-547` |
| 29 | Pay-first only where the connector opens a bill on an empty table and returns its reference; after the round is entered Restro never releases on its own | holds | `pay-first.ts:96-103`; `pay.ts:895-901` (`enterAttempted`), `payments.ts:573-586` |
| 30 | Service connector gains `tipMinor` on the close, capability `recordTipOnClose`; `addLines` on an empty payment table returns the bill's reference | holds | `schemas.ts:347-370`; `payments.ts:1206-1208` |
| 31 | Stripe: Payment Intents, manual capture, cards only (wallets still show) | holds | `provider.ts:472-483` (`allowed_payment_method_types: ['card']`, the name the pinned API version `2026-09-30.endive` requires; comment `:467-469`) |
| 32 | A redirect's address is cleaned before any request | holds | `connectors/return-address.ts:201-253` (`cardReturnUrl` drops query and fragment; `cleanAddressBarOf`) |
| 33 | The restricted key reads Charges and Disputes as well as writing Payment Intents; Refunds none | **MISMATCH** | same as D125 row 16: RR-A10b-4 |
| 34 | Lines paid in the app stay greyed "Paid in the app"; a Pay refused "bill changed" clears only changed ticks; a friend's new round never refuses it | holds (server) | `pay.ts:447-458` (the knock covers the picked lines only); the phone never sends `pick:'whole'` (`shell/src/paying.ts:223-229`), so the whole-bill count check at `pay.ts:430` is not reached from the page: O10. UI greying not read: not checked |
| 35 | The pay screen: smallest payment on lines plus tip; paused: Pay greyed; off: no Pay button | holds | `shell/src/paying.ts:185-207`, `guest.ts:510-514` |
| 36 | The payment handle stays in the browser for the sitting, never in an address; same-amount warning within 15 min | holds | `shell/src/paying.ts:346` (15 min), `use-table-services.ts:40-82` (storage); not read in depth |
| 37 | Payment confirmation never looks like a receipt (no "фискален", no ЕИК/ДДС header) | partly checked | strings `shell/src/strings.ts:634-638,978-983` carry "not your receipt"; page layout not read |
| 38 | Electronic receipt: optional email, erased at close, never in a log, event or provider metadata; subject «Касова бележка от {venue}» | holds | `pay.ts:502` (dropped where the POS cannot issue it); `pay-route.ts:850-854` erases at close; `schema.ts:2564-2572` (states that may hold it); `payment-recovery.ts:196-216` (30-minute erase); `email-sender.ts:100-101`; `payments.ts:1503-1512` (held in memory only) |
| 39 | The 60 s wait for a payment table releases the hold (Kept) | holds | `pay-route.ts:447-459` |

39 checked: 32 hold, 3 mismatch (rows 17, 25, 33), 4 partial or only partly read (rows 7, 19, 36, 37).

### D122 §8 (paying in the app), the statements that bind code

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Every in-app payment goes through a payment table of the table's bar, one payment per payment table at a time | holds | `pay-route.ts:355-467` |
| 2 | Order: guest picks from a fresh reading; provider approves and holds; lines move and are read back; close and capture within seconds | holds | `payments.ts:1976-1991` |
| 3 | Last check: exactly the confirmed lines, table still open; any extra, missing or earlier close releases the hold, lines go back, staff alerted | holds | `pay-route.ts:640-696,756-761`, `payments.ts:1746-1770` |
| 4 | A lower amount only when a fresh read of the real table shows the missing line was voided | holds | `pay-route.ts:687-695` (`voided` needs the line absent from the real read by ref and by quantity+amount; `partialCapture` required) |
| 5 | "Payment unconfirmed" holds the money and alerts staff | holds | `pay-route.ts:857-861` |
| 6 | The provider's notices are signature-checked; unsigned ones dropped and counted; each stored once by id | holds, one wording point | dropped and logged (`handle.ts:92-95` `logWarn`); no counter exists: O12 |
| 7 | Restro's key can create, take and cancel payments only | partial | O2 |
| 8 | Refund the venue makes in its dashboard reaches Restro through the signed notice; a step on the payment record and a Log entry | holds | `payment-refunds.ts:153-160` (Log), `payment-observe.ts` |
| 9 | Each refund the provider reports is a refund row, each its own storno to-do | **MISMATCH** | RR-A10b-6 (RR-1 confirmed, and a second form) |
| 10 | A dispute marks the payment "Disputed", retention until 6 months after it closes; to-do with the answer-by date, leaves when won or lost | holds | `payment-observe.ts:32-39,126-179` |
| 11 | Where the provider declares no refund notice, a daily status check covers payments of the last 30 days | not implemented | O6 (D127 4.7 narrows this for Stripe) |
| 12 | The payment type: Restro closes with a card type | holds | `payments.ts:1525` (`paymentType: null`, the connector picks its card type; the code comment says "no venue setting yet") |
| 13 | Dispute evidence on the payment record: lines and prices, each step with its time, real table, payment table, bar, money-alert answers, 3-D Secure result, provider payment id and authorisation code, receipt number and fiscal memory number | partial | all stored except the fiscal memory number: RR-A10b-3 (`pay.ts:826-828` 3DS and authorisation code; `payment_steps`; `pay.ts:510-527`) |
| 14 | Electronic receipt only where the POS declares it and the file is the device's own; paper otherwise | holds | `payments.ts:1503-1512`, `:1582-1621` (`pos_sent`, `file_sent`, `not_issued`) |
| 15 | Evidence kept 18 months from the service day, and while a dispute is open plus 6 months | holds | `payment-observe.ts:165-178` |
| 16 | No card digits and no phone, device or IP identifier kept | holds | `pay.ts:510-527`; `stripe/mapping.ts:128-167` maps no card number |

16 checked: 11 hold, 2 mismatch (rows 9, 13 via RR-A10b-3), 2 partial (7, 13), 1 not implemented (11).

### Rule 8 as it applies to payments (integer minor units, money module only)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | No `* 100`, `/ 100`, `toFixed`, `parseFloat` on amounts in the payment path | holds | grep over `packages/core/src`, `apps/web/src`, `apps/web/app`, `apps/worker/src`, `packages/shell/src`, `packages/payments`, `packages/connectors`: the only matches are non-money (theme, image crop, sim-pos control page `packages/connectors/sim-pos/src/control/page.ts:82`, a dev display) |
| 2 | Hold = sum of the POS's line amounts plus the tip, through the module | holds | `pay.ts:184-200` (`sumSignedMinor`, `addMinor`) |
| 3 | A percent tip rounds half-up | holds | `money.ts` `ratioOfMinor`: `(2·minor·num + div) / (2·div)` in BigInt; `pay.ts:190-194` |
| 4 | Partial capture never exceeds the hold; lowered amount is integer arithmetic | holds | `pay-route.ts:762-764` (`addMinor(found, tip)`, `heldMinor < amount` fails), `:897-899` (captured > amount refused), `pay-first.ts:583-587` |
| 5 | Stripe amounts are integers both ways | holds | `stripe/api.ts:31,40-42,86` (`z.int()`); `provider.ts:555` `amount_to_capture: req.amountMinor` |
| 6 | Storage is integer (bigint minor columns) | holds | `schema.ts:2668-2677,2859,2916` |

6 checked: 6 hold. (One note on rounding: when a capture is lowered for a voided line the tip is kept in full, as D127 fixes the tip before the hold: `pay-route.ts:762`.)

### Rule 7 as it applies to payments (a waiter's acts only, no back-office, no live POS in tests)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Writes into the POS on the payment path are all waiter acts: move lines to another table (`isolateLines`), move them back (`undoIsolate`), take a payment (`payAndClose` with card type and tip), add a round (`addLines`, pay-first), ask for the receipt (`receiptEmail` on the close) | holds | `payments.ts:806` (`RouteWrite`), `:1091`, `:1197`, `:1514`, `:1810` |
| 2 | No item, price, setting or user write on this path | holds | no other connector method is called in `payments.ts` |
| 3 | The web app never calls a POS | holds | web reaches the worker only for connection (`payments-connection.ts:54`); no connector import in `apps/web/app/api/guest/payment` or `/payments/notices` |
| 4 | Provider notices are fine, POS webhooks are not | holds | notices only, from the provider |
| 5 | Development and tests never run against a live venue's POS or Stripe | holds (code) | `config.ts:25-42`, `assertSimAllowed` at `payments.ts:761` |

5 checked: 5 hold. The only judgement point is RR-A10b-5 (the route may write a close at the POS for a payment whose account lost access).

---

## 2. Candidate rows

Format: id | proposed severity | file:line | text quoted | scenario | evidence | confidence.

**RR-A10b-1** | medium | `apps/worker/src/jobs/payments.ts:1533-1535` (and `:1367`) | D127: "It captures on proof of the close: a done answer, the connector's `already_done`, or a closed bill carrying Restro's reference or a receipt number." The connector contract defines the code as "The step was already done (a second close of the same bill)" (`packages/core/src/connectors/service/schemas.ts:65-66`) | The close is sent at most once (`writePos` refuses a second `payAndClose` attempt, `payments.ts:832-837`). So an `already_done` on that single call can never be Restro's own earlier close, yet the worker takes it as proof and captures the guest's card. If a connector answers `already_done` for a bill closed by someone else (a waiter settled the payment table's bill with cash between the last check and the close, about 2 s: `PAYMENT_WRITE_PAUSE_MS` plus the budget wait), then the guest is charged although Restro's close never landed and the venue was paid by the waiter: money taken twice. With `sim-pos` this cannot happen (it answers `bill_closed`, `connector.ts:575`, which leads to "unconfirmed"); with the test double `toy-pos` it does: `toy-pos.ts:386` (`if (bill === undefined \|\| bill.closed) return refused('already_done')`). The kit even accepts either code for a retry (`checks-write.ts:612`). No real connector's mapping exists yet | evidence: `const proof = outcome.kind === 'done' \|\| (outcome.kind === 'refused' && outcome.refusal.code === 'already_done')` (`payments.ts:1533-1535`); `proof ? 'done' : 'refused'` (`:1549`) | medium (the decision text endorses the code; the failure needs a connector that maps "closed by someone else" to `already_done`; the contract does not forbid it)

**RR-A10b-2** | medium | `apps/worker/src/jobs/payments.ts:1378-1407` (header `:31-33`) | D127: "Timeouts are read back, never guessed (3.4)" and "capture on proof ... or a closed bill carrying Restro's reference or a receipt number." | If the close times out ("unknown") but landed at the POS, Restro never reads the bill back: it waits the read-back window and then marks the payment "unconfirmed" (`payment.closed outcome:'unknown'`, `:1399-1405`), and a manager must answer "Receipt printed". Every close timeout therefore becomes manual work at the busiest hour, though D127 lists a read-back of the closed bill (its reference, or a receipt number) as proof Restro could use itself. The code is more cautious than the decision, so money is safe; the cost is the guest waiting and the manager answering | evidence: header comment "an unknown close is never read back as a close (an empty payment table is no proof)"; the branch at `:1378-1407` has no read of the bill; `readIsolated` (`:1417-1424`) is called only before a first close | high that the mismatch exists; severity medium because it fails safe

**RR-A10b-3** | medium | `payments.ts:1375,1405,1552` (and `PayAndCloseResultSchema`, `schemas.ts:433-455`) | D127 Records: "The receipt number and fiscal memory number are stored for dispute evidence (4.5)"; D122 §8 dispute evidence: "the receipt number and the fiscal memory number" | The fiscal memory number is written `null` on every path; the seam has no field for it (comment `:1552`: "The seam carries no fiscal memory number yet (#111 open question)"). If a guest disputes a payment, the venue's evidence page cannot show the fiscal memory number the decision requires. No money effect | evidence: `fiscalMemoryNumber: null` three times; `payments.fiscal_memory_number` is only ever set from this command | high (known gap, documented in the code)

**RR-A10b-4** | medium | `packages/payments/stripe/src/provider.ts:335-337` | D127: "The restricted key reads Charges and Disputes, as well as writing Payment Intents. Refunds stay none"; D125 3.5: "Charges and Refunds none" | `readNoticeSubject` resolves a `refund.created`, `refund.updated`, `refund.failed` or `charge.refund.updated` notice by `stripe.refunds.retrieve(...)` (`GET /v1/refunds/:id`). With the key D127 prescribes (Refunds none; the knowledge file's V29 line shows the local key set exactly so) Stripe answers 403 `more_permissions_required`, `get` returns "not ok" and "not missing", the reading is incomplete, and the notice waits unhandled (logged as an error after a day, `provider-notices.ts` job `NOTICE_LATE_MS`). The failed-refund notices are exactly the ones the "didn't go through" mark depends on (a `refund.failed` event does not come with `charge.refunded`); only `charge.refunded` (read through the charge) keeps working. The recorded conformance ran with the earlier key (L26: "Charges and Refunds Read") | evidence: `read = await get(RefundSchema, () => stripe.refunds.retrieve(objectId, {}, on(accountRef)))`; knowledge file lines 215 (L26 key) vs 224 (V29 key, "Refunds None") | medium (needs the real key; whether Stripe's retrieve is refused under "Refunds none" was not run by me)

**RR-A10b-5** | high | `payments.ts:1440-1448` with `pay-route.ts:1255` and `payment-recovery.ts:65`; the gate is missing at `payments.ts:1514` | D125: "Access removed, or the account can't take payments: paying pauses at once ... A held, unfinished payment is never charged"; spec #102 problem statement: "never close a bill that wasn't paid"; code comment `payment-connection.ts:17-19`: "a held, unfinished payment is never charged because the provider refuses its capture" | Case A: the owner removes Restro's access in Stripe (or reconnects, which makes a NEW account and abandons the old one: `payment-connection.ts:390-394`) while a payment is `queued`, `isolated` or `checked`. The route runs on (no state gate between the hold and the close). Before the close it reads the hold: `readPayment` for the old payment under the old (or the new) account fails, `hold.complete` is false, the step throws `PaymentStepRetry("the hold could not be read")` on every run. The payment never leaves `isolated`: the guest's lines stay moved off the real table, the payment table stays owned (`payment.table_freed` needs a final payment), and nobody is told: `payment.stuck` covers only `requested`, `priced`, `cancelling` (`pay-route.ts:1255`, `payment-recovery.ts:65`), and `payment.expired` does not touch `isolated` (`pay-route.ts:1191-1197`). Case B: the account is only restricted (card payments off) while the hold is still readable: the route closes the bill at the POS, then the capture is the only thing left, and if Stripe refuses it the bill is closed with no payment ("capture failed" alert). In both cases the guest's card is not charged as D125 says, but the route does not finish | evidence: `if (!hold.complete) throw new PaymentStepRetry('the hold could not be read')` (`:1448`); `const STUCK_STATES = ['requested','priced','cancelling']`; open item 10 of the knowledge file ("What `GET /v2/core/accounts/:id` answers after the venue disconnects: unknown") | medium (rests on Stripe refusing reads on an abandoned or deauthorized account, which the knowledge file lists as unchecked)

**RR-A10b-6** | medium | `packages/core/src/service/payment-refunds.ts:116` and `:141-152` (RR-1 confirmed, plus a second form) | D122 §8: "Each refund the provider reports is a refund row on the payment, and each refund row is its own storno to-do"; D127 4.4 "Refunds and disputes are observed by notice" (knowledge file open item 12: "reconcile per refund, not per total ... a failed refund is matched by id") | Confirmed RR-1: a fall in the total marks the newest row whose amount equals the fall (`rows.find((row) => row.amountMinor === fallMinor)`), by amount, never by the provider's refund id. With 500 stored, a failed 500 plus a new 800 read as 500 → 800: a row of 300 is added and the failed 500 is not marked; the venue is told to storno a refund that never happened and a 300 one that was really 800. Second form (not in the ledger): two refunds of 500 and 300 made inside one reading interval (the job runs once a minute, `provider-notices.ts` job `cron '* * * * *'`, and reads only `amount_refunded`) become ONE row of 800 and ONE storno to-do, though the venue has two receipts to storno. Both come from the same cause: the seam gives one total, not the refunds (`ProviderPayment.refundedMinor`). The doc comment of the function states the first as a "Known limit" (`:94-99`) | evidence: `const failing = rows.find((row) => row.amountMinor === fallMinor)` (`:116`); `const amountMinor = subtractMinor(targetMinor, previousMinor)` one row per rise (`:142`) | high (the code says so itself); severity medium because the loss is bookkeeping at the till, not money moved

---

## 3. Observations (true, not concrete defects)

- **O1** `packages/db/src/table-access.ts:181`: the spec (#102 Implementation 2 and the Testing section) says the web role "may only insert into" `provider_notices`. The grant is `SELECT, INSERT, UPDATE` for the shared app role; the comment says the insert-only reach is pinned by dependency-cruiser (`notice-route-records-only`), not by a grant. D127 itself does not say "grant". Not run: the dependency rule.
- **O2** `packages/payments/stripe/src/config.ts:15-18,31-34`: `checkStripeKey` accepts `sk_` (unrestricted) as well as `rk_`, and `connectors.ts:35` says "secret or restricted key". D125 3.5 states Restro's key is restricted; nothing in code refuses a full secret key in production, so the "no refund" property rests on the key Martin creates plus a test file guard.
- **O3** `packages/core/src/service/guest-limits.ts` and `guest.ts:1245-1261,1315`: the per-phone limits and "one open payment per phone" live in process memory and are keyed by a header the page makes (`X-Restro-Phone`): a new header value, or a second web instance, is a new phone. The per-table limit of three (DB) and the per-line index stay the real guards.
- **O4** `pay.ts:161,493` and `guest.ts:1222-1226`: the server takes any whole percent 1-100 and an amount up to the lines' own total; D127 names 5/10/15 and "Other amount". The page only offers the presets.
- **O5** `pay-route.ts:896-899`: `payment.captured` refuses a capture above the hold but accepts one below it; a provider answering less than `amount_minor` would be recorded "captured" with the lower amount and no alert.
- **O6** `packages/core/src/connectors/payment/capabilities.ts:26`: `refundNotices` is declared by both providers and never read; D122 §8's "daily status check where the provider declares no refund notice" has no code (D127 4.7 narrows it for Stripe, so a provider with `refundNotices:false` would have no refund coverage).
- **O7** `apps/worker/src/payments/connection.ts:272`: the wallet-domain create uses `domain:<venue>:<randomUUID()>` as its key each time, unlike the account and link creates (`connect:<venue>:<attempt>`). D125 3.9 says "an idempotency key on every create"; Stripe's domain registration is naturally repeatable.
- **O8** `provider-notices.ts` (worker) `schedule: { cron: '* * * * *' }`: a `payment_intent.*` notice nudges the check up to a minute late; the phone's `pay.returned` and its poll cover the guest's wait, so the route is not blocked.
- **O9** `packages/core/src/service/provider-notices.ts:106-135` (`paymentAccountVenues`): reads every organisation, one transaction each, on every notice run that needs accounts; fine at pilot size, linear in tenants.
- **O10** `pay.ts:428-431`: the `pick:'whole'` path is not reached by the page (it always sends `lines`, `shell/src/paying.ts:223-229`); D127's "The whole bill ticks every line free to pay" is done on the phone. It would refuse a friend's new round as `bill_changed` if used.
- **O11** `packages/core/src/paying-settings.ts:13`: `CARD_FLOOR_MINOR = 50` duplicates Stripe's `MINIMUM_MINOR` (`provider.ts:80`); a second provider with another minimum would show a wrong floor to the phone (the worker's check at pricing, `pay.ts:701-706`, stays the truth).
- **O12** D122 §8 says unsigned notices are "dropped and counted"; `handle.ts:92-95` logs a warning with the reason, no counter. Whether a log-derived count counts is for the lead.
- **O13** `pay.ts:836-838`: a provider reading `released` while awaiting the guest settles with reason `expired` whatever caused the cancel (a bank decline that cancels the intent, an operator cancel in the Dashboard).
- **O14** `money.ts` `percentOfMinor` doc says "Only the preview adapter calls it; real tips ... come from the platform's quote (D72)", but `packages/shell/src/paying.ts:131-133` calls it at run time for the preset tip shown on the phone. Same function as the server's, so no rule-8 break; the comment is stale.
- **O15** `pay-route.ts:620` (last check) and `pay-first.ts:506-535` (`matchRound`): lines are matched by quantity and amount (and by POS item with `<=`), not by POS line id, because a line's ref across tables is not stated by the POS docs (`payments.ts:1856-1861`). Documented and fail-safe, but a waiter's equal line on the payment table is indistinguishable from Restro's.
- **O16** `guest.ts:16,878` ("paying is never located") against `apps/web/src/guest/services-client.ts:247` (`LOCATED` includes `pay.start`) and D127's bill screen ("No location pass means no bill"): the server does not need the location pass for `pay.start`, the page does. D122 §4 settles the server side.
- **O17** `provider.ts:480`: the intent's `description` carries the venue name and the table's name (`payments.ts:451-462`); no guest data, but it reaches the guest's bank/Stripe record. D125 3.7 only forbids email and customer.
- **O18** D125 2.3: two of the four turn-on checks are the owner's tick, not read from anything (`payment-connection.ts` core `:10-14`); a venue can tick "receipt emails off" while Stripe still sends them.
- **O19** Disconnect and unconfirmed payments: `unconfirmed` counts as settled, so an owner can Disconnect while a hold awaits a manager's answer (`payment-connection.ts:460-465`). The later capture still works (it needs only `accountRef`), but it is unrecorded in the decision that this is allowed.

---

## 4. What I could not cover

- **Not run:** no test, build, dependency-cruiser, migration or Stripe call. The `notice-route-records-only` and no-refund-call guardrails were read about, not executed; the Stripe sandbox facts come from `docs/deliverables/2026-10-22-stripe-knowledge.md`, not from a call.
- **Not read:** the guest page's visual layout and wording beyond strings (`apps/web/src/guest` UI, the face packages' pay panels, "Paid in the app" greying), the Payment confirmation page's layout, the owner's Paying settings screens (`apps/web/src/settings/paying-*`), Tonight's payment screens, `packages/core/src/service/alert-rules.ts` and `alert-delivery.ts` wording and the half-time and 24 h reminders (only seen to exist: `alert-delivery.ts:31-33,249-251`), `packages/core/src/service/payment-number.ts`, `paid-lines.ts`, `bill.ts`.
- **Only skimmed:** the Stripe `errors.ts` classification (which Stripe error is `refused` vs `unknown`), the breaker's pure logic (`breaker.ts` beyond its constants), `payments/connection.ts` (worker) beyond the domain and idempotency lines, `sim-pay` internals.
- **Not verified:** that the default Owner role holds `settings.connect_payments` beyond `permissions.ts:120`; that `restro_purge` erases `provider_notices` after 18 months (`table-access.ts:181` only); that the dependency-cruiser rule files match D127 1.6.
- **Tests were used as context only.** Where a statement is covered by a test I did not rely on it; each verdict above comes from the code lines cited.
