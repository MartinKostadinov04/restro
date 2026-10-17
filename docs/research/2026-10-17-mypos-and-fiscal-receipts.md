# myPOS online payments and Bulgarian fiscal receipts for card payments
### Preliminary research for the lawyer (tracker Q62-Q64) and for the payment-provider choice
*Researched 2026-10-17 against primary sources only. Not legal advice. Restro rule: official docs > architecture doc > tracker.*

## How to read this document

Each finding carries a tag:

- **[DOC]** stated on an official myPOS documentation page.
- **[VENDOR PAGE]** stated on myPOS's own marketing or partner page (official, but not technical documentation).
- **[LAW]** the text of the law as published (consolidated text on lex.bg, which republishes the State Gazette text; NRA pages for NRA guidance).
- **[READING]** my interpretation. Not a fact. The lawyer decides.
- **[NOT FOUND]** the primary source is silent or unreachable.

Pages were read through a fetch tool that summarises them. The lawyer should open the cited URL for anything load-bearing.

---

# Part 1. myPOS online payments (Bulgaria)

## Summary

1. The Checkout API (v1.4) has pre-authorisation with completion and cancellation (`IPCPreAuthorization`, `IPCPreAuthCompletion`, `IPCPreAuthCancellation`, `IPCPreAuthStatus`). It is off by default and myPOS must switch it on. The hold is "typically up to 30 days", set by business type.
2. Server-to-server notification (`URL_Notify`), refunds (`IPCRefund`) and reversals (`IPCReversal`) exist. Partial refund is not documented.
3. Apple Pay is advertised for the hosted checkout on myPOS's marketing page, with no developer work. Google Pay on hosted checkout is not confirmed by any primary page. Both work only in production.
4. No split payment or application-fee parameter is documented in the Checkout API. The partner portal advertises "automatic commission splits", with no mechanism published.
5. Each merchant is a myPOS account holder with its own verified Checkout store; the partner model is "merchant approves the partner integration". Published online card fee: 1.30% + 0.10 EUR (EEA consumer cards).

## Findings

### Where the documentation lives and what was reachable

- **[DOC]** The developer portal is `https://developers.mypos.com`. It lists Online Payments (PHP SDK, Embedded SDK, Checkout API, TypeScript SDK), APIs (Checkout, REST) and a Partners Portal at `https://partners.mypos.com`. No sign-in was needed for any page cited here. Nothing was entered anywhere. Source: https://developers.mypos.com
- **[NOT FOUND]** `help.mypos.com` (help centre) returned HTTP 403 to the fetch tool, so its articles on website requirements, merchant verification and pre-authorisation could not be read. They appear below only as search-result snippets and are marked so.
- **[NOT FOUND]** `https://developers.mypos.com/en/doc/online_payments` and the "433 apple pay & google pay" page returned 404 at fetch time.

### (a) Pre-authorisation (hold), capture, cancel, maximum duration

