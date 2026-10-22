# Stripe: what we know

The one place for what Restro knows about Stripe, the possible second payment provider (#49). Started by the ordering lead (Opus) on 10-22. It works like `2026-10-21-mypos-knowledge.md` (Martin 10-21): one dated line per fact with its source, nothing deleted, and an old line struck through (`~~…~~`) when something newer contradicts it.

**Sources, by short name:**
- **F21**: `2026-10-21-payment-provider-facts.md` §1–10 (Sonnet research, from docs.stripe.com). Its facts stay there; this file adds to them.
- **S22**: docs.stripe.com, read by the ordering lead on 10-22. Each line names the page.
- **C21**: `2026-10-21-mypos-vs-stripe-cost.md` (Sonnet research, Stripe's and myPOS's public price pages, 10-21).

Tags: **[DOC]** developer documentation, **[READING]** our interpretation.

## Holds with Apple Pay and Google Pay

- 2026-10-22 · S22 [DOC] (payments/payment-methods/payment-method-support, "Wallets API support" table) Apple Pay and Google Pay are each marked "Supported" for:
  - PaymentIntents;
  - SetupIntents;
  - **manual capture (a hold)**;
  - setup future usage (saving the card).

  Neither requires a redirect. Cards have the same four marks.
- 2026-10-22 · S22 [DOC] (payments/place-a-hold-on-a-payment-method) An online card hold usually lasts 7 days; a customer-initiated one is 7 days for Visa, Mastercard, Amex and Discover. A merchant-initiated one is 4 days 18 hours for Visa. An extended hold can be asked for on eligible payments.
- 2026-10-21 · F21 [DOC] (§4–5) An embedded form with manual capture is shown. Wallets need each domain registered for each connected account, which can be done by API.
- 2026-10-22 · [READING] What this means:
  - Stripe can hold a card paid with Apple Pay or Google Pay, inside our own page. That's what myPOS can't do (`2026-10-21-mypos-knowledge.md`, M22c answer 9).
  - It keeps D122 §8's hold-first order and the in-page form of round 1 (6.6).
  - For song bidding (D99), a wallet hold lasts long enough for one night, and a saved wallet card could back later boosts without a new card entry.

## Where the money goes

- 2026-10-21 · F21 [DOC] (§1) The venue connects its own Stripe account to Restro through Stripe Connect ("Connect with Stripe": sign in or sign up, approve access, back to Restro). Restro stores the account's id and calls Stripe with its own key plus that account's id. The venue keeps its own Stripe Dashboard. The other way is the venue pasting a restricted key.
- 2026-10-21 · F21 [DOC] (§4, §2) Payments are direct charges on the venue's account. Direct charges use no transfers between accounts.
- 2026-10-22 · [READING] So the money lands in the venue's Stripe balance and pays out to the venue's bank. Restro never receives or forwards it, as D98 requires. Restro's fee stays its subscription (D122 §9).
- 2026-10-21 · F21 [DOC] (§2) Restro has to register as a Connect platform in Stripe's Dashboard first. Review criteria and timing weren't found.
- 2026-10-21 · F21 [READING] (§3) A restricted key with PaymentIntents write and no refund write can't refund. To be checked in the sandbox (a refund call must fail). The venue's Dashboard can still refund.
- 2026-10-21 · F21 [DOC] (§7) Stripe may email the guest a receipt, depending on the venue's own setting. Restro would ask the venue to switch it off.

## What it costs

- 2026-10-21 · C21 [PRICE PAGE] The venue pays Stripe per successful payment: EEA consumer cards 1.5% + €0.25, premium EEA 2.8% + €0.25, UK 2.5% + €0.25, non-EEA 3.15% + €0.25. Apple Pay and Google Pay cost the same as the card. No monthly fee. A dispute is €20.
- 2026-10-21 · C21 [PRICE PAGE] With direct charges on the venue's own account and Stripe billing the venue, Restro pays Stripe nothing. Caution: Stripe's Connect page shows 1.5% + €0.50 for European cards; to be confirmed with Stripe.
- 2026-10-21 · C21 [READING] Fees are per successful payment, so a cancelled hold costs nothing.
- 2026-10-21 · C21 [READING] On the same card mix, Stripe costs the venue about 0.47 points more than myPOS: €482 vs €390 a month at €20,000, €1,447 vs €1,165 at €60,000 (about €3,400 a year more), €3,618 vs €2,910 at €150,000. Payouts take 3 business days (the first 7 days); myPOS's are instant.

## Open

1. ~~Whether a cancelled hold (an uncaptured payment) costs anything. Not checked yet.~~ Answered by C21's reading (fees are per successful payment); confirm in the sandbox's balance.
2. Whether a merchant-initiated hold on a saved wallet card (a later boost) needs the guest again for 3-D Secure.
