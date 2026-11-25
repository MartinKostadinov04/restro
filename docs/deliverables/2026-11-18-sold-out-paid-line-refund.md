# A paid line that turns out to be sold out: how the guest gets the money back

Made by: a design subagent of the lead session, 2026-11-18. For: Martin, who decides; then the lead, who words the decision. Kind: a proposal with research. Nothing is decided here and no code or decision file was changed.

Martin's words (11-18): "In my opinion a line that is paid within the prem of Restro should be able to be automatically and securely trased back, removed from the bill and refunded upon missing. I am open to opinions".

## For Martin, in plain words

**The scene.** 01:00, Table 7. A guest pays 12 EUR in the app for 2 Jägermeister. The round prints at the bar. The last bottle ran out a minute ago and nobody had marked it sold out yet.

**What is true at that moment, as Restro is built today:**
- The 12 EUR is already taken from the card. Restro takes the money within seconds of the POS closing the paid lines (D127).
- The 2 Jägermeister are **not** on the table's open bill any more. Paying moved them to a payment table and closed them there, so the venue's fiscal device has already issued a receipt for them (D122 §8). "Removing the line" is therefore not a waiter deleting an unpaid line. It is a **storno** of a receipt that exists.
- Restro cannot give the money back. Its Stripe key is not allowed to (D125 3.5, D132). The owner refunds in Stripe's dashboard, by day, and a manager then makes the storno at the till and taps "Storno done" in Tonight (D122 §8). The guest waits until tomorrow at the earliest.

**What I recommend (design B below):** the bartender taps **"Not served"** on that paid line in Tonight. Restro then sends exactly those 12 EUR back to the card it came from, records who tapped, and gives the manager one storno to-do with the receipt's number on it. Where a POS can make the storno through its API, Restro does that too, first. The guest's bill shows "Refunded 12 EUR" only after Stripe confirms it.

**Why a person taps, and it is not fully automatic.** Restro never knows whether a drink reached the table (you ruled out delivery stages, D112). When Jägermeister goes sold out, Restro cannot tell whether Table 7's two were the last ones poured or the first ones missed. So a sold-out mark **suggests** ("2 paid rounds with Jägermeister in the last 15 minutes: Table 7, Table 12. Served?"), and a person answers. Every comparable product works the same way: none refunds without a person.

**The one thing I need from you** is at the end: may the bartender's tap alone send the money back, or must a manager confirm?

## What exists today (checked in the code)

- **The trace is already there.** A payment (`py_` id) has its lines, and each line holds the POS's line reference, the quantity and the exact amount the POS closed it for (`payment_lines.pos_line_ref`, `closed_quantity`, `closed_minor`). The payment holds the provider's payment reference, the receipt number and the fiscal memory number (D127 4.5). Every row carries its source, actor and job (rule 2).
- **Refunds are read, never made.** `payment_refunds` has one row per refund the provider reports, each with its own storno to-do (D122 §8, log `2026-10-21-refunds-disputes-decision-log.md` rows 5.1–5.6). The provider interface has no refund step (D127 6.1); `scripts/no-refunds.test.ts` and the provider guard (`packages/core/src/connectors/payment/testing/guard.ts`) fail the build on one.
- **The few seconds between the hold and the close are already covered.** If a waiter voids the line in that window, Restro captures less and the rest of the hold is released (D122 §8 "the last check"; `pay-route.ts`, with the provider capability `partialCapture`). The open case is only **after** capture.
- **No POS step removes or stornos a line.** The waiter action `cancel_within_pos_rules` is listed (D110) but no connector step uses it, and no capability says a POS can storno a closed line. Whether the pilot's POS (Mistral) or barsy can do it through the API is **unknown**; nobody has asked yet.
- **An unpaid line needs none of this.** A sold-out drink ordered onto the bill and not yet paid is voided by the waiter in the POS, as today, and disappears from the guest's bill at the next reading.

## How comparable products do it (fetched 11-18, vendor help pages)

| Product | Who refunds | Corrects the POS too? | Sold-out mark |
|---|---|---|---|
| me&u | Staff in its Venue Manager, manager PINs only; an amount, not an item | No, staff record it in the POS by hand | Staff or manager PIN |
| sunday | An admin in its dashboard; full or custom amount | No, the venue adjusts the POS by hand | not verified |
| Toast (is the POS) | Staff with the refund permission; per item | Yes, same system | Manager passcode |
| Square (is the POS) | Staff with the orders permission: "Cancel items", then refund; lists "not in stock" as a reason | Yes, same system | Anyone with the items permission |
| Lightspeed K-Series | Staff in the POS; a partial refund needs a hand-made correction in reporting | Partly | From the POS or back office |