- **[DOC]** The Checkout API reference lists `PreAuthorization` ("Reserves funds via myPOS Checkout (customer interaction required)"), `In-App PreAuthorization`, `PreAuth Completion` ("Captures funds from a pre-authorization"), `PreAuth Cancellation`, `PreAuth Status`. Source: https://developers.mypos.com/en/doc/online_payments/v1_4/20-api-reference
- **[DOC]** Wire names (version `1.4`): `IPCPreAuthorization`, `IPCPreAuthCompletion`, `IPCPreAuthCancellation`. Completion takes Amount, Currency, OrderID, SID, WalletNumber, KeyIndex. Cancellation takes OrderID, SID, WalletNumber, KeyIndex. Sources: https://developers.mypos.com/apis/checkout-api/pre-authorization , https://developers.mypos.com/apis/checkout-api/pre-auth-completion , https://developers.mypos.com/apis/checkout-api/pre-auth-cancellation
- **[DOC]** Pre-authorisation "is not enabled by default": myPOS support must activate it for the account. Pre-auths made via the PHP SDK or Checkout API "must be completed or cancelled through the same API"; do not mix them with terminal pre-auths. Source: https://developers.mypos.com/guides/troubleshooting-guides/online-payments-troubleshooting
- **[DOC]** The maximum time between authorisation and capture depends on business type and is "typically up to 30 days". Same troubleshooting page. It also says to retry failed completions and to release held funds with a cancel call if a pre-auth cannot be completed (it names the terminal-style `COMPLETE_PREAUTH` / `CANCEL_PREAUTH` there; looks like mixed naming, treat as a doc inconsistency).
- **[DOC]** The method pages for PreAuthorization, Completion and Cancellation state no time limit and say nothing on partial completion (same URLs as above).
- **[DOC]** A second hold family exists for stored cards: `Authorization`, `Authorization Capture`, `Authorization Reverse`, `Authorization List`. "The amount is reserved and can be captured instantly or after a period of time"; the maximum period "is limited based on the type of business". Source: https://developers.mypos.com/apis/checkout-api/authorization
- **[NOT FOUND]** A fixed number of days for the Authorization family, and whether capture can be for less than the held amount.
- **[READING]** The hosted pre-auth page needs the guest to be redirected to enter card details, so a hold starts with the guest present. Capture is a server call.
- **[VENDOR PAGE, unverified snippet]** A search snippet of the help-centre article "Pre authorization on credit cards" says holds can last up to 30 days (aimed at hotels and car rental). Not opened (403). https://help.mypos.com/hc/en-gb/articles/6882373876253-Pre-authorization-on-credit-cards

### (b) Apple Pay and Google Pay in hosted checkout

- **[VENDOR PAGE]** The myPOS Apple Pay page lists Apple Pay as "Available for myPOS Hosted Web Checkout", with Visa, Mastercard, Maestro, American Express, and says no additional developer resources are required. Source: https://www.mypos.com/en-cy/apple-pay-online
- **[DOC]** The `IPCPurchase` page lists `PaymentMethod` values CARD, iDEAL, Satispay, TWINT, IRIS and "all methods". It does not mention Apple Pay or Google Pay for the hosted page. Source: https://developers.mypos.com/apis/checkout-api/purchase
- **[NOT FOUND]** A primary myPOS page that says Google Pay is available on the hosted checkout page. The Google Pay product page (`mypos.com/en-cy/google-pay-online`) returned 404. The Bulgarian Checkout page mentions neither wallet: https://www.mypos.com/bg-bg/online-plashtaniya/checkout
- **[DOC]** Separate product: the Embedded SDK puts Apple Pay and Google Pay buttons on the merchant's own page (payment session via `PaymentSessionCreate`; Apple Pay needs a domain association file under `/.well-known/` and a store setting). Checkout API methods `IPCApplePayProcess` and `IPCGooglePayProcess` exist for merchant-integrated flows. Sources: https://developers.mypos.com/sdks/embedded-sdk/apple-and-google-pay , https://developers.mypos.com/apis/checkout-api/apple-pay-process , https://developers.mypos.com/apis/checkout-api/google-pay-process
- **[DOC]** In the WooCommerce plugin both wallets are "included by default" and "cannot be tested in the sandbox" (production only). Source: troubleshooting page above.

### (c) Webhooks and callbacks

- **[DOC]** `URL_Notify` receives a server-to-server POST after the payment (`IPCPurchaseNotify`), with `IPC_Trnref`, `OrderID`, `Amount`, `Currency`, `PaymentMethod`, `CardBrand`, `CardToken` (if stored) and a SHA-256 `Signature`. The handler must answer HTTP 200 with the plain body `OK`. Source: https://developers.mypos.com/apis/checkout-api/purchase-notify
- **[DOC]** Authorise the order only on the server-to-server notification, not on `URL_OK`, which "is not always guaranteed to arrive". Same page.
- **[DOC]** If the notify callback fails, myPOS reverses the payment (`IPCPurchaseRollback`; "the customer's card is not charged"). Source: troubleshooting page. A `PreAuthorization Notify` callback also exists (API reference above).
- **[NOT FOUND]** A published retry schedule for failed notifications.
- **[DOC]** `IPCGetPaymentStatus` lets the server poll a payment. Source: https://developers.mypos.com/sdks/embedded-sdk/apple-and-google-pay

