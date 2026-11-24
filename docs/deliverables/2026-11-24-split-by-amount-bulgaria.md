# Split by amount: is the Spanish way possible in Bulgaria?

Written 2026-11-24. Research for the split-by-amount grilling (map #29). Builds on `2026-10-18-split-payments.md` (here "the 10-18 file"), which it cites for what that file already settled. Planning research only, not legal advice.

**Tags on every fact**
- **[LAW]** the published text of a law or regulation (lex.bg consolidated texts, BOE).
- **[SCHEME]** a card scheme's own rule book (Visa Rules, 18 April 2026, as read for the 10-18 file).
- **[DOC]** official documentation: a tax agency's technical pages, a vendor's docs, or open-source driver code.
- **[VENDOR PAGE]** official but marketing or help-centre text.
- **[SECONDARY]** a third-party copy or summary; used only where the primary text could not be read.
- **[READING]** my interpretation. Not a fact.
- **[NOT FOUND]** searched; the source is silent or could not be read. Not assumed to exist.
- **(extract)** after a tag: read only as a search-engine snippet or summary, not on the page itself.

**Words** (GLOSSARY.md). **Bill**: everything open at a table, however many POS bills sit behind it. **POS bill**: one bill as the POS holds it. **Payment table**: a POS table only Restro uses, where lines are moved to be paid and closed. **Split**: moving chosen items onto a new POS bill. **Part payment**: a payment that leaves its POS bill open with something still owed. **Group payment**: several guests' cards settling one bill, or one share of it, together. **Hold**, **capture**, **release**: money reserved on a card, taken, or let go. "Split by amount" is only the grilling's working name. In glossary words it is either a group payment (model a) or a part payment (model b), never a split.

---

## Summary for Martin

**Yes, in one form: model (a), the group payment.** Each guest types an amount and confirms it with their bank; Restro holds it on their card, untaken. When the holds reach the total, the POS closes the bill once, with one card payment per guest, and prints one fiscal receipt. Seconds later Restro takes every held amount. For the guests it feels like Spain: dial 25 EUR, pay, and the bill is paid when the amounts add up.

**What Spain really does.** Each guest's card is most likely charged at once. The bill stays open in the till, and one ticket prints at the end. That works because the Spanish invoice belongs to the meal, not to each payment, and no fiscal printer was found there.

**The one difference that matters.** Here a fiscal device must print a receipt for every payment, at the moment of the payment. Charging guest 1 and waiting for guest 4 leaves guest 1's money without a receipt: the case the law fines. Holds avoid it.

**"Pay 25 EUR and leave while the others stay"** (model b) needs the special "part payments" receipt form, or moving fractions of lines. No POS we know documents either.

**For the lawyer or accountant** (interpretation only): is one receipt with several card payments fine, and does a capture seconds after the receipt count as "at the payment"? **For Mistral** (facts only they know): do their POS and the pilot's fiscal device accept several card payments in one close?

---

## 1. How the Spanish practice works

### The waitress's terminal keeps the bill, each card pays its part

- **[VENDOR PAGE]** myPOS in Spain: staff split one bill into several card payments on the terminal. Each person pays in turn. The terminal shows what is paid and what is still owed, and all payments stay linked to one bill. After each payment a QR code opens that payment's digital receipt. The page never mentions a ticket or factura. https://www.mypos.com/es-es/blog/pagos/novedades-en-tu-dispositivo-tpv-division-de-cuenta-y-recibos-digitales-con-qr
- **[VENDOR PAGE] (extract)** The same myPOS feature lets each person add a tip to their own payment. Same URL.
- **[VENDOR PAGE]** Getnet (Santander), October 2025: its new terminal software can "divide the bill between several diners" and take card tips. https://www.santander.com/es/sala-de-comunicacion/notas-de-prensa/2025/10/getnet-lanza-una-nueva-version-de-su-tpv-para-potenciar-el-negocio-de-pymes-pequenos-comercios-y-autonomos
- **[SECONDARY] (extract)** Teya: split one transaction equally or by different amounts, each part by card; the terminal can print individual receipts and a summary. https://finantres.com/?p=475917
- **[VENDOR PAGE]** Qamarero (a Spanish till app): a table can be paid per person or per product. Unpaid items stay open for the next part. On closing, the final ticket with the VAT breakdown prints automatically. https://intercom.help/qamarero-9e4c4f5026e3/es/articles/9347123-como-cobrar-una-mesa
- **[VENDOR PAGE] (extract)** Square, Spanish help: split payments must finish within 5 minutes, or the earlier payments of that check may be voided. https://squareup.com/help/es/es/article/5097-process-split-tender-payments-with-square
- **[NOT FOUND]** Any page from Redsys, CaixaBank/Comercia, BBVA, Sabadell or Paycomet on split payments. Any page saying whether each guest's part is an ordinary sale or a hold. Anything on overpayment or on who pays the remainder.
- **[READING]** Each guest's card is most likely an ordinary sale, charged at once. The bill's state lives in the till or terminal, not in the card network. No page read says so outright. Square's 5-minute rule shows at least one product treats earlier parts as provisional until the total is reached, which is closer to Restro's model (a) than to a plain sale.

### One simplified invoice, when the meal is done

- **[NOT FOUND]** Any source saying a ticket is issued for each part payment. Qamarero documents one final ticket (above). myPOS gives a receipt per payment, but its fiscal status is not stated.
- **[SECONDARY]** A Qamarero blog for diners claims bars must give each consumer a receipt; it cites no law. https://www.qamarero.com/blog/pagar-por-separado-en-un-bar-como-dividir-la-cuenta/
- **[LAW]** RD 1619/2012 art. 4.1: a simplified invoice is allowed up to 400 EUR, VAT included. Art. 4.2.e raises this to 3,000 EUR for restaurants, bars and cafés, and for food or drink consumed on the spot. https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696
- **[LAW]** Art. 7.1 lists the content of a simplified invoice: number, issue date, issuer's tax number, description, total, tax rate. Neither art. 6 nor art. 7 has a payment-method item. The only payment item is the date of an advance payment (arts. 6.1.i, 7.1.c). The full list was not re-read line by line. Same URL.
- **[LAW]** Art. 11.1: invoices are issued "en el momento de realizarse la operación" (when the operation is made). Same URL.
- **[LAW]** RD 238/2026 (25 March 2026) amended RD 1619/2012, as Orden HAC/1028/2026 states. That order concerns business-to-business e-invoicing. Whether arts. 4, 7 or 11 changed was not checked; the consolidated BOE page showed the wording above. https://www.boe.es/boe/dias/2026/10/05/pdfs/BOE-A-2026-20587.pdf
- **[LAW]** Ley 37/1992 art. 75.Uno.2: VAT on services falls due when they are performed. Art. 75.Dos: a payment made before that falls due on the amount actually received. https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740
- **[READING]** A guest paying 25 EUR after the drinks were served is not an advance. The invoice attaches to the meal as a whole, issued when it is done. One invoice for several card payments fits the text.
- **[NOT FOUND]** Any ruling of the tax agency (AEAT) or the tax directorate (DGT) on a bill paid by several diners, or on the pre-bill ("pre-cuenta").

### No fiscal printer, and the tax record has no payment field

- **[DOC]** The AEAT lists 18 items of the VERI*FACTU invoice record: issuer, recipient, number, dates, type, description, total, VAT breakdown, chaining, software. None is a payment method, a part payment or an amount received. https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/cuestiones-generales/contenido-registro-facturacion-alta_.html
- **[DOC]** The AEAT developer description has no payment-method element; the sample XML carries only totals. https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf
- **[SECONDARY]** RDL 15/2025 set the dates for invoicing software users: 1 January 2027 for companies paying corporate tax, 1 July 2027 for others. https://www.cuatrecasas.com/es/spain/fiscalidad/art/rdl15-sistemas-informaticos-facturacion-plazo
- **[SECONDARY] (extract)** In October 2026 the government announced a move to October 2028. No norm making it law was found as of 24 November 2026, so the 2027 dates stand. https://getrenn.com/es/blog/verifactu-aplazado ; https://emprendedores.es/gestion/aplazamiento-verifactu-2028/
- **[SECONDARY] (extract)** Sector guides say adapting rarely means changing the computer, the card terminal or the printer; a software update is often enough. The software maker certifies compliance itself; the AEAT publishes no approved list. https://www.sage.com/es-es/blog/ley-antifraude-cambios-fiscales-tpv-homologado/ ; https://www.wolterskluwer.com/es-es/expert-insights/verifactu-hosteleria-pequeno-comercio
- **[NOT FOUND]** An official sentence saying Spain requires no fiscal printer. The Basque TicketBAI rules were not checked for a payment field.

### Why it is easy in Spain

- **[READING]** Three things make it easy. The invoice belongs to the operation (the meal), not to each payment. No device must print something at each payment. The tax record carries only the total, so it never sees four cards. "Charge each card now, one ticket at the end" therefore breaks no Spanish rule found. No authority has confirmed this either.

---

## 2. Is it lawful in Bulgaria?

### Nothing has changed since 10-18

- **[LAW]** Н-18's last amendment on lex.bg is still ДВ бр. 42/2025. The whole consolidated text carries no 2026 marks. https://lex.bg/bg/laws/ldoc/2135540645
- **[LAW]** ЗДДС was amended by ДВ бр. 69/2026 (in force 01.08.2026), but only in чл. 10б (water-utility services). Nothing on payments or receipts. https://lex.bg/bg/laws/ldoc/2135533201
- **[DOC] (extract)** A further Н-18 draft from the Ministry of Finance concerns the EU Cyber Resilience Act and device support periods. https://www.minfin.bg/upload/61343/Spravka+NID+Naredba+N-18.pdf
- **[NOT FOUND]** The State Gazette itself was not checked; a very recent change not yet on lex.bg cannot be ruled out.

### The rules that decide it

- **[LAW]** A fiscal receipt is due for every payment, with exemptions that do not include card payments (Н-18 чл. 25, ал. 1, т. 1). Settled in the 10-18 file, §1.
- **[LAW]** It is handed over together with the payment received (чл. 25, ал. 6). The NRA's own page says the receipt is issued "при извършване на плащането" (at the making of the payment). https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/dokumenti-zaprodajba-i-storno-operatsii/Dokumenti-za-prdajba
- **[LAW]** Every receipt shows the total and the payment method or methods, plural since 2019 (чл. 26, ал. 1, т. 8). 10-18 file, §1.
- **[LAW]** чл. 26а, ал. 1: it "се допуска" (is allowed) to program the fiscal device so that sales with part payments go into a department named "ЧАСТИЧНИ ПЛАЩАНИЯ". All amounts received as part payments are registered there. The goods are written as free text between "#" marks. https://lex.bg/bg/laws/ldoc/2135540645
- **[LAW]** чл. 26а, ал. 2: at the final payment all goods and services are registered, then a value discount equal to the part payments. Same URL.
- **[LAW]** чл. 26а, ал. 3–4: two more optional departments, for receipts issued before payment ("РАЗНОСНА ТЪРГОВИЯ") and for e-shops ("ЕЛЕКТРОННА ТЪРГОВИЯ"). Same URL.
- **[READING]** чл. 26а is a permission about how to program the device, not a duty. The duty to print at each payment comes from чл. 25. So a true part payment needs a receipt at that moment. чл. 26а only offers a lawful shape for it.
- **[LAW]** чл. 26б and чл. 25, ал. 5: a sale may close with the payment deferred (type резерв 2, отложено плащане) only through an ИАСУТД (a till system linked to the NRA) or an extended receipt. A later payment, part payments included, then names that receipt. Same URL. **[READING]** As the 10-18 file found, this is not open to an ordinary venue till.
- **[LAW]** чл. 7а: a document showing the bill's sum must not look like a fiscal, system or service receipt, in look or content. No non-fiscal document may carry the word "фискален". Same URL. **[READING]** A shared progress screen ("held 50 of 120 EUR") is lawful if it never looks like a receipt. D127 already sets this for the payment confirmation.
- **[LAW]** Annex 29 т. 10 (binds venues on NRA-listed sales software only): when a sale has more than one payment, the sale's unique number (УНП) goes on the receipt issued for each payment. 10-18 file, §1. **[READING]** The law already pictures one sale paid in several payments, each with its own receipt.
- **[LAW]** Money taken without a receipt: 1,000–4,000 лв for a company, more if revenue goes unreported, and sealing of the venue (ЗДДС чл. 185–186). A guest given no receipt may refuse to pay (чл. 118, ал. 1а). 10-18 file, §1.
- **[LAW]** ЗДДС чл. 25, ал. 7: when a full or part advance is paid before the supply, VAT falls due on the amount received. https://lex.bg/bg/laws/ldoc/2135533201

### The Spanish form, moved here word for word

Picture four guests and a 120 EUR bill. Guest 1 pays 25 EUR at 23:00 and their card is charged at once. Guest 4 is at the bar and pays the last 35 EUR at 23:12. One receipt prints at 23:12.

- **[READING]** Under чл. 25 guest 1's 25 EUR is a payment at 23:00. It needs a receipt at 23:00. For twelve minutes the venue holds money without one. That is the case ЗДДС чл. 185 fines, and the NRA compares terminal totals with receipts (below).
- **[READING]** So the literal Spanish form does not fit Bulgarian law, unless every card is run inside one continuous act of paying. The law gives no tolerance in seconds or minutes. Where "one closing" ends and "a bill left open with money taken" begins is a question for the lawyer (§5, F5).
- **[SECONDARY]** The NRA sealed a hotel where terminal totals differed from fiscal-device totals. https://kik-info.com/novini/nap/NAP-zapechata-hotel-v-Borovets-zaradi-neizdavane-na.15372.php
- **[READING]** Restro would not use the literal form anyway. D124 makes card holds a must-have for paying in the app, with no charge-and-refund fallback.

### How a Bulgarian counter does it today

- **[DOC]** barsy's staff screen has a mixed payment at closing: several amounts and methods make up the total. https://docs.lukanet.com/barsy.help/200-faq/200-sales/smeseni-plashtania.html
- **[DOC]** If a mixed payment by two cards fails on the second card, barsy saves the POS bill with the first payment and locks it; staff see the remainder. https://docs.lukanet.com/barsy.help/120-posx/pos_terminal_cases.html
- **[READING]** That page implies the receipt stays open while each card is run: the first card is charged, and the receipt waits for the second. So a Bulgarian counter already accepts a short gap, inside one closing, between a card charge and the one receipt. Whether the fiscal device opens the receipt before the cards are run, or only prints after, is not stated, and may differ by POS.
- **[NOT FOUND]** Any forum, FAQ or vendor text on how often Bulgarian waiters take "two people pay by card" on one bill. The 10-18 file's demand test (count POS bills closed with two or more cards) still stands.

### Where чл. 26а applies

- **[READING]** чл. 26а is for a payment that leaves the POS bill open while the payer is gone: "I pay 25 EUR and leave, the others carry on". Each such payment needs its own receipt then, in the "ЧАСТИЧНИ ПЛАЩАНИЯ" department. The last payer's receipt lists all goods, minus a value discount equal to the earlier parts.
- **[READING]** It does not apply when all cards settle the bill in one closing. That is a mixed payment under чл. 26, т. 8, and the receipt lists the real goods.
- **[READING]** It is also not needed when a guest pays named items, or fractions of named items, moved onto their own POS bill. That receipt lists real goods (10-18 file, §1).

### What the NRA has said: nothing on this

- **[NOT FOUND]** Any NRA opinion on a restaurant bill split by amount or by several cards, on a pre-bill, or on whether a card hold is a payment.
- **[SECONDARY]** NRA opinion (abstract): a card payment through a POS terminal needs a fiscal receipt unless Н-18 exempts it. https://kik-info.com/stanovishta-na-nap/1bc407b0b7627baaeac910c471121aa1
- **[SECONDARY]** NRA opinion (abstract): a later part payment, in cash or by card, on an invoice gets a fiscal receipt that names the invoice. https://kik-info.com/stanovishta-na-nap/115cd9861412b35dc637241c8e22c850
- **[SECONDARY]** NRA opinions citing чл. 26а exist (2020, 2024, 2026), but the texts are paywalled and were not read. Same listing as above.
- **[VENDOR PAGE]** Bulgarian banks let hotels hold an amount on a card as a guarantee; one says the hold stays 5 calendar days. https://www.procreditbank.bg/filemanager/FileManager/tariff_terms_conditions_BC/instrukcija-za-priemane-na-plashtanija-bez-fizicheska-nalichnost-na-kartata-31.05.2024.pdf ; https://unicreditbulbank.bg/doc/1493707882/10051

### What the fiscal devices show

- **[DOC]** ErpNet.FP, an open-source driver for Bulgarian fiscal devices, sends one payment command per payment row and never merges rows of one type. It then sends a separate close command; it never relies on the device closing by itself. This holds for its two driver families, covering Datecs, Daisy, Eltrade, Incotex and Tremol. https://github.com/erpnet/ErpNet.FP/blob/master/ErpNet.FP.Core/Drivers/BgIslFiscalPrinter.cs ; https://github.com/erpnet/ErpNet.FP/blob/master/ErpNet.FP.Core/Drivers/BgZfpFiscalPrinter.cs
- **[DOC]** Its API says: "Multiple different payment types and amounts are allowed for one receipt." It says "different"; it says nothing of one type twice. Card is one type, NRA code "SCards". https://github.com/erpnet/ErpNet.FP/blob/master/PROTOCOL.md
- **[DOC]** Unicontsoft's driver takes payment rows with an amount and a type (example: 10 by card, the rest cash). It does not say whether a type may repeat. https://github.com/Unicontsoft/UcsFiscalPrinters/blob/master/PROTOCOL.md
- **[SECONDARY] (extract)** Copies of Datecs manuals: command 53 takes a payment as a type letter plus an amount, between the sales and the close. https://www.scribd.com/document/632167931/FP-700-doc
- **[SECONDARY] (extract)** A summary of a Synergy PF-550 manual copy (a Datecs-family device) says payment may be made several times and the receipt closes once the total is paid. The page returned 403; unverified. https://manualmachine.com/synergy/pf550/20180104-user-manual
- **[LAW]** The device reports card payments to the NRA as one total; there is no per-card type (Annex 17). 10-18 file, §1.
- **[NOT FOUND]** Any manual, protocol or driver line saying a second card payment on one receipt is accepted, refused, summed into one line or printed as its own line. The official Datecs, Daisy, Tremol, Eltrade and Incotex protocols could not be read.
- **[READING]** Several card rows on one receipt are plausible on these devices, because the payment command can repeat before the close. Only the vendor, or a test on the real device, can confirm it.

### Terminal splitting is already sold here; its receipts are not described

- **[VENDOR PAGE]** myPOS in Bulgaria (Ultra and Flex terminals, page updated 05.11.2026): split a bill equally among 2 to 20 people, or by a different amount each, each paying by card with a tip. The terminal shows paid and remaining. Fiscal receipts are not mentioned. https://www.mypos.com/bg-bg/blog/plashtania/dve-novi-funktsii-na-tvoya-mypos-terminal-razdeleni-plashtaniya-i-digitalni-belezhki
- **[VENDOR PAGE] (extract)** myPOS Carbon Fiscal is one device combining till, fiscal printer and card terminal, and issues receipts for card, cash or mixed payment. https://www.mypos.com/bg-bg/kupi-pos-terminal/carbon-fiscal
- **[VENDOR PAGE] (extract)** Tremol POS mini Restaurant, NRA-listed software, lists bill splitting as a feature. https://tremol.bg/bg/product/tremol-mini.pdf
- **[SECONDARY] (extract)** DSK Bank's terminal booklet says all goods and services must be paid in one transaction for the total. The exact wording could not be read. https://dskbank.bg/docs/default-source/документи/пос/dsk_pos_terminal_book_new_2020.pdf
- **[READING]** The DSK line, if accurate, binds that bank's card terminal at the counter. It does not touch Restro's route through Stripe. It shows that even the counter version of the Spanish practice depends on the venue's bank.
- **[NOT FOUND]** Any Bulgarian vendor text showing what fiscal document prints for each share of a terminal split.

---

## 3. Restro's model (a): the Bulgarian-safe form?

### The Spanish practice mapped onto hold, close once, capture all

| Spain (as far as sources show) | Restro, model (a) |
|---|---|
| The waitress enters 25 EUR on the terminal | The guest types 25 EUR on their phone (or picks an equal share) |
| The card is charged at once | The card is held for 25 EUR plus any tip, after the bank's check (3-D Secure, D127) |
| The terminal shows what is still owed | Every phone at the table shows held, missing and time left |
| The till closes the bill when the parts reach the total | When the holds equal the total, Restro moves the lines to a payment table, checks them, and closes it once with one card payment per guest (D122 §8) |
| One ticket at the end | One fiscal receipt listing several card payments, printed by the venue's device |
| (nothing more) | Restro captures every hold, each for its held amount, seconds after the close |

### Why it fits

- **[READING]** No money is taken before the receipt exists. A hold is not a payment until captured (the 10-18 file's reading A1, for the lawyer as F2). The capture follows the close within seconds, as every in-app payment already does (D122 §8, D127).
- **[READING]** One receipt with several card payments fits чл. 26, т. 8, which speaks of payment methods in the plural, and the NRA's own term "смесено плащане" (mixed payment). 10-18 file, §1, F1.
- **[READING]** Closing a POS bill with several card payments is taking a payment, a waiter's action under D110. It needs no new kind of POS write.
- **[SCHEME]** Visa expressly allows one purchase paid partly with one Visa card and partly with another card. https://usa.visa.com/content/dam/VCOM/download/about-visa/visa-rules-public.pdf (§5.7.3.1; 10-18 file, §2)
- **[READING]** Each guest agrees to their own amount only, as PSD2 Art. 75 requires for a hold (10-18 file, §2). No guest's card ever carries someone else's share.
- **[READING]** The receipt lists the real goods, so чл. 26а is not needed.

### What breaks it

1. **A capture before the close.** Money without a receipt: the case ЗДДС чл. 185 fines. Restro must never capture a group payment's hold before the close is proven (D127: capture only on proof of the close).
2. **A capture that fails after the receipt printed.**
   - The fix belongs to the venue: an operator-error storno of that card payment, by the 7th of next month (Н-18 чл. 31, ал. 3–4; 10-18 file, F4). Since 2025 one storno receipt may carry several payment methods (чл. 31, ал. 2б). https://lex.bg/bg/laws/ldoc/2135540645
   - Once a close was attempted, Restro never undoes or releases (D127). It keeps retrying the capture and alerts the owner. It never refunds automatically.
   - **[READING]** With four guests the chance of one failed capture is about four times one guest's chance. It stays rare: each hold was approved minutes earlier.
3. **The capture comes seconds after the receipt prints.** **[READING]** The receipt and the money arrive in one continuous act, so they count as the same moment. This is how every in-app payment already works (D122 §8). Still a reading: the lawyer's F2, extended in §5 as F6.
4. **Holds that wait too long.**
   - **[DOC]** A Stripe hold on an online card payment lasts 7 days. https://docs.stripe.com/payments/place-a-hold-on-a-payment-method (10-18 file, §3; D122 §8 plans for 7-day holds)
   - **[SCHEME]** An unused hold must be released within 24 hours of the payment being given up (Visa §5.7.3.6; 10-18 file, §2).
   - **[DOC] (extract)** A released hold can take the guest's bank up to 7 business days to clear. https://help.meandu.com/hc/en-us/articles/6539880778511
   - **[READING]** Lifetime is no problem; a table settles within minutes. The risk is a group that never completes. Restro must release every hold by an active call as soon as the window ends. The window is D30's, reopened by D112 to be decided with group payment. Its 3-minute default is too short for four bank checks in a club; the 10-18 file suggested about 10 minutes.
5. **A guest who holds their part and leaves before the total is reached.** If the others never complete, every hold is released and that guest has paid nothing. **[READING]** The venue carries the same risk it carries today with a walk-out. Restro should show the table who is still missing, and let anyone take over a missing part.
6. **The bill changes while the holds gather.**
   - **[READING]** The group payment covers the lines read when it started. New orders land on the table but are not part of it. At the close Restro moves only those lines and checks them (D122 §8: exactly the confirmed lines, or the holds are released).
   - **[READING]** A line voided or repriced meanwhile makes that check fail. Every hold is then released and the table starts again. That is safe, but annoying in a busy club. A POS that can freeze the lines would avoid it (S6).
7. **The POS or the fiscal device refuses several card payments of one type.** This is the real unknown (S1, S4). The fallbacks, honestly:
   - **One payment table per guest, by items.** That is "pay my items" (D112), not "pay an amount". The guest's amount must match lines, which a typed 25 EUR rarely does.
   - **One payment table per guest, by fractions of lines.** For equal shares, move a quarter of every line to each guest's payment table. Each receipt lists real goods (0.25 of a bottle), so чл. 26а is not needed (10-18 file, F3). **[READING]** This works only if the POS moves fractions (S10). Line amounts must be rounded, so the last share absorbs a few cents. A typed amount (25 of 120 EUR) becomes 20.83 % of every line, and the guest sees 24.99 or 25.01 EUR. Each guest's capture happens at their own close, so each guest may pay and leave, as in model (b). In glossary words it is a split, not a part payment: each guest's own POS bill closes. It is lawful because each receipt lists goods.
   - **One receipt per guest for an amount.** The amount matches no goods. That needs the чл. 26а form, which is model (b).
   - **[READING]** If the POS can only take one card row per receipt, model (a) as one receipt is out at that venue. The fraction route is then the closest lawful substitute.
8. **The tip per guest.**
   - D127 offers a tip only where the till puts it on the same POS bill and fiscal receipt. Each guest's tip sits inside their own hold.
   - **[READING]** At the close the guests' tips add up to one tip line on the one receipt. This is fine for the receipt, but the tip line needs Mistral's answer that D127 already waits for.
   - Restro must keep each guest's tip on their own payment record, so a refund or dispute can be traced to one card.
9. **The holds overshoot the total.** **[READING]** Restro must never let the holds add up to more than the total. The last guest is offered exactly "the rest". This mirrors the Spanish terminal, which shows what is still owed.

### Can model (b) ever be the Spanish practice in Bulgaria?

**Yes, at a price.** Model (b) is the "pay 25 EUR and leave" scene: each guest's money is taken at once and the bill stays open. In Bulgaria that means:

- **[LAW]** A fiscal receipt at each part payment (чл. 25), most cleanly in the "ЧАСТИЧНИ ПЛАЩАНИЯ" department, the goods written between "#" (чл. 26а, ал. 1). https://lex.bg/bg/laws/ldoc/2135540645
- **[LAW]** At the last payment, a receipt with all goods minus a value discount equal to the earlier parts (чл. 26а, ал. 2). Same URL.
- **[LAW]** Under listed software, the same УНП on every one of those receipts (Annex 29 т. 10; 10-18 file, §1).
- **[NOT FOUND]** Any Bulgarian POS or fiscal-device vendor page documenting the "ЧАСТИЧНИ ПЛАЩАНИЯ" department, or a part payment on an open bill that prints a receipt. Searches of lukanet.com, mistral.bg and the device makers returned nothing.
- **[READING]** The price, in order:
  - the POS must support the department and take a card part payment on an open bill through its API, with a receipt at that moment;
  - Restro's payment-table route does not fit, because a part payment moves no lines, so the POS needs a new kind of step;
  - the VAT on each part receipt must be right; ЗДДС чл. 25, ал. 7 treats an early payment as an advance (F7);
  - whoever pays last receives the receipt with all the goods.
- **[READING]** The fraction route (above) delivers the same scene with ordinary receipts, if the POS moves fractions. It is the cheaper road to model (b).

---

## 4. What the POS must do: questions for Mistral Software

Plain yes/no questions, POS-neutral. **[VENDOR PAGE]** Public Mistral pages say little on payments. Mobile ordering offers "Плащане поотделно? Става мигновено!" (separate payment) by attaching an order to a seat (https://mistral.bg/mobilno-markirane.html). A blog page names splitting a bill between two tables (https://mistral.bg/blog-tri-klyuchovi-funkcionalnosti.html). The home page names a Datecs Pay terminal integration (https://mistral.bg). **[NOT FOUND]** Anything on mixed payment, several cards, part payment or deposits, on any Mistral page read.

**For model (a): several cards, one close, one receipt**

- **S1.** Can one bill, or one payment table, be closed in one close with several payments of the card type, printing one fiscal receipt?
- **S2.** Does that receipt list each card payment with its own amount, or one card total?
- **S3.** Does each card payment come back with its own reference? Can Restro attach its own reference to each?
- **S4.** Which fiscal device runs at the pilot venue? Does it accept two or more payments of the card type on one receipt?
- **S5.** If the device refused the second card payment, would the POS refuse the whole close before anything prints? Or would it print, or save a part-paid bill?
- **S6.** Can a bill, or the lines on a payment table, be frozen against new lines and voids while payments gather?
- **S7.** Can the POS tell, just before the close, whether the fiscal device can print now?
- **S8.** Can one card payment out of several on a closed receipt be reversed alone, as card, with no cash (storno)?
- **S9.** Can one close carry one tip line that sums several guests' tips?
- **S10.** Can a fraction of a line (0.25 of a bottle) be moved to a payment table? With how many decimals, and how is the line amount rounded?

**For model (b): a part payment while the bill stays open**

- **S11.** Can a card payment for an amount be taken on a bill that stays open, through the API, printing a fiscal receipt at that moment?
- **S12.** Does the POS support the "ЧАСТИЧНИ ПЛАЩАНИЯ" department of Н-18 чл. 26а? How are the goods written on the part-payment receipt?
- **S13.** What does the final receipt show: all goods minus a value discount equal to the earlier parts? Does each part-payment receipt carry the same sale number (УНП)?
- **S14.** "Separate payment" by seat: does each seat close with its own fiscal receipt, while the table's other seats stay open?

---

## 5. Open points for the lawyer or accountant (interpretation only)

The 10-18 file's F1–F4 stand unchanged and cover most of this:
- **F1:** one receipt, several card payments.
- **F2:** the hold is not yet the payment.
- **F3:** a share not tied to items.
- **F4:** storno after a failed capture.

New points:

- **F5.** **Is the Spanish literal form lawful in Bulgaria?** Each guest's card is charged at once, the bill stays open, and one receipt prints at the end. Where does "one closing with several cards" end and "money held without a receipt" begin? Is there any tolerance?
- **F6.** In model (a) the receipt prints first and every hold is captured seconds later. Is that payment "at" the receipt under чл. 25, ал. 6, for holds placed several minutes earlier by different guests? (Extends F2.)
- **F7.** For model (b) through чл. 26а: is a part payment for drinks already served an advance under ЗДДС чл. 25, ал. 7? Which VAT group goes on the part-payment receipt?
- **F8.** Several guests' tips summed into one tip line on one receipt: acceptable, or one line per payment? (The tip already waits on the accountant under D127.)

- **F9** (added 11-25). Is a hold's authorisation already "the payment"? Н-18 ties the e-shop document to the authorisation of a card-not-present payment (чл. 3, ал. 17; чл. 52о). If that reading carried over to a venue's fiscal device, each guest's authorisation, placed minutes before the receipt, would be the moment the receipt is due. (Sharpens F2 and F6; §6 below.)

---

## 6. Addendum 2026-11-25: a check of official Bulgarian sources

Martin asked on 11-25 for a check against official Bulgarian sources such as myPOS. It was done by a research agent on 11-25 and filed by the lead. Same tags as above. Planning research only, not legal advice.

**Bottom line.** Nothing official contradicts model (a): hold every card, close once with several card payments on one receipt, then capture seconds later. Several sources fit it, but none confirms it outright. No official text deals with holds, with a capture after the receipt, or with several payments of the card type on one receipt. F1, F2, F6 and the new F9 stay with the lawyer or accountant, and S1, S2 and S4 stay with Mistral.

### Н-18, consolidated text (lex.bg, read 2026-11-25; last amendment ДВ бр. 42/2025)
Source: https://lex.bg/bg/laws/ldoc/2135540645
- **[LAW] чл. 3, ал. 1:** card payments are not among the payments with no receipt.
- **[LAW] чл. 3, ал. 15:** the regulation itself uses "смесено плащане" (mixed payment) for several payments closing one sale (pharmacies part-paid by the health fund).
- **[LAW] чл. 3, ал. 17 and чл. 52о:** an e-shop paid by card not present may give a non-fiscal document instead of a receipt, at the card payment or at the virtual POS's authorisation of the payment order.
  - **[READING]** This is the only text that ties timing to authorisation, and it covers e-shops only, not a venue's own fiscal device. It is the source of F9.
- **[LAW] чл. 25, ал. 6:** the receipt is issued when the payment is made and handed over as the payment is received. No tolerance in seconds is stated.
- **[LAW] чл. 26, ал. 1, т. 8:** the receipt shows the payment method or methods ("начин/и на плащане"). The wording is unchanged since 2019.
- **[LAW] чл. 26а:** unchanged; the part-payments department is an option, not a duty.
- **[LAW] Annex 17:** the NRA receives card payments as one total per period.
- **[NOT FOUND]** Any rule in Н-18 on pre-authorised, blocked or reserved card amounts.

### The NRA (nra.bg)
- **[NRA] Opinion ВК-30-14766/23.10.2025, on card tips** (read in full): https://nra.bg/wps/portal/nra/actualno/stanovishte-bakshish
  - A tip given before the bill closes goes on the same receipt. A tip paid after the receipt gets a second receipt. Where the tip was left after the card payment was authorised, one receipt may sum several tips.
  - The risk the NRA names is a gap between fiscal turnover and the totals paid through card terminals.
  - **[READING]** The NRA treats card authorisation and the receipt as one act at the counter, which helps the "capture seconds later" reading. It says nothing about holds or several cards. It also bears on F8 (several guests' tips on one receipt).
- **[SECONDARY]** Abstracts of NRA opinions (behind a paywall) say a card payment through a virtual POS also needs a receipt, for example an online hotel booking: https://kik-info.com/stanovishta-na-nap/1bc407b0b7627baaeac910c471121aa1
- **[NOT FOUND]**
  - An NRA Q&A or opinion on one receipt with several cards, on splitting a restaurant bill, or on pre-authorisation (hotels, car rental, fuel).
  - The texts of the opinions on чл. 26а (Plovdiv 2020 and 2024, Sofia 2026): only their titles are visible, and the texts are behind a paywall: https://kik-info.com/stanovishta-na-nap/115cd9861412b35dc637241c8e22c850

### myPOS Bulgaria
- **[VENDOR PAGE]** The Bulgarian split-bill page (updated 05.11.2026) matches the Spanish one cited in §1:
  - equal shares for 2–20 people, or custom amounts;
  - one card payment per person, all linked to one bill, with a tip per payer;
  - Ultra and Flex terminals only.
  - It says nothing about a fiscal receipt or pre-authorisation; the only receipts it mentions are digital QR receipts.
  - https://www.mypos.com/bg-bg/blog/plashtania/dve-novi-funktsii-na-tvoya-mypos-terminal-razdeleni-plashtaniya-i-digitalni-belezhki
  - The same article runs in other countries, so it is a global feature, not a Bulgarian fiscal design.
- **[VENDOR PAGE]** Carbon Fiscal, the fiscal terminal: a receipt for every payment, whether cash, card or mixed. Nothing on splitting a bill. https://www.mypos.com/bg-bg/kupi-pos-terminal/carbon-fiscal
- **[VENDOR PAGE] (extract)** Pre-authorisation:
  - aimed at hotels, with food and beverage charges among the allowed uses;
  - a hold of up to 30 days, for verified merchants only;
  - one help article says every device except Carbon Fiscal supports it.
  - https://help.mypos.com/hc/en-bg/articles/6882453362589-How-does-credit-card-pre-authorization-work
- **[DOC]** ePay.bg: a hold of up to 30 days, with partial completion. Nothing on fiscal receipts. https://kb.epay.bg/en/web/preauth/

### Fiscal-device and POS vendors
- **[NOT FOUND]** Official text from Datecs, Daisy, Tremol, Eltrade, Microinvest, Gensoft, Mistral or barsy on several card payments on one receipt, or on pre-authorisation.
- **[SECONDARY] (extract)** Datecs FP-700 manual: the payment command takes a payment type and an amount between the sale and the close. Whether it may repeat for the card type is not stated, so the question stays with Mistral (S1, S2, S4). https://www.scribd.com/document/632167931/FP-700-doc

---

## Sources

**Bulgarian law**
- Н-18, consolidated: https://lex.bg/bg/laws/ldoc/2135540645
- ЗДДС, consolidated: https://lex.bg/bg/laws/ldoc/2135533201
- NRA, documents for a sale: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/dokumenti-zaprodajba-i-storno-operatsii/Dokumenti-za-prdajba
- Ministry of Finance, Н-18 draft: https://www.minfin.bg/upload/61343/Spravka+NID+Naredba+N-18.pdf
- [SECONDARY] NRA opinions (abstracts): https://kik-info.com/stanovishta-na-nap/1bc407b0b7627baaeac910c471121aa1 ; https://kik-info.com/stanovishta-na-nap/115cd9861412b35dc637241c8e22c850
- [SECONDARY] NRA enforcement: https://kik-info.com/novini/nap/NAP-zapechata-hotel-v-Borovets-zaradi-neizdavane-na.15372.php
- Bank hold instructions: https://www.procreditbank.bg/filemanager/FileManager/tariff_terms_conditions_BC/instrukcija-za-priemane-na-plashtanija-bez-fizicheska-nalichnost-na-kartata-31.05.2024.pdf ; https://unicreditbulbank.bg/doc/1493707882/10051

**Spanish law**
- RD 1619/2012: https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696
- Ley 37/1992: https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740
- Orden HAC/1028/2026: https://www.boe.es/boe/dias/2026/10/05/pdfs/BOE-A-2026-20587.pdf
- AEAT, VERI*FACTU record content: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/cuestiones-generales/contenido-registro-facturacion-alta_.html
- AEAT, developer description: https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf
- [SECONDARY] Deadlines: https://www.cuatrecasas.com/es/spain/fiscalidad/art/rdl15-sistemas-informaticos-facturacion-plazo ; https://getrenn.com/es/blog/verifactu-aplazado ; https://emprendedores.es/gestion/aplazamiento-verifactu-2028/
- [SECONDARY] No new hardware: https://www.sage.com/es-es/blog/ley-antifraude-cambios-fiscales-tpv-homologado/ ; https://www.wolterskluwer.com/es-es/expert-insights/verifactu-hosteleria-pequeno-comercio

**Fiscal devices and drivers**
- ErpNet.FP: https://github.com/erpnet/ErpNet.FP/blob/master/PROTOCOL.md ; https://github.com/erpnet/ErpNet.FP/blob/master/ErpNet.FP.Core/Drivers/BgIslFiscalPrinter.cs ; https://github.com/erpnet/ErpNet.FP/blob/master/ErpNet.FP.Core/Drivers/BgZfpFiscalPrinter.cs
- Unicontsoft: https://github.com/Unicontsoft/UcsFiscalPrinters/blob/master/PROTOCOL.md
- [SECONDARY] Device manual copies: https://www.scribd.com/document/632167931/FP-700-doc ; https://manualmachine.com/synergy/pf550/20180104-user-manual

**POS, terminals, card scheme and products**
- Visa Rules, 18.04.2026: https://usa.visa.com/content/dam/VCOM/download/about-visa/visa-rules-public.pdf
- barsy: https://docs.lukanet.com/barsy.help/200-faq/200-sales/smeseni-plashtania.html ; https://docs.lukanet.com/barsy.help/120-posx/pos_terminal_cases.html
- Mistral Software: https://mistral.bg ; https://mistral.bg/mobilno-markirane.html ; https://mistral.bg/blog-tri-klyuchovi-funkcionalnosti.html
- myPOS: https://www.mypos.com/es-es/blog/pagos/novedades-en-tu-dispositivo-tpv-division-de-cuenta-y-recibos-digitales-con-qr ; https://www.mypos.com/bg-bg/blog/plashtania/dve-novi-funktsii-na-tvoya-mypos-terminal-razdeleni-plashtaniya-i-digitalni-belezhki ; https://www.mypos.com/bg-bg/kupi-pos-terminal/carbon-fiscal
- Tremol: https://tremol.bg/bg/product/tremol-mini.pdf
- DSK Bank: https://dskbank.bg/docs/default-source/документи/пос/dsk_pos_terminal_book_new_2020.pdf
- Getnet: https://www.santander.com/es/sala-de-comunicacion/notas-de-prensa/2025/10/getnet-lanza-una-nueva-version-de-su-tpv-para-potenciar-el-negocio-de-pymes-pequenos-comercios-y-autonomos
- Qamarero: https://intercom.help/qamarero-9e4c4f5026e3/es/articles/9347123-como-cobrar-una-mesa ; https://www.qamarero.com/blog/pagar-por-separado-en-un-bar-como-dividir-la-cuenta/
- Square: https://squareup.com/help/es/es/article/5097-process-split-tender-payments-with-square
- [SECONDARY] Teya: https://finantres.com/?p=475917
- Stripe holds: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- me&u: https://help.meandu.com/hc/en-us/articles/6539880778511

**Earlier Restro research:** `docs/deliverables/2026-10-18-split-payments.md`, and the decisions D30, D110, D112, D114, D122 (§8), D124, D125, D126 and D127.
