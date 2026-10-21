Made by: Sonnet research agent, 10-21, at Martin's request (#49). For: Martin and the ordering lead.

# myPOS or Stripe: what a venue pays on in-app card payments

## Summary
- On the public prices, **myPOS is cheaper than Stripe** for a Bulgarian venue: about **0.47 percentage points of volume** (0.43 with 30% tourist cards). That is €93 a month at €20,000, €282 at €60,000, €708 at €150,000.
- By Martin's rule this is **significant** (over €100 a month at €60,000, and over 0.3 points). Restro should not push Stripe as the cheaper option.
- Two things could change this: myPOS quotes a "custom offer" above €5,000 a month, and one myPOS fee line (€0.30 "myPOS Online") might be added to every card payment. Both go to myPOS (Q76).
- Recommendation: myPOS stays the default. Offer Stripe only as an option for a venue that wants it, because of the embedded hold form and wallets.

Tags: [PRICE PAGE], [DOC], [READING] (my interpretation), [NOT FOUND]. Prices checked 10-21.

## Price table (EUR, online card payments)

| Item | myPOS | Stripe |
|---|---|---|
| EEA consumer cards (Bulgarian too) | 1.30% + €0.10 [PRICE PAGE] ^m1 | 1.5% + €0.25 [PRICE PAGE] ^s1 |
| EEA premium or business cards | Business cards fall in "all other consumer and commercial cards": 2.90% + €0.10 [PRICE PAGE] ^m1. A premium consumer card is still "consumer" [READING] | Premium EEA 2.8% + €0.25 [PRICE PAGE] ^s1 |
| American Express | 2.50% + €0.10 [PRICE PAGE] ^m1 | Not listed separately [NOT FOUND] |
| UK cards | Treated as non-EEA: 2.90% + €0.10 [PRICE PAGE] ^m1 | 2.5% + €0.25 [PRICE PAGE] ^s1 |
| Non-EEA (tourist) cards | 2.90% + €0.10 [PRICE PAGE] ^m1 | 3.15% + €0.25 [PRICE PAGE] ^s1; +2% only if currency conversion is needed |
| Apple Pay, Google Pay | Accepted, no separate fee listed [PRICE PAGE] ^m1. Charged as the card [READING] | No separate fee listed [PRICE PAGE] ^s1, ^s3. Charged as the card [READING] |
| Hold, cancelled hold, partial capture | No fee line [NOT FOUND]. Hold must be switched on by myPOS ^m5. Partial completion [NOT FOUND] ^m5 | No fee line [NOT FOUND]. Fees are "per successful payment" ^s3, so a cancelled hold costs nothing [READING]. Partial capture releases the rest [DOC] ^s4 |
| Refund | €0.25 "refund for online payment", €0 "refund from account" [PRICE PAGE] ^m2. Which one applies to cards: unclear [READING] | Free. The original fee is not returned [PRICE PAGE] ^s1 |
| Dispute / chargeback | €15 "chargeback initiation fee" [PRICE PAGE] ^m2. Whether it covers online acquiring: [READING] yes | €20 per dispute received, not refunded; +€20.45 if you answer it, refunded if you win [PRICE PAGE] ^s1, [DOC] ^s5 |
| Monthly or account fee | €0 [PRICE PAGE] ^m1. Over €5,000 monthly card turnover: "custom offer" [PRICE PAGE] ^m3 | €0 for standard pricing [PRICE PAGE] ^s1 |
| Payout to the bank | Money lands in the myPOS account at once, no fee [PRICE PAGE] ^m1. Sending it on by SEPA: €0.40 [PRICE PAGE] ^m2. Speed [NOT FOUND] | No payout fee on the page [NOT FOUND]. First payout 7 days, then 3 business days; manual payout 1-4 business days [DOC] ^s6 |
| Currency conversion | Rate list only, no figure [NOT FOUND] ^m2 | +2% when needed [PRICE PAGE] ^s1. Not needed for EUR payments [READING] |
| 3-D Secure | Mandatory, no fee line [NOT FOUND] ^m6 | Included on standard pricing [PRICE PAGE] ^s1 |

## Who pays what when a software platform is linked

- **Stripe Connect, direct charges on the venue's own Standard account.** The venue is billed by Stripe at the rates above, and carries refunds and disputes. If Stripe bills the connected accounts directly, the platform pays no account, payout or per-payout fee [PRICE PAGE] ^s2. Restro takes no cut, so it pays nothing [READING]. Caution: the Connect page also shows "1.5% + €0.50" for European cards, a different fixed fee from the Bulgarian price page. If a venue were charged that, Stripe would cost another 0.56 points. The Bulgarian page is more specific; confirm with Stripe.
- **Venue pastes its own Stripe keys.** No Connect involved. Same sticker price, paid by the venue. Restro pays nothing [READING].
- **myPOS.** The venue holds its own merchant account. The partner account is free, with "no monthly fees" and "no binding contracts" [PRICE PAGE] ^m4. A fee for a platform like Restro: [NOT FOUND].

## Cost model