### (d) Refunds and reversals via API

- **[DOC]** `IPCRefund` "initiate[s] a refund of a previously executed payment" by `IPC_Trnref`, with Amount and Currency. Source: https://developers.mypos.com/apis/checkout-api/refund
- **[DOC]** `IPCReversal` exists. If it fails ("Operation Already Processed", insufficient funds) the guide says to use `IPCRefund`. Reversal refunds "may take 1-3 business days" to show on the statement. Source: troubleshooting page.
- **[NOT FOUND]** Whether `IPCRefund` accepts a partial amount, and any refund time window.

### (e) Platform / marketplace split or application fee

- **[DOC]** The `IPCPurchase` and `IPCPaymentSessionCreate` parameter tables contain no split, commission, fee or sub-merchant parameter. The only settlement parameter is `AccountSettlement`. Extra fees go into the cart as additional items. Sources: https://developers.mypos.com/apis/checkout-api/purchase , https://developers.mypos.com/apis/checkout-api/payment-session-create
- **[VENDOR PAGE]** The Partner Portal advertises "Multi-merchant platforms" with "Automatic commission splits & merchant payouts" and "seamless commission payouts", with no mechanism, rates or timing. Source: https://partners.mypos.com
- **[DOC]** The eCommerce API page lists marketplaces ("Multi-party and multi-merchant payment flows") as a use case. Its methods are Button, Link, Payment Request, Common; no split method is described. Source: https://developers.mypos.com/apis/ecommerce
- **[DOC]** Partners can add `PartnerID` and `ApplicationID` to requests (analytics only; needs API version 1.4.1). Source: the pre-authorization page above.
- **[NOT FOUND]** Any documented way to pay the venue and take a fee for a third party in one transaction.
- **[READING]** Without a documented split, Restro's fee would have to be invoiced to the venue separately. Ask myPOS what the partner programme really offers.

### (f) Merchant onboarding for a Bulgarian venue

- **[DOC]** "To process live payments, you need a verified myPOS account." The Checkout store must also be verified, usually up to 5 business days; until then payments are capped at 3,000 EUR and "Funds are held in reserve". Any change to the Checkout triggers re-verification. Source: https://developers.mypos.com/online-payments/initial-setup-and-testing/going-live
- **[DOC]** Not supported for Checkouts: cryptocurrency, pharma and nutra, gambling, adult content, tobacco, streaming, hosting. Same page. Alcohol is not listed.
- **[DOC]** A store is created under Stores > eCommerce with a name, website URL and currency, plus a key pair; the Request URL must be a plain domain with no path. Source: https://developers.mypos.com/online-payments/initial-setup-and-testing/create-checkout-store
- **[DOC]** Partner model: "Partners must first create an Integration in the myPOS Partner Portal"; "After a merchant approves your integration, you'll receive merchant-specific credentials". Each merchant authorises the integration itself. Source: https://developers.mypos.com/apis/identity
- **[VENDOR PAGE]** The partner account is free, approval is "instant with no paperwork", no monthly fee. Source: https://partners.mypos.com
- **[READING]** The merchant is the venue's legal entity, with its own myPOS account, verified Checkout store and keys. A myPOS account per venue looks required. No page says "one account per merchant" in words.
- **[NOT FOUND]** The documents myPOS requires from a Bulgarian company. A search snippet of the help centre (403, not opened) mentions a visible merchant name and address, contact details, delivery/refund/cancellation/privacy policies, and company documents with owners above 25%: https://help.mypos.com/hc/en-bg/articles/6882958205213-What-are-the-general-requirements-for-websites-which-would-like-to-integrate-the-myPOS-online-payment-solutions

