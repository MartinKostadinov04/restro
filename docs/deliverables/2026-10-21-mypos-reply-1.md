Made by: the ordering lead (Opus), 10-21, from myPOS's first reply to Restro's contact-form message (#49, Q76). For: the #49 grilling, #45, #52 and #53.

# myPOS's first reply (10-21): what it settles and what it doesn't

**Who answered:** myPOS's AI virtual assistant, not a person. It answered from myPOS's general help material. Where it says it "can't confirm" something, that means its material is silent. It doesn't mean the thing is missing: the public developer site documents a sandbox that the assistant says it knows nothing about (`2026-10-17-payment-providers-feasibility.md` §1.7).

## What it says

- **How to integrate:** through myPOS Checkout (API, SDK or e-commerce plugins). The merchant (the venue) opens a free myPOS account and completes the online identification. Money settles into the venue's myPOS account.
- **Fees:** no setup fee and no subscription. There is a fee per transaction, and a fee when a pre-authorisation is cancelled automatically (shown in the account's "Тарифа").
- **Pre-authorisation:**
  - an amount is blocked and later completed or cancelled;
  - completion must happen within 30 days, or myPOS cancels it and charges a fee;
  - completion may not be higher than the held amount;
  - only merchants who meet the conditions get it. The merchant asks support with the subject "Requesting a pre-authorization method".
- **The embedded form:** its material describes none, only the payment portal.
- **The sandbox:** its material describes none (but see above).
- **Notices, receipts and partners:** it describes nothing specific to online checkout. Its receipt answers are about terminals. There is no integrator programme, only the "Препоръчай myPOS" referral scheme.
- **What the merchant's site must show** for online payments to be allowed:
  - the merchant's name and address;
  - a customer-service email or phone;
  - delivery methods and times;
  - the return and refund policy;
  - the cancellation policy;
  - a privacy statement;
  - the total cost with taxes;
  - the currency;
  - any trial terms;
  - clear, non-misleading descriptions of the products.

## What it means for Restro

1. **The embedded form is unconfirmed, and the documentation says Checkout redirects** (`2026-10-21-payment-provider-facts.md` §11). Plan for myPOS's own payment page until a person at myPOS says otherwise. This is #49 round 2, Q3.
2. **Pre-authorisation must be switched on for each venue,** by the venue asking myPOS support. It goes on the pilot readiness list (#56) and into the owner's setup steps (#61).
3. **The rules for completion fit D122 §8.** Completion may be for less than the hold, never more, so a tip can't be added at completion. This matches Martin's "a tip is a charge of its own" (#53). The 30-day window covers the plan's 7 days. The fee for an automatic cancel means Restro always releases a hold itself and never lets one lapse.
4. **Each venue has its own account; there is no partner model.** Connecting is therefore the venue's own Checkout credentials, sealed as D98 says (#49 round 3, #61).
5. **The site requirements line up with the payment screen** the #52 answers propose (`2026-10-21-pilot-law-working-answers.md` §4). That screen adds three things for #45 and #57:
   - "how it's delivered" ("served at your table");
   - a cancellation line (a sent order can't be cancelled, D116);
   - a link to the venue's refund policy.
6. **Still open, for a person at myPOS:**
   - the sandbox, and who registers in it;
   - whether an embedded form can hold a card;
   - whether a completion below the hold releases the rest;
   - limiting the key to no refunds;
   - the signature and retries of notices;
   - turning off the payer's email receipt;
   - the link with Mistral / Zamboo.
