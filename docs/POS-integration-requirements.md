# POS integration requirements
### What a venue's POS must do when Restro takes card money in a club: app payments, deposits and paid song requests

**Not legal advice.** This document prepares Restro's questions for its lawyer and for the two POS producers, Lukanet (barsy) and Mistral Software (Mistral/Zamboo). It settles nothing. Every line tagged [READING] is interpretation, never fact; the lawyer, a written NRA opinion or the producer's signed-in documentation decides. The barsy and Mistral columns describe what each producer's documentation said on 2026-10-17, not what the products can or cannot do. Lawyer questions L1–L12 are in `docs/research/2026-10-17-fiscal-rules-in-app-payments.md` and are cited here by number only; new questions continue at L13.

Every card payment Restro takes for a club needs a fiscal receipt from the venue's own fiscal device, printed at the moment the money is captured. That covers the bill, a round, a reservation deposit and each backer's capture on a song request. Three texts lead there. A card payment is not among the exemptions (Н-18 чл. 3, ал. 1). The receipt is due "при извършване на плащането" and must be handed over with it (чл. 25, ал. 6). The e-shop alternative regime fails because the service is used inside the venue's trade site (ЗДДС § 1, т. 96). The venue's POS therefore carries the fiscal load, and it must do four things for Restro. It must say in real time whether it can print. It must register each app payment and print at once. It must storno a refunded payment with the original receipt's data. And, if the venue chose NRA-listed sales software, it must take Restro's orders and song requests in as an Annex 42 import no later than the moment the venue commits. barsy documents most building blocks in its staff screens and names matching API methods behind its login. Its public help is silent on Annex 42, on the чл. 26а partial-payment department, on electronic receipts and on refunds to a card, and its fiscal storno is cash-only. Mistral/Zamboo publishes no API at all. Nothing here can be built today. Every requirement that writes into the POS collides with Restro rule 7, whose write allowlist is empty. The stricter half of the requirements applies only to a venue on NRA-listed software, and the listing of barsy and Mistral/Zamboo is unconfirmed. Paid song requests as designed in D99 are probably not an e-shop, and they are not gambling.

---

## How to read this document

**Tags on findings.**

| Tag | Meaning |
|---|---|
| [LAW] | Text of a Bulgarian law or ordinance, consolidated on lex.bg, quoted with article, paragraph and point |
| [NRA] | Stated on a page of the National Revenue Agency (nra.bg) |
| [LAW, EU] | An EU act, an official Commission guidance, or a judgment of the EU Court |
| [DOC] | Stated on the producer's public technical or help documentation |
| [VENDOR PAGE] | Stated on the producer's own marketing page |
| [INDEX] | A word or name found in barsy's public API search index (`https://docs.lukanet.com/barsy.api/searchindex.js`). It shows that a method or field appears on a login-gated page, not what the page says |
| [REPO 10-08] | barsy API pages read signed in on 10-08, as recorded in the Restro repository (`docs/tracker.md`, research facts). Secondary record, not re-verified |
| [READING] | Interpretation. Never fact |
| [NOT FOUND] | Source silent or unreachable; "[NOT FOUND – sign-in]" when the page needs a login |

**Variants.** (S) = the venue chose NRA-listed sales software (СУПТО) for the site and notified the NRA (Annex 32). (U) = the venue drives its fiscal device with unlisted software. "S+U" means the requirement binds either way.

**Requirement numbers.** G = holds for every flow. F1–F6 = the six flows. P = a requirement on the POS side. D = data Restro hands the POS, or takes back from it ("back").

**Support status** (barsy and Mistral columns):
- **supported**: a public [DOC] page states it, or the signed-in reading of 10-08 recorded it. "(UI)" means the doc describes a staff screen, not an API.
- **needs sign-in**: the method or field exists behind docs.lukanet.com's login ([INDEX] or [NOT FOUND – sign-in]); its behaviour is unverified.
- **not documented**: the public docs were read and say nothing.
- **unknown**: there is no technical documentation to check (most of Mistral).