### (g) Published fees

- **[VENDOR PAGE]** myPOS Checkout (Bulgarian site): 0 EUR per month, no set-up fee. Local and EEA consumer cards 1.30% + 0.10 EUR; American Express 2.50% + 0.10 EUR; all other consumer and business cards 2.90% + 0.10 EUR; MO/TO online fee + 0.5%. Source: https://www.mypos.com/bg-bg/online-plashtaniya/checkout
- **[NOT FOUND]** Separate fees for Apple Pay / Google Pay, pre-authorisation, refunds and chargebacks, and any volume tier. A search snippet of the myPOS home page mentions 1.45% above a volume threshold, with thresholds that differ between pages; not verified.

## Open points for the lawyer or for myPOS

1. Does a hold of up to 30 days fit bar tabs and table deposits? What is the exact limit for a nightclub's business type, and can capture be less than the hold?
2. Is Google Pay available on the hosted page? Is Apple Pay on hosted checkout in the standard rate?
3. Is there a real split / platform-fee mechanism (the Partner Portal says yes)? Under which contract? Would Restro then be a payment intermediary needing a licence?
4. Can an amount be added at capture (a tip after the order)?
5. Can the venue's myPOS account receive funds in a way that meets the fiscal alternative regime (Part 2, чл. 52п)?
6. Retry policy of `URL_Notify`; partial refund; refund time window.

## Sources

- https://developers.mypos.com
- https://developers.mypos.com/en/doc/online_payments/v1_4/20-api-reference
- https://developers.mypos.com/apis/checkout-api/ (pre-authorization, pre-auth-completion, pre-auth-cancellation, authorization, purchase, purchase-notify, refund, payment-session-create, apple-pay-process, google-pay-process)
- https://developers.mypos.com/guides/troubleshooting-guides/online-payments-troubleshooting
- https://developers.mypos.com/online-payments/initial-setup-and-testing/going-live and `.../create-checkout-store`
- https://developers.mypos.com/apis/identity , https://developers.mypos.com/apis/ecommerce
- https://developers.mypos.com/sdks/embedded-sdk/apple-and-google-pay
- https://partners.mypos.com
- https://www.mypos.com/en-cy/apple-pay-online , https://www.mypos.com/bg-bg/online-plashtaniya/checkout
- Not opened (403): https://help.mypos.com/hc/en-gb/articles/6882373876253-Pre-authorization-on-credit-cards

---

# Part 2. Bulgarian fiscal receipt for online card payments

Law text: Наредба № Н-18 of 13.12.2006 (consolidated text on lex.bg; latest amendment visible in it: ДВ бр. 42/2025) and the Закон за данък върху добавената стойност, ЗДДС (consolidated on lex.bg; amendments visible up to ДВ бр. 69/2026). Both were read on 2026-10-17. Check the State Gazette for anything later.

## Summary

1. The default is a fiscal receipt (ЗДДС чл. 118, ал. 1; Н-18 чл. 3, ал. 1) for every sale in a trade site. The listed exemptions cover transfers, direct debit and cash deposits through a payment provider. A card payment is not among them.
2. The "alternative regime" (Н-18 чл. 3, ал. 17 and чл. 52м-52у) lets an e-shop issue its own electronic sales document instead of a fiscal receipt, but only for "неприсъствено плащане" by card through a virtual POS.
3. Decisive for Restro: the ЗДДС definition (§ 1, т. 96) requires that goods or services are delivered "на място, различно от търговския обект на търговеца". [READING] An in-venue QR order served at the venue may fall outside the alternative regime, so a fiscal receipt would be required. This needs the lawyer and probably a written NRA opinion.
4. The alternative regime needs: the e-shop registered with the NRA (qualified e-signature), funds paid into the seller's own payment account, a monthly audit file, a QR code on the document.
5. Deposits and paid song requests: no special rule found in the ordinance. ЗДДС чл. 25, ал. 7 makes VAT due when an advance payment is received. [READING] Treat both as a sale of a service by the venue.