Sources: meandu.helpjuice.com (refunding an order; mark an item as sold out), intercom.help/sundayapp-help (articles 8285019, 7010788), support.toasttab.com (void vs refund; 86 an item), squareup.com/help (articles 8323, 8430), k-series-support.lightspeedhq.com (article 4412418588443).

**Common practice:** a person triggers the refund inside the ordering product, behind a permission or PIN; overlay products (the ones that sit on someone else's POS, like Restro) refund the money themselves and leave the POS correction to staff. No vendor documents "hold the card until the bar accepts" as its answer for pay-per-order. No vendor refunds with no person involved.

## Stripe facts used (official docs, read 11-18)

- A restricted key gives None, Read or Write **per resource**, with a separate column for connected accounts (docs.stripe.com/keys/restricted-api-keys). **Not stated anywhere:** a limit by amount, or to payments the key itself made. So Stripe cannot enforce "only this line, only our payments"; Restro's own code must.
- A platform can refund a direct charge on the venue's account; Stripe takes the money from the **venue's** balance (docs.stripe.com/connect/direct-charges, "Issue refunds"; docs.stripe.com/refunds).
- A refund goes "back to the original payment method" only, never to another card, and the total can never exceed the original charge (docs.stripe.com/refunds).
- A part refund is an `amount`. Stripe's fee on the original payment is not returned. The guest sees it in about 5–10 business days, or the charge simply drops off the statement when the refund is soon after the payment (a reversal). If the venue's balance is short, the refund waits as pending, up to 45 days (docs.stripe.com/refunds).
- A hold on an online card lasts 7 days (Visa 5 when merchant-initiated); one capture only; "A partial capture automatically releases the remaining amount"; releasing a hold costs nothing (docs.stripe.com/payments/place-a-hold-on-a-payment-method).
- Keys can be limited to fixed IP addresses, and Stripe advises one restricted key per service (docs.stripe.com/keys-best-practices).

## The designs

### A. Today's rules: the venue refunds in Stripe, Restro keeps a to-do

1. **Trace:** the manager finds the payment in Tonight by table and time; the provider's payment id is on its page.
2. **POS:** a manager makes the storno at the till and taps "Storno done".
3. **Money:** the owner refunds 12 EUR in Stripe's dashboard, by day (refunds at night are "later" in D122 §8).
4. **Guest:** the bill shows the refund once Restro reads it from Stripe, usually the next day. At 01:00 the guest hears "come back tomorrow" or gets cash from the bar.
- **Security:** nothing new. A leaked key cannot move money back.
- **Staff effort:** an owner with a Stripe login per case, plus the storno; at night, an argument at the bar.
- **Changes:** none.

### B. Staff tap "Not served"; Restro refunds that line itself (recommended)

1. **Trace:** the tap is on the paid line itself, so Restro already holds the payment, the POS line, the amount the POS closed it for and the receipt number. A refund row is written first, through `applyService`, with the actor and the job.
2. **POS:** a new capability, "storno of a paid line". Where the connector declares it, Restro asks the POS for the storno as a waiter would and waits for its confirmation **before** any money moves. Where it is not declared (today: every POS, until asked), the manager gets the storno to-do that already exists, with the receipt's number, date and fiscal memory number.
3. **Money:** one new provider step, `refundLine`, called only by the worker. Bounds, all in Restro's code and all checked in one place:
   - only a payment Restro itself captured, in this service day;
   - only the amount the POS closed that line for (per unit, for 1 of 2);
   - once per line, with the refund row's id as Stripe's idempotency key, so a retry can never pay twice;
   - a nightly limit per venue (proposed start: 10 refunds or 300 EUR, the owner may lower it); past it, a manager's PIN;
   - off until the owner turns it on, because the money leaves the venue's account;
   - the tip stays; a whole-payment refund stays in the venue's Stripe dashboard.
4. **Guest:** after the tap the line reads "Not served. Your refund is being sent." (a true pending state). It becomes "Refunded 12 EUR · sold out" only when Restro reads the refund back from Stripe (D72: no local success). If Stripe says it failed: "Please see the bar". A guest whose phone is already closed sees nothing; Restro keeps no email or phone number (D125 3.7), so the waiter tells them.
- **Security:**
  - *A leaked key* could send venues' money back to the guests who paid it, across every connected venue. It could not send money anywhere else (Stripe's rule above). That is sabotage or a guest refunding himself, not theft, but it is real money and today's key cannot do it at all.
  - *A bug* could refund the wrong line or amount; Stripe caps it at the payment's total.
  - *A dishonest bartender* could tap "Not served" for a friend who was served.
  - *Limits:* a separate key used only by the refund job, tied to the worker's IP address; an alarm and an automatic switch-off when Stripe reports a refund made with Restro's key that has no refund row; the nightly limit; every tap in the Log with a name and on the end-of-night page.
