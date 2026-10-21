Made by: Sonnet research agent for #49, 10-21. For: the ordering lead.

# Payment provider facts: Stripe Connect for a Bulgarian venue, myPOS embedded form
Builds on `2026-10-17-payment-providers-feasibility.md`; sources: docs.stripe.com and developers.mypos.com only. Tags: [DOC] official page, [READING] my interpretation, [NOT FOUND] pages silent. Stripe paths below are under https://docs.stripe.com/.

## 1. Connecting a venue (Stripe)
- [DOC] Stripe says OAuth "isn't recommended for new Connect platforms" and points to Connect Onboarding for Standard accounts: `connect/oauth-standard-accounts`. That page is itself marked deprecated for legacy account types; new platforms are sent to the Accounts v2 API (or v1 with controller properties): `connect/standard-accounts`, `connect/accounts-v2`.
- [DOC] Only OAuth connects an existing account: the user "is logged in and can choose an account", and creating a new account is "incorporated into our authorization flow". Account Links (v1 or v2) only onboard accounts the platform creates. Accounts v2 lists OAuth as a case where v1 must be used. `connect/oauth-standard-accounts`, `connect/accounts-v2`.
- [DOC] The platform stores `stripe_user_id` and then uses its own key plus `Stripe-Account`. `read_write` OAuth cannot connect accounts controlled by another platform.
- Owner's steps with OAuth: (1) press "Connect with Stripe" in Restro; (2) on Stripe, sign in, or sign up (business details, identity check, bank account, terms); (3) pick the account and approve access for Restro; (4) land back in Restro. The venue keeps its own Dashboard.
- [READING] No removal of OAuth announced. Restro's choice: OAuth versus pasted restricted keys.

## 2. What Stripe requires of the platform
- [DOC] Before building, "onboard your platform to Connect" in the Dashboard's platform profile: `connect/design-an-integration`. [NOT FOUND] review criteria or timing (the platform-profile docs page returned 404).
- [DOC] stripe.com/global lists Bulgaria. The account-types page lists BG for Express and Custom availability; a Standard account defaults to the platform's country: `connect/accounts`, `connect/standard-accounts`.
- [NOT FOUND] an explicit "Bulgaria as Connect platform country" line. [READING] A Bulgarian platform with Bulgarian venues is same-region; cross-border limits apply to transfers, which direct charges do not use: `connect/cross-border-payouts`.

## 3. Restricted key: create, capture, cancel, but no refund
- [DOC] Restricted keys (`rk_live_`) set None/Read/Write per resource; "if you use Connect, you can also select the permission ... when accessing connected accounts": `keys/restricted-api-keys`. They work with `Stripe-Account`: `connect/authentication`.
- [DOC] "Payment Intents" write covers create, update, confirm, capture, cancel, increment. "Charges and Refunds" is a separate resource whose write creates refunds. (Stripe Apps permission reference, same resource names: `stripe-apps/reference/permissions`.)
- [READING] So PaymentIntents Write with Charges and Refunds set to None or Read cannot refund. This comes from the Apps page, not the key page: confirm a 403 on `POST /v1/refunds` in a sandbox.
- Venue-pasted key, suggested: PaymentIntents Write; Checkout Sessions Write (only if Sessions are used); Payment Method Domains Write; Charges and Refunds Read (to read the 3-D Secure result); Events Read. Everything else None.
- [NOT FOUND] a way to narrow an OAuth `read_write` grant; the no-refund limit sits in Restro's own key. The venue's Dashboard can still refund.