## Findings

### (a) When no fiscal-device receipt is needed, and what replaces it

- **[LAW]** General rule: every person registers and reports sales "във или от търговски обект" by a fiscal receipt from a fiscal device or a system receipt, "освен когато плащането се извършва чрез внасяне на пари в наличност по платежна сметка, кредитен превод, директен дебит или наличен паричен превод, извършен чрез доставчик на платежна услуга" (or a postal money transfer). Н-18 чл. 3, ал. 1. Source: https://lex.bg/bg/laws/ldoc/2135540645
- **[LAW]** The ЗДДС rule behind it: all persons register sales in a trade site by fiscal or system receipt, whether or not another tax document was requested. ЗДДС чл. 118, ал. 1. Source: https://lex.bg/bg/laws/ldoc/2135533201
- **[READING]** The чл. 3, ал. 1 exception lists cash deposit, credit transfer, direct debit and cash transfer. A card payment is not listed, so it is not exempt under that clause. The relief for card payments comes only from the alternative regime.
- **[LAW]** ЗДДС чл. 118, ал. 3б allows, for "неприсъствено плащане с кредитна или дебитна карта", an electronic sales document "вместо фискален или системен бон", not issued from a fiscal device. Conditions are left to the ordinance. Source: lex.bg ЗДДС above.
- **[LAW]** Н-18 чл. 3, ал. 17: a person selling through an e-shop "може да регистрира и отчита тези продажби вместо с фискален или системен бон чрез документ за регистриране на продажбата ... когато е извършено неприсъствено плащане с кредитна или дебитна карта", if (1) the sales software meets чл. 52с and (2) the seller accepts remote card payments.
- **[LAW]** The replacement document (чл. 52о, ал. 1) must be readable and contain at least: name, 10-digit ascending unique number and date; seller data; unique order number; reference number of the financial transaction; items with tax group, quantity, unit price, total and payment method; a QR code per Annex 18a. It must be sent to the customer electronically when the card payment is authorised by the virtual POS (ал. 5). If an invoice with the same data is issued, the separate document may be skipped (ал. 2, 3).
- **[LAW]** Narrower exceptions: чл. 3, ал. 1а (document instead of receipt for recurring subscription/utility card payments on pre-given consent, and for card deposits to the seller's own payment account at a provider's premises).
- **[LAW]** Also available: a fiscal or system receipt generated electronically and sent to the customer. Н-18 чл. 3, ал. 18 and 19 (ал. 19 covers e-shops and persons using a system receipt), чл. 25, ал. 13: the customer's electronic address is stored and the delivery time recorded; paper on request. ЗДДС чл. 118, ал. 21-22.

### (b) Does it depend on payment method or on being a registered e-shop?

