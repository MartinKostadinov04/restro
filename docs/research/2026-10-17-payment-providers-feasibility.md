# Payment providers for Restro: feasibility of D98's interface
### Research for tracker T80 (issue #9). Extends Part 1 of `2026-10-17-mypos-and-fiscal-receipts.md`; does not repeat it.
*Researched 2026-10-17 from the providers' own developer documentation and pages. Not legal advice. The legal side (fiscal receipts, who may take a fee) is the lawyer's (Q74, Q75) and is only cross-referenced here.*

## How to read this document

Every line carries a tag and a URL.

- **[DOC]** stated on the provider's developer documentation (or its technical specification PDF).
- **[VENDOR PAGE]** stated on the provider's marketing or product page (official, not technical).
- **[READING]** my interpretation. Not a fact. Flagged so the lead can check it.
- **[NOT FOUND]** the primary pages I read are silent. It is **not** assumed to exist.

Most pages were read through a fetch tool that summarises them (the same limit as the earlier research). Two sources were read in full as text: Borica's specification P-OM-41 v7.0 (PDF, `pdftotext`) and SumUp's complete documentation file (`llms-full.txt`). For anything load-bearing, open the cited URL.

## Result in one screen

| Provider | Hold and capture | Venue is merchant, Restro never holds money | Verdict |
|---|---|---|---|
| **Stripe** | Yes, documented in full | Yes (Connect, direct charges) | **Feasible** |
| **myPOS** | Yes (switch-on by myPOS) | Yes (venue's own store keys) | **Feasible with named conditions** |
| **Borica** | Yes (pre-authorisation, 30 days) | Yes, but each venue needs a contract with a partner bank | **Feasible with named conditions** |
| **ePay.bg** | Yes (30 days, documented 2023) | Yes (venue's ePay account) | **Feasible with named conditions** (no refund API found) |
| **SumUp** | No hold or capture found anywhere in its documentation | Yes (OAuth or API key) | **Feasible only as the fallback** (charge on request, refund on skip) |

Recommendation for the first provider package: **Stripe**, with myPOS second. Reasons and the one condition are in "Recommendation" below. Nothing in the research needed a partner account to read, and no provider offered only a model where Restro would hold the money (see "Stop-and-ask checks").

---

# 1. myPOS (additions to Part 1)

Part 1 already covers: pre-authorisation exists and is off by default, "typically up to 30 days"; notification `URL_Notify`; `IPCRefund` and `IPCReversal`; Apple Pay on hosted checkout is advertised, Google Pay is not confirmed; no split parameter; fees 1.30% + 0.10 EUR. Not repeated. New findings only.

**1. Partner model**
- **[DOC]** A merchant creates its own Checkout store and key pair; the API calls carry `SID` (store), `WalletNumber` and `KeyIndex`. The credentials belong to the venue's myPOS account; Restro would store them sealed (D98). https://developers.mypos.com/apis/checkout-api/pre-authorization
- **[DOC]** A second, partner-style path exists in the Identity API: the partner creates an Integration in the Partner Portal and gets a `client_id`/`client_secret`; after a merchant approves it, the partner gets merchant-specific credentials (`cli_*`, `sec_*`). A bearer token (about 3,600 s) plus a session (about 360 s) are then sent with every call. https://developers.mypos.com/apis/identity
- **[READING]** The scopes shown on the Identity page are accounting and banking (`accounting.read`, `banking.write`). The page does not say the same credentials drive the Checkout API's hold calls. For Checkout, the venue's store keys are the documented route. Ask myPOS (Q76).
- **[DOC]** Checkout API methods accept optional `PartnerID` and `ApplicationID` (API version 1.4.1) for the Partners Program; the pages say they give "analytics" in the Partners Portal, nothing more. https://developers.mypos.com/apis/checkout-api/refund
- **[NOT FOUND]** Whether the venue or Restro holds the private key in the partner path.

**2. Hold**
- **[DOC]** `IPCPreAuthorization` requires `Amount`, `Currency`, `OrderID`, `SID`, `WalletNumber`, `KeyIndex`, `URL_OK`, `URL_Cancel`, `URL_Notify`, `ItemName`. The page states no hold duration and no test mode. https://developers.mypos.com/apis/checkout-api/pre-authorization
- **[DOC]** The completion page lists `Amount` as "the amount of the payment requested" and says nothing about completing for less (or more) than the held amount, and nothing on a time limit. https://developers.mypos.com/apis/checkout-api/pre-auth-completion
- **[NOT FOUND]** Partial capture. **[NOT FOUND]** What happens to an uncompleted hold at the end of the period (released by the issuer or not).
- **[DOC]** Cancel exists (`IPCPreAuthCancellation`), status exists (`IPCPreAuthStatus`). https://developers.mypos.com/apis/checkout-api

**3. Refund**
- **[DOC]** "The merchant can refund any partial amount of the payment back to the customer. The maximum refunded amount is 100 percent of the original amount." The refund goes back to the original payment method. https://developers.mypos.com/apis/checkout-api/checkout-getting-started/implementation-basics
- **[DOC]** The `IPCRefund` parameter page is silent on partial amounts and on a time window; it takes `IPC_Trnref`, `Amount`, `Currency`. https://developers.mypos.com/apis/checkout-api/refund
- **[NOT FOUND]** A refund time limit. **[NOT FOUND]** Refunding a captured hold specifically (the refund references the original `IPC_Trnref`; whether completion creates a refundable one is not stated).

**4. Wallets**
- Nothing new beyond Part 1 (Apple Pay **[VENDOR PAGE]**; Google Pay **[NOT FOUND]**; both production only in the WooCommerce note).

**5. Notifications**
- **[DOC]** Signature: SHA-256 of all properties in the command, Base64-encoded, sent as the last POST parameter; validate against all received fields because the list "can be expanded over time". The page does not state a secret key or the field order for hashing. https://developers.mypos.com/apis/checkout-api/purchase-notify
- **[DOC]** "Any non-200 response is treated as a communication or system error." **[NOT FOUND]** a retry schedule and a timeout.
- **[READING]** `RequestSTAN` ("used for request unique match") is the closest thing to an idempotency handle; duplicates are not discussed. Treat notifications as possibly repeated.

**6. Split or platform fee**
- **[VENDOR PAGE]** "Automatic commission splits & merchant payouts" for "multi-merchant platforms"; no mechanism or terms. https://partners.mypos.com
- **[DOC]** No fee parameter in the Checkout API (Part 1). Unchanged: **[NOT FOUND]**.

**7. Test environment**
- **[DOC]** Sandbox: test URL `https://www.mypos.com/vmp/checkout-test`, a shared test store (SID `000000000000010`, wallet `61938166610`, key index 1) with published test keys; "works just like the real system"; 3D Secure is not performed in the sandbox. https://developers.mypos.com/online-payments/initial-setup-and-testing/testing-in-sandbox/test-data
- **[DOC]** Test cards (Visa, Mastercard, V Pay), declined in production. https://developers.mypos.com/online-payments/initial-setup-and-testing/testing-in-sandbox/test-cards (via search listing)
- **[NOT FOUND]** Any statement that pre-authorisation, completion or wallets work in the sandbox.

**8. Fees and contract**
- Part 1 stands (1.30% + 0.10 EUR EEA consumer cards; free partner account, "No binding contracts, no monthly fees"). **[VENDOR PAGE]** https://partners.mypos.com
- **[NOT FOUND]** Any fee for a platform like Restro.

**9. Fiscal link**
- **[NOT FOUND]** In the pages read for this task, no document the provider issues that a venue can use as a fiscal receipt. See Part 2 of the earlier research and the sibling research (issue #8).

**Verdict: feasible with named conditions.** Conditions (all to myPOS, Q76): pre-authorisation switched on for the venue's store; partial completion allowed; the real hold length for a nightclub's business type; Google Pay on hosted checkout; notification retries; refund of a completed hold; which credentials a partner may use. Restro would invoice its fee.

---

# 2. Stripe (Bulgaria)

**1. Partner model**
- **[DOC]** Bulgarian businesses and non-profits (sole proprietors too) can hold a Stripe account; the agreement is with Stripe Payments Europe, Limited. https://stripe.com/en-mt/legal/ssa/bg
- **[DOC]** Stripe's Bulgaria pricing page exists and is in euro and levs (the euro was adopted in Bulgaria on 2026-01-01; Stripe says it no longer accepts BGN). https://stripe.com/en-bg/pricing and https://support.stripe.com/questions/bulgarian-lev-(bgn)-transition-to-euro-(eur)
- **[DOC]** Connect lets a platform create **direct charges** on a connected account: the payment is a charge on the connected account, its balance rises, the platform sends `Stripe-Account: <acct_id>` and Checkout shows the connected account's branding. Stripe recommends direct charges for accounts with the full Dashboard. https://docs.stripe.com/connect/direct-charges
- **[DOC]** For a Standard connected account the connected account carries fraud and dispute liability for direct charges; onboarding and identity checks are done by Stripe; the account holder has the full Dashboard and "can process charges on their own". https://docs.stripe.com/connect/accounts
- **[DOC]** An existing Stripe account is connected to a platform with OAuth (`connect.stripe.com/oauth/authorize`, code exchanged for `stripe_user_id`); the platform then uses its own secret key plus the `Stripe-Account` header. https://docs.stripe.com/connect/oauth-reference
- **[DOC]** The same page says platforms using OAuth with `read_write` scope cannot connect accounts "controlled by another platform" (since June 2021). https://docs.stripe.com/connect/oauth-reference
- **[DOC]** The account-types page tells new platforms to use the Accounts v2 API or controller properties instead of the legacy account types. **[NOT FOUND]** the exact current path for "connect a venue's existing account" under that newer model. https://docs.stripe.com/connect/accounts
- **[DOC]** Alternative with no Connect: a venue can create restricted API keys (`rk_live_...`) in its own Dashboard and set permissions; webhook signing secrets are separate per endpoint. https://docs.stripe.com/keys
- **[READING]** D98's flow (owner enters credentials, platform tests them, seals them) fits restricted keys directly; Connect OAuth is the smoother flow for owners and is needed for an inline platform fee. Choice for the interface design, not for this research.
- **[READING]** Restro would need to be accepted by Stripe as a Connect platform. I found no page on what that review requires. Ask Stripe.

**2. Hold**
- **[DOC]** Authorise now, capture later: `capture_method=manual` on a Checkout Session or PaymentIntent; the payment waits in `requires_capture`. https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- **[DOC]** Standard hold for online cards: 7 days (Visa merchant-initiated: 5 days, exactly 4 days 18 hours). If not captured in time the funds are released and the payment is `canceled`. Same page.
- **[DOC]** Extended hold up to 30 days (Mastercard all categories; Visa 29 days 18 hours, other categories +0.08% per transaction, customer-initiated only; Amex only lodging and rental). Offered on IC+ pricing; on blended pricing "contact" Stripe. https://docs.stripe.com/payments/extended-authorization
- **[DOC]** Partial capture: `amount_to_capture` below the held amount captures that and "automatically releases the remaining amount". Only one capture per authorisation for most payments. Same hold page.
- **[DOC]** Release: cancel the PaymentIntent. https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- **[READING]** For D99 (one night), the 7-day standard hold is long enough; the 30-day extended hold is not needed.

**3. Refund**
- **[DOC]** Full and partial refunds, several against one charge up to the original total; the refund goes to the original payment method only; Stripe's processing fees are not returned. https://docs.stripe.com/refunds
- **[DOC]** A payment that is only authorised cannot be refunded; it must be cancelled. After capture it is an ordinary refund. Same page.
- **[DOC]** A card refund can fail (closed card); the money then returns to the balance, which can take up to 30 days; Stripe sends `refund.failed`. Same page.
- **[NOT FOUND]** A stated time limit for refunds on the refunds page.
- **[DOC]** Refunds use the connected account's available balance; if short, a card refund waits as pending. Same page.

**4. Wallets**
- **[DOC]** Apple Pay on hosted Checkout "works with no additional configuration"; domain registration is for Elements and embedded Checkout. Manual capture supported; partial refunds supported; Connect supported. https://docs.stripe.com/apple-pay.md?platform=web
- **[DOC]** Google Pay on Checkout "requires no additional code"; enable it in payment-method settings. Manual capture and partial refunds supported. https://docs.stripe.com/google-pay.md?platform=web
- **[DOC]** Both pages also say that with **direct charges** the domain must be configured for each connected account through the API. **[NOT FOUND]** whether that applies to Stripe-hosted Checkout (the pages put it under the general web section). Ask Stripe or test in the sandbox.
- **[DOC]** Test: Apple Pay needs a real card in the wallet with test keys ("returns a successful test card token"); you cannot add Stripe test cards to Apple Wallet. Google Pay uses Google's test card suite. https://docs.stripe.com/apple-pay.md?platform=web and https://docs.stripe.com/google-pay.md?platform=web
- **[READING]** Wallet test needs a real iPhone or Android device: a manual step, not CI.

**5. Notifications**
- **[DOC]** Signed webhooks: `Stripe-Signature` header, HMAC-SHA256 over `timestamp.payload`, 5-minute tolerance in the libraries, signing secret per endpoint. https://docs.stripe.com/webhooks
- **[DOC]** Retries "for up to three days with an exponential back off" in live mode; in a sandbox 3 times over a few hours. Events can arrive out of order; dedupe by event ID. Same page.
- **[DOC]** Connect: a separate event destination for connected accounts' events (direct charges). Same page.
- **[DOC]** Idempotency keys on every POST: the first result is saved and replayed; keys may be pruned after 24 hours; up to 255 characters. https://docs.stripe.com/api/idempotent_requests
- **[DOC]** For a hold, `payment_intent.amount_capturable_updated` marks "authorised". https://docs.stripe.com/payments/place-a-hold-on-a-payment-method

**6. Split or platform fee**
- **[DOC]** `payment_intent_data[application_fee_amount]` on the Checkout Session: the fee goes to the platform's balance, the rest to the connected account. It must be positive and under the charge, it is capped at the captured amount, and no extra Stripe fee is charged on it. https://docs.stripe.com/connect/direct-charges
- **[DOC]** A refund does not refund the application fee unless `refund_application_fee=true`; partial refunds return it proportionally. Same page.
- **[READING]** So Stripe offers the split D98 says to wait for. Using it means Restro's fee money passes through Restro's Stripe balance. Whether that is allowed or changes Restro's regulatory position is a question for the lawyer, not this note. The default in D98 (invoice the fee) works on Stripe too.

**7. Test environment**
- **[DOC]** Sandboxes with test keys (`pk_test_`, `rk_test_`, `sk_test_`); card networks do not process payments; Connect account objects return no sensitive fields. https://docs.stripe.com/keys
- **[DOC]** Test cards: `4242 4242 4242 4242` (success), `4000 0025 0000 3155` (needs 3D Secure), `4000 0000 0000 9995` (declined); extended-authorisation test cards for Visa, Mastercard, Amex, Discover. https://docs.stripe.com/connect/direct-charges and https://docs.stripe.com/payments/extended-authorization
- **[DOC]** If extended authorisation is available in a test, it is available live. Same extended page.
- **[NOT FOUND]** What does not work in test beyond wallets needing a real device.

**8. Fees and contract**
- **[VENDOR PAGE]** Bulgaria: standard EEA cards 1.5% + EUR 0.25; premium EEA 2.8% + 0.25; UK 2.5% + 0.25; international 3.15% + 0.25 (+2% with currency conversion). Apple Pay and Google Pay are charged at the card rates, no wallet surcharge listed. Dispute EUR 20; no refund fee; Checkout has no surcharge. https://stripe.com/en-bg/pricing
- **[VENDOR PAGE]** Connect: "Platforms that set their own pricing start at a 0.25% fee"; where Stripe bills the connected accounts directly, no platform fee. The Connect pricing page also lists EUR 4 per monthly active account, 0.25% + EUR 0.60 per payout and 1.5% + EUR 0.50 for standard European cards, "not Bulgaria-specific". The two pages differ (EUR 0.25 vs 0.50); the Bulgarian price page is the more specific. https://stripe.com/en-bg/connect/pricing
- **[DOC]** Fee responsibility depends on the pricing model and on legacy Express/Custom accounts being charged "at standard sticker rates" for direct charges. https://docs.stripe.com/connect/accounts
- **[NOT FOUND]** A written contract for a platform; Connect terms were not read.

**9. Fiscal link**
- **[DOC]** Stripe sends email or hosted-URL receipts for payments and refunds, and can create paid-invoice PDFs from Checkout (separately priced); the receipt carries the legal business name and support details. https://docs.stripe.com/receipts
- **[NOT FOUND]** Any Bulgarian fiscal receipt or NRA document. **[READING]** these are payment receipts, not fiscal-device receipts.

**Note on a conflicting reading.** One fetch of `https://stripe.com/global` said Bulgaria was absent from the supported list; a second, pointed fetch of the same page quoted "Belgium Brazil Bulgaria Canada ..." Together with the Bulgarian service agreement and price page, I take Bulgaria as supported. [READING]

**Verdict: feasible.** Conditions: Restro accepted as a Connect platform (unverified); the per-account wallet domain question; the pricing model (blended vs IC+) if the 30-day hold is ever wanted.

---

# 3. Borica (BORICA AD, virtual POS)

Borica is the Bulgarian card processor owned by 19 banks; it acts as third-party processor for Visa and Mastercard. A venue does not contract Borica directly. **[VENDOR PAGE]** "Merchants may use virtual POS terminals contracting any of the financial institutions, partners of BORICA." https://www.borica.bg/en/products-and-services/obslujvane-na-terminali-v-shemata-3d-secure

**1. Partner model**
- **[DOC]** The merchant has a Merchant ID and a Terminal ID "provided by FI" (the acquiring bank); the terminal ID differs between test and production. https://3dsgate-dev.borica.bg/P-OM-41_BORICA_eCommerce_CGI_interface_v%207.0_EN.pdf (section 1.2.1)
- **[DOC]** Every merchant signs each request with its own RSA key (2048-bit), one for test and one for production; the merchant sends a certificate request to Borica, which signs it; "Safekeeping and replacement of private key is merchant's responsibility" and the key must not be disclosed to third parties. Same PDF, sections 5.1-5.4.
- **[READING]** Restro would hold the venue's signing key on the venue's behalf; the specification says the key must not be shared, so this needs Borica's and the bank's written OK. A sealed key under D98's rule is the closest fit.
- **[DOC]** "Each vPOS can work in one currency only." Same PDF, section 2.1. (Its examples still show BGN; **[NOT FOUND]** the EUR statement.)
- **[DOC]** Additional appendices (tokens and others) "are provided upon request by the institutions that offer the relevant services". Same PDF, section 1.1. **[READING]** The core specification is public; the add-ons need the bank. Nothing needed for hold, capture, reversal was behind that wall.
- **[VENDOR PAGE]** Borica lists the partner banks in a PDF (`Certified-e-Commerce-FI-EN-March-2024.pdf`), not opened. https://www.borica.bg/attachments/BobsProduct/57/docs/Certified-e-Commerce-FI-EN-March-2024.pdf

**2. Hold**
- **[DOC]** Pre-authorisation (`TRTYPE=12`) "approves account balance and blocks the requested amount"; completion (`TRTYPE=21`) pays it; the completion amount "should be lower or equal" to the pre-authorisation. Same PDF, sections 1.2.1, 2.1, 4.5.
- **[DOC]** One completion per successful pre-authorisation, within 30 days; a failed completion needs a new pre-authorisation. Same PDF, section 4.5.
- **[DOC]** Release: reversal of pre-authorisation (`TRTYPE=22`), amount equal to the original, within 30 days, only one attempt per operation. Same PDF, section 4.6.
- **[DOC]** "The acquiring institution of the e-merchant may have additional requirements." Same PDF, section 4.5. **[READING]** The bank may switch pre-authorisation on, limit or price it. Ask the bank.

**3. Refund**
- **[DOC]** Reversal of a sale (`TRTYPE=24`): "less or equal" to the original amount (partial allowed), one reversal per sale, within 30 days of the original date. If it fails the merchant contacts the acquirer; the amount "can be returned to the cardholder through the acquiring institution". Same PDF, sections 2.1 and 4.3.
- **[READING]** After 30 days no API refund is documented. A refund of a captured hold follows the same 30-day rule from the original date: **[NOT FOUND]** whether the 30 days run from authorisation or completion.

**4. Wallets**
- **[DOC]** Apple Pay and Google Pay buttons are on the Borica payment page; no merchant integration; the only requirement is a service contract with the acquiring bank; Visa and Mastercard. https://www.borica.bg/attachments/BobsProduct/57/docs/Manual-for-Apple-Pay.pdf and https://www.borica.bg/attachments/BobsProduct/57/docs/Google-Pay-for-Virtual-Merchants-EN_2.pdf
- **[NOT FOUND]** Whether a wallet payment can be a pre-authorisation. **[NOT FOUND]** Wallets in the test environment.

**5. Notifications**
- **[DOC]** The result comes back **through the cardholder's browser** (HTTP POST to the merchant's `BACKREF`), signed by Borica; the merchant verifies the signature with Borica's public key. Same PDF, section 2.1.
- **[DOC]** "It is possible ... that the e-merchant will never receive a 'Sale' result" (browser closed); the merchant then asks for the status with `TRTYPE=90`, valid for operations "within previous 24 hours". Same PDF, section 2.1.
- **[NOT FOUND]** A server-to-server callback, a retry policy, or an idempotency mechanism in this specification (v7.0, 2026-04-17). Reversal and completion are direct server calls; a duplicate transaction gets a response code ("The transaction has already been executed", RC -21). Same PDF, section 8.
- **[READING]** Restro would have to poll status for any payment whose browser never came back, inside the 24-hour window. That breaks D98's "status notifications" as a push.

**6. Split or platform fee**
- **[NOT FOUND]** Any split or platform-fee parameter. The venue's contract is with its bank. **[READING]** Fee invoiced outside the payment.

**7. Test environment**
- **[DOC]** Test gateway `https://3dsgate-dev.borica.bg/cgi-bin/cgi_link`, production `https://3dsgate.borica.bg/cgi-bin/cgi_link`; test cards Visa `4341792000000044`, Mastercard `5100789999999895`, OTP `111111`; an amount ending `.65` gives response code 65/1A. Same PDF, sections 2.2 and 7.
- **[DOC]** The specification has worked pre-authorisation, completion and reversal examples, so the flow exists on the test terminal. **[NOT FOUND]** a statement that wallets work there.

**8. Fees and contract**
- **[NOT FOUND]** Any fee on Borica's page; the bank sets it. Nothing for a platform like Restro.

**9. Fiscal link**
- **[NOT FOUND]** Receipts or fiscal documents in the specification.

**Verdict: feasible with named conditions.** (a) every venue needs a bank contract with the right products (online card acceptance, pre-authorisation, wallets); (b) the venue's RSA signing key must sit with Restro; (c) status must be polled; (d) one currency per terminal; (e) 30-day limits on completion and reversal. It is the only one of the five that works through the venue's own bank, so it fits large clubs with a bank POS contract and a bank willing to enable it, not a quick pilot.

---

# 4. ePay.bg

**1. Partner model**
- **[DOC]** A merchant registers on epay.bg as a legal entity, files a "Request for registration as a merchant", needs a contract for the service, copies of the representatives' IDs and a bank note for transfers. https://kb.epay.bg/en/faq/
- **[DOC]** The merchant holds a Customer Identification Number (CIN) and a "secret word" that signs the requests with HMAC-SHA1. https://kb.epay.bg/en/web/web/ and https://kb.epay.bg/en/web/notify/
- **[READING]** The venue's own ePay account is the merchant; funds land in that account (payouts monthly, weekly, on a date, or at a threshold: https://kb.epay.bg/en/faq/). The venue would paste CIN and secret word into Restro. No partner or OAuth mechanism is described. **[NOT FOUND]**

**2. Hold**
- **[DOC]** Pre-authorisation: request to `WEB_ADDRESS/paylogin` with `PREAUTH=1` and a required `EXP_TIME`; the customer enters card details; the amount is blocked. https://kb.epay.bg/en/web/preauth/
- **[DOC]** "The hold lasts 30 days. If the merchant takes no action, the request is cancelled automatically." Same page.
- **[DOC]** Confirm (capture): `/preauth/confirm` with `ORIGINAL_AMOUNT` and `CONFIRM_AMOUNT` less than or equal to the original; the difference is released. Cancel: `/preauth/cancel` with `REV_AMOUNT` equal to the original (full only). One of the two per pre-authorisation, then a status check. Same page.
- **[DOC]** The feature was added to the API on 2023-06-23; the documentation was last updated 2023-09-29. https://kb.epay.bg/en/changelog/
- **[NOT FOUND]** Who switches pre-authorisation on, and whether it is open to every merchant. The page says to ask ePay.

**3. Refund**
- **[DOC]** The FAQ says a payment can be reversed "from your ePay.bg account" and that "the commission deducted for the payment made to you is not refundable". https://kb.epay.bg/en/faq/
- **[NOT FOUND]** A refund API, partial refund, or time limit. The navigation has no refund page. https://kb.epay.bg/en/
- **[READING]** After capture, a "refund on skip" would be a manual step by the venue in ePay's panel unless ePay offers an API. This is the main gap.

**4. Wallets**
- **[NOT FOUND]** Apple Pay or Google Pay anywhere in the documentation or FAQ pages read. https://kb.epay.bg/en/

**5. Notifications**
- **[DOC]** Server-to-server POST with `ENCODED` (Base64) and `CHECKSUM` (HMAC-SHA1 with the secret word). Statuses `PAID`, `DENIED`, `EXPIRED`; `STAN`, and the BORICA authorisation code (`BCODE`) when paid. https://kb.epay.bg/en/web/notify/
- **[DOC]** The merchant answers `INVOICE=<n>:STATUS=OK` (stops retries), `NO` (stops), or `ERR` (repeats). One request may carry several invoices. Same page.
- **[DOC]** Retries: 5 within 1 minute, 4 at 15-minute intervals, 5 within 1 hour, 6 within 3 hours, 4 within 6 hours, then 1 per day, for 14 days. Same page.
- **[DOC]** Answering `OK` or `NO` stops further notifications for that invoice. **[READING]** Notifications are keyed by invoice number, so repeats are safe to treat as the same event; duplicates are not otherwise discussed.
- **[READING]** The `BCODE` field names "BORICA authorization code", so card payments appear to run through Borica. Not stated as a fact.

**6. Split or platform fee**
- **[NOT FOUND]** No split or fee parameter. **[READING]** Invoiced outside.

**7. Test environment**
- **[DOC]** Free demo at `https://demo.epay.bg/` with a demo package; the merchant sets the notification address in the demo profile; the pre-authorisation page lists test cards and requires `force_credit_paydirect=1` in tests. https://kb.epay.bg/en/faq/ and https://kb.epay.bg/en/web/preauth/
- **[NOT FOUND]** Wallets in the demo.

**8. Fees and contract**
- **[DOC]** "No monthly fees"; the full tariff is "Appendix No. 1 of the contract". https://kb.epay.bg/en/faq/
- **[NOT FOUND]** A public card-payment price list; nothing for a platform like Restro.

**9. Fiscal link**
- **[NOT FOUND]** In the pages read.

**Verdict: feasible with named conditions.** The hold and the notifications are well described, with the longest retry window of the five. But no refund API and no wallets are documented, the documentation is from 2023, and no public tariff exists. The refund gap breaks "refund on skip" unless ePay provides an API: ask them before counting it.

---

# 5. SumUp

**1. Partner model**
- **[DOC]** Two ways to call the API: an API key or OAuth 2.0 (authorisation-code flow: the merchant approves, the platform exchanges the code at `api.sumup.com/token`; the platform holds the `client_secret`; refresh tokens are long-lived; the merchant never gives SumUp credentials to the platform). https://developer.sumup.com/tools/authorization/oauth/
- **[DOC]** The scopes `payments` and `payment_instruments` "need manual verification by SumUp" (contact SumUp). Same page. **[READING]** A partner step, but not needed to read the documentation.
- **[DOC]** Client-credentials tokens "can still process payments for merchants linked to your application" but not read merchant data. Same page.
- **[DOC]** Affiliate Keys: "mandatory for card-present integrations"; "SumUp enforces agreed terms such as fast onboarding, revenue share, and transaction fees". https://developer.sumup.com/tools/authorization/affiliate-keys/ (read in `llms-full.txt`, line 8872)

**2. Hold**
- **[NOT FOUND]** Pre-authorisation, authorise-then-capture, or any hold in the complete developer documentation (searched `llms-full.txt`, 587 KB, for pre-auth, hold, capture, reserve): the only "authorization" found is a zero-net verification charge on saved-card setup and the card-reader flows. https://developer.sumup.com/llms-full.txt
- **[DOC]** A checkout has a `valid_until` and a purpose of `CHECKOUT` or `SETUP_RECURRING_PAYMENT`. Same file.

**3. Refund**
- **[DOC]** Full refund: empty body. Partial: `{"amount": 24.42}`. `POST https://api.sumup.com/v0.1/me/refund/{txn_id}`; HTTP 204; needs a token from the authorisation-code flow (client-credentials tokens don't work); the refund goes to the original method; original processing fees are not returned. https://developer.sumup.com/online-payments/guides/refund/
- **[NOT FOUND]** A time limit.

**4. Wallets**
- **[DOC]** The hosted checkout page shows "Google Pay, Apple Pay, and card payment". https://developer.sumup.com/online-payments/checkouts/hosted-checkout/
- **[DOC]** Apple Pay and Google Pay are listed for Bulgaria; domain onboarding in the dashboard (Settings > For developers > Payment wallets) is needed for the direct and widget integrations. `llms-full.txt` lines 279-286 and https://developer.sumup.com/online-payments/apm/apple-pay/
- **[NOT FOUND]** Wallets in the sandbox.

**5. Notifications**
- **[DOC]** One event, `CHECKOUT_STATUS_CHANGED`, set per checkout via `return_url`; any 2xx answer; retries after 1 minute, 5 minutes, 20 minutes, 2 hours. https://developer.sumup.com/online-payments/webhooks/
- **[DOC]** No signature: "your application must always verify if the event really took place" by calling the API. Same page. **[NOT FOUND]** idempotency or duplicate handling.

**6. Split or platform fee**
- **[NOT FOUND]** For online payments. **[READING]** The affiliate wording is about card-present integrations; revenue share would be a contract with SumUp.

**7. Test environment**
- **[DOC]** Sandbox merchant accounts (Developer Settings > Sandboxes), test cards for the main networks, failed payments by amount (11.00, 42.01, 42.76, 42.91), 3D Secure cards. https://developer.sumup.com/online-payments/testing/
- **[NOT FOUND]** Wallets in the sandbox.

**8. Fees and contract**
- **[VENDOR PAGE]** Bulgaria online payments: 0 EUR per month, 2.50% per transaction, no fixed fee, no setup fee; API/SDK integrations "may have custom pricing". https://www.sumup.com/bg-bg/online-plashtania/

**9. Fiscal link**
- **[NOT FOUND]** For online payments. The mobile SDKs mention email/SMS receipts for card-present payments only (`llms-full.txt`). **[READING]** Not fiscal.

**Verdict: feasible only as D98's fallback provider** (charge on request, refund on skip), and only if the lawyer accepts that model. It cannot do D99's "hold on request, capture on accept".

---

# 6. One more provider?

The issue allows one more only if a primary Bulgarian page shows venues commonly use it. **None added.** Viva (viva.com) came up in searches with a documented ISV payment API and pre-authorisation, but I found no primary page showing Bulgarian venues using it, and two fetches (its developer pages and its Bulgarian site) timed out. Revolut's online-payments launch in Bulgaria appeared only in a news item (capital.bg), not a primary page. **[NOT FOUND]** Worth one follow-up if a pilot club names its provider.

---

# 7. Comparison of the nine points

| # | Point | myPOS | Stripe | Borica | ePay.bg | SumUp |
|---|---|---|---|---|---|---|
| 1 | Partner model | Venue's own store keys (**[DOC]**); partner-portal credentials, scope for Checkout unclear | Connect direct charges + OAuth, or venue's restricted keys (**[DOC]**) | Venue contracts a partner bank; venue's RSA key + certificate per terminal (**[DOC]**) | Venue's CIN + secret word (**[DOC]**) | OAuth or API key (**[DOC]**); `payments` scope needs SumUp's manual OK |
| 2 | Hold | Yes, off by default, "typically up to 30 days"; partial capture **[NOT FOUND]** | Yes; 7 days (Visa MIT 5); up to 30 on IC+; partial capture yes | Yes; completion and reversal within 30 days; completion up to the hold | Yes; 30 days, auto-cancel; confirm up to the hold | **[NOT FOUND]** |
| 3 | Refund | Partial yes (**[DOC]**, one page); window **[NOT FOUND]** | Full and partial; hold: cancel; no limit found | Sale reversal up to the amount, once, 30 days; hold reversal full only | UI only; API **[NOT FOUND]** | Full and partial by API; window **[NOT FOUND]** |
| 4 | Wallets (hosted) | Apple Pay **[VENDOR PAGE]**; Google **[NOT FOUND]**; production only | Both **[DOC]**; real device to test; per-account domain question | Both on Borica's page **[DOC]**; with a hold **[NOT FOUND]** | **[NOT FOUND]** | Both on hosted page **[DOC]**; sandbox **[NOT FOUND]** |
| 5 | Notifications | `URL_Notify`, SHA-256; retry **[NOT FOUND]** | Signed (HMAC-SHA256), 3 days exponential retry, dedupe by event ID, idempotency keys | Browser return only; status query for 24 h; no server push found | Signed (HMAC-SHA1), retries up to 14 days | One event, retries 1m/5m/20m/2h, unsigned |
| 6 | Platform fee in payment | **[NOT FOUND]** (portal claims) | Yes, `application_fee_amount` | **[NOT FOUND]** | **[NOT FOUND]** | **[NOT FOUND]** |
| 7 | Test environment | Sandbox store and cards; hold and wallets **[NOT FOUND]** | Sandbox; cards; hold documented; wallets need real device | Test gateway, 2 cards; hold in examples | Demo site; cards on page | Sandbox merchants and cards; wallets **[NOT FOUND]** |
| 8 | Fees | 1.30% + 0.10 EUR (EEA) | 1.5% + 0.25 EUR (EEA std); Connect from 0.25% | None published; bank's tariff | Contract appendix | 2.50% online |
| 9 | Fiscal document | **[NOT FOUND]** | Payment receipts only | **[NOT FOUND]** | **[NOT FOUND]** | **[NOT FOUND]** |

---

# 8. Recommendation: which provider first

**Stripe first, myPOS second.**

1. **Stripe is the only one where every point D98 and D99 need is written down in public**: hold with partial capture and release, refund after capture, wallets on hosted checkout, signed webhooks with a long retry window and idempotency keys, a free sandbox, and a way to take a fee inside the payment if Martin ever wants it. The other four each leave at least one core item **[NOT FOUND]** or unreachable.
2. **No contract with the provider is needed to start building**: sandbox keys are free, the venue holds its own account, and Restro never touches the money (direct charges on the venue's account).
3. **One condition**: Restro must be accepted as a Stripe Connect platform (or the venue must paste restricted keys), and the pilot club must be willing to use a Stripe account. If a pilot club already runs on myPOS, the order flips: myPOS becomes first as soon as myPOS answers the Q76 questions, because its hold, notification and refund calls exist but the details above are open.

Nothing here says myPOS is common in Bulgarian clubs; D98 states it, and I did not find a primary page to confirm it.

**Questions for the providers or Martin (to turn the **[NOT FOUND]** items into answers):**
- myPOS (extends Q76): partial completion; hold length for a nightclub; notification retries; Google Pay on hosted checkout; refund of a completed hold; which credentials a partner may use for Checkout calls.
- Stripe: what the Connect platform review needs; the wallet domain rule for Stripe-hosted Checkout on direct charges; whether a venue can connect an existing account under the Accounts v2 model.
- Borica or a pilot club's bank: pre-authorisation and wallets enabled on the venue's terminal; the bank's fee; whether Restro may hold the venue's signing key.
- ePay.bg: refund API; wallets; who enables pre-authorisation; the tariff.
- Martin (Q77): charging model, and whether a platform fee inside the payment is wanted at all.

---

# 9. Capability flags D98's interface needs (in words, no code)

Each provider declares the following. Where a value is not known, it is declared "unknown" and the platform behaves as if absent (the repository's "absence is never assumed" stance).

- **Can hold**: whether a payment can be authorised now and captured later.
- **Maximum hold length**: in days, and whether it varies by card brand or by the venue's contract (Stripe 7 days or 30 extended; Borica, ePay and myPOS about 30).
- **Hold expires by itself**: whether an uncaptured hold is released automatically (Stripe and ePay say yes; others unknown).
- **Can capture less than held**: partial capture, remainder released.
- **Can capture more than held**: for tips (Stripe, limited; others unknown).
- **One capture per hold**: whether a second capture is refused (Stripe and Borica yes; ePay: one confirm or one cancel per hold).
- **Can release a hold**: and whether partially or only in full (Borica and ePay: full only).
- **Can refund after capture**: full, and partially.
- **Refund time limit**: a number of days, or unknown (Borica 30 days from the original date).
- **Refund of the platform fee**: whether Restro's fee, if taken inside the payment, is returned with a refund.
- **Hosted checkout**: a redirect page run by the provider, so card data never reaches Restro.
- **Apple Pay on the hosted page** and **Google Pay on the hosted page**: each separately.
- **Wallets work together with a hold**: a separate flag.
- **Wallets testable in the sandbox**: separate, because they often are not.
- **Pushes status to Restro**: server-to-server notifications exist; if not, Restro must poll.
- **How notifications are signed**: none, shared secret hash, or public-key signature.
- **Notification retry window**: how long the provider keeps trying, or unknown.
- **Status can be queried**: and for how long back (Borica 24 hours).
- **Accepts an idempotency key** on requests that move money.
- **Platform fee inside the payment**: available or not; fee invoiced to the venue otherwise.
- **How the venue connects**: sign-in approval (OAuth), pasted keys, or keys plus certificates issued through a bank.
- **Needs a contract beyond the venue's account**: for example a partner bank or a manual provider approval of a scope.
- **One currency per account or terminal**.
- **Sandbox**: exists, has test cards, supports holds.
- **Documents the venue can use fiscally**: none found for any provider; the field exists so the lawyer's answer can be applied (D98).
- **Verified status of each flag**: each flag carries whether it came from documentation, a vendor page or an answer from the provider, with the date.

---

# 10. Stop-and-ask checks

- **Documentation behind a partner account:** none needed for the points above. Borica's extra appendices (tokens and similar) are "provided upon request"; the core specification, the wallet manuals and the test environment details are public. The myPOS help centre returned 403 in the earlier research, so help-centre facts are still unverified. SumUp's `payments` scope needs manual verification, which affects building, not reading.
- **A model where Restro itself holds the money:** none found. All five are the venue's own account. Stripe offers destination charges and separate charges (platform holds funds first) but direct charges avoid that; I did not design around it. The one place Restro receives money is Stripe's optional `application_fee_amount`, a legal question for the lawyer.
- **Downloaded files:** two Borica manuals and the Borica specification (PDF, about 1.1 MB), and SumUp's documentation text file (about 590 KB), were saved outside the repository to read them as text. They were not executed or committed.

---

# Sources

- myPOS: https://developers.mypos.com/apis/checkout-api (pre-authorization, pre-auth-completion, refund, purchase-notify, checkout-getting-started/implementation-basics), https://developers.mypos.com/apis/identity, https://developers.mypos.com/online-payments/initial-setup-and-testing/testing-in-sandbox (and `/test-data`, `/test-cards`), https://partners.mypos.com
- Stripe: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method, https://docs.stripe.com/payments/extended-authorization, https://docs.stripe.com/connect/direct-charges, https://docs.stripe.com/connect/accounts, https://docs.stripe.com/connect/oauth-reference, https://docs.stripe.com/keys, https://docs.stripe.com/refunds, https://docs.stripe.com/webhooks, https://docs.stripe.com/api/idempotent_requests, https://docs.stripe.com/apple-pay, https://docs.stripe.com/google-pay, https://docs.stripe.com/receipts, https://stripe.com/en-bg/pricing, https://stripe.com/en-bg/connect/pricing, https://stripe.com/en-mt/legal/ssa/bg, https://stripe.com/global
- Borica: https://3dsgate-dev.borica.bg/P-OM-41_BORICA_eCommerce_CGI_interface_v%207.0_EN.pdf, https://www.borica.bg/en/products-and-services/obslujvane-na-terminali-v-shemata-3d-secure, https://www.borica.bg/attachments/BobsProduct/57/docs/Manual-for-Apple-Pay.pdf, https://www.borica.bg/attachments/BobsProduct/57/docs/Google-Pay-for-Virtual-Merchants-EN_2.pdf
- ePay.bg: https://kb.epay.bg/en/ (web/web, web/notify, web/preauth, faq, changelog)
- SumUp: https://developer.sumup.com/llms-full.txt, https://developer.sumup.com/online-payments/ (checkouts/hosted-checkout, webhooks, guides/refund, testing, apm/apple-pay), https://developer.sumup.com/tools/authorization/oauth/, https://www.sumup.com/bg-bg/online-plashtania/