Assumptions (mine, not from the providers):
- Average payment €45. All payments in EUR. One dispute per 2,000 payments, not countered, the lost amount itself ignored (same on both sides).
- Card mix: 70% Bulgarian consumer, 15% EEA premium or business, 10% non-EEA or UK. You gave 95%, so I put the missing 5% on other EEA consumer cards (priced as Bulgarian). The 10% is split 4% UK and 6% other non-EEA.
- Business cards are priced at myPOS's higher row for all 15%. That favours Stripe, because a premium consumer card would cost 1.30% at myPOS.
- Weekly myPOS-to-bank transfer (€0.40). Stripe payout fee €0 (not found). Refunds left out.

| Monthly card volume | Payments | Stripe | myPOS | Stripe dearer by | In points of volume | Per year |
|---|---|---|---|---|---|---|
| €20,000 | 444 | €482.36 | €389.51 | €92.84 | 0.46 | €1,114 |
| €60,000 | 1,333 | €1,447.07 | €1,165.07 | €282.00 | 0.47 | €3,384 |
| €150,000 | 3,333 | €3,617.67 | €2,910.07 | €707.60 | 0.47 | €8,491 |

Cost as a share of volume: Stripe 2.41%, myPOS about 1.94-1.95%.

**Sensitivity, 30% tourist cards** (30% non-EEA or UK, split 12% UK and 18% other; 55% EEA consumer; 15% premium or business):

| Monthly card volume | Stripe | myPOS | Stripe dearer by | Points | Per year |
|---|---|---|---|---|---|
| €20,000 | €537.96 | €453.51 | €84.44 | 0.42 | €1,013 |
| €60,000 | €1,613.87 | €1,357.07 | €256.80 | 0.43 | €3,082 |
| €150,000 | €4,034.67 | €3,390.07 | €644.60 | 0.43 | €7,735 |

Tourist cards narrow the gap a little but do not close it.

## Verdict

- **Significant: yes.** €282 a month at €60,000 (rule: €100) and 0.47 points (rule: 0.3). It goes **in myPOS's favour** at every volume tested.
- **Should Restro propose Stripe? Not as the cheaper choice.** Keep myPOS as the default and **offer both**, so each venue picks. A venue that wants Stripe's embedded hold form and wallets can take it and knows it pays about €3,400 a year more at €60,000 a month.
- **Check before relying on this (myPOS, add to Q76):**
  1. Does the €0.30 "payment via myPOS Online / iDEAL" fee ^m2 apply to card payments on top of the €0.10? I read it as a myPOS-wallet or iDEAL fee, since the online page lists cards at +€0.10 only. If it did apply, myPOS would cost about 0.67 points more and become the dearer one.
  2. Is the online rate still 1.30% + €0.10 above €5,000 a month, given the "custom offer" wording? A venue at €20,000 or more is above that line.
  3. Is the €15 chargeback fee the acquiring one, and is a card refund €0 or €0.25?
- Stripe's public price is not final either: custom or interchange-plus pricing is available on request, and the Bulgarian price page gives no figure for it [NOT FOUND]. It might narrow the gap at €60,000 or more.

Non-price factors:
- **Hold in the embedded form:** Stripe documents manual capture in an embedded form [DOC]. myPOS Checkout is a redirect, its embedded SDK shows no hold, and hold activation is by myPOS staff (see `2026-10-21-payment-provider-facts.md`).
- **Apple Pay and Google Pay in the form:** Stripe yes, with domain registration per venue. myPOS: wallets only in the hosted Checkout; the embedded SDK says "not supported".
- **Payout speed:** myPOS into its own account at once; Stripe 3 business days after the first 7 calendar days.
- **Existing myPOS terminals:** a venue with myPOS terminals already has the account and the contract; Stripe means a new onboarding.
- **Mistral/Zamboo link:** Mistral question 9 asks whether the myPOS partnership covers online payments tied to Zamboo receipts (`2026-10-17-pos-integration-requirements.md`). A yes would favour myPOS; unanswered.
- **Partial capture:** Stripe yes; myPOS not documented. Matters, because Restro captures a lower amount at times.

## Sources
Stripe (^s):
- ^s1 https://stripe.com/en-bg/pricing
- ^s2 https://stripe.com/en-bg/connect/pricing
- ^s3 https://stripe.com/en-bg/pricing/local-payment-methods
- ^s4 https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- ^s5 https://docs.stripe.com/disputes/how-disputes-work
- ^s6 https://docs.stripe.com/payouts

myPOS (^m):
- ^m1 https://www.mypos.com/en-bg/online-payments and https://www.mypos.com/bg-bg/online-plashtaniya/checkout
- ^m2 https://www.mypos.com/en-bg/pricing-and-fees/fees and https://www.mypos.com/bg-bg/pricing-and-fees/fees
- ^m3 https://www.mypos.com/en-bg/pricing-and-fees
- ^m4 https://partners.mypos.com
- ^m5 https://developers.mypos.com/apis/checkout-api/pre-auth-completion (no partial amount, validity or fee stated); activation by myPOS team from a search result for https://developers.mypos.com/apis/checkout-api (not opened)
- ^m6 https://developers.mypos.com/en/doc/online_payments/v1_4/10-security-and-availability

No myPOS fee PDF was found; its HTML fees page is called the full breakdown. myPOS help-centre pages returned an access error. Earlier work: `2026-10-17-payment-providers-feasibility.md`, `2026-10-21-payment-provider-facts.md`.
