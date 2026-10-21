# myPOS: what we know

The one place for what Restro knows about myPOS, the first payment provider (Martin 10-21, #49). Started by the ordering lead (Opus) on 10-21, from every myPOS finding filed until then. For: #49, #45, #53, #56, #61, and the build of the myPOS provider package.

**How this file works** (Martin 10-21):
- It is a living file. New knowledge is added as a new line, dated, with its source. Nothing is deleted.
- When something new contradicts an older line, the older line stays, struck through (`~~…~~`), with a pointer to the line that replaces it.
- **Open questions** are at the bottom, with the date each was asked and of whom.
- Facts about other providers stay in their own files. Earlier research stays as it is and is cited here as a source.

**Sources, by short name:**
- **R17**: `docs/research/2026-10-17-mypos-and-fiscal-receipts.md`, Part 1 (Sonnet research, from developers.mypos.com and mypos.com).
- **F17**: `2026-10-17-payment-providers-feasibility.md` §1.
- **F21**: `2026-10-21-payment-provider-facts.md` §11 (Sonnet research, from developers.mypos.com).
- **C21**: `2026-10-21-mypos-vs-stripe-cost.md` (the cost comparison made for #54).
- **Martin**: Martin's own knowledge.
- **AI-1**: myPOS's first reply to Restro (10-21). It was written by myPOS's AI virtual assistant from general help pages, not by a person. Where it "can't confirm" something, its material is silent; that doesn't mean the thing is missing.
- **H21**: myPOS's help centre, help.mypos.com (en-gb), read by the ordering lead on 10-21. Each line names the article id and the date the article was last updated. The help centre is written mostly for card terminals; online-only points are marked. Searches for embedded, iframe, sandbox, nightclub and bar found nothing, and the Bulgarian help centre returned no results.
- **P21**: myPOS's public fees page, mypos.com/en-gb/pricing-and-fees/fees, read on 10-21. It is the UK page, in pounds; the Bulgarian figures may differ.

Tags: **[DOC]** developer documentation, **[VENDOR]** a marketing or help page, **[SAID]** said by myPOS or by Martin, **[READING]** our interpretation.

## Account and connecting a venue

- 2026-10-17 · R17 [DOC] Each merchant has its own verified myPOS account and Checkout store, with a key pair. A store is created under Stores > eCommerce (name, website URL, currency).
- 2026-10-17 · R17 [DOC] Live payments need a verified account and a verified store, usually within 5 business days. Until then, payments are capped at €3,000 and the funds are held in reserve. Any change to the Checkout triggers re-verification.
- 2026-10-17 · R17 [DOC] Checkout calls carry the store's `SID`, `WalletNumber` and `KeyIndex`, signed with the store's key.
- 2026-10-17 · R17 [DOC] A partner path exists in the Identity API: a partner creates an Integration in the Partner Portal, and after a merchant approves it, gets merchant-specific credentials. The scopes shown are accounting and banking. Whether they drive Checkout is not stated (F17).
- 2026-10-21 · Martin [SAID] API access is given from the client's own myPOS account, with permissions.
- 2026-10-21 · AI-1 [SAID] To integrate: the merchant opens a free myPOS account, completes the online identification, then connects through myPOS Checkout (API, SDK or e-commerce plugins). Money settles into the merchant's myPOS account.
- 2026-10-21 · AI-1 [SAID] Its material describes no integrator programme, only the "Препоръчай myPOS" referral scheme. **Conflicts** with R17's Identity API partner path. Asked of a person (open question 4).
- 2026-10-17 · R17 [DOC] Checkout is not supported for crypto, pharma and nutra, gambling, adult content, tobacco, streaming or hosting. Alcohol is not listed.
- 2026-10-21 · H21 [VENDOR] (6741946321565, updated 2026-09-09) Any legal business registered and operating in the EU, EEA, UK or Switzerland can open an account. Not supported: FX speculators, weapons dealers, non-regulated charities, companies with bearer shares, and "other high-risk industries" in the Acceptance Policy (not read yet). Bars and clubs are not named.

## What the merchant's site must show

- 2026-10-17 · R17 [VENDOR, a search snippet only] Visible merchant name and address, contacts, and the delivery, refund, cancellation and privacy policies; company documents with owners above 25%.
- 2026-10-21 · AI-1 [SAID] For online payments to be allowed, the site shows:
  - the merchant's name and address;
  - a customer-service email or phone;
  - delivery methods and times;
  - the return and refund policy;
  - the cancellation policy;
  - a privacy statement;
  - the total cost, taxes included;
  - the currency;
  - trial terms, where there is a trial;
  - clear, non-misleading descriptions of the products.
- 2026-10-21 · [READING] This matches the payment screen in `2026-10-21-pilot-law-working-answers.md` §4. It adds three lines for #45 and #57:
  - "served at your table" as the delivery;
  - a cancellation line (a sent order can't be cancelled, D116);
  - a link to the venue's refund policy.

## The payment form

- 2026-10-17 · R17 [DOC] The hosted pre-authorisation needs the guest on myPOS's page to enter the card.
- 2026-10-17 · R17 [DOC] The Embedded SDK puts Apple Pay and Google Pay buttons on the merchant's own page (a `PaymentSessionCreate` session; Apple Pay needs a domain file under `/.well-known/`).
- 2026-10-21 · F21 [DOC] The Checkout API redirects: "iFrame and similar solutions will not work due to security reasons."
- 2026-10-21 · F21 [DOC] The Embedded SDK's iFrame takes cards and iDEAL, needs at least 320×620, and lists Apple Pay and Google Pay as "not supported". It documents no pre-authorisation. **Conflicts** with R17 on the wallets; the pages may differ by SDK version. Asked of a person (open question 2).
- 2026-10-21 · AI-1 [SAID] Its material describes no embedded form, only the payment portal.
- 2026-10-21 · H21 [VENDOR] (6883031967389, updated 2025-12-08) With Checkout, "customers are directed to a secure payment gateway" to enter the card. This matches F21: Checkout redirects.
- 2026-10-21 · [READING] Plan for myPOS's own page for holds until a person at myPOS confirms an in-page form that can hold a card (#49 round 2, Q3).

## Pre-authorisation (holding the money)

- 2026-10-17 · R17 [DOC] The calls are `IPCPreAuthorization` (needs the guest), `IPCPreAuthCompletion`, `IPCPreAuthCancellation` and `IPCPreAuthStatus`. It is off by default, and myPOS support switches it on. Pre-auths made through the API must be completed or cancelled through the API.
- 2026-10-17 · R17 [DOC] The hold lasts "typically up to 30 days", by business type.
- 2026-10-17 · R17 [DOC] A second family exists for stored cards: `Authorization`, `Authorization Capture`, `Authorization Reverse`. Its period is limited by business type.
- 2026-10-17 · F17 [DOC] The completion page lists only `Amount`, "the amount requested". Partial completion isn't stated.
- 2026-10-21 · Martin [SAID] Authorisations and pre-authorisations are supported. A released hold returns to the card in a few days, depending on the bank.
- 2026-10-21 · AI-1 [SAID]
  - The amount is blocked and later completed or cancelled.
  - Completion must happen within 30 days. Otherwise myPOS Europe Ltd. cancels it and charges the merchant a fee (shown under "Тарифа").
  - Completion may not be higher than the held amount.
  - It is only for eligible merchants, who ask support with the subject "Requesting a pre-authorization method".
- 2026-10-21 · [READING] What this means for the pilot:
  - a completion below the hold looks allowed, but whether the rest is released at once is open (question 3);
  - a tip can't be added at completion;
  - ~~Restro always cancels an unused hold itself and never lets one lapse, so the venue pays no lapse fee;~~ (wrong: a cancel costs the same fee as a lapse; see the H21 lines below)
  - the pilot venue must ask for pre-authorisation before the pilot (#56, #61).
- 2026-10-21 · H21 [VENDOR] (6882373876253, updated 2026-06-15) myPOS offers pre-authorisation "predominantly for hotels, motels, B&Bs, hostels, camping sites, boat rentals and others". A hold lasts up to 30 days. It must not be used for loss, damage or theft charges.
- 2026-10-21 · H21 [VENDOR] (6882468303517, updated 2026-04-27) To switch it on, the merchant emails help@mypos.com **from the email address the account was registered with**, subject "Requesting a pre-authorization method". myPOS assesses each request on its own.
- 2026-10-21 · H21 [VENDOR] (6882470531741, updated 2026-08-28) Pre-authorisations may be used only for a listed set of charges, which includes **"Food or beverage charges"** (others: rental fees, room charges, fuel, parking, cruise purchases, insurance, taxes). The article is about terminals.
- 2026-10-21 · H21 [VENDOR] (6882371009821, updated 2026-04-27)
  - The completion may differ from the hold, but never be higher.
  - A hold not completed within 30 days is cancelled by myPOS, and the merchant is charged for it.
  - **A cancel the merchant makes itself costs "the same fee as the one for the automatic cancellation".**
  - The fee is in the account's tariff page. P21 confirms that acquiring fees are listed only inside the myPOS account, so the amount can't be read from outside.
  - The article is about terminals; whether the same fee applies to `IPCPreAuthCancellation` online isn't stated.
- 2026-10-21 · [READING] What this changes:
  - **A club may not be eligible.** Holds are aimed at hotels, but "food or beverage charges" are an allowed use. Only myPOS can say, after the venue asks (open question 11).
  - **Every hold that isn't captured costs the venue a fee**, whether Restro cancels it or it lapses. D122 §8 cancels a hold only when the last check fails, so this should be rare; but a guest who leaves the payment screen after the hold, or a hold placed and then not needed, also costs a fee. For #53: place the hold as late as possible, right before the lines are moved, so few holds end up cancelled (the fee amount is open question 12).
  - Restro still never lets a hold lapse: a lapse costs the same and leaves the guest's money blocked for up to 30 days.

## Tips

- 2026-10-21 · Martin [SAID] A tip is not a field of a pre-authorisation, but it can be taken as a charge of its own (#53).
- 2026-10-17 · R17 [DOC] Extra amounts go into the cart as additional items (on `IPCPurchase`).
- Whether the tip charge needs the guest to enter the card again is open (question 7).

## Refunds and reversals

- 2026-10-17 · R17 [DOC] `IPCRefund` refunds an executed payment by `IPC_Trnref`, with an amount. `IPCReversal` exists; if it fails, use `IPCRefund`. A reversal "may take 1-3 business days" to show.
- 2026-10-17 · F17 [DOC] "The merchant can refund any partial amount … maximum 100 percent." The refund goes back to the original payment method.
- 2026-10-21 · [READING] Restro never refunds (D122 §8). Refunds are the venue's, from its myPOS account (#54).

## Notices (server-to-server)

- 2026-10-17 · R17 [DOC]
  - `URL_Notify` receives a POST with `IPC_Trnref`, `OrderID`, `Amount`, `Currency` and a SHA-256 `Signature`, and must answer 200 with `OK`.
  - Authorise only on the notice, never on `URL_OK`.
  - A failed notice makes myPOS roll the payment back (`IPCPurchaseRollback`).
  - A `PreAuthorization Notify` exists, and `IPCGetPaymentStatus` polls.
- 2026-10-17 · F17 [DOC] The signature covers all fields, and the list "can be expanded over time". Any non-200 answer counts as an error. No retry schedule is published.
- 2026-10-21 · AI-1 [SAID] Nothing specific to online checkout.

## Wallets

- 2026-10-17 · R17 [VENDOR] Apple Pay is "available for myPOS Hosted Web Checkout". Google Pay on the hosted page is not confirmed. Wallets can't be tested in the sandbox (WooCommerce plugin).
- See "The payment form" for the Embedded SDK conflict.

## Sandbox

- 2026-10-17 · F17 [DOC]
  - A test URL and a shared test store with published keys: "works just like the real system".
  - 3-D Secure is not performed in the sandbox.
  - Test cards are declined in production.
  - Holds and wallets in the sandbox are not stated.
- 2026-10-21 · AI-1 [SAID] Its material describes no sandbox for online checkout. **Conflicts** with F17's documentation; trust the documentation. Asked of a person (question 1).
- 2026-10-21 · Martin [SAID] A sandbox exists. Its details, who registers in it and what it costs are unknown.

## Fees

- 2026-10-17 · R17 [VENDOR] Checkout costs €0 a month with no set-up fee:
  - EEA consumer cards 1.30% + €0.10;
  - Amex 2.50% + €0.10;
  - other cards 2.90% + €0.10.
- 2026-10-21 · AI-1 [SAID] No set-up or subscription fee, only a fee per transaction. A lapsed pre-authorisation is charged.
- 2026-10-21 · C21 The comparison with Stripe for the pilot venue is in that file.
- 2026-10-21 · H21 [VENDOR] (31033431141404, updated 2026-10-14; UK, pounds)
  - Opening and holding an account is free: no subscription, no contract.
  - Three fees can apply to an idle account: no-cooperation £75 (documents not sent), inactivity £15 (10 months without a transaction), no-acquiring £30 (10 months without a card payment). Two months' notice is given first.
  - Asking myPOS to cancel or return a completed card or online payment costs £10. A normal refund from the balance is free.
  - Card payments cost one flat rate, "from 1.10% + £0.07".
- 2026-10-21 · P21 [VENDOR] An online payment costs £0.30 and a refund of an online payment £0.25 (the account fees table). The card acquiring rates, the pre-authorisation fees among them, are shown only inside the myPOS account.

## Settlement and reserve

- 2026-10-21 · H21 [VENDOR] (6881492806813, updated 2026-09-17) Funds are in the merchant's myPOS account within seconds after a payment.
- 2026-10-21 · H21 [VENDOR] (6883186370589, updated 2026-09-18) A rolling reserve applies to MO/TO payments (mail or phone orders, card not present and typed in by the merchant): 30% of each, at least €1, held for 180 days.
- 2026-10-21 · [READING] A guest typing their own card on myPOS's page is an online payment, not MO/TO, so the reserve shouldn't apply. R17's "funds held in reserve" until the store is verified is a different, temporary rule.

## Support

- 2026-10-21 · H21 [VENDOR] (6852687183133, updated 2026-10-03) Support is open 24/7, by phone, email and the online portal, Bulgarian included.

## Receipts

- 2026-10-21 · AI-1 [SAID] Its receipt answers are about terminals: print, email or SMS, and a pre-auth receipt carries the pre-auth code. Whether myPOS emails the payer after an online payment, and whether the venue can turn that off, is open (question 6).
- 2026-10-21 · [READING] A myPOS email to the guest must never look like the venue's fiscal receipt (D122 §8).

## Mistral

- 2026-10-21 · Mistral list, question 9: does the myPOS partnership include online payments tied to Zamboo receipts? Asked of Mistral, and also of myPOS (question 8).

## Open questions

The first three were asked on 2026-10-21 by Restro through myPOS's contact form (AI-1 answered). The follow-up asking for a person at myPOS was drafted on 2026-10-21 for Martin to send.

1. The sandbox: who registers (Restro or the venue), whether it costs anything, and whether holds, completion, cancel and 3-D Secure work in it.
2. Whether the Embedded SDK can hold a card, and with which wallets; otherwise, whether the redirecting Checkout is the only way.
3. Whether a completion below the hold releases the rest at once.
4. How a software company connects to a venue's account: the store's keys, or the Partner Portal and Identity API; and whether that works for Checkout.
5. Whether the key the venue gives Restro can be limited to hold, completion, cancel and status, with no refunds.
6. Turning off myPOS's email to the payer after an online payment.
7. Whether a tip charged on its own needs the card entered again.
8. Any myPOS partnership or integration with Mistral / Zamboo.
9. The notice signature (which key, which field order), the retry schedule, and whether duplicates happen.
10. The hold length for a bar or club. (H21 10-21: "up to 30 days" in general.)
11. Whether a club can get pre-authorisation for online payments through Checkout. Asked by the venue itself, from its registered email, to help@mypos.com (H21 6882468303517). Not asked yet: needs Martin and the venue (#56, #61). 2026-10-21: the email was drafted for the venue to send (in Bulgarian, subject in English as myPOS asks). It also asks questions 3, 10 and 12.
12. The fee for a cancelled or lapsed hold on the venue's tariff, and whether it applies to an online cancel (`IPCPreAuthCancellation`) as it does at a terminal. The venue can read the amount in its myPOS account. Not asked yet.