- **[LAW]** Both. "Неприсъствено плащане" is a payment initiated over the internet and made through software identification of the card "от виртуално терминално устройство ПОС (Virtual POS Terminal) без физическо прочитане на картата и без едновременното физическо присъствие на продавача и купувача по продажби, при които предоставянето на стоките или услугите става на място, различно от търговския обект на търговеца." ЗДДС ДР § 1, т. 96. Source: lex.bg ЗДДС above.
- **[LAW]** "Електронен магазин" is software reached through a browser or mobile app, through which goods/services are sold by a distance contract (ЗЗП чл. 45), with a basket or other selection, contact data, delivery address and payment method. ЗДДС ДР § 1, т. 87. The NRA repeats it: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page.turgovia-v-internet-i-e-magazini
- **[READING]** A guest who scans a QR code at the table, orders for service at that table and pays by card in the app is at the trade site. The last clause of т. 96 ("different place") is arguably not met. A guest paying online for something used elsewhere or later (a table deposit paid from home) fits the definition better. No text I found decides this.
- **[NOT FOUND]** Any NRA text or opinion saying whether QR table ordering in a venue is an e-shop payment, or whether it falls inside the "different place" wording. The NRA alternative-regime page does not mention delivery place or give examples.
- **[LAW, via NRA]** On payment type, the NRA page speaks only of "неприсъствено плащане с кредитна или дебитна карта" through a virtual POS and does not mention Apple Pay or Google Pay. Source: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page.turgovia-v-internet-i-e-magazini/page.lternativen-rejim-za-registrirane-i-otchitane-na-prodajbite
- **[NOT FOUND]** An NRA statement on whether Apple Pay / Google Pay count. [READING] The definition says "кредитна или дебитна карта или друг картово базиран платежен инструмент" and wallets are card-based, so they probably count. Ask.

### (c) Obligations of the seller and of a software provider

Seller (the venue), alternative regime:

- **[LAW]** Register each e-shop with the NRA before starting, with a qualified e-signature in the NRA e-services portal (Annex 33), separately for each e-shop, "независимо дали използва собствен домейн, нает домейн или домейн на друго лице, предоставящо платформа"; report changes within 7 days. Н-18 чл. 52м, чл. 52т, ал. 1. The NRA keeps a public list (чл. 52м, ал. 5). NRA summary: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page-Iziskvania-kum-e-turgovciete/iziskvania-kum-e-turgovciete/
- **[LAW]** Also report (Annex 33): payment methods offered, payment providers with a virtual POS contract, the payment accounts receiving the funds, the virtual POS number. Н-18 чл. 52р, ал. 1.
- **[LAW]** Accept card payments only into payment accounts held by the seller (as titular) at a bank or provider in the EU or a tax-information-exchange jurisdiction, linked to the virtual POS given by that provider. Funds may pass through the provider's own account if they are then transferred to the seller's account. Н-18 чл. 52п.
- **[READING]** Under чл. 52п, a platform collecting for venues into Restro's own account would not meet the condition. Funds must reach each venue's own account. This fits Part 1: a myPOS account per venue.
- **[LAW]** Monthly: a standardised audit file (Annex 38) by the 15th of the next month, for orders delivered in the month. Н-18 чл. 52т, ал. 2.
- **[LAW]** If the seller stops meeting any requirement of чл. 52о-52т, it loses the right to the alternative document and the NRA may strike the e-shop from the list. Н-18 чл. 52у.
- **[LAW, via NRA]** Registration is mandatory for sellers who accept payments that require a fiscal receipt; sellers who do not accept such payments need not report. NRA page above.

Software (SUPTO status and Restro):

- **[LAW]** E-shop software in the alternative regime must give each order a unique number and meet items 2, 3 and 7 of Annex 29 (чл. 52с, ал. 1). Item 3 of Annex 29 is repealed (ДВ бр. 17/2021), so in practice item 2 (data completeness and integrity) and item 7 (unambiguous user authentication). A Bulgarian translation of the interface on request; tax authorities get full access to the admin panel (чл. 52с, ал. 2, 3).
- **[LAW]** The ЗДДС defines "софтуер за управление на продажби в търговски обект" as software used to process sales in a trade site for which a fiscal receipt is due (§ 1, т. 84); producer and distributor are persons established in the EU (т. 85, 86). Source: lex.bg ЗДДС above.
- **[LAW]** Listing such software with the NRA is voluntary: the producer "може да декларира" (ЗДДС чл. 118, ал. 14) and the venue "може да избере" listed software (ал. 18). A venue that chooses listed software must use only that software in the site, and it must run all fiscal devices there (Н-18 чл. 52з, ал. 3). Annex 29 sets the full requirement list, including the link to the fiscal device.
- **[LAW]** E-shop orders may be imported into the venue's sales software (Н-18 чл. 52з, ал. 11).
- **[READING]** Restro is not forced onto the NRA list by law. It matters in two cases: (1) the venue takes the fiscal-receipt route, so Restro orders must reach the venue's fiscal system (the Lukanet / barsy question, Q8, Q24); (2) a venue wants the alternative regime, so Restro's ordering software must be e-shop software meeting чл. 52с.
- **[NOT FOUND]** An explicit obligation on a software vendor that does not produce listed sales software.