- **Law (flag only):** a refund to a card after a fiscal receipt needs a storno (Н-18 чл. 31). Whether the storno must come before the refund, and whether a storno may be issued through an API by Restro's POS user, is for the accountant and the lawyer (open point L10, #52). Restro refunding on the venue's account also needs the venue's written consent in our terms.
- **Staff effort:** one tap per case; one storno per case until a POS can do it by API.
- **Changes:** D125 3.5; D127 4.4 and 6.1; D132's third rule; D112's "Refunds" line; D122 §8 ("Restro's key can create, take and cancel only"; "refunds at night"); D126's "carries over unchanged"; D124 §4's note that the key never refunds (holds stay a must-have); D110 gains "storno of a paid line" under "cancel within the POS's own rules"; `scripts/no-refunds.test.ts` and the provider guard are narrowed to exactly one step in one file. That loosens a guardrail, so it needs your explicit yes (D67).

### C. Take the money only when the bar accepts

Keep the hold, let the bar confirm each paid round, then capture only what was served.
1. **Trace:** as B.
2. **POS:** the paid lines would wait, open, on the payment table until the bar answers. One payment table serves one payment at a time (D127), so one slow answer blocks every other guest's payment at that bar.
3. **Money:** nothing to refund; Stripe releases the rest for free. The 7-day hold is long enough.
4. **Guest:** "Waiting for the bar" instead of "Paid", for every payment.
- **Security:** best of all; the key stays as it is.
- **Law (flag only):** when the fiscal receipt is due if the card is only held is a question for the accountant.
- **Staff effort:** one tap for **every** paid round, every night, to save one tap on a rare miss. You rejected exactly this (D112: no stages; D116: "no card is held while a bartender decides").
- **Changes:** D112, D116, D122 §8, D127 (the route's order and 3.10).
- **Verdict:** not recommended.

### D. Close at once, take the money 15 minutes later

The POS closes and prints as today; Restro waits 15 minutes to capture. "Not served" inside the window captures less; after it, design A applies.
1. **Trace:** as B. 2. **POS:** a storno is still needed; the receipt already exists. 3. **Money:** no refund, no new key right. 4. **Guest:** as B, with "released" instead of "refunded".
- **Security:** the key stays as it is. But every payment, not only the rare miss, sits 15 minutes as a printed receipt with the money not yet taken; today that gap is seconds (D127 3.14).
- **Limits:** Stripe allows one capture, so a second miss on the same payment is not covered; a miss found at minute 16 is not covered.
- **Staff effort:** as B inside the window, as A after it.
- **Changes:** D127 (3.1, 3.10), D122 §8. D125, D132 and the guardrail stay.
- **Verdict:** the choice if you will not give Restro's key a refund right.

Also looked at: Stripe's embedded "payment details" component, which lets the venue refund from inside our page (docs.stripe.com/refunds, "Refunds through a Connect platform"). It is still a manager working a Stripe screen at 01:00, so it does not meet "automatically". Not explored further.

## Recommendation

**B**, built in two steps: first the money and the to-do (works on every POS), then the POS storno by API for each POS that confirms it. It is what me&u and sunday do, it touches only the rare case, and it reuses the refund rows, storno to-dos and end-of-night lists that are already built. With it, the staff sold-out mark you decided today becomes the prompt that finds the paid rounds to check.

## Unknown, stated as unknown

- Whether Mistral or barsy can storno a paid line through the API, and with which user rights. A question for each (connector questions).
- Whether a restricted key with a refund right works with the connected-account header. The docs say all APIs support restricted keys but show the secret key in the refund example; check in the sandbox. Also whether the dashboard offers "Refunds" apart from "Charges"; our two key records differ.
- How long after a payment Stripe still accepts a refund: not on the pages read.
- The order of storno and refund under Н-18, and a storno through an API: accountant and lawyer (#52, L10).

## The question for you

01:05. The bartender sees Table 7's paid round, has no Jägermeister, and taps "Not served".

**Does the 12 EUR go back at once on the bartender's tap, or only after a manager confirms with a PIN?**

Recommended: at once, for anyone who may review sent orders, inside the nightly limit; the manager sees each one the same night as a storno to-do, and a PIN is asked only past the limit. This is faster than me&u, which asks for a manager PIN every time; the price is that a bartender could refund a friend, which the Log and the nightly limit bound but do not prevent.
