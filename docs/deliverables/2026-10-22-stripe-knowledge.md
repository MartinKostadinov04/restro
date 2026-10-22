# Stripe: what we know

The one place for what Restro knows about Stripe, the possible second payment provider (#49). Started by the ordering lead (Opus) on 10-22. It works like `2026-10-21-mypos-knowledge.md` (Martin 10-21): one dated line per fact with its source, nothing deleted, and an old line struck through (`~~…~~`) when something newer contradicts it.

**Sources, by short name:**
- **F21**: `2026-10-21-payment-provider-facts.md` §1–10 (Sonnet research, from docs.stripe.com). Its facts stay there; this file adds to them.
- **S22**: docs.stripe.com, read by the ordering lead on 10-22. Each line names the page.

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

## Open

1. Whether a cancelled hold (an uncaptured payment) costs anything. Not checked yet.
2. Whether a merchant-initiated hold on a saved wallet card (a later boost) needs the guest again for 3-D Secure.
