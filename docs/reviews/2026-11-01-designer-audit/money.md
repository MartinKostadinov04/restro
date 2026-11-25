# Designer audit, B2: money on the new screens

**Who:** agent B2 (Opus), audit plan step 2. **Pin:** `st/foundation` at `7dccd3a4`. **Worktree:** `E:/Restro/.claude/worktrees/da-money`. **Database:** `restro_da_money` (its own, local).

**What I covered:**
- the Editorial face's bag, Send and pay, tip row, paying screens, bill and Call a waiter (`packages/faces/editorial-market/src/services/`);
- the shell's `pay-first.ts`, `paying.ts`, `stock.ts`, `bag.ts` and `services.ts`;
- the guest client `apps/web/src/guest/services-client.ts` and `use-table-services.ts`;
- core's `send.ts`, `pay-first.ts`, `pay.ts`, `guest.ts` and `waiter-call.ts`;
- the card-form glob in `apps/web/src/connectors/`.

I checked all of this against D72, D116, D117, D119, D122, D127 and decision 131, and tickets #239, #258 and #180.

**Proving tests** (local branch `da/b2-tests`, commit `f5cfe5e9`, never pushed). A green test means the defect is present.
- `packages/core/src/service/da-b2-money.test.ts`: Postgres, as `restro_app`. 2 tests pass.
- `packages/faces/editorial-market/src/services/da-b2-money.test.tsx`: jsdom. 5 tests pass.

## Findings

