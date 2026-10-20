Made by: independent agent (Opus), 10-21

# Card brand and last 4 in the payment record: third opinion

## Verdict

**A variant of Position 1.** Do not store the brand or the last 4 in Restro's payment record. If staff need them on screen, fetch them from the provider by the payment reference when the record is opened, and do not save them. Position 1 is right about the outcome but wrong about the reason. PCI scope is not the reason; GDPR necessity is.

## Reasons

**1. PCI DSS does not decide this.** PCI DSS v4.0.1 treats a correctly truncated PAN as no longer PAN. Truncation is one of the listed ways to make PAN unreadable (Req. 3.5.1; glossary, "Truncation"). PCI SSC FAQ 1091 allows at most the BIN and the last 4. The last 4 plus the brand is well inside that limit. SAQ A requires that the merchant stores no account data electronically. A truncated PAN is not account data, so SAQ A still applies. Position 2 is right here. One trap: never store a hash of the same PAN next to the truncation (Req. 3.5.1.1).

What really sets Restro's PCI exposure is the page that embeds the provider's iframe. That page is in scope for the venue's SAQ A whatever the record holds. In the 2025 SAQ A revision, this became an eligibility check that the page is protected against script attacks. The last 4 changes none of this.

**2. GDPR decides it, and the need is not shown.** The record is already personal data. The provider reference resolves to a cardholder at the provider, and the venue can reach that link (Breyer C-582/14; SRB C-413/23 P, 2025). Adding the last 4 does not create personal data. It does add a field, so Art. 5(1)(c) asks whether that field is necessary. It is not necessary for disputes:
- A chargeback arrives on the venue's provider account already tied to the provider's payment reference (Stripe's dispute object points to the charge; Adyen and myPOS send the transaction reference). Matching it to Restro's record is an exact lookup by reference, with no need for the last 4.
- The scheme already holds the card details. The provider fills them into the dispute case. The venue's job is to prove the sale and the service: the items, the times, the table, the 3-D Secure result and the fiscal receipt. Restro keeps all of these.
- The one real use case is a guest who walks up and says "card ending 1234, last night". Time, amount and table usually find the payment. A live lookup at the provider covers the rest.

**3. A leak costs a little more with it.** The last 4 plus the time and the venue puts a named card at a nightclub at a known hour. Last 4 digits have also been used in social-engineering account takeovers (the 2012 Honan case). This is low harm, but the field brings no gain to set against it.

**4. Common practice.** Payment apps often store the brand and last 4 to show saved cards. Restro saves no cards, so that reason does not apply.

## What I am unsure of

- Whether myPOS's embedded checkout returns the brand or last 4 at all. If it does not, the live lookup is Stripe/Adyen-only, and myPOS venues use the myPOS dashboard.
- I have not checked what Sunday, me&u or other QR-ordering products store. I have no evidence either way.
- If the 18-month record must stand alone after the venue leaves its provider (provider data gone), the last 4 would become useful. That is a retention question for the venue, not a reason to store it by default.
