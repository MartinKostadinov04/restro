# Can several cards pay one bill, and can a guest pay a share?

Research for wayfinder ticket #43 (map #29, "Ordering from the menu"). Written 2026-10-18 on branch `research/split-payments`; this branch is never merged. Planning research only: no code. Not legal advice.

**Tags on every fact**
- **[LAW]** the published text of a law or regulation (lex.bg consolidated texts, EUR-Lex, the Council's PSR text).
- **[SCHEME]** a card scheme's own rule book (Visa Core Rules, edition 18 April 2026).
- **[DOC]** a provider's or POS vendor's official documentation.
- **[VENDOR PAGE]** official but marketing or help-centre text.
- **[SECONDARY]** a third-party copy or summary; used only where the primary text could not be read.
- **[READING]** my interpretation. Not a fact.
- **[NOT FOUND]** searched, the primary source is silent or could not be read. Not assumed to exist.

Several pages could only be read as search-engine extracts (help.mypos.com, developer.revolut.com, developer.viva.com). Those facts say "(extract)". The Mastercard rule books returned 403 everywhere, so every Mastercard fact here is [SECONDARY].

**Words** (GLOSSARY.md): **bill** = what the guests at a table see, one running total over all the POS bills behind it (Martin, #35); **POS bill** = one bill in the POS (barsy's *сметка*); **payment provider**, **payment account**, **hold**, **capture**, **release**, **refund** as in the glossary. Two working words this file proposes, not yet in the glossary: **group payment** (several guests' cards together pay one fixed amount, all or nothing) and **share** (one guest's part of a group payment, on one card).

---

## Summary for Martin

**1. Can several cards pay one amount together?** Yes. The law and Visa's rules allow it in so many words, and the providers venues here can use have the building block: a hold on each guest's card, captured together. No provider offers "several payers for one amount" as a ready feature, so Restro would run it: one hold per guest, capture them all once they add up to the amount, release them all if they don't in time.

**2. Can a guest pay a share instead of named items?** That question hides two cases with different answers.
- **Shares that settle the bill now** ("we split the 300 € bottle four ways and pay"): yes, it is the same group payment. All cards are taken at the same moment and the POS bill closes once.
- **An amount on a bill that stays open** ("I pay 50 € now and leave, the others carry on"): not yet. Bulgarian fiscal law has a special form for this (Н-18 чл. 26а, a "ЧАСТИЧНИ ПЛАЩАНИЯ" department on the fiscal device), and no POS we know documents it. barsy has two possible routes; Lukanet must say whether they print a correct fiscal receipt.

**3. Fiscal receipts.** The POS prints them, never Restro. If every card is taken at the moment the POS bill closes, one fiscal receipt listing several card payments looks allowed. If guests pay at different moments, each payment needs its own receipt at that moment. Both are readings for the lawyer.

**4. Two rules that change the earlier plan.**
- A hold must be **released actively** (an API call) as soon as the group payment fails. Letting it run out breaks Visa's 24-hour rule, and myPOS charges the venue for holds it has to cancel itself.
- D30's 3 minutes is probably too short for four people each confirming with their bank (3-D Secure) in a loud club. Because holds cost nothing while they wait, a longer window (about 10 minutes, a venue setting) is safe. D30 also caps the window at barsy's payment-link lifetime, which a group payment through Restro's provider does not use. Both are Martin's call.

**5. Recommendation.** Design group payment into this feature set as the one mechanism for "pay together" and "split evenly". Build it only when (a) the venue's payment provider has holds switched on and (b) Lukanet confirms that the API can close a POS bill with several card payments. Leave "pay an amount on an open bill" out until Lukanet and the lawyer answer. The cheapest demand test costs no code: count how often the pilot venue's POS bills are already closed with two or more cards.

---

## 1. Findings: Bulgarian fiscal law

Texts: Наредба № Н-18 (consolidated on lex.bg, last amendment ДВ бр. 42/23.05.2025) https://lex.bg/bg/laws/ldoc/2135540645 ; ЗДДС (consolidated, last amendment ДВ бр. 115/30.12.2025) https://lex.bg/bg/laws/ldoc/2135533201 ; ДВ бр. 42/2025 https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=235038 . Earlier research on why the e-shop regime does not apply inside the venue and the venue's fiscal device must print: `docs/deliverables/2026-10-17-pos-integration-requirements.md` (branch `ad/research-fiscal-rules`).

**When the receipt is due**
- **[LAW]** A fiscal receipt is due for every payment, with exemptions that do not include card payments (Н-18 чл. 25, ал. 1, т. 1; чл. 3, ал. 1).
- **[LAW]** It is issued "при извършване на плащането" and handed over at the same time the payment is received (Н-18 чл. 25, ал. 6).
- **[NOT FOUND]** Н-18 does not define "плащане" and says nothing about a card hold in a venue. The only text tying the receipt to a card authorisation is the e-shop rule (чл. 52о, ал. 5), which does not apply here.
- **[READING]** For a hold followed by a capture, the safe reading is: the payment happens at capture, so the receipt prints at capture. A released hold is no sale.

**Several payments on one sale**
- **[LAW]** Every receipt shows "обща сума за плащане и начин/и на плащане", total and payment method(s); the plural was added in 2019 (Н-18 чл. 26, ал. 1, т. 8).
- **[LAW]** Annex 29 т. 10 (binds only venues on NRA-listed sales software, СУПТО): "Когато плащанията по продажбата са повече от едно", the unique sale number (УНП) goes on the receipt issued for each payment, storno receipts included.
- **[LAW]** Annex 29 т. 18.2: listed software stores one row per payment (УНП, date, operator, amount, payment type, the fiscal device that printed it).
- **[LAW]** The NRA's own page calls one sale closed with several payment sources "смесено плащане" (mixed payment), in a pharmacy context. https://nra.bg/wps/wcm/connect/agency/site/fiskalni-ustroystva-supto-i-e-magazini/dokumenti-za-prodajba.storno.operacii/dokuenti.prodajba
- **[LAW]** Since 2025 a storno system receipt may carry more than one payment method (Н-18 чл. 31, ал. 2б).
- **[SECONDARY]** The NRA's 2019 answers on listed software, as copied by a software vendor: no limit on the number or type of payments on one sale; all relate to the УНП made at first entry. https://kamisl.com/vaprosi-i-otgovori-kasaeshti-supto-nap/
- **[LAW]** Card payments are one payment type in the device's data to the NRA ("Сума по кредитни/дебитни карти", Annex 17). There is no per-card type.
- **[NOT FOUND]** Any text that allows or forbids two payments of the same type (card + card) on one receipt, and any fiscal-device protocol document (Datecs, Daisy, Tremol) on this.
- **[READING]** All cards captured at the moment the POS bill closes: one receipt with several card payments fits the law. Cards captured at different moments: one receipt per payment, each at its own moment, with the same УНП under listed software.

**Partial payments (чл. 26а)**
- **[LAW]** For sales "за които лице ... приема частични плащания", it "се допуска" (is allowed) to book each partial amount in a department named "ЧАСТИЧНИ ПЛАЩАНИЯ", with the goods written as free text between "#" marks. At the final payment all goods are registered, then a value discount equal to the partial amounts (Н-18 чл. 26а, ал. 1–2, in force since 31.07.2020, unchanged in 2025).
- **[LAW]** Separately, every receipt must list goods, tax group, quantity and value (чл. 26, ал. 1, т. 7).
- **[READING]** чл. 26а is optional, not the only way. A guest paying named items gets a receipt listing those items, which already meets т. 7, so чл. 26а is not needed. An arbitrary amount (1/4 of the total, 50 €) matches no items; that is the case чл. 26а is written for.
- **[NOT FOUND]** Any NRA opinion applying чл. 26а to splitting a restaurant bill, or defining "частично плащане".
- **[LAW]** Deferred payment ("резерв 2 – отложено плащане") is open only to an ИАСУТД or an invoice receipt (чл. 25, ал. 5; чл. 26б), not to an ordinary venue.

**The venue's risk**
- **[LAW]** No receipt for a payment: 1,000–4,000 лв for a company (ЗДДС чл. 185, ал. 1); 6,000–20,000 лв when revenue goes unreported (ал. 2); 200–1,000 лв for the employee who took the money (ал. 3); sealing of the venue up to 30 days (чл. 186), waived for a first offence by a venue on listed software only (чл. 186а). lex.bg still prints лв; the euro amounts were not checked.
- **[LAW]** A guest given no receipt may withhold payment (ЗДДС чл. 118, ал. 1а).
- **[LAW]** Storno for operator error, including the payment method, is allowed even with too little cash in the drawer, and must be done by the 7th of the following month (Н-18 чл. 31, ал. 3–4).
- **[NOT FOUND]** Anything on a receipt printed and the card capture then failing.
- **[READING]** The heavy risk is money taken without a receipt at that moment. A receipt without money is fixable by the venue with an operator-error storno.

## 2. Findings: EU payment law and card-scheme rules

Texts: PSD2 https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32015L2366 ; SCA rules (Delegated Regulation 2018/389) https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32018R0389 ; PSR final compromise text, Council doc 8221/26 of 17.04.2026 https://data.consilium.europa.eu/doc/document/ST-8221-2026-INIT/en/pdf ; Visa Core Rules and Visa Product and Service Rules, 18 April 2026 https://usa.visa.com/content/dam/VCOM/download/about-visa/visa-rules-public.pdf

**Holds under EU law**
- **[LAW]** A payer's bank may block funds for a card payment of unknown amount only if the payer agreed to the exact amount blocked, and must release it without undue delay once it knows the exact amount (PSD2 Art. 75).
- **[LAW]** The coming Payment Services Regulation (compromise text Art. 61) adds: the blocked amount must be in proportion to what the payer can reasonably expect to pay; the payee (the venue) must tell its provider the exact amount immediately after delivery; the bank releases the rest immediately. It applies 21 months after entry into force. **[NOT FOUND]** publication in the Official Journal as of 2026-10-18.
- **[LAW]** A payer may claim a refund when the amount was not specified and the charge exceeded what they could reasonably expect (PSD2 Art. 76; PSR Art. 62).
- **[READING]** Each guest is a separate payer and agrees to their own share. Holding the whole bill on one guest's card "in case the others don't pay" conflicts with proportionality once the PSR applies, and creates "paid by other means" disputes.

**Strong customer authentication (3-D Secure)**
- **[LAW]** A remote card payment needs SCA linked to the amount and the payee; for a hold, the code is tied to the amount the payer agreed to block (RTS Art. 5(1), 5(3)(a)).
- **[LAW]** EBA Q&A 2020_5133: capturing the same or a lower amount needs no new SCA; a higher amount needs SCA on the final amount or is declined. https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2020_5133
- **[READING]** Each guest confirms their own share (tip included) with their bank. Restro can never raise a share after the guest confirmed it.

**Visa (primary text)**
- **[SCHEME]** "A Merchant must not split a Transaction by using 2 or more Transaction Receipts", except, among others, a transaction where part is paid with one Visa card "and the other part paid with another Visa Card or other form of payment" (§5.7.3.1). Several cards for one bill is expressly allowed; several charges on the same card for one purchase is not.
- **[SCHEME]** One authorisation with several captures is allowed only for airlines, cruises, split shipments and a few others, not bars (§5.7.3.2).
- **[SCHEME]** In the EEA the cleared amount must always equal the authorised amount; the 20 % tip tolerance for bars (MCC 5813) and restaurants applies only outside the EEA (§7.5.6, Table 7-10).
- **[SCHEME]** An estimated authorisation may not include tips (§5.7.2.4). Authorise the final amount when it is known (§5.7.2.3).
- **[SCHEME]** Approval validity: 10 days for a cardholder-initiated card-absent payment (a QR-to-phone payment), 5 days card-present (§5.7.3.5).
- **[SCHEME]** An unused hold must be reversed within 24 hours of cancellation or of the cardholder paying by other means, and the unused part of a hold within 24 hours of completion (§5.7.3.6, Table 5-14).
- **[SCHEME]** Disputes that fit split-bill failures: 12.6 "Duplicate Processing / Paid by Other Means", 12.5 "Incorrect Amount", 11.3 "No Authorization / Late Presentment" (§11.8.3, §11.9.4, §11.9.5).
- **[READING]** The clean pattern: each guest's hold is for their exact share including tip, captured once for that same amount, reversed at once if the group payment fails. Then no tolerance, no increment and no second capture is ever needed.

**Mastercard (secondary only)**
- **[SECONDARY]** Final authorisation must be presented within 7 days for the exact amount; pre-authorisation is valid 30 days; "processing integrity" fees for holds not captured or reversed in time; dispute code 4834 covers duplicates and "paid by other means". Sources: search extracts of Mastercard's Transaction Processing Rules (https://www.mastercard.us/content/dam/public/mastercardcom/na/global-site/documents/transaction-processing-rules.pdf , 403 to fetch) and Worldline's acquiring docs https://docs.acquiring.worldline-solutions.com/Features/Card-based/Authorizations/authorization-validity
- **[NOT FOUND]** Mastercard's own text on several cards for one purchase, and the fee amounts in Europe.

**Who carries the loss**
- **[READING]** Chargebacks land on the acquirer, which passes them to its merchant. Under D98 the merchant is the venue, so the venue carries disputes per card. Evidence that helps the venue: what each guest agreed to (share, items, tip), the 3-D Secure result, hold and capture times, and the fiscal receipt reference. D32 (finest grain) already keeps this.

## 3. Findings: payment providers

No provider checked has a native online "several payers for one amount" feature: not myPOS, Stripe, Borica, Revolut, Viva, SumUp or ePay.bg. Only Square (`PayOrder` with several payments) and Adyen (Orders API "partial payments") have a multi-tender object, and neither is a realistic choice for a small Bulgarian venue (Square: availability in the EEA not checked; Adyen: "minimum invoice depending on industry", https://www.adyen.com/pricing). Restro therefore runs a group payment as one hold per guest.

| Provider | Hold (their name) | How long | Capture less | Capture more | Captures per hold | Release | Native multi-payer |
|---|---|---|---|---|---|---|---|
| **myPOS** | Pre-authorisation, `IPCPreAuthorization` | up to 30 days; then myPOS cancels it and **charges the venue** (extract) | yes | no | one assumed (more not documented) | `IPCPreAuthCancellation` | no |
| **Stripe** | "Place a hold", `capture_method=manual` | 7 days online (Visa merchant-initiated 4 d 18 h); 30 days on IC+ pricing | yes, rest released | not for EEA Visa/Mastercard | one (multicapture: IC+, not for bars) | cancel the PaymentIntent | no |
| **Borica** (via the venue's bank) | Pre-authorisation, `TRTYPE=12` | completion within 30 days | yes | no | exactly one; a failed completion needs a new hold | `TRTYPE=22`, full amount only | no |
| **Revolut Business** | `capture_mode: manual` (extract) | 7 days by default, up to 30 with pre-authorisation | yes, rest voided | no | one | cancel / expiry | no |
| **Viva.com** | `isPreAuth=true` on a payment order (extract) | not stated | yes | not found | not confirmed | "Cancel transaction" | not found |
| **SumUp** | not found | – | – | – | – | – | no |
| **ePay.bg** | not found in the merchant spec | – | – | – | – | – | no |

**myPOS** (the first provider for Bulgarian venues)
- **[DOC]** Hold, capture, release and status calls exist: `IPCPreAuthorization`, `IPCPreAuthCompletion`, `IPCPreAuthCancellation`, `IPCPreAuthStatus`. https://developers.mypos.com/apis/checkout-api/pre-authorization
- **[DOC]** Pre-authorisation is off by default; myPOS support switches it on. https://developers.mypos.com/guides/troubleshooting-guides/online-payments-troubleshooting . **[VENDOR PAGE] (extract)** The venue emails help@mypos.com and myPOS assesses each request. https://help.mypos.com/hc/en-ch/articles/6882468303517-How-can-I-use-the-pre-authorization-functionality
- **[DOC]** Capture can be partial: the PHP SDK says "Total or partial amount of your Pre-authorization" (https://developers.mypos.com/sdks/php-sdk/sample-code/pre-auth-completion); the Android SDK says the capture "cannot exceed the amount that was originally pre-authorized" and the rest is released (https://developers.mypos.com/in-app-payments/android-payments/pre-authorization-completion).
- **[VENDOR PAGE] (extract)** Completion within 30 days; after that myPOS cancels the hold "and merchants will be charged for this cancellation". https://help.mypos.com/hc/en-bg/articles/6882371009821-What-is-pre-authorization
- **[DOC]** Payment Requests and Payment Links mention "usage limits" and "amount locks", nothing on several payers or a payer-chosen amount. https://developers.mypos.com/apis/ecommerce/payment-request , https://developers.mypos.com/apis/ecommerce/link
- **[VENDOR PAGE]** "Bill splitting" appears only as something integrators build on myPOS terminals. https://partners.mypos.com/solutions/food-beverage
- **[NOT FOUND]** Whether a hold can be completed twice; whether Apple Pay / Google Pay work with a pre-authorisation; whether cancellation can be partial.

**Stripe**
- **[DOC]** Hold durations, partial capture ("automatically releases the remaining amount"), one capture for most payments, cancel to release, automatic expiry to `canceled`. https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- **[DOC]** Extended (30 days), incremental, multicapture and overcapture are IC+ pricing features; blended-pricing accounts must ask. https://docs.stripe.com/payments/extended-authorization , https://docs.stripe.com/payments/multicapture , https://docs.stripe.com/payments/overcapture
- **[DOC]** Overcapture for Visa "Excludes businesses in the European Economic Area"; Mastercard's restaurant overcapture is US-only. https://docs.stripe.com/payments/overcapture
- **[DOC]** Connect direct charges: the charge and the balance sit on the venue's own account; Restro would get only an application fee if one is used (D98 keeps the fee outside the payment for now). https://docs.stripe.com/connect/direct-charges
- **[DOC]** Webhook when a hold is placed: `payment_intent.amount_capturable_updated`. Same hold page.
- **[READING]** None of the IC+ features is needed for a group payment that closes the same night.

**Borica** (spec P-OM-41 v7.0, 17.04.2026, read in full) https://3dsgate-dev.borica.bg/P-OM-41_BORICA_eCommerce_CGI_interface_v%207.0_EN.pdf
- **[DOC]** Completion "should be less or equal to" the pre-authorisation; "only one Completeion [sic] could be processed (successful or not) within 30 days"; a failed completion needs a new pre-authorisation. Release (TRTYPE 22) must be for the full amount.
- **[READING]** Usable, but a failed capture means the guest must come back and confirm again.

**Revolut, Viva, SumUp, ePay.bg**
- **[DOC] (extract)** Revolut: capture once, full or partial, never above the authorised amount; 7-day default hold; Bulgarian businesses can open merchant accounts. https://developer.revolut.com/docs/guides/merchant/operations/capture-and-settlement/capture-later , https://developer.revolut.com/docs/merchant/capture-order
- **[DOC] (extract)** Viva: pre-authorisation with partial capture and cancel; serves Bulgarian venues; an ISV partner programme with a connected account per venue, the best documented platform fit. https://developer.viva.com/smart-checkout/pre-authorization/ , https://developer.viva.com/isv-partner-program/
- **[NOT FOUND]** SumUp: no hold in the part of its docs read (https://developer.sumup.com/llms-small.txt). ePay.bg: no hold in its merchant spec (https://www.epay.bg/v3main/img/front/tech_wire.pdf); the "30-day hold" in earlier research may have been the invoice expiry. This corrects `docs/deliverables/2026-10-17-payment-providers-feasibility.md`.

## 4. Findings: the POS side (barsy)

All from `docs/research/2026-10-18-barsy-api-reference.md` (branch `research/barsy-signed-in`) and `docs/research/2026-10-18-bill-in-barsy.md` (branch `research/bill-in-barsy`). Nothing new was read from barsy for this file.

- **[DOC]** `Accounts_close` closes an open POS bill with payments "cash, card, cheque, voucher, mixed, several currencies" and prints the fiscal receipt on the configured fiscal device. `methods/accounts/close.html`
- **[DOC]** `Accounts_place` accepts payments only when it closes the POS bill. `methods/accounts/place.html`
- **[DOC]** barsy's staff screen has a mixed payment at closing: several methods make up the total. https://docs.lukanet.com/barsy.help/200-faq/200-sales/smeseni-plashtania.html
- **[DOC]** If a mixed payment by two cards fails on the second card, the POS bill is saved with the first payment and **locked**; staff see the remainder. https://docs.lukanet.com/barsy.help/120-posx/pos_terminal_cases.html
- **[DOC]** `Accounts_divide` moves chosen items and quantities from an open POS bill to a new one, which is then paid and closed on its own. `methods/accounts/divide.html`
- **[DOC]** `Payments_create` registers a payment and spreads it over the remainders of the POS bills listed in `accounts`. Whether the POS bill may be open and whether a fiscal receipt prints: not stated (Q82.1). `methods/payments/create.html`
- **[DOC]** `Accounts_getpaymentlink` makes a one-time public link that pays the remainder or a smaller `request_sum`; the page names "paying a large bill in parts". `methods/accounts/getpaymentlink.html`. The payment goes through barsy's own online-payment setup ("public cash desk", an extra billed cash desk), not through Restro's payment provider. https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/payments-links.html
- **[DOC]** `PaymentData.fx` = 1 marks a payment that performed a fiscal operation; `AccountData.unp` holds the УНП. `methods/accounts/get.html`
- **[NOT FOUND]** barsy's support for the чл. 26а "ЧАСТИЧНИ ПЛАЩАНИЯ" department; whether `Accounts_close` over the API takes several card payments (the doc lists "mixed", not "several of one kind"); whether `Accounts_divide` takes a fractional quantity (a quarter of a bottle).
- Rule 7 (D110): Restro writes into a POS only as a waiter would. Splitting a bill and taking a payment are on D110's list of waiter actions, so every POS write below is a waiter action. Until the ticket that adds the first write, `packages/barsy/src/write/` stays empty.

## 5. Findings: how other products split, and demand

- **[DOC] / [VENDOR PAGE]** sunday, Qerko, me&u, GoTab and Toast all use the same model: one open bill, several final payments, a running remainder that updates live for the table. Modes: my items, equal share, custom amount, pay the rest. Toast: https://support.toasttab.com/en/article/Split-Payments-with-Toast-Mobile-Order-Pay ; GoTab: https://gotab.com/features/tab-splitting ; sunday: https://sundayapp.com/en-gb/?p=5156 ; Qerko: https://www.qerko.com/eng/pay
- **[DOC]** Where these products use a hold, it is one card per tab. Toast: "only one guest" can be the pre-authorised card, and that guest pays what is left.
- **[NOT FOUND]** No restaurant or nightclub product documents several cards held and captured only when the total is reached. The pattern exists in bookings: PodPlay holds the booker's full amount plus each invitee's share (https://docs.podplay.app/payments/customer-payments/bill-splitting); Airbnb (2018, [SECONDARY]) held a booking until every share was paid.
- **[DOC] (extract)** me&u warns that a released hold can take the guest's bank up to 7 business days to clear. https://help.meandu.com/hc/en-us/articles/6539880778511
- **[VENDOR PAGE]** Demand figures, all vendor-reported: sunday, about 35 % of users split (2022); me&u, 50 % of guests at one venue pay through it. **[SECONDARY]** UK surveys: about 2 in 3 diners split; 34 % prefer equal shares, 36 % by who had what (https://www.opentable.co.uk/blog/going-dutch/). No data on bars, clubs or Bulgaria.
- **[SECONDARY]** Bulgaria: PossePay (2024, a student start-up; first client a shisha bar in Sofia) lets guests pick their items and pay. Current status unknown. https://www.capital.bg/biznes/fintech/2024/01/15/4575756_possepay_razdeli_mi_smetkata/
- **[READING]** Nobody in the market sells pooled holds for bar bills. That is either a gap or a sign the need is small. Section 8 tests which.

---

## 6. Meta-architecture: a hypothesis

POS-neutral and provider-neutral. Everything here is a proposal to verify (section 8), not a decision.

### 6.1 Three ways to pay, one new mechanism

| What the guest wants | How Restro does it | New mechanism? |
|---|---|---|
| Pay my own items | Split the items onto a new POS bill and close it with one card (decided 10-18) | no |
| Pay for everyone | Close the POS bill with one card | no |
| **Pay together**: equal shares, chosen amounts, or "who had what", all settling the amount now | **Group payment** | **yes** |
| Pay an amount and leave while the bill stays open | Not offered until section 8 answers B1–B3 and F1 | – |

The fourth row is the one case that needs a part payment on an open POS bill (чл. 26а). A possible bridge, if the POS allows it: put a fraction of a row (a quarter of the bottle) on a new POS bill. The receipt then lists real items and чл. 26а is not needed (question B3).

### 6.2 Group payment, step by step

1. **Start.** Any guest at the table chooses "Pay together" on the bill. It covers one fixed amount: a whole POS bill, a POS bill just split off by items, or a pay-first order. Restro records that POS bill's total at that moment.
2. **Freeze the amount.** While the group payment is open, new rounds from the table go onto a new POS bill (barsy allows several POS bills per table), so the amount cannot change under the guests. If the POS bill changes anyway (staff add a line), Restro releases every hold and starts again.
3. **Shares.** The starter picks a split: equal (N people), by items, or amounts typed per person. Each guest opens their share on their own phone from the table's bill, adds a tip if they want, and confirms with their bank (3-D Secure). Restro places **one hold per guest, for exactly that share plus tip**.
4. **Progress.** Everyone at the table sees: the amount, the shares held, what is still missing, the time left. Any guest may take over a missing share. Restro never lets the holds add up to more than the amount.
5. **Complete.** When the holds equal the amount:
   - Restro asks the POS whether it can print now (listed software must block payments when the fiscal device is down, Annex 29 т. 8);
   - Restro closes the POS bill with one card payment per share (the POS prints one receipt with several card payments, or one per payment, whichever the POS and the lawyer settle);
   - Restro captures every hold at once, each for exactly its held amount.
6. **Timeout or give up.** When the window ends (D30, a venue setting) or the starter cancels, Restro **releases every hold by API call at once**. The POS bill is untouched and the table can try again or pay at the bar. Restro tells guests their bank may show the released hold for a few days.
7. **A capture fails after the receipt printed** (rare: the hold was approved minutes earlier). Restro retries; if it still fails, the venue gets a task: collect that share another way, or do an operator-error storno of that payment by the 7th of next month (Н-18 чл. 31, ал. 3–4). Restro never refunds automatically once a receipt exists.
8. **Later refund.** A storno in the POS and a refund at the provider, linked share by share (D32).

**Why close the POS bill before capturing, not after.** Money taken without a receipt is the penalised case (ЗДДС чл. 185–186). A receipt without money is fixable by the venue (operator-error storno). With the hold already approved, the gap between the two steps is seconds and a failure is rare.

### 6.3 What the guest sees

- On the bill: a "Pay together" button next to "Pay my items" and "Pay all".
- Their own share: the amount, the items when split by items, a tip choice, then the bank's confirmation.
- A shared progress card: initials with "held" or "missing", the amount still missing, a countdown, "take over this share".
- At the end: "Paid. Your receipt is at the bar" (or electronic, if the lawyer allows; Q80 and Q81 still apply). If it failed: "Nothing was charged. Your bank may show a hold for a few days; it is released."
- The bill screen must never look like a fiscal receipt (Q81's safe reading).

### 6.4 What the venue carries

- It is the merchant of record (D98): chargebacks per card, provider fees per share, myPOS's fee for holds it has to cancel itself.
- The fiscal receipt and any storno are made on its POS.
- The "capture failed after receipt" task in step 7.

### 6.5 Capability flags for D98's provider interface

| Flag | Needed for | myPOS | Stripe | Borica | Revolut | Viva | SumUp | ePay.bg |
|---|---|---|---|---|---|---|---|---|
| `hold` (authorise now, capture later) | group payment at all | on request | yes | yes | yes | yes | not found | not found |
| `holdLifetime` | the D30 window must be far shorter | 30 d | 7 d | 30 d | 7 d | unknown | – | – |
| `releaseByCall` (cancel a hold) | step 6, Visa's 24 h rule | yes | yes | yes, full amount only | yes | yes | – | – |
| `lapsedHoldFee` (the provider charges for a hold left to expire) | risk shown to the venue | yes | not found | not found | not found | not found | – | – |
| `captureLess` (capture below the hold, rest released) | nice to have, if a share shrinks | yes | yes | yes | yes | yes | – | – |
| `capturesPerHold` | design assumes 1 | 1 (assumed) | 1 | 1 | 1 | unknown | – | – |
| `holdNotification` (webhook when the hold is placed) | progress card | `URL_Notify` | yes | browser return only | unknown | unknown | – | – |
| `walletsWithHold` (Apple Pay / Google Pay on a hold) | clubs are phone-first | unknown | yes | unknown | unknown | unknown | – | – |
| `partialRefund` | refund of one share | yes (doc says any partial amount) | yes | sale reversal ≤ original, once, 30 d | unknown | unknown | unknown | unknown |
| `idempotentCalls` | no double capture (Visa 12.6) | unknown | yes | unknown | yes (capture) | unknown | – | – |

Sources for the table are in section 3; Stripe's idempotency keys: https://docs.stripe.com/api/idempotent_requests ; myPOS partial refunds: https://developers.mypos.com/apis/checkout-api/checkout-getting-started/implementation-basics . "Unknown" means not found in what was read.

D98 already names three flags: can it hold and for how long, Apple Pay and Google Pay, and "can it split a charge". The last means splitting one charge between the venue and Restro's fee, not several payers; to avoid confusion, the group-payment flags above should keep their own names. D98's fallback for a provider without holds (charge, then refund) is written for song requests and does not fit group payment (below).

Not flags but entry checks for any provider: money lands in the venue's own payment account (D98); every hold goes through 3-D Secure. A provider without `hold` (SumUp, ePay.bg today) offers "pay my items" and "pay all", never "pay together". Without holds, a group payment would mean charging guests and refunding on failure, which leaves money taken without a receipt (section 1).

### 6.6 What the POS connector would need (POS-neutral)

| Capability | Needed for | barsy |
|---|---|---|
| Close a POS bill with several card payments | group payment, step 5 | "mixed" is documented for `Accounts_close`; several card payments over the API: B1 |
| Report whether the fiscal device can print now | step 5 | not documented |
| Split items (and fractions of a row) onto a new POS bill | pay my items; the fraction bridge | `Accounts_divide`; fractions: B3 |
| Return the receipt reference per payment (УНП, receipt number) | D32, disputes, storno | `unp`, `payment_print_data` |
| Storno one payment of a closed POS bill | step 7, step 8 | `Accounts_storno` with `payments` |
| Part payment on an open POS bill with a correct receipt (чл. 26а) | "pay an amount and leave" | Q82.1, B2 |

### 6.7 Where I weighed Fable's opinion

An independent Fable agent was asked the same question. Agreed and adopted: one mechanism for "pay together" and equal shares; one hold per guest; refuse an amount on an open POS bill (чл. 26а) until the POS documents it; close the POS bill before capturing; freeze the amount while a group payment is open; never refund automatically after a receipt; D30's 3 minutes is the wrong size for holds; the venue carries disputes and should be told so; read barsy's history for the demand test; barsy's payment link as a possible one-venue bridge for part payment.

Where I disagree:
- **"Build neither yet."** Fable would defer group payment too. I would design it into this feature set and build it behind two gates (holds on at the venue's provider, B1 answered). It needs no fiscal mechanism beyond what "pay all" already needs: closing a POS bill with card payments.
- **"One fiscal receipt per payment, always."** The law does not require that when all cards are taken at the same moment (чл. 26, т. 8 "начин/и"; the NRA's "смесено плащане"). Either shape is fine; whichever the POS prints decides it.
- **A 10–15 minute window as the answer.** Visa and the PSR care about releasing at once after failure, not about how long Restro waits; any window is lawful if release is by call. The number is a venue setting and D30's default is Martin's call; I suggest about 10 minutes for the pilot. D30 also caps the window at barsy's payment-link lifetime, a limit written for shares paid through barsy links, not through holds (A9).
- **"A staff-assisted close first"** (staff close the POS bill by hand, Restro captures after sync sees it). It avoids POS writes, but D110 already allows taking a payment as a waiter would. The gap between sync and capture leaves holds open, and it is the staff work the operational design wants to avoid (design intent, 10-17). I list it only as a fallback.
- **"Collecting by Revolut is ubiquitous in Bulgaria."** Plausible, but no source was found. It is assumption A6 below, to test.

### 6.8 Assumptions this rests on

- **A1.** A card hold is not yet a "payment" under Н-18 чл. 25, ал. 6; the receipt is due at capture. (Lawyer, F2.)
- **A2.** One fiscal receipt may carry several card payments when all are captured at closing; otherwise one receipt per payment is fine. (Lawyer F1, Lukanet B1.)
- **A3.** barsy's API can close a POS bill with several card payments in one call and print the receipt. (Lukanet B1.)
- **A4.** The venue's provider will switch holds on for a nightclub (myPOS assesses each request) and allows exactly one capture for the held amount. (Providers P1–P3.)
- **A5.** Each guest confirming their own share with 3-D Secure on their own phone is acceptable friction in a club at night.
- **A6.** Guests and venues want "pay together" often enough to pay for it; today they use the terminal's mixed payment or one person collects by bank transfer.
- **A7.** New rounds during an open group payment can go onto a second POS bill without confusing staff.
- **A8.** Closing a POS bill with several card payments counts as "take a payment", a waiter action under D110; nothing here works without that write.
- **A9.** D30's window may outlast barsy's payment-link lifetime for a group payment, because the holds go through Restro's payment provider and no barsy payment link is used. D30 says the window must never be longer than that lifetime; Martin decides whether that limit applies to group payment.

---

## 7. Fiscal receipts per payment, in one table

| Situation | Receipt(s) | Basis |
|---|---|---|
| Pay my items (split onto a new POS bill) | one receipt for that POS bill, its items listed | чл. 25, ал. 6; чл. 26, т. 7 |
| Group payment, all cards captured at closing | one receipt listing several card payments, or one per payment; same УНП under listed software | чл. 26, т. 8; Annex 29 т. 10 [READING] |
| Group payment released | none | no payment [READING] |
| Capture failed after the receipt | operator-error storno of that payment by the 7th of next month | чл. 31, ал. 3–4 [READING] |
| Amount on an open POS bill | "ЧАСТИЧНИ ПЛАЩАНИЯ" department now, all items minus a value discount at the end | чл. 26а; not documented by any POS |
| Refund of one share | storno receipt citing the original receipt and УНП | чл. 31, ал. 2 |

---

## 8. Verification plan

### 8.1 Technical: payment providers

**myPOS** (first)
- **P1.** Will you switch on pre-authorisation (`IPCPreAuthorization`) for a nightclub's online store (MCC 5813)? What is the hold limit for that business type?
- **P2.** Can `IPCPreAuthCompletion` be called once for the full held amount a few minutes after the hold, and can one hold be completed twice?
- **P3.** Does `IPCPreAuthCancellation` release the hold at the guest's bank at once, and is it free? What exactly is the fee when myPOS cancels an expired hold?
- **P4.** Do Apple Pay and Google Pay work with a pre-authorisation on the hosted checkout?
- **P5.** Is there a notification for a hold being placed and for a completion? What is the retry schedule?
- **P6.** Can a Payment Request or Payment Link be paid several times, or with a payer-chosen amount?
- **P7.** Is there anything in the partner programme for several payers on one order?

**Stripe, Viva, Revolut, Borica banks** (short)
- **P8.** Stripe: on a Bulgarian venue's connected account (direct charges), is manual capture available on blended pricing? Confirm wallets with manual capture.
- **P9.** Viva: hold duration for online pre-authorisation, captures per hold, Apple/Google Pay with `isPreAuth`, and whether the ISV programme accepts Bulgarian venues.
- **P10.** Revolut: refund of a partly captured order, webhook names for authorised and captured, wallets with manual capture.
- **P11.** The venue's bank (Borica): is TRTYPE 12/21 enabled for MCC 5813, and are Apple/Google Pay appendices offered?

### 8.2 Technical: Lukanet (barsy), to send with Q79/Q82

- **B1.** Can `Accounts_close` (or `Accounts_place` with closing) take several payments of the same card method, each with its own provider transaction reference? Does the fiscal device print one receipt with several card lines, or one receipt per payment? Does each payment come back with its own `payment_id`, `fx` and receipt data?
- **B2.** (Extends Q82.1.) For a part payment while the POS bill stays open, through `Payments_create` or `Accounts_getpaymentlink` with `request_sum`: is a fiscal receipt printed at that moment, and in which form (the чл. 26а "ЧАСТИЧНИ ПЛАЩАНИЯ" department, a "Капаро" item, or something else)? What does the final receipt show?
- **B3.** Can `Accounts_divide` move a fractional quantity of a row (0.25 of a bottle) to a new POS bill?
- **B4.** How does an integrator ask, just before closing, whether the cash desk's fiscal device can print now?
- **B5.** Can `Accounts_storno` reverse one card payment of a closed POS bill (refund to card, no cash), and which payment type does it print?
- **B6.** While a POS bill is being paid together, can it be locked against new lines, as barsy does after a failed second card at the terminal?

### 8.3 Technical: the lawyer (add to the L-list)

- **F1.** Is one fiscal receipt with several card payments, all captured at closing, compliant with Н-18 чл. 26, ал. 1, т. 8, with and without listed software?
- **F2.** Is the "payment" under чл. 25, ал. 6 the capture, not the hold? Is a receipt at capture compliant for a hold placed minutes earlier?
- **F3.** Is a share that is not tied to items (1/4 of the bill), paid while the POS bill stays open, a "частично плащане" that needs чл. 26а, or may it be avoided by splitting fractions of rows?
- **F4.** If a capture fails after the receipt printed, is an operator-error storno (чл. 31, ал. 3) the right correction?

### 8.4 Practical: do guests and venues want it? (cheapest first)

1. **Count what already happens (no code).** With Martin's OK and the pilot venue's, read the last three months of closed POS bills and count those closed with two or more card payments, by table and amount. barsy already stores every payment (`payments_history`). This is a read, inside rule 7. Signal to look for: what share of table bills over 100 € is paid by several cards.
2. **Ask the staff (one hour, no code).** A 15-minute talk with two waiters and the manager at the pilot venue: how often a bottle or table is paid by several cards; how long it takes; what goes wrong (a declined second card, people leaving); whether one person collects by bank transfer instead (tests A6).
3. **Watch one busy night.** Count tables that split at the terminal and the minutes it takes.
4. **A "coming soon" tap in the guest page** once ordering is live: a "Pay together" option that explains it is not available yet and counts the taps. It must say clearly that nothing is charged.
5. **Five-guest phone test** before building: a clickable mock of the share and progress screens, with five people at a table and a 3-D Secure step simulated (tests A5).

**Go/no-go for building group payment** (a proposal): build if (1) shows that a meaningful share of large table bills is already paid by several cards, or (2) says splitting is a regular pain, and P1–P3 and B1 come back yes.

---

## Sources

Law: Н-18 https://lex.bg/bg/laws/ldoc/2135540645 · ЗДДС https://lex.bg/bg/laws/ldoc/2135533201 · ДВ бр. 42/2025 https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=235038 · NRA "Документи за продажба" https://nra.bg/wps/wcm/connect/agency/site/fiskalni-ustroystva-supto-i-e-magazini/dokumenti-za-prodajba.storno.operacii/dokuenti.prodajba · [SECONDARY] NRA Q&A copy https://kamisl.com/vaprosi-i-otgovori-kasaeshti-supto-nap/ · PSD2 https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32015L2366 · RTS 2018/389 https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32018R0389 · EBA Q&A 2020_5133 https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2020_5133 · PSR compromise text https://data.consilium.europa.eu/doc/document/ST-8221-2026-INIT/en/pdf

Card schemes: Visa Rules 18.04.2026 https://usa.visa.com/content/dam/VCOM/download/about-visa/visa-rules-public.pdf · [SECONDARY] Mastercard TPR https://www.mastercard.us/content/dam/public/mastercardcom/na/global-site/documents/transaction-processing-rules.pdf · [SECONDARY] Worldline https://docs.acquiring.worldline-solutions.com/Features/Card-based/Authorizations/authorization-validity

Providers: myPOS https://developers.mypos.com/apis/checkout-api/pre-authorization · https://developers.mypos.com/sdks/php-sdk/sample-code/pre-auth-completion · https://developers.mypos.com/in-app-payments/android-payments/pre-authorization-completion · https://help.mypos.com/hc/en-bg/articles/6882371009821-What-is-pre-authorization · https://developers.mypos.com/apis/ecommerce/payment-request · https://partners.mypos.com/solutions/food-beverage · Stripe https://docs.stripe.com/payments/place-a-hold-on-a-payment-method · https://docs.stripe.com/payments/overcapture · https://docs.stripe.com/connect/direct-charges · Borica https://3dsgate-dev.borica.bg/P-OM-41_BORICA_eCommerce_CGI_interface_v%207.0_EN.pdf · Revolut https://developer.revolut.com/docs/merchant/capture-order · Viva https://developer.viva.com/smart-checkout/pre-authorization/ · https://developer.viva.com/isv-partner-program/ · SumUp https://developer.sumup.com/llms-small.txt · ePay.bg https://www.epay.bg/v3main/img/front/tech_wire.pdf · Adyen https://docs.adyen.com/online-payments/partial-payments · Square https://developer.squareup.com/docs/orders-api/pay-for-orders

POS: barsy, see section 4 (pages under `https://docs.lukanet.com/barsy.api/` and `https://docs.lukanet.com/barsy.help/`).

Products and demand: https://support.toasttab.com/en/article/Split-Payments-with-Toast-Mobile-Order-Pay · https://gotab.com/features/tab-splitting · https://sundayapp.com/en-gb/?p=5156 · https://www.qerko.com/eng/pay · https://help.meandu.com/hc/en-us/articles/6539880778511 · https://docs.podplay.app/payments/customer-payments/bill-splitting · https://www.opentable.co.uk/blog/going-dutch/ · https://www.capital.bg/biznes/fintech/2024/01/15/4575756_possepay_razdeli_mi_smetkata/

Earlier Restro research this builds on: `docs/research/2026-10-17-mypos-and-fiscal-receipts.md`, `docs/deliverables/2026-10-17-payment-providers-feasibility.md`, `docs/deliverables/2026-10-17-pos-integration-requirements.md` and `docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md`, `docs/research/2026-10-18-bill-in-pos-systems.md` (on `research/bill-in-pos-systems`).