## 4. Embedded form with manual capture and direct charges
- [DOC] Checkout Sessions with `ui_mode=elements` and `payment_intent_data[capture_method]=manual` is shown: `payments/place-a-hold-on-a-payment-method`. Direct charge on `ui_mode=embedded_page` (Stripe-Account header on the server, `stripeAccount` in Stripe.js) is shown: `connect/direct-charges?platform=web&ui=embedded-page`. Express Checkout Element with Sessions plus Connect is shown: `elements/express-checkout-element/accept-a-payment`.
- [DOC] PaymentIntent plus Payment Element direct charge is shown (`connect/direct-charges?...ui=elements`). [NOT FOUND] one page combining manual capture, embedded form and Connect.
- [DOC] Stripe recommends Checkout Sessions with the Payment Element over bare PaymentIntents "for most integrations": `payments/accept-a-payment?payment-ui=elements&api-integration=checkout`. Embedded page: least effort, preset styling only.
- [READING] Restro's own page style points to Sessions with `ui_mode=elements`. Catch [DOC]: that mode requires a customer email (see 7); the PaymentIntent route does not. Decision for the lead.

## 5. Apple Pay and Google Pay
- [DOC] With Elements or embedded Checkout, every domain showing the wallet must be registered. For direct charges, register it for each connected account: `POST /v1/payment_method_domains` with the platform key and `Stripe-Account`. Yes, by API: `payments/payment-methods/pmd-registration?dashboard-or-api=api`. Needs Payment Method Domains Write.
- [DOC] Apple Pay is marked "(Required)"; Google Pay is listed but not marked. [NOT FOUND] whether Google Pay works unregistered. Apple Pay shows only on Safari 17+/iOS 17+, Google Pay on Chrome 61+.

## 6. 3-D Secure
- [DOC] `payment_method_options[card][request_three_d_secure]=any` (prefers frictionless) or `challenge`, on PaymentIntent create/confirm and on Checkout Session. It overrides Radar rules; Stripe cannot be told to skip 3DS; SCA rules still apply. The issuer decides the flow. `payments/3d-secure/authentication-flow`.
- [DOC] With manual capture the payment ends in `requires_capture` after authentication. Wallets are exempt from 3DS prompts ("not all transactions support 3DS, for example wallets"); liability shift "in some cases" applies via their cryptogram.
- [DOC] Result on the charge: `payment_method_details.card.three_d_secure` with `result`, `authentication_flow`, `electronic_commerce_indicator`. On a dispute Stripe adds the ECI and result to evidence. Liability shift is "not guaranteed". Not read: other fields such as version.

## 7. Stripe's own receipts
- [DOC] Direct charges use the connected account's Customer emails, Branding and Public details settings. A platform-supplied `receipt_email` sends a receipt "regardless of your email settings". `receipts`, `api/payment_intents/create`.
- [READING] Restro can avoid sending one (never set `receipt_email`, send no email to Stripe) but cannot switch off a Standard account's own "Successful payments" toggle. [NOT FOUND] whether a payment with no email attached gets a receipt. Ask the venue to turn the toggle off.
- [DOC] Checkout Sessions in `ui_mode=elements` require a valid customer email: `payments/accept-a-payment?payment-ui=elements&api-integration=checkout`.

## 8. Tips and a larger hold
- [DOC] No online tip parameter found: `amount_details` takes discount, line items, shipping, tax (`api/payment_intents/capture`); `tip` appears only in Terminal docs. [READING] Tip = a higher `amount`, chosen before the hold.
- [DOC] Incremental authorization: `request_incremental_authorization=if_available` at confirm, then `increment_authorization` (max 10 per PaymentIntent, does not extend the window). Visa, Mastercard and Amex: global, all categories. IC+ pricing feature ("contact" Stripe on blended). Under SCA the card is saved for off-session use; later increments count as merchant-initiated. `payments/incremental-authorization`. No card-not-present or EEA restriction is stated.
- [DOC] Overcapture: Visa excludes EEA businesses; Mastercard is US-only; Amex +30% for restaurants and drinking places; IC+ only; under SCA authenticate the highest amount: `payments/overcapture`. [READING] Unusable for Visa/Mastercard in Bulgaria.