**Law versions read on 2026-10-17.** Н-18, consolidated, latest amendment ДВ бр. 42/2025 ([lex.bg](https://lex.bg/bg/laws/ldoc/2135540645)). ЗДДС, consolidated, amendments to ДВ бр. 69/2026 ([lex.bg](https://lex.bg/bg/laws/ldoc/2135533201)). ЗЗП, amendments to ДВ бр. 87/2026 ([lex.bg](https://lex.bg/laws/ldoc/2135513678)). Закон за електронната търговия, ЗЕТ ([lex.bg](https://lex.bg/bg/laws/ldoc/2135530547)). Закон за хазарта, ЗХ ([lex.bg](https://lex.bg/laws/ldoc/2135783265)). Unless another source is named, "чл." and "Annex" refer to Н-18 and "ЗДДС" to the VAT Act at these URLs.

**Abbreviations.** ФУ = fiscal device. ФБ = fiscal receipt. ИАСУТД = integrated automated system that issues system receipts. СУПТО = sales-management software. УНП = unique sale number. Restro terms follow `GLOSSARY.md`: hold, capture, release, refund, payment provider, payment account, song request, backer, request queue, service day.

---

## Two gates stand in front of every requirement

### Gate 1: Annexes 29, 41, 42 and чл. 52з bind only a venue that chose listed software

The import rules, the УНП, the readiness check and the audit export all come from Annex 29 (requirements for listed software), Annexes 41 and 42 (exchange and import) and чл. 52з (duties of a person using listed software). [LAW] They bind a venue only if it chose software on the NRA list: a person "може да избере ... софтуер, включен в списъка по ал. 16", and once it has, "е длъжно да ползва само този софтуер" in that site (ЗДДС чл. 118, ал. 18). Choosing is voluntary. [LAW] The penalty for a venue that chose listed software and still manages sales in "друг софтуер/модул от софтуер, невключен в списъка" is 5,000–10,000 лв. for a company, 10,000–20,000 лв. for a repeat (ЗДДС чл. 185б, ал. 1–2, amounts as printed on lex.bg). The same conduct is a ground for "запечатване на обект за срок до 30 дни" (ЗДДС чл. 186, ал. 1, т. 5). [NRA] Listed software brings benefits a venue would lose: no sealing for a first missing receipt, VAT refund within 30 days, and 100 % amortisation ([NRA, users of СУПТО](https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/supto/page.Informacia-za-potrebiteli-na-SUPTO)). [READING] So Restro should plan for (S) and treat (U) as the lighter case.

**Whether barsy and Mistral/Zamboo are listed is unconfirmed.** [NOT FOUND] The NRA's link to the public list of sales software ([NRA СУПТО page](https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/supto)) points to `https://inetdec.nra.bg/pls/pub/home.html#/goto:dec2009.REGREPSOFT.home`, which returned 404 on 2026-10-17. [NRA] The list now lives as a search form on portal.nra.bg, open without sign-in ("Свободен достъп"), searchable by software name, version and declarant ([portal.nra.bg](https://portal.nra.bg/details/reg-allowed-software)). The form was not filled. [DOC] barsy says a "barsy SUPTO" variant exists: "barsy SUPTO е вариант на система barsy, при които са изпълнени всички изисквания на Наредба Н18" ([barsy, Представяне](https://docs.lukanet.com/barsy.help/100-about/index.html)). [READING] Because it is a variant, each pilot venue may or may not run it. [VENDOR PAGE] Mistral Software sells a product called "Софтуер Мистрал v3 по наредба H18" ([mistral.bg/helpdesk](https://mistral.bg/helpdesk/)) and hosts a form for "Информация, подавана от лицата по чл. 118, ал. 18 от ЗДДС" ([mistral.bg, Н-18](https://mistral.bg/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D1%8F-%D0%BD-18/)); no page states Zamboo's listing. Two facts are needed per pilot venue: is its POS on the list (name, version), and has the venue filed Annex 32 for the site. The first takes one search on portal.nra.bg; the second, a question to the venue.

### Gate 2: Restro rule 7 forbids every write that these requirements need

Restro's rule 7 says sync never writes into a POS, and `packages/barsy/write/` exports only calls on the product owner's allowlist, **currently none**. The same rule forbids webhooks and POS registration. CLAUDE.md also holds back ordering, payment and webhook backend code "until the tracker says so". **Every requirement below that needs Restro to write into the POS needs Martin's allowlist decision first.** Until then, none of flows F1–F6 can be compliant for an in-app card payment. [READING] The only compliant path today is the old one: staff ring the sale up on the POS and the guest pays at the bar. Under D71 and D72, the guest's pay, bill and receipt screens stay hidden until the platform supports them, which fits.

| Write into the POS | Needed by | barsy name in its docs | Mistral | Allowlist |
|---|---|---|---|---|
| Create or continue a sale from a Restro order or song request | P6.1, P6.3, P4.1 | `Accounts_place`, `Accounts_create`, `Clientorders_create` [DOC] ([web-order scenarios](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)) | none known | not on it |
| Register an app payment, close the sale, print the ФБ | P1.2, P2.1, P3.1, P4.3 | `Accounts_place` with `payments` and `flag_close_account` [REPO 10-08] ([Accounts_place](https://docs.lukanet.com/barsy.api/methods/accounts/place.html)); `Payments_create` [INDEX] | none known | not on it |
| Split an open sale | P2.2 | `Accounts_divide` [INDEX] | none known | not on it |
| Storno a sale or a payment | P3.5, P4.5, P5.1–P5.4 | `Accounts_storno` [INDEX] ([page, sign-in](https://docs.lukanet.com/barsy.api/methods/accounts/storno.html)) | none known | not on it |
| Annul a declined request or a released hold | P4.6, P6.5 | not documented | none known | not on it |
| Create a barsy payment link (alternative route, F1, F3) | F1, F3 | `Accounts_getpaymentlink`, `Reservations_getpaymentlink` [INDEX] | none known | not on it |
| Subscribe to POS webhooks to learn the УНП | P1.4 | webhooks for accounts, client orders, reservations [REPO 10-08] ([webhooks](https://docs.lukanet.com/barsy.api/integrations/40-webhooks.html)) | none known | rule 7 forbids webhooks |

Reads stay allowed. [LAW] Listed software may export to other software: "Допуска се СУПТО да извежда (експортира) информация към други софтуери" (Annex 29 т. 23). [INDEX] barsy's `Accounts_get` and `Accounts_getlist` carry `unp` and `payment_print_data` ([search index](https://docs.lukanet.com/barsy.api/searchindex.js)), so reading the receipt reference back by polling is a read, not a write.

A third gate sits with the lawyer. The requirements assume the readings behind L2 (fiscal receipt for in-venue app payments), L7 (receipt at capture, nothing at a hold) and L10 (storno for card refunds). If the lawyer answers otherwise, the affected requirements change.

---

## Card money in a club always ends at the venue's fiscal device

The rules that drive the requirements are few, and they point the same way. [LAW] A receipt is due "за всяко плащане" (чл. 25, ал. 1, т. 1). The only exemptions are a cash deposit to a payment account, a credit transfer, a direct debit, or a cash or postal money transfer (чл. 3, ал. 1); a card is not among them (L1 tests the NRA's looser wording). [LAW] The receipt "се издава при извършване на плащането", and the seller must hand it over "едновременно с получаване на плащането" (чл. 25, ал. 6). [LAW] The guest "е длъжен да получи фискалния или системния бон" and may refuse to pay if none is issued (ЗДДС чл. 118, ал. 1, 1а). [LAW] The alternative regime, an electronic sales document instead of a receipt, needs a "неприсъствено плащане", which requires delivery "на място, различно от търговския обект на търговеца" (ЗДДС § 1, т. 96). [READING] Every Restro flow delivers in the club: drinks at the table, a song played there, a table used there. So the alternative regime is closed for all six flows, including a deposit paid from home and a song request paid from outside (L4, L25).

Four further rules shape how the POS must work.

**The receipt follows the capture, not the hold.** [READING] A hold reserves money on the guest's card. The venue has not received it, so no receipt and no VAT arise until capture (ЗДДС чл. 25, ал. 7; чл. 25, ал. 6). A released hold needs no document. This is L7.

**Readiness gates the payment under (S).** [LAW] Listed software must know in real time whether the ФУ can print. Without that, it "блокира функционалността за обработване на плащания, за които се изисква издаване на фискален бон" (Annex 29 т. 8 (в)). Opening a sale needs ФУ contact within "предходните 2 часа" (т. 8 (б)). [LAW] Entering a payment that needs a receipt "задължително подава команда към фискалното устройство", and every receipt and storno of that sale carries the same УНП (т. 10). [READING] Read together, Restro must not capture unless the POS has just confirmed it can register and print the payment.

**Under (S), the sale must be inside the listed software from the guest's request.** [LAW] "Управление на продажби чрез СУПТО" covers the sale "от заявяването от страна на клиентите ... до предоставянето/заплащането им". The request counts as made "най-късно в момента, в който лицето по чл. 3 поема ангажимент към клиента", "включително мълчаливо" (Н-18 § 1, т. 19 ДР). [LAW] Sales software is "всеки софтуер или модул от софтуер" that processes sale information in a trade site (ЗДДС § 1, т. 84). [LAW] The venue may not "без оторизация от производителя ... добавят външни модули" (чл. 52з, ал. 5). It may import sales "от други източници и софтуери" under Annex 42 (чл. 52з, ал. 10). [READING] Restro stays a lawful source only if each order or song request reaches the POS no later than the venue's commitment. The commitment is staff acceptance, Restro's auto-accept, the DJ's accept or a capture, whichever comes first (L14). Restro must show "accepted" only after the POS has the sale.

**Partial payments and refunds have fixed shapes.** [LAW] Partial payments may go to a ФУ department "ЧАСТИЧНИ ПЛАЩАНИЯ" with the goods in free text between "#" signs. At the final payment, all goods are registered, then a "стойностна отстъпка, равна на размера на частично заплатената ... сума" (чл. 26а, ал. 1–2). [LAW] A deferred payment ("резерв 2 – отложено плащане") is allowed only for an ИАСУТД (чл. 25, ал. 5), or for an extended receipt that is an invoice (чл. 26б, ал. 1). [LAW] A refund is a storno from the device, citing the original receipt and, under (S), the УНП (чл. 31, ал. 1–2). It is blocked by "недостатъчна касова наличност" except for operator error (ал. 3). The express exception for refunds by card is granted only to an ИАСУТД (ал. 3а). This is L10.

[READING] **The capture-before-receipt gap is the hardest design point.** Two orders are possible, and both leave a failure case. Capture first, then register: if the POS fails after capture, money is taken with no receipt. That breaches чл. 25, ал. 6, and the only cure is a fast refund. Register first, then capture: if the capture fails, a receipt exists for money never received, and the cure is an operator-error storno, allowed until the 7th of the next month and exempt from the cash check (чл. 31, ал. 3–4). The second order fails more safely on paper, but it prints receipts for payments that may not happen. The lawyer should pick one (L16). D99's outbox jobs for captures must then run the same sequence as one step with the POS call.

---

## Requirements flow by flow

F6 (Restro orders entering the POS) is listed last, as asked, but it comes first in time. Under (S), payments in F1, F2 and F4, and probably F3, must attach to a sale that already has a УНП.

### G. Requirements for every flow

| ID | Requirement | Applies | Legal source | barsy | Mistral/Zamboo |
|---|---|---|---|---|---|
| G1 | The POS accepts Restro's data only through an interface its producer built or authorised. Restro never writes into the POS database | S | чл. 52з, ал. 5, 10; Annex 29 т. 4, 22 | **supported** for the shape: API order paths named in public help [DOC] ([web orders](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)). A personal cash desk serves "за ограничен API достъп на външни приложения" [DOC] ([Каса](https://docs.lukanet.com/barsy.help/210-dictionary/pos.html)). Authorisation of outside apps under чл. 52з, ал. 5: **not documented** | **unknown**: no public API. Back Office has a "Външни системи" screen whose purpose is not described [DOC] ([help, BackOffice](https://help.zamboo.bg/BackOffice/)) |
| G2 | The POS exposes ФУ readiness in real time. It refuses an app payment when it cannot print, and refuses to open a sale after 2 h without ФУ contact | S | Annex 29 т. 8 (а)–(в) | **not documented** for the API. In the UI, closing checks the device link and marks the account closed only after the print succeeds [DOC] ([Продажби](https://docs.lukanet.com/barsy.help/120-posx/020-sale.html)) | **unknown** |
| G3 | The POS defines an operator identity for imported orders and payments, used in the УНП's operator code and the payments table | S | Annex 29 т. 6–7, 9, 18.2 | **not documented** | **unknown** |
| G4 | The POS has a payment type "card, paid in the app", mapped to the ФУ's card register and printed as card. It is kept apart from card at the bar for reconciliation with the payment provider | S+U | чл. 26, ал. 1, т. 8; Annex 17 ("Сума по кредитни/дебитни карти"); Annex 29 т. 18.2, 18.9 | **supported (UI)**: types include "Карта(неприсъствена)" and "Карта(присъствена)" [DOC] ([types](https://docs.lukanet.com/barsy.help/extra/payment_methods_types.html)). "Код ФУ" picks the device payment, and a method can name a payment operator [DOC] ([create](https://docs.lukanet.com/barsy.help/110-admin/180-settings/100-main/payment_methods/basic/02_create_payment_methods.html)). How "Карта(неприсъствена)" is fiscalised: **not documented** | **supported (UI)**: "Видове плащане" screen [DOC] ([BackOffice](https://help.zamboo.bg/BackOffice/)). Use by an outside app: **unknown** |
| G5 | The POS prints no service slip on the ФУ for client orders | S+U | чл. 7а, ал. 2; Annex 29 т. 11 | **not documented**. The setting "Печат на фискален тотал" prints a total-only ФБ plus a service note with the items [DOC] ([settings](https://docs.lukanet.com/barsy.help/extra/settings.html)); [READING] the venue should check it against т. 11 | **not documented** |
| G6 | No test or training mode on the live system. Tests run only at separate workplaces with no client access, with the NRA told the day before. Restro never tests against a live venue's POS | S | Annex 29 т. 20; чл. 52з, ал. 4 | **unknown** | **unknown** (T69 asks for a test installation) |
| G7 | Audit export: imported sales, app payments, stornos and annulments appear in the т. 18 tables, with payment date, operator, payment type and ФУ number | S | Annex 29 т. 15, 18.1–18.5 | **not documented** as an Annex 29 export. Report "Отпечатани бележки" lists receipt number, fiscal memory, device serial, payments and storno receipt [DOC] ([report](https://docs.lukanet.com/barsy.help/110-admin/170-reports/122_fiscal_printers/3_printed_notes.html)) | **not documented** |

Three constraints fall on Restro itself, not on the POS. [LAW] No document other than a fiscal receipt may contain "Фискален", "Фискална", "Фискално", "Фискални" or derived words (чл. 7а, ал. 3; Annex 29 т. 14). [LAW] A running-total document must not resemble a receipt and, if requested, follows Annex 39 with "По този документ НЕ СЕ ДЪЛЖИ ПЛАЩАНЕ" (чл. 7а, ал. 1; чл. 26, ал. 6); whether an app screen is such a document is L9. [LAW] Workstations sync time with their ФУ at least once a working day (Annex 29 т. 5); [READING] Restro's timestamps sit beside the POS's in the audit trail, so its clocks should be synced. A fourth is open. [LAW] On inspection, a venue on listed software must give access to "всички устройства, които работят с използвания в обекта софтуер - сървъри, работни станции, ФУ" (чл. 52и, ал. 1). Whether Restro's servers count is L21.

### F1. App payment of a bill or a round

The guest pays the whole bill, or one round, in the app. The money is captured into the venue's payment account (D98). The venue's ФУ prints one receipt for that payment.

| ID | Requirement | Applies | Legal source | barsy | Mistral/Zamboo |
|---|---|---|---|---|---|
| P1.1 | Before capture, Restro asks the POS whether this payment can be registered and printed now, and captures only on yes | S (prudent for U) | Annex 29 т. 8 (в); чл. 25, ал. 6 | **not documented** | **unknown** |
| P1.2 | On receiving the app payment, the POS registers it against the sale and prints the ФБ at once: payment type card, total, and under (S) the УНП | S+U (УНП: S) | чл. 25, ал. 1, т. 1, ал. 6; чл. 26, ал. 1, т. 8, 17; Annex 29 т. 10; ЗДДС чл. 118, ал. 3 | **needs sign-in**. The documented path is closing an account with balanced payments, then "издава се фискален бон" [DOC] ([Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)). Over the API, payments are accepted only when closing (`flag_close_account`), and `print_receipt` was read as a local print [REPO 10-08] ([Accounts_place](https://docs.lukanet.com/barsy.api/methods/accounts/place.html)). Which device prints for an API close: **not documented** | **supported (UI)**: staff pick "КАРТА" and press "ФИС.БОН" [DOC] ([help, Ресторант](https://help.zamboo.bg/restaurant)). From an outside app: **unknown** |
| P1.3 | The ФБ reaches the guest with the payment: on paper at the table, or electronically only under чл. 3, ал. 18 (listed software and client data) or ал. 19 (e-shop), with a delivery log | S+U | чл. 25, ал. 6, 13; чл. 3, ал. 18–19; чл. 52з, ал. 17; Annex 29 т. 24; ЗДДС чл. 118, ал. 21–22; L3 | **not documented**: no electronic fiscal receipt in the public help; only invoices go by email [DOC] ([Фактура](https://docs.lukanet.com/barsy.help/210-dictionary/invoice.html)) | **not documented** |
| P1.4 | The POS returns the receipt reference (УНП, ФБ number, date and time, ФУ number). Restro stores it against the provider's transaction reference as D98's "receipt reference". The law does not require this link | Restro need | D98; чл. 26, ал. 1, т. 17 | **needs sign-in**: `unp`, `payment_print_data` on `Accounts_get` and AccountData [INDEX] ([index](https://docs.lukanet.com/barsy.api/searchindex.js)) | **unknown** |
| P1.5 | The POS stores the payment provider's transaction reference with the payment | Restro need | none in Н-18; Annex 29 т. 18.2 has no such field | **needs sign-in**: `transaction_id`, `ref_num` on AccountPaymentInputData [INDEX] | **unknown** |
| P1.6 | If printing fails after the capture, the POS reports it at once, so Restro can retry while the guest waits or refund | S+U | чл. 25, ал. 6; ЗДДС чл. 118, ал. 1а; L16 | **not documented** for the API. In the UI the account closes only after the print succeeds [DOC] ([Продажби](https://docs.lukanet.com/barsy.help/120-posx/020-sale.html)) | **unknown** |

| ID | Data Restro hands the POS | Why |
|---|---|---|
| D1.1 | Sale reference: the УНП or the POS's account id | Annex 29 т. 10 (payment attaches to the sale) |
| D1.2 | Amount, integer minor units, euro | чл. 26, ал. 1, т. 8; Restro rule 8 |
| D1.3 | Payment type code for "card, app" | G4 |
| D1.4 | Capture time | чл. 25, ал. 6; Annex 29 т. 18.2 "дата на плащане" |
| D1.5 | Provider transaction reference | P1.5 (Restro's audit link) |
| D1.6 | Lines paid, when the payment covers a round rather than the whole bill | Annex 29 т. 18.3; chooses P2.1 vs P2.3 |
| D1.back | УНП, ФБ number, date and time, ФУ number, or a failure | P1.4, P1.6 |

[DOC] barsy has a second route that removes the payment write but not the allowlist question. A barsy payment link lets a guest pay an account, client request, reservation or invoice by card through a vPOS set up with the **venue's own** merchant credentials, myPOS among them. The payment then appears in the document's payments tab ([payment links](https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/payments-links.html); [myPOS vPOS](https://docs.lukanet.com/barsy.help/110-admin/180-settings/100-main/payment_methods/payment-providers/Vpos-myPOS/vpos.html)). It needs the paid "Публична каса" resource and an extra billed cash desk. [NOT FOUND] Whether a link payment closes the account and prints a ФБ is not stated. [INDEX] `Accounts_getpaymentlink` takes `request_sum`, and its page carries "поетапно", "части" and "остатъка" ([index](https://docs.lukanet.com/barsy.api/searchindex.js)). [READING] If barsy fiscalises link payments, this route would put the money, the payment record and the receipt inside barsy. It would also bypass Restro's own payment-provider connector (D98) for barsy venues. That is a product choice for Martin as much as a Lukanet question.

### F2. Part paid in the app, rest at the bar

One table, one open sale. Some guests pay in the app, and the rest pay at the bar by card or cash.

| ID | Requirement | Applies | Legal source | barsy | Mistral/Zamboo |
|---|---|---|---|---|---|
| P2.1 | One open sale takes several payments. Each gets its own ФБ, and under (S) each carries the same УНП | S+U (УНП: S) | Annex 29 т. 10 ("Когато плащанията по продажбата са повече от едно"); чл. 25, ал. 1, т. 1 | **needs sign-in**. Over the API, payments were read as accepted only when closing [REPO 10-08]; `Payments_create` exists [INDEX]. In the UI, an account can be marked unpaid "(или частично платена)" [DOC] ([Плащане 2.3.5](https://docs.lukanet.com/barsy.help/110-admin/160-pos/payments2/index.html)). A failed second card keeps the first payment and locks the account with the rest due [DOC] ([POS terminal cases](https://docs.lukanet.com/barsy.help/120-posx/pos_terminal_cases.html)) | **supported (UI)**: "смесено плащане на всяка разделена сметка" [VENDOR PAGE] ([POS](https://www.zamboo.bg/pos.html)). From an outside app: **unknown** |
| P2.2 | As an alternative, the POS splits the open sale, so the app pays its own part as a separate, fully closed sale | S+U | Annex 29 т. 12 (annulments kept); Annex 42 т. 2.5 (traceability); [READING] lawful if each part is a complete sale | **needs sign-in**: `Accounts_divide` [INDEX]. In the UI: "Разделяне, сливане и клониране" [DOC] ([Сметка](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)) | **supported (UI)**: "Отделни сметки" [VENDOR PAGE] ([POS](https://www.zamboo.bg/pos.html)). Outside: **unknown** |
| P2.3 | When the app pays a share of the bill rather than named items, the POS registers it in a "ЧАСТИЧНИ ПЛАЩАНИЯ" department with the goods in "#" text. At the final payment, it registers all goods, then a value discount equal to the shares paid, with a "#" explanation | S+U | чл. 26а, ал. 1–2; чл. 32, ал. 1 | **not documented**: "ЧАСТИЧНИ ПЛАЩАНИЯ" and чл. 26а appear on no public page [NOT FOUND] | **not documented**. Fiscal departments are configurable [DOC] ([BackOffice](https://help.zamboo.bg/BackOffice/)); Zamboo's "ЧАСТИЧНО ПЛАЩАНЕ" is a payment on a credit sale [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)), not obviously чл. 26а |
| P2.4 | The POS never closes the unpaid rest with "резерв 2 – отложено плащане" on a ФУ | S+U | чл. 25, ал. 5; чл. 26б, ал. 1 | **not documented** | **not documented**. A deferred "Продажба кредит" exists [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)); whether it prints with резерв 2 is not stated |

| ID | Data Restro hands the POS | Why |
|---|---|---|
| D2.1 | Sale reference (УНП or account id) | Annex 29 т. 10 |
| D2.2 | Amount, minor units | чл. 26, ал. 1, т. 8 |
| D2.3 | Either the lines paid, or a flag "share of the bill" | picks P2.1/P2.2 vs P2.3 |
| D2.4 | Capture time and provider reference | as D1.4, D1.5 |
| D2.back | ФБ reference per payment; the sale's remaining amount | P1.4; Restro shows what is left to pay |

[READING] The law does not ask for the number of payers. Paying by named lines (P2.1 or P2.2) avoids the чл. 26а department, which neither POS documents. A "split the bill evenly" button would need P2.3.

### F3. Reservation deposit: counted against the bill, refunded, or forfeited

A guest books a table on the venue's reservation page (D101) and pays a deposit. The deposit is later counted against the bill, refunded on a timely cancellation, or kept after a no-show.

| ID | Requirement | Applies | Legal source | barsy | Mistral/Zamboo |
|---|---|---|---|---|---|
| P3.1 | At deposit capture, the venue's ФУ prints a ФБ in the "ЧАСТИЧНИ ПЛАЩАНИЯ" department, with the reservation in "#" text. VAT is due on receipt | S+U | ЗДДС чл. 25, ал. 7; чл. 25, ал. 1, т. 1, ал. 6; чл. 26а, ал. 1 | **partly**. A deposit on a client request is recorded "с фискален бон при СУПТО" [DOC] ([Плащане](https://docs.lukanet.com/barsy.help/210-dictionary/payment.html)). The reservation's "Капаро" field is "само информативно поле"; real payments go in its payments tab or come through a payment link [DOC] ([reservations](https://docs.lukanet.com/barsy.help/110-admin/160-pos/reservations/01-reservations-settings.html)). Whether a reservation payment is fiscalised: **not documented**. API: **needs sign-in** (`Payments_create`, `Reservations_getpaymentlink` [INDEX]) | **not documented**: the reservation screen has no deposit step [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)). The reservation-portal integration is marketed without details [VENDOR PAGE] ([portal](https://mistral.bg/%d0%bf%d0%be%d1%80%d1%82%d0%b0%d0%bb-%d0%b7%d0%b0-%d1%80%d0%b5%d0%b7%d0%b5%d1%80%d0%b2%d0%b0%d1%86%d0%b8%d1%8f/)) |
| P3.2 | Under (S), the reservation exists as a sale before the deposit is taken, so the deposit's ФБ carries a УНП. The night's sale is that sale or is linked to it | S | Annex 29 т. 9–10; чл. 26а, ал. 2. [NOT FOUND] how one УНП spans booking day and night (L17) | **supported (UI)** in shape: when a request or reservation becomes an account, its payments carry over and only the rest is paid [DOC] ([Плащане](https://docs.lukanet.com/barsy.help/210-dictionary/payment.html)). The УНП link: **not documented** | **unknown** |
| P3.3 | Counted against the bill: the final ФБ lists all goods, then a value discount equal to the deposit, with "#" text | S+U | чл. 26а, ал. 2; чл. 32, ал. 1 | **different mechanism documented**. Either the payment carries over (above), or a "Капаро" package card is sold on its own ФБ and later adds a negative line, so the final ФБ is items minus deposit [DOC] ([Отложено плащане / капаро](https://docs.lukanet.com/barsy.help/220-workflows/10_payments.html)). Fit with чл. 26а: L18 | **not documented** |
| P3.4 | A deposit captured while the club is closed is still fiscalised at capture, or the capture waits until it can be. Under (S), opening the sale needs ФУ contact within the last 2 h | S+U | чл. 25, ал. 6; Annex 29 т. 8 (б), (в); L4 | **not documented** | **unknown** |
| P3.5 | Refunded: a storno ФБ at the refund, citing the deposit's ФБ and УНП; a credit note within 5 days if an invoice was issued | S+U | чл. 31, ал. 1–2, 4; ЗДДС чл. 115, ал. 2 | **supported (UI, admin module only)**: storno of a single payment, such as a deposit refunded after a cancelled event, asks for УНП, receipt number, date and fiscal memory; "Все още функционалността не е налична в модул „Продажби"" [DOC] ([Сторно на плащане](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/07-storno_payment.html)). API: **not documented** | **supported (UI)** for storno in general [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)); deposits: **not documented** |
| P3.6 | Forfeited after a no-show: the POS can record whichever treatment the lawyer picks: leave the deposit's ФБ as is, storno it for "намаление на данъчната основа", or issue a credit note | S+U | ЗДДС чл. 25, ал. 7; чл. 115, ал. 2; чл. 31, ал. 1; [LAW, EU] CJEU C-277/05 ([EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62005CJ0277)); L6 | **not documented** | **not documented** |

| ID | Data Restro hands the POS | Why |
|---|---|---|
| D3.1 | Reservation id, date and time window, tables | P3.2 |
| D3.2 | Deposit amount and the text for the "#" field | чл. 26а, ал. 1 |
| D3.3 | Capture time and provider reference | чл. 25, ал. 6; P1.5 |
| D3.4 | On the night: the link from the reservation to the table's sale | чл. 26а, ал. 2; P3.2 |
| D3.5 | On refund: original ФБ and УНП, reason, refund time, provider refund reference | чл. 31, ал. 2, 4 |
| D3.6 | On no-show: the event and its time | P3.6 |
| D3.7 | Guest email, only if the venue uses an electronic receipt route | чл. 3, ал. 18–19; чл. 25, ал. 13 |
| D3.back | Deposit ФБ reference; later, the final sale's reference | P1.4 |

[READING] Unlike song requests, the reservation page collects an email: D101 sends confirmations by email. That gives the client data an electronic receipt needs (чл. 25, ал. 13). It also brings the page one element closer to an e-shop (see below).

### F4. Song requests: capture per backer, refund on skip, release

A guest places a hold on a song request, and others may join as backers. The DJ accepts and every backer's hold is captured, or the DJ skips after accept and the captures are refunded, or the request is never reached and the holds are released at the close of the service day (D99). A request can be made at a table or "online" without one (D100).

| ID | Requirement | Applies | Legal source | barsy | Mistral/Zamboo |
|---|---|---|---|---|---|
| P4.1 | Under (S), the song request enters the POS as an import when it is made, and the УНП is generated at the DJ's accept, the venue's commitment. Requests never accepted stay stored as declined | S | § 1, т. 19 ДР; Annex 42 т. 2.2–2.3; L14 | **needs sign-in**. A client request is not a sale: "складът и фискалът идват по-късно" [DOC] ([Клиентска заявка](https://docs.lukanet.com/barsy.help/210-dictionary/client-order.html)). [READING] It fits a request awaiting the DJ | **unknown** |
| P4.2 | The POS has an article "paid song request" whose price is the backer's amount, VAT 20 % | S+U | ЗДДС чл. 9, ал. 1; чл. 66, ал. 1; Annex 42 т. 2.3 (lines per т. 18.3); L8 | **not documented**. `original_current_price` is optional on `Accounts_place` order rows [REPO 10-08]; its meaning is unverified | **unknown** |
| P4.3 | Each backer's capture is a separate payment with its own ФБ, carrying the request's УНП | S+U (УНП: S) | Annex 29 т. 10; чл. 25, ал. 1, т. 1, ал. 6 | **needs sign-in** (as P2.1). [READING] One account per backer, each closed with its payment, would give each its own УНП, which is also lawful | **unknown** |
| P4.4 | The receipts reach backers who may sit at no table: on paper at a fixed point, or electronically only under чл. 3, ал. 18–19 | S+U | чл. 25, ал. 6, 13; ЗДДС чл. 118, ал. 1, 1а; L3, L24 | **not documented** | **not documented** |
| P4.5 | Skip after accept: one storno ФБ per captured payment, with the УНП, at the refund | S+U | чл. 31, ал. 1–2, 4; Annex 29 т. 10 ("включително и в Сторно-ФБ"); reason: L19 | **needs sign-in**: `Accounts_storno` [INDEX]. UI partial storno [DOC] ([Сторно](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/05-storno.html)) | **supported (UI)** storno [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)); outside: **unknown** |
| P4.6 | Release of a hold never captured: no ФБ, no storno. Any request opened in the POS is annulled and kept, within the same service day | S | Annex 29 т. 12, 15, 18.5; Annex 42 т. 2.3; L7 | **not documented** | **unknown** |

| ID | Data Restro hands the POS | Why |
|---|---|---|
| D4.1 | Song request id; the POS article code for a paid song request | Annex 42 т. 2.3, 2.4 |
| D4.2 | Table reference, or the "online" marker | D100; Annex 42 т. 2.3 |
| D4.3 | Per backer: amount (minor units), capture time, provider reference | P4.3 |
| D4.4 | Skip after accept: time, reason category, the captures refunded | P4.5 |
| D4.5 | Release at close: time, requests released | P4.6 |
| D4.back | УНП at accept; one ФБ reference per backer | P1.4 |

[READING] The law needs no guest identity here, and the backer's display name does not need to reach the POS. One busy service day can mean hundreds of small paper receipts printed for backers who never come to the bar. P4.4 is where the lawyer's answers to L3 and L24 matter most. A second point concerns Restro's own rules. The POS article in P4.2 would carry a price Restro sets, while Restro rule 5 and the POS-venue rule (D87, D89, D90, D92) forbid Restro to re-price POS items. A song request is not a POS menu item, but the boundary should be stated in a decision.

### F5. Refunds and reversals of any app payment

| ID | Requirement | Applies | Legal source | barsy | Mistral/Zamboo |
|---|---|---|---|---|---|
| P5.1 | A storno ФБ from the ФУ that printed the original, with the original ФБ number, date and time, the fiscal-memory number, the reason, "СТОРНО" and, under (S), the УНП | S+U | чл. 31, ал. 1–2 | **supported (UI)**: storno asks for reason, УНП, receipt number, date, fiscal memory [DOC] ([Сторно](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/05-storno.html)). API: **needs sign-in**: InputStornoData has `storno_reason`, `unp`, `receipt_num`, `receipt_date`, `fm_num`; there is also `Accounts_getstornoreasons` [INDEX] | **supported (UI)**: "СТОРНО", "Основание", "СТОРНО ФИСКАЛЕН БОН" [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)). Outside: **unknown** |
| P5.2 | Partial storno by line or amount | S+U | чл. 31, ал. 1, 4 ("изцяло или частично") | **supported (UI)**: "всички артикули от една сметка или само избрани"; no article twice [DOC] ([Сторно](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/05-storno.html)). API: **needs sign-in** | **supported (UI)**: "Избрано за сторно" [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)) |
| P5.3 | Timing: the storno at the refund; an operator-error storno by the 7th of the next month | S+U | чл. 31, ал. 4 | **supported (UI)**: operator error only until the 7th [DOC] ([Сторно](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/05-storno.html)) | **not documented** |
| P5.4 | A storno for money returned to the guest's card through the payment provider is not blocked by the drawer's cash | S+U | чл. 31, ал. 3 (cash check), ал. 3а (card exception for ИАСУТД only); L10, L20 | **conflicts**: "сторно документът може да бъде издаден единствено в брой" and needs cash, except for operator error. barsy's own reading is that a refund "по банков път" needs no storno receipt [DOC] ([FAQ 7.1.23](https://docs.lukanet.com/barsy.help/200-faq/200-sales/w-storned_orders_withCard_by_cash.html); [storno limits](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/specifics_and_limitations_storno.html)) | **not documented** |
| P5.5 | A reversal before settlement counts as a refund of a registered payment: a storno if a ФБ was printed | S+U | чл. 31; L10 | **not documented** | **not documented** |
| P5.6 | The storno is logged with operator and УНП and appears in the storno export table | S | Annex 29 т. 13, 15, 18.4 | **supported (UI)**: recorded "като сторно операция в дневния отчет на фискалното устройство" [DOC] ([Сторно](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/05-storno.html)). Export: **not documented** | **not documented** |
| P5.7 | For an invoiced sale, a credit note within 5 days; a ФУ may issue it only for a cash refund | S+U | ЗДДС чл. 115, ал. 1–3; чл. 31, ал. 9, 9а | **not documented** | **supported (UI)**: a bank sale's storno ends in "Кредитно известие" [DOC] ([Ресторант](https://help.zamboo.bg/restaurant)) |

| ID | Data Restro hands the POS | Why |
|---|---|---|
| D5.1 | Original УНП and ФБ reference (number, date, time, ФУ, fiscal memory) | чл. 31, ал. 2 |
| D5.2 | Lines or amount refunded | P5.2 |
| D5.3 | Reason category: "рекламация или връщане", "операторска грешка" or "намаление на данъчната основа" | чл. 31, ал. 1 |
| D5.4 | Refund time; provider refund or reversal reference | чл. 31, ал. 4; P1.5 |
| D5.back | Storno ФБ reference, or a refusal (for example, not enough cash) | P5.4 |

[DOC] barsy also documents a workaround for a guest who paid part by card and then refuses the whole account. Staff close the rest "fictitiously" in cash, then storno the whole value in cash, "за да се отрази правилно във фискалното устройство" ([POS terminal cases](https://docs.lukanet.com/barsy.help/120-posx/pos_terminal_cases.html)). [READING] This shows how cash-shaped a ФУ storno is. An automated refund through the payment provider has no documented counterpart in either POS.

### F6. Restro orders entering the POS

This flow is the precondition for F1, F2 and F4 under (S). For (U), Annex 42 does not bind. Orders could then stay in Restro, but the receipt still comes from the venue's ФУ at payment.

| ID | Requirement | Applies | Legal source | barsy | Mistral/Zamboo |
|---|---|---|---|---|---|
| P6.1 | Restro's order enters the POS at the guest's submission, or at the latest when the venue commits. The УНП is generated at import, or at confirmation if the process needs one | S | § 1, т. 19 ДР; Annex 42 т. 2.2; Annex 29 т. 9.1 | **supported** in shape, details **needs sign-in**. Four documented scenarios: client request, open account, account created and closed automatically ("Невъзможност за предварителна проверка"), stock transfer [DOC] ([web orders](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)). `Accounts_place`: no `account_id` creates a new account; rows carry `article_id` and `amount`; `account.uuid` deduplicates; `external_source` [REPO 10-08]. The page "Изпращане на поръчка като сметка към Barsy" is [NOT FOUND – sign-in] ([60-orders](https://docs.lukanet.com/barsy.api/integrations/60-orders.html)) | **unknown** for outside apps. Zamboo's own Web Menu does "Изпращане на поръчки към POS" [VENDOR PAGE] ([pricing](https://www.zamboo.bg/pricing-zamboo.html)) |
| P6.2 | The POS stores each import in full and unchanged, keeps declined requests, links every request to its УНП, and compares requested and confirmed items by kind, quantity and value | S | Annex 42 т. 2.1, 2.3, 2.4 | **not documented**: no public page mentions Annex 42, "чл. 52з" or "импорт на поръчки" [NOT FOUND] | **unknown** |
| P6.3 | A new round added to the table's open sale stays traceable before and after the import | S | Annex 42 т. 2.5 | **supported (API)**: `account_id` continues an account [REPO 10-08]. Traceability: **not documented** | **unknown** |
| P6.4 | Acceptance happens in the POS, or the POS confirms it. Restro shows "accepted" only after the POS says so | S | § 1, т. 19 ДР; Annex 42 т. 2.2 | **supported (UI)**: approval per cash desk, modes "Без одобрение", "Ръчен", "Директно след плащане" ("При липса на плащане, поръчката не се обработва") and "Автоматичен" [DOC] ([approval](https://docs.lukanet.com/barsy.help/110-admin/160-pos/accounts/04-approval-orders.html)). Accounts awaiting approval appear under "За потвърждение" [REPO 10-08] ([zones](https://docs.lukanet.com/barsy.help/120-posx/110-zones.html)). Whether a payment sent through the API counts as "плащане": **not documented** | **unknown**. Its own web menu tracks order statuses [VENDOR PAGE] ([pricing](https://www.zamboo.bg/pricing-zamboo.html)) |
| P6.5 | A declined or cancelled open sale is annulled and kept in full | S | Annex 29 т. 12, 18.5 | **not documented** | **unknown** |
| P6.6 | The import prints no service slip on the ФУ. [READING] Kitchen and bar printers that are not the ФУ are outside the text | S+U | чл. 7а, ал. 2; Annex 29 т. 11 | **supported (UI)**: a new account is routed to the screens and printers set for new orders [DOC] ([public settings](https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/settings.html)) | KDS shows web orders [VENDOR PAGE] ([pricing](https://www.zamboo.bg/pricing-zamboo.html)) |

| ID | Data Restro hands the POS | Legal source | barsy field |
|---|---|---|---|
| D6.1 | Request id, assigned by Restro, stable, also the idempotency key | Annex 42 т. 2.3, 2.4 | `account.uuid` [REPO 10-08] |
| D6.2 | Source identifier and name ("ЕИК/идентификатор и наименование на заявител"). Who the "заявител" is: L13 | Annex 42 т. 2.3 | `external_source` [REPO 10-08] |
| D6.3 | Method: API (recorded by the POS) | Annex 42 т. 2.3 | n/a |
| D6.4 | Guest's submit time (the POS records the import time itself) | § 1, т. 19 ДР; Annex 42 т. 2.3 | not documented |
| D6.5 | Lines per т. 18.3: POS item code, name, quantity, unit price, discount, VAT rate and amount, line total. Prices are the POS's own, unchanged (Restro rule 5) | Annex 42 т. 2.1 ("непроменено съдържание"), 2.3; Annex 29 т. 18.3 | `article_id`, `amount`, `modificators`, `supplements` [REPO 10-08] |
| D6.6 | Table reference | Annex 42 т. 2.3 (sale data) | not confirmed; barsy places have unique URLs for QR codes [DOC] ([QR orders](https://docs.lukanet.com/barsy.help/110-admin/100-catalog/public/qr-orders.html)) |
| D6.7 | Change and cancel messages for the same request id | Annex 42 т. 2.5 | `account_id` continues [REPO 10-08] |
| D6.back | Accepted, declined or partly confirmed, with the УНП | Annex 42 т. 2.4 | `unp` on AccountData [INDEX] |

[READING] Payments are not part of the т. 2 import data (tables 18.1 and 18.3 only); payment data (table 18.2) is listed only for e-shop imports under т. 1.4. For an in-venue order, the payment is entered in the POS as a payment (Annex 29 т. 10), separately from the order. Whether an import may carry an already captured payment is [NOT FOUND].

---

## Support at a glance: barsy is half documented, Mistral not at all

| Capability Restro needs | barsy | Mistral/Zamboo |
|---|---|---|
| Place an order from an outside app | supported (API named; details need sign-in) | unknown (own Web Menu only) |
| Approval inside the POS before work starts | supported (UI, four modes) | unknown |
| Register an outside card payment and print the ФБ | needs sign-in (only at closing; which printer unknown) | unknown (UI: "КАРТА", "ФИС.БОН") |
| Readiness check before capture | not documented | unknown |
| Several payments on one open sale | needs sign-in | supported (UI only) |
| "ЧАСТИЧНИ ПЛАЩАНИЯ" department, чл. 26а | not documented (own "Капаро" method instead) | not documented |
| Reservation deposit with a fiscal receipt | not documented (client-request deposit: yes, UI) | not documented |
| Storno with original receipt data | supported (UI); API needs sign-in | supported (UI) |
| Storno of a refund to a card | conflicts (cash only; "по банков път" = no storno) | not documented |
| Annex 42 import duties | not documented | unknown |
| Electronic fiscal receipt | not documented | not documented |
| Read back the УНП | needs sign-in (`unp` on account) | unknown |
| On the NRA list | unconfirmed ("barsy SUPTO" variant exists) | unconfirmed ("Мистрал v3 по наредба H18" exists) |

[READING] With barsy, the open points are mostly questions of reading: a signed-in reading of `Accounts_place`, `Accounts_storno`, `Payments_create`, `Accounts_getpaymentlink` and the integration pages would settle half the "needs sign-in" cells. Martin signs in himself; agents do not type passwords. Three points need Lukanet's answer whatever the docs say: authorisation under чл. 52з, ал. 5; Annex 42; and card refunds. With Mistral, everything waits on T69.

---

## An e-shop is a legal status, and song requests as designed are not one

### The definition has four cumulative elements

[LAW] "Електронен магазин" is defined only in ЗДДС § 1, т. 87. It is software reached through the internet "при използване на уеб-браузер или мобилно приложение". Through it goods or services are sold "посредством сключване на договор от разстояние по чл. 45 от Закона за защита на потребителите". The client can choose "чрез потребителска кошница или по друг начин", and the software must offer the possibility "за предоставяне на информация за контакт с купувача, адреса на доставка и метода за плащане". Н-18 uses the term without defining it again. [LAW] A distance contract is one concluded "като част от организирана система за продажби от разстояние ... без едновременното физическо присъствие на търговеца и потребителя, чрез изключителното използване на едно или повече средства за комуникация от разстояние" (ЗЗП чл. 45). [LAW, EU] The Consumer Rights Directive's recital 20 adds two points ([CRD, BG](https://eur-lex.europa.eu/legal-content/BG/TXT/HTML/?uri=CELEX:32011L0083)). A contract "договорен в търговския обект на търговеца и ... окончателно сключен чрез използването на средства за комуникация от разстояние" is not a distance contract. And an "организирана система" includes systems "предлагани от трети лица", such as an online platform. [LAW, EU] The Commission's guidance says a later meeting at delivery or payment does not change the classification, and that a binding booking for a set time is "вероятно" a distance contract ([Guidance 2021/C 525/01](<https://eur-lex.europa.eu/legal-content/BG/TXT/HTML/?uri=CELEX:52021XC1229(04)>)). [NRA] The NRA paraphrases т. 87 as a list of things that "трябва да има" ([NRA, e-traders](https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page.turgovia-v-internet-i-e-magazini/page-Iziskvania-kum-e-turgovciete)). [READING] Read literally, all four elements must be present (L22). [LAW] ЗЕТ has its own, separate notion: an information-society service provided "от разстояние", meaning "страните не се намират едновременно на едно и също място" (ЗЕТ чл. 1, ал. 3; § 1, т. 1). That is a test of place, and it points even more clearly to "not at a distance" for a guest inside the club.

### What being an e-shop means for a venue

[LAW] The venue, not Restro, reports the e-shop to the NRA before it starts. Every "лице по чл. 3" selling through an e-shop files Annex 33 electronically with a qualified e-signature, "независимо дали използва собствен домейн, нает домейн или домейн на друго лице, предоставящо платформа" (чл. 52м, ал. 1). It files separately for each e-shop (ал. 2), reports changes and termination within 7 days (ал. 3–4), and appears on a public list (ал. 5, Annex 36). [NRA] The NRA says the filing is mandatory for e-shops that "приемат плащания, за които се изисква издаване на фискален бон" ([NRA, e-traders](https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page.turgovia-v-internet-i-e-magazini/page-Iziskvania-kum-e-turgovciete)), and card payments are such payments. [LAW] Annex 33 would name Restro either as an online platform (т. 4.1: name, URL, operator, ЕИК) or as host, maintainer and software of a venue domain (т. 4.2). [NOT FOUND] No duty falls on the platform operator itself under Н-18 Chapter 7 "г". [LAW] Breaches of чл. 118 or the ordinance carry 6,000–20,000 лв. for a company, or 1,000–4,000 лв. when no revenue goes unreported (ЗДДС чл. 185, ал. 2, 1).

The gain is one receipt route. [LAW] An e-shop seller may issue the fiscal receipt electronically if it "разполага с данни за клиента" and keeps "начина, датата, часа и минутата на предоставяне на бона" (чл. 3, ал. 19). [READING] Unlike чл. 3, ал. 18, this route does not need listed software. [LAW] For services, the receipt is still due "най-късно при плащане на услугата" (чл. 25, ал. 7–8). [LAW] Annex 16 lists fiscal-device types "11 ЕКАФП за електронен магазин" and "21 ФПр за електронен магазин". [READING] A venue using the e-shop route may need such a device; its fiscal-service company decides.

Being an e-shop does **not** open the alternative regime. [LAW] That regime needs both "чрез електронен магазин" and a "неприсъствено плащане" (чл. 3, ал. 17; ЗДДС чл. 118, ал. 3б), and т. 96 fails in every Restro flow. Under (S), it also changes the import shape. [LAW] E-shop orders are imported under Annex 42 т. 1, not т. 2 (чл. 52з, ал. 11). The source is then "уеб адрес на електронния магазин", the key is the e-shop's own order number, and payment data per table 18.2 is included (т. 1.4).

[LAW] The consumer-law duties follow from the distance contract, whether or not the page is an e-shop. ЗЗП чл. 47 sets the pre-contract information. ЗЗП чл. 49, ал. 2 (in force 27.09.2026) puts the key information next to the button, which carries "само думите „поръчка със задължение за плащане"" or an equivalent; otherwise "потребителят не е обвързан" (ал. 3). Чл. 49, ал. 8 requires confirmation "на траен носител". Чл. 50 gives 14 days to withdraw. The new чл. 52а (in force 24.09.2026) requires a withdrawal function "откажете се от договора тук", available for the whole withdrawal period. ЗЕТ чл. 8 and 10 add the technical steps, error correction and an electronic confirmation of receipt of the order.

### Can paid song requests be an e-shop?

| Element ([READING] for every cell) | (a) Inside, at a table | (b) Inside, no table ("online", D100) | (c) Outside the club |
|---|---|---|---|
| Web software; a service sold; choice of a song | met | met | met |
| Organised system for distance sales | met (a standing page; platforms count) | met | met |
| No simultaneous physical presence (ЗЗП чл. 45) | doubtful: guest and staff are in the same trade site; ЗЕТ's place test points to presence | doubtful, as (a) | met while the guest is outside |
| Contact data possible | **not met** (D99: optional display name only) | not met | not met |
| Delivery address possible | **not met** (service performed in the club) | not met | not met |
| Payment method choice | met at the provider's checkout | met | met |
| ЗДДС § 1, т. 96 "different place" (alternative regime) | not met | not met | not met: the song is played in the club |

[READING] As designed, the request page is probably **not an e-shop for any guest**. For guests inside the club, two elements fail independently. For guests outside, only the contact and delivery-address elements fail. Whatever the answer, т. 96 fails, so a fiscal receipt from the venue's ФУ at capture stays due in all three cases (L25). The page would become an e-shop if a guest outside the club concluded the contract and the page offered an email and an address field. The gain would be electronic receipts without listed software (чл. 3, ал. 19). The cost would be the Annex 33 filing, 7-day updates, the public listing, possibly an e-shop device type, and the delivery log. One page serves (b) and (c), and Restro cannot tell where an "online" guest stands. [READING] A venue that opens requests to guests without a table should assume the consumer-law duties apply. That means the order-button wording, a durable-medium confirmation (L27), and the withdrawal function until the song is played. [LAW] The right of withdrawal is lost under ЗЗП чл. 57, т. 1 only once the service is "предоставена напълно", with the guest's express prior consent. Т. 12 (leisure "на конкретна дата") is read narrowly by the Commission ([Guidance](<https://eur-lex.europa.eu/legal-content/BG/TXT/HTML/?uri=CELEX:52021XC1229(04)>)). [LAW, EU] Т. 11 (public auction) is unlikely: online bidding without the chance to attend in person "не може да се квалифицира като „публичен търг"" (same Guidance). These questions are L26. [READING] D99 lets a guest cancel only when told of a duplicate, so a cancel-and-release control before the lock window would be a design change for Martin.

[READING] The reservation page (D101) sits closer to the line. It collects an email (contact data) and payment, and a booking made from home is "вероятно" a distance contract under the Commission's guidance. Only the delivery-address element and т. 96 stand in the way. The table is used in the club, so the alternative regime stays closed either way (L4). L22 asks the lawyer to rule on both pages.

**Paid song requests are not gambling.** [LAW] "Хазарт е всяка игра на случайността, в която има залог и може да се получи печалба или да се загуби залогът" (ЗХ чл. 2, ал. 1). [READING] Play order follows the backers' amounts and the DJ's actions, not chance. A backer pays only for a song that is played; holds on unplayed requests are released; nothing is won beyond the service bought. A random draw among backers, a prize, or keeping the money of requests not played would change that (L28).

---

## Conclusion

The fiscal law does not stop Restro from taking card money in a club, but it moves the hard part into the POS. Every capture must be matched by a receipt from the venue's own device at that moment. Under listed software, every order and song request must already sit in the POS when the venue commits. That makes the POS integration a synchronous, two-way, write-heavy link: readiness, then capture, then registration, with a storno path behind it. It is the opposite of the read-only connector Restro has built so far. The decision that unlocks everything is therefore Martin's, not the lawyer's: whether and which POS writes go on the rule 7 allowlist. That decision is best taken per POS system, after a signed-in reading of barsy's API and Mistral's answer to T69.

Three findings change the plan. First, barsy's storno is cash-only, and barsy reads a bank refund as needing no storno. Until the lawyer answers L10 and L20, an automated refund to a card has no documented fiscal shape in either POS. Refunds on skip (D99) and deposit refunds (D101) depend on it. Second, barsy's payment link through the venue's own vPOS could keep money, payment record and receipt inside barsy. It is worth asking about before Restro builds its own payment-provider connector for barsy venues. Third, the e-shop route is a choice the platform can make or avoid by adding or omitting an email field. It buys electronic receipts at the cost of an NRA filing per venue, and it never removes the fiscal receipt itself.

---

## Questions for the lawyer (new; continue after L12)

Each can be answered yes or no, or by naming the condition. The e-shop presence question for guests inside the venue is already L2.

**L13.** (Н-18 приложение № 42, т. 2.3)
BG: Кой е „заявител" по т. 2.3 при импорт на поръчка от Restro: Restro (с неговия ЕИК), каналът на заведението или гостът?
EN: Who is the "заявител" in Annex 42 т. 2.3 for an order imported from Restro: Restro (by its ЕИК), the venue's channel, or the guest?

**L14.** (Н-18 § 1, т. 19 ДР; приложение № 42, т. 2.2)
BG: Ако Restro автоматично приеме поръчка от името на заведението, или диджеят приеме платена заявка за песен в Restro, това „поемане на ангажимент" ли е, което трябва вече да е отразено в СУПТО?
EN: If Restro auto-accepts an order for the venue, or the DJ accepts a paid song request in Restro, is that the "commitment" that must already be inside the listed software?

**L15.** (приложение № 29, т. 6, 9 и 18.2)
BG: Може ли технически „оператор за импорт", без две имена, да е операторът в УНП и в таблицата за плащания за плащанията от приложението?
EN: May a technical "import operator" without two names be the operator in the УНП and in the payments table for app payments?

**L16.** (Н-18 чл. 25, ал. 6; приложение № 29, т. 8 и 10)
BG: Нарушение ли е, ако сумата се усвои (capture), докато ФУ е без връзка, и бонът се отпечата при възстановяване на връзката? Кой ред е допустим: първо усвояване, после регистриране, или обратното със сторно при операторска грешка?
EN: Is it a breach to capture while the ФУ is offline and print when it returns? Which order is acceptable: capture then register, or register then capture with an operator-error storno if the capture fails?

**L17.** (Н-18 чл. 26а; приложение № 29, т. 9–10)
BG: Как един УНП свързва депозит, платен в деня на резервацията, със сметката в нощта на посещението: една продажба, отворена няколко дни, или две свързани продажби?
EN: How does one УНП link a deposit paid on booking day with the bill on the night: one sale open across days, or two linked sales?

**L18.** (Н-18 чл. 26а, ал. 1–2)
BG: Отговаря ли на чл. 26а методът на barsy: депозитът се продава като отделен артикул „Капаро" с фискален бон, а в крайния бон се добавя отрицателен ред за същата сума? Или е задължителен департамент „ЧАСТИЧНИ ПЛАЩАНИЯ" със стойностна отстъпка?
EN: Does barsy's method (the deposit sold as a separate "Капаро" item on its own receipt, then a negative line on the final receipt) meet чл. 26а, or is the ЧАСТИЧНИ ПЛАЩАНИЯ department with a value discount required?

**L19.** (Н-18 чл. 31, ал. 1)
BG: Кое основание по чл. 31, ал. 1 се посочва в сторно, когато платена и приета заявка за песен не е изпълнена?
EN: Which чл. 31, ал. 1 reason applies to the storno when a paid, accepted song request is not played?

**L20.** (Н-18 чл. 31, ал. 1 и 4)
BG: barsy приема, че при връщане на сума „по банков път" не се издава сторно бон. Връщането по картата на госта чрез доставчика на платежни услуги такова връщане ли е? Ако да, как се коригира оборотът по първоначалния бон?
EN: barsy holds that a refund "by bank" needs no storno receipt. Is a refund to the guest's card through the payment provider such a refund? If yes, how is the turnover on the original receipt corrected?

**L21.** (Н-18 чл. 52и, ал. 1)
BG: Ако Restro подава поръчки и плащания към СУПТО, попадат ли сървърите му сред „устройствата, които работят с използвания в обекта софтуер", до които заведението трябва да осигури достъп при проверка?
EN: If Restro feeds orders and payments into the listed software, are its servers "devices working with the software used in the site", to which the venue must give inspectors access?

**L22.** (ЗДДС § 1, т. 87)
BG: Кумулативни ли са елементите „информация за контакт с купувача, адреса на доставка и метода за плащане", така че страница без поле за адрес (заявки за песни; резервация с депозит и имейл) не е „електронен магазин"?
EN: Are the contact, delivery-address and payment-method elements cumulative, so that a page without an address field (song requests; a reservation with deposit and email) is not an e-shop?

**L23.** (Н-18 чл. 52м, ал. 1; приложение № 33)
BG: Ако страницата е електронен магазин, трябва ли заведението да подаде приложение № 33 преди първото плащане, с Restro като „онлайн платформа" (т. 4.1) или като хостинг и софтуер (т. 4.2)?
EN: If the page is an e-shop, must the venue file Annex 33 before the first payment, naming Restro as an online platform (т. 4.1) or as host and software (т. 4.2)?

**L24.** (Н-18 чл. 3, ал. 19; чл. 25, ал. 8 и 13)
BG: Ако заведението продава чрез електронен магазин, може ли да издава електронен фискален бон от своето ФУ, без СУПТО по списъка, изпратен на имейла, въведен от госта?
EN: If the venue sells through an e-shop, may it issue an electronic fiscal receipt from its ФУ, without listed software, sent to an email the guest enters?

**L25.** (ЗДДС § 1, т. 96; Н-18 чл. 3, ал. 17)
BG: Правилно ли е, че алтернативният режим е неприложим и за заявка за песен, платена от гост извън клуба, защото песента се пуска в търговския обект?
EN: Is it right that the alternative regime is also unavailable for a song request paid by a guest outside the club, because the song is played in the trade site?

**L26.** (ЗЗП чл. 57, т. 1, 11 и 12; чл. 52а)
BG: При договор от разстояние за платена заявка за песен отпада ли правото на отказ след пускането ѝ, при изрично предварително съгласие? Важи ли т. 12? Нужна ли е функция за отказ по чл. 52а до пускането?
EN: For a distance contract for a paid song request, is the right of withdrawal lost once it is played, with express prior consent? Does т. 12 apply? Is a чл. 52а withdrawal function needed until it is played?

**L27.** (ЗЗП чл. 49, ал. 8; § 13, т. 32)
BG: Без имейл на госта, потвърждение, показано в браузъра с възможност за изтегляне, „траен носител" ли е?
EN: Without the guest's email, is a confirmation shown in the browser, with a download option, a durable medium?

**L28.** (ЗХ чл. 2, ал. 1; § 1, т. 1 ДР)
BG: Потвърждавате ли, че платена опашка за песни, подредена по сумите на гостите, при която неизпълнените заявки се освобождават без плащане, не е хазарт?
EN: Do you confirm that a paid song queue ordered by guests' amounts, where requests not played are released unpaid, is not gambling?

**L29.** (ЗДДС чл. 118)
BG: Променя ли проектът на ЗИД на ЗДДС (обществена консултация 12733-K, до 23.10.2026) чл. 118 или задълженията на ползвателите на СУПТО?
EN: Does the draft amendment of the ЗДДС (consultation 12733-K, until 23.10.2026; [strategy.bg](https://www.strategy.bg/bg/public-consultations/12733)) change чл. 118 or the duties of persons using listed software?

## Questions for Lukanet (barsy)

To helpme@lukanet.com, after Martin's signed-in reading of the API pages named above.

1. Is barsy SUPTO on the NRA list under ЗДДС чл. 118, ал. 16 (name, version, declaration number)? Which pilot venues run the SUPTO variant?
2. Do orders sent through `Accounts_place` or `Clientorders_create` by a third-party ordering app meet Н-18 чл. 52з, ал. 10 and Annex 42 т. 2: stored source, method and external request id; declined requests kept; requested and confirmed items compared? Do you authorise such apps under чл. 52з, ал. 5, and how?
3. When an API caller closes an account with a card-type payment, does barsy print the ФБ on the venue's fiscal device? On which one, and through which cash desk? What happens if the device is offline: does the close fail? What does `print_receipt` do?
4. Can an API caller ask, before taking the guest's money, whether the account's fiscal device is ready to print (Annex 29 т. 8)?
5. Can the API add a payment to an open account without closing it, so that one account takes several payments, each with its own ФБ carrying the same УНП? Is that what `Payments_create` does?
6. Does barsy support a "ЧАСТИЧНИ ПЛАЩАНИЯ" department under Н-18 чл. 26а? If not, is the "Капаро" package card your recommended way to count a deposit against a bill?
7. Is a payment on a reservation fiscalised as a payment on a client request is? Can the API attach a fiscalised payment to a reservation or client request?
8. Does `Accounts_storno` support partial storno by article and quantity, and the storno of a single payment? Which payment type does it print? Can it document a refund made to a card through the payment provider without cash in the drawer?
9. How is the payment-method type "Карта(неприсъствена)" fiscalised?
10. Does a link from `Accounts_getpaymentlink` or `Reservations_getpaymentlink`, paid through the venue's own myPOS vPOS, close the account and print the ФБ automatically? Can the guest be redirected back to another web app afterwards?
11. Can barsy issue an electronic fiscal receipt under Н-18 чл. 3, ал. 18 or ал. 19?
12. Which operator code goes into the УНП for an account created through the API? Can a declined or cancelled API account be annulled and kept (Annex 29 т. 12)?
13. Is there a test installation separate from live venues (Annex 29 т. 20)?

## Questions for Mistral Software (T69)

To office@mistral.bg (fiscal service: fiskal@mistral.bg; [contacts](https://www.zamboo.bg/contacts.html)).

1. Which product runs at the pilot venue, Zamboo or Мистрал v3, and which version? Is it on the NRA list under ЗДДС чл. 118, ал. 16 (type, version)?
2. Is there an API for third parties (protocol, authentication, documentation, test installation, terms, cost)? What does the Back Office screen "Външни системи" do?
3. Can an outside app read the menu and post an order to a table or bill, as Zamboo Web Menu does? Does the order wait for approval in the POS?
4. Can an outside app register a card payment captured online and make Zamboo print the ФБ at that moment, with a chosen payment type? On which fiscal devices and drivers? Can it first check that the device is ready?
5. Does Zamboo meet Annex 42 т. 2 for imported orders (source, method, request id, declined requests kept, requested vs confirmed)?
6. Does Zamboo support a "ЧАСТИЧНИ ПЛАЩАНИЯ" department under Н-18 чл. 26а for deposits and part payments? Does "Продажба кредит" close with "резерв 2"?
7. Can an outside system start a storno, full or partial, of an online-paid sale? How does Zamboo document a refund to a card without cash in the drawer?
8. Are there webhooks, or polling, for order status, the УНП and the receipt number? Does Zamboo issue electronic fiscal receipts?
9. Does the myPOS partnership include online payments tied to Zamboo receipts?