### (d) Deposits, prepayments, paid song requests

- **[LAW]** Н-18 has no special rule for deposits or advance payments. The full text was searched for "аванс", "депозит", "капаро", "предварително плащане"; only reservation forms appear, in the invoice/tourism context (чл. 26, ал. 7). Source: lex.bg Н-18 above.
- **[LAW]** ЗДДС чл. 25, ал. 7: where a full or partial advance payment is made before the tax event, "данъкът става изискуем при получаване на плащането (за размера на плащането)". This is the VAT time-of-tax rule; it does not itself say a fiscal receipt is due at deposit time.
- **[LAW]** ЗДДС чл. 25, ал. 3, т. 4: for goods sold by post or electronically, the tax event is the date the supplier receives the payment. It concerns goods, and a deposit is a service. Source: lex.bg ЗДДС above.
- **[NOT FOUND]** An NRA opinion on a deposit for a table or bottle service credited against the final bill. The NRA opinions database was not searched exhaustively.
- **[READING]** A paid song request is a service sold by the venue, paid by card online at the venue. It follows the same analysis as table ordering. Whether a fiscal receipt is due at receipt of a deposit or when the service is rendered is open.
- **[READING]** A card hold that is later captured is a sale only on capture; a cancelled hold is not a sale. Ask whether the receipt follows the capture.

## Open points for the lawyer (Q62-Q64) or for Lukanet

1. In-venue QR order, guest at the table, card paid in the app: is it "неприсъствено плащане" (§ 1, т. 96 ЗДДС) or not? If not, the venue's fiscal device must issue a receipt for every such payment. Get a written NRA opinion if the lawyer is unsure.
2. If a fiscal receipt is due: can barsy (or Mistral) register an order paid online and issue the fiscal receipt, and which software must drive the fiscal device (Q8, Q24 for Lukanet)?
3. Q64: is an electronic fiscal receipt enough? The text says paper on request (ЗДДС чл. 118, ал. 22).
4. Q63: does Restro count as sales software under Н-18? Listing is voluntary; check whether the venue's chosen route makes Restro a module of the venue's system.
5. Alternative regime for deposits and song requests paid from outside the venue: registration, funds into the venue's own account (чл. 52п), monthly file. Worth it for a venue?
6. Apple Pay and Google Pay: confirm they count as card payments through a virtual POS.
7. Timing of the receipt for a deposit credited later, and for hold then capture.
8. Confirm that the myPOS entity and account the venue uses meet the чл. 52п account conditions.

## Sources

- Н-18 (consolidated, lex.bg): https://lex.bg/bg/laws/ldoc/2135540645
- ЗДДС (consolidated, lex.bg): https://lex.bg/bg/laws/ldoc/2135533201
- NRA, Търговия в интернет и е-магазини: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page.turgovia-v-internet-i-e-magazini
- NRA, Алтернативен режим: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page.turgovia-v-internet-i-e-magazini/page.lternativen-rejim-za-registrirane-i-otchitane-na-prodajbite
- NRA, Изисквания към е-търговците: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page-Iziskvania-kum-e-turgovciete/iziskvania-kum-e-turgovciete/
- NRA, Н-18 PDF (binary, not readable by the fetch tool): https://nra.bg/wps/wcm/connect/nra.bg25863/6e2bcfb7-8035-445d-901f-e7f49a3d772e/Naredba+%E2%84%96+N-18++2006.pdf