## 9. Hold length
- [DOC] Online card payments: 7 days (Visa merchant-initiated 4 days 18 hours). The tables do not vary by merchant category. Read `capture_before` on the charge for the real expiry. `payments/place-a-hold-on-a-payment-method`. Yes, 7 days is standard.
- [DOC] Extended 30 days: Mastercard all categories; Visa other categories at +0.08%, customer-initiated only; Amex lodging and rental only; Discover dropped bars and restaurants in 2023. IC+. `payments/extended-authorization`.

## 10. Sandbox
- [DOC] Test connected accounts via API or Dashboard; SMS code `000-000`; OAuth test `client_id` allows a localhost redirect and skipping the account form; an existing test account connects only with an email different from the platform's; verification tokens (DOB `1901-01-01`); Bulgarian test IBAN `BG80BNBG96611020345678`. Sandboxes "might not enforce some capabilities". `connect/testing`.
- [DOC] Cards: `4242 4242 4242 4242` pays, `4000 0025 0000 3155` needs 3DS, `4000 0000 0000 9995` declines, `4000 0084 0000 1629` authenticates then declines; test mode shows a mock 3DS page. Incremental: `4000 0584 0000 0063` succeeds, `4000 0084 0000 0076` fails. `payments/3d-secure/authentication-flow`, `payments/incremental-authorization`.
- [DOC] Wallets need a real device. [READING] Not CI-testable.

## 11. myPOS (Checkout)
- [DOC] The Checkout API is a redirect: "iFrame and similar solutions will not work due to security reasons." https://developers.mypos.com/apis/checkout-api/checkout-getting-started/implementation-basics
- [DOC] A separate Embedded SDK offers a myPOS-branded iFrame (cards, iDEAL; min 320x620; Apple Pay and Google Pay "not supported"; standard and deferred-button modes). https://developers.mypos.com/en/doc/online_payments/v1_4/374-embedded-sdk. [NOT FOUND] pre-authorisation, 3DS handling or partner use in it: https://developers.mypos.com/en/doc/online_payments/v1_4/376-sample-code
- [DOC] Pre-authorisation, completion and cancellation exist, hosted. Completion lists only `Amount` ("requested"): partial completion [NOT FOUND]. https://developers.mypos.com/apis/checkout-api/pre-auth-completion
- [DOC] In-App PreAuthorization avoids the redirect, but Restro would handle card data: PCI SAQ-D, own 3DS (MPI plugin). https://developers.mypos.com/apis/checkout-api/in-app-pre-authorization
- [DOC] Partners Program: `PartnerID` and `ApplicationID` (analytics only). [NOT FOUND] a flow to connect a merchant's account for Checkout.
- [DOC] 3DS is mandatory, merchants auto-enrolled, redirect to the issuer. https://developers.mypos.com/en/doc/online_payments/v1_4/10-security-and-availability

## What this means for D98's capability flags
- **Hosted vs embedded**: Stripe embedded, yes. myPOS Checkout hosted-only; SDK iFrame exists without a documented hold. Needs a flag "embedded form supports hold".
- **Wallets in embedded form**: Stripe yes with per-venue domain registration (set at connect time). myPOS SDK no.
- **Partial capture**: Stripe yes; myPOS unknown.
- **Raise hold / tip over hold**: Stripe incremental authorization on IC+ pricing only; overcapture unusable for Visa/Mastercard in Bulgaria. Default flag: tip fixed before the hold.
- **Hold length**: Stripe 7 days (read `capture_before`); myPOS unknown.
- **Connection method and key scope**: Stripe OAuth or pasted restricted key; refund blocked by key scope (verify in sandbox). myPOS: store keys; no partner connect found.
- **Provider emails the guest**: add a flag; Stripe depends on the venue's setting.
- **3DS forcing**: Stripe `any`; wallets bypass; myPOS always.
- **Sandbox**: Stripe all but wallets; myPOS no hold or 3DS shown.