| id | severity | where (pin) | rule / decision quoted | failure scenario | evidence | conf. |
|---|---|---|---|---|---|---|
| DA-B2-1 | high | `packages/core/src/service/send.ts:225-227` (`if (payFirst !== null && !payFirst.ok) return refused(...)`); `packages/faces/editorial-market/src/services/provider.tsx:616` (every Send carries `payFirst: payFirst.part`); `bag-sheet.tsx:376` (Send greyed only for sending, offline, paused or a bad tip) | D117 "Send sends the on-the-bill lines at once"; D127 "one tap sends the on-the-bill lines and opens the pay-first payment"; D127 "Below it, Pay is greyed"; D117 "Pay unlocks at the minimum" | The bag holds a beer on the bill and a gin paid first, and the pay-first part is refused. That happens when the gin plus tip is below the venue's `minCardMinor` (`pay-first.ts:281`), when the table has 3 open payments (`:287`), or when this phone has an open payment or used `payGap` in the last 15 s (`guest.ts:988, 1128`). Then every "Send and pay" is refused as a whole and the beer never goes. The button is never greyed below the minimum. Editorial has no control that sends the bill lines alone. The server would accept them alone. The guest has to delete the gin to get the beer. | core test: refused `below_minimum` and `rate_limited`; nothing sent, both lines kept; the beer alone is accepted. Face test "DA-B2-1": button live below the minimum, the retap still carries `payFirst`, it is the only Send. | 0.85 |
| DA-B2-2 | high | `packages/faces/editorial-market/src/services/call-sheet.tsx:107-117` (any ok outcome that is not `rejected` → `settle('sent')`); `apps/web/src/guest/services-client.ts:912` `unknown()` (a network error, a 5xx or an unreadable body gives `{status:'pending', code:'answer_lost'}` for every kind) | D72 "it never ... confirms a waiter ... itself", "It shows *pending*, then *accepted* or *rejected*"; the brief's scenario 7 "nothing claims success early" | If the Call a waiter answer is lost (phone offline, as the client doesn't block `service.request` offline; a 5xx; a dropped connection), the sheet shows "Request sent / We are waiting for the team to confirm it." There is no Try again. No request ever reaches the state, so the sheet stays there and the guest waits for a waiter nobody called. RR-50 fixed this for Send only (`provider.tsx:522`). | face test "DA-B2-2", first test | 0.8 |
| DA-B2-3 | medium | `packages/faces/editorial-market/src/services/pay-sheet.tsx:598-618` `CallWaiter()`: `onClick={() => void o.run({...})}`, result dropped | D72 "showing pending, then accepted or rejected"; D127 "Restro adds only 'Pay later' (before the hold), Call a waiter" | The Call a waiter on the card, checking, ended and preparing screens, and on the no-location bill screen, shows nothing: no pending while it goes, nothing when it is refused (`calls_off`, `table_not_open`), nothing when it is lost. A guest whose payment is stuck at "checking" taps it and can't tell whether anyone was called. They tap again, or they leave. | face test "DA-B2-3": the screen text is identical before and after a refused call, with no alert | 0.85 |
| DA-B2-4 | medium | `packages/faces/editorial-market/src/services/provider.tsx:444` `useState<TipChoice>(NO_TIP)`. The only setter is `setTip` (`:658`); nothing resets it after a Send or a payment. | D127 "the tip: ... nothing selected"; `paying.ts:49` "presets are never preselected" (consumer law, D127 log 1.3) | A guest picks 10 % and taps "Send and pay". Later, still on the page, they add another pay-first drink. The tip row opens with 10 % already pressed and in the amount. A guest who doesn't look pays a tip they didn't choose this time. | face test "DA-B2-4": after the first Send is accepted and a new pay-first line is added, `aria-pressed` is `[false, true, false]` and the button shows 11.00 | 0.75 |
| DA-B2-5 | low | `packages/faces/editorial-market/src/services/call-sheet.tsx:205-213` (hint is `rejected.hint` when `message === null`); `services-client.ts:905` (every answer has `message: null`) | D127 "refusals told plainly" (the brief's scenario 7); D121 one-line reason | Every refusal of Call a waiter reads "The team could not take this request / Ask your waiter.", whatever the code. Real causes: `calls_off`, `kind_not_offered` (a stale menu after the venue unticked a kind), `table_not_open` (sitting ended) and `rate_limited` (429). The guest isn't told that, for example, the table was closed. | face test "DA-B2-2", second test | 0.7 |

## Observations

| # | point |
|---|---|
| O1 | The server takes any `tipPercent` from 1 to 30 (`packages/shell/src/services.ts`, `SERVICE_LIMITS.tipPercentMax`) and core's `TipSchema` from 1 to 100 (`pay.ts`). The face sends only 5, 10 or 15. That isn't a defect, since a raw 30 % tip is still capped by the lines and is what the guest asked for, but "the server refuses what the face would never send" doesn't hold for percents. Negative, non-integer and string tips are refused by zod. An amount above the lines is refused `invalid_command`. A tip where the till records none is refused `tip_not_offered` (`pay-first.ts:276-277`). |
| O2 | The tip shown, held and captured is the same number. Shell and core use one `percentOfMinor` (half-up; `packages/shell/src/money-math.ts` re-exports core's `money.ts:207`). The card screen shows the server's `amountMinor`, not the face's sum. |
| O3 | An `order.send` refused `rate_limited` because of its pay-first part is worded with the order's text, not `paying.rateLimited` (`paying.ts` `refusalText` maps only `pay.*`). That is part of DA-B2-1's fix. |
| O4 | The face and core measure the minimum differently. The face reads `paying.minCardMinor`, which is the larger of the venue's value and the provider's floor (`paying-phones.ts:27`). Core's Send checks only the venue's value (`pay-first.ts:279`, `?? 0`, at least 1). Below the provider's floor and with no venue minimum, the Send is accepted and the worker's pricing refuses it later, so the payment ends "below_minimum" after the bill lines went. That is consistent, but the guest sees the refusal one step later. |
| O5 | When the server says an item is sold out but the overlay is still stale, the whole Send is refused `item_unavailable`, with the item named (`send.ts:151-158`). Editorial marks a line sold out only from a not-sent sent order (`stock.ts` `refusedOutOfStock`) or the overlay. A refused Send makes no sent order, so the line isn't marked, and a retap fails the same way until the overlay catches up. The notice names the item, so the guest can remove it. |
| O6 | A pay-first payment's entry (`apps/worker/src/jobs/payments.ts`) does no availability read before the hold, unlike order-send's #80 read. A sold-out item is caught by the POS refusal, then released with `item_unavailable` → "ended" with no Pay again (`paying.ts:311`). This is old or/foundation code. |
| O7 | The "waiting" pay screen (held, queued, entered, checked) has only a status panel: no Call a waiter and no way back. That is by design (D117 "Paying…" runs through the hold and the POS write), but if the worker stalls the guest has nothing to tap. Worth a time-out line. |
| O8 | Waiter calls read the venue's settings, not the published kinds (`waiter-call.ts` `readGuestFeatures(stx.venue.settings)`), and have no closed-night check. A kind unticked after publishing is refused as `kind_not_offered`, which DA-B2-5 words generically. |
| O9 | A lost answer on "Send and pay" holds the lines (greyed, "being paid") until the payment expires. The client keeps no handle without a body, so this phone can't "Pay later" it. This is RR-50's area. Noted because the pay-first Send is new on the screen. |
| O10 | The card slot: `payFormSlot` returns an empty mount when `cardFormFor(provider)` is null (`use-table-services.ts:107-109`). The "card" screen then shows Pay later and Call a waiter but no form and no word. Only sim-pay and stripe exist, and both have a form, so this is theoretical. |

**Scenarios that hold, by code or test:**
1. **Hold, Send, capture, with a failure between each step:** the pay-first round is entered only after the hold. A refused entry releases the hold and gives the lines back (pay-first-route tests). An unknown entry is `unconfirmed`, never released. The face shows each state (`payScreen` maps every `PaymentView` state).
2. **A double tap on Send:** a ref guard (`provider.tsx` `sendingNow`) plus the server's `payGap`.
3. **Two tabs on one phone:** held lines are refused `order_changed` or `order_empty`, and the phone has one open payment.
4. **Pay later:** `pay.cancel`, then dismiss only once accepted.
5. **RR-14:** the server refuses `being_paid` (`payment_lines.open` plus the unique index), and Editorial greys `beingPaid` lines and disables their ticks.
6. **Screens:** every bill and paying state has a screen; the bill has an empty text and the no-location screen.
7. **Single-step Call a waiter:** it calls only with the kinds exactly `['waiter']`.
8. **A line sold out between Send and Added:** it becomes Not sent and is marked in the bag (decision 131).

## What I could not cover

- **The Stripe card form itself** (no sandbox; `guest-pay-card.spec.ts` not run). I only read `apps/web/src/connectors/stripe/card-form.ts` and the glob in `card-forms.ts`. Its look and the font gap (#281) are B4's and Martin's.
- **No Playwright spec.** Every e2e set-up for paying uses the shared publish folder and another port, so per the brief I proved the points with face and core tests instead.
- **Real POS stock behaviour and the worker's timing** under a sell-out mid-pay. I read it but didn't run it.
- **Races beyond the double tap** (B5) and hostile input (B4).

**Setup note for the lead:** `env-da-money.sh` has no `DATABASE_PURGE_PASSWORD`, so `pnpm db:roles` fails. I ran it with the value from the shared `env.sh`. Both roles reported "password kept", and privileges were granted on `restro_da_money` only.
