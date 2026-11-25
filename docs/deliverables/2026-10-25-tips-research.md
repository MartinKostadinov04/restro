Made by: a research agent (Sonnet), 10-25, for the ordering lead (#53, map #29). For: deciding how Restro offers and records tips.

# Tips paid by card with the bill: how real products and Bulgarian rules handle them

All web pages below were read on 2026-10-25 unless noted. Tags: [DOC] vendor or official text, [FORUM] community post, [PRESS] press or vendor marketing, [READING] my inference.

## Short answer

- **barsy can record a tip, but as an item, not as a payment field.** barsy has a built-in "Бакшиш" (tip) item that is added to the bill as an extra line. Whether the API can add it, and how it reaches the fiscal receipt, is unknown: the API method pages need a sign-in I do not have.
- **Most products use one of two shapes:** a tip field on the card payment (Square, Toast, Stripe Terminal), or a tip line on the bill (barsy; Toast as a service charge). Neither is an "over-payment".
- **When the POS cannot record the tip, products keep the tip in their own system** and report it there (Sunday, Square Online, Toast online orders). The money still lands with the venue, and the venue shares it out.
- **Nobody sends the tip to the waiter directly by default.** The venue gets the money; payroll, cash or a bank transfer follows (Toast, Sunday).
- **Bulgarian rule (NRA letter, 23.10.2025):** a voluntary card tip is venue income, has no VAT, and goes on the fiscal receipt in tax group "А", ideally in a department "БАКШИШ". A tip paid after the receipt needs a second receipt.
- **Recommendation:** offer the tip only where the POS can add a "БАКШИШ" line to the same bill. Where it cannot, do not charge the tip until the venue agrees how it will issue the receipt.

## 1. barsy (Lukanet)

- **Built-in tip feature.** Setup: Settings, Accounts, "Бакшиш", then "Активирай". The venue sets percentages or amounts, rounding, a decline text, and the categories where the item shows. [DOC] http://docs.lukanet.com/barsy.help/220-workflows/scenario-tips.html
- **The tip is an item.** In the Sales module staff "must add the 'Бакшиш' item to the bill as an extra item". The item can be renamed, for example "Такса Сервиз" or "Обслужване". [DOC] same page
- **At the till and on the customer display.** In POSX a "Бакшиш" button appears when closing a bill, if the payment method is set to show it. On the customer display the guest picks a percentage or amount, or declines. The tip is "recorded automatically" when the guest confirms and pays. [DOC] same page; display: http://docs.lukanet.com/barsy.help/110-admin/180-settings/100-main/adds/addusage/cdx.html
- **Reports.** Total tips: Reports, Sales, By items, filtered by item type "Бакшиш". Also shown in the summary and personal daily reports. [DOC] scenario-tips page
- **Not stated anywhere I could read:** the fiscal receipt, tax group, change, over-payment. The FAQ (7.1.22) has nothing on over-payment or change. [DOC] http://docs.lukanet.com/barsy.help/200-faq/200-sales/tips.html
- **API: unknown.** `docs.lukanet.com/barsy.api/` shows a login form; I did not sign in. I could not see the values of `article_type`, nor any tip field on `Accounts_place`, `Accounts_close` or the payment objects. The repo's reference (`docs/deliverables/2026-10-18-barsy-api-reference.md`) lists no tip field either. The demo fixtures hold no "Бакшиш" article (types 1, 3 and 5 only).
- **[READING]** If the tip is an item, Restro would add it as an order row on `Accounts_place`. That needs the tip item's id and its fiscal setup (which department and tax group it prints under). Neither is known. It is a question for Lukanet and for the pilot venue's barsy setup.
- **Risk:** the item can be renamed "Такса Сервиз". A service charge carries VAT; a voluntary tip does not (section 6). The venue's tip item must be set up as a tip.
- **Repo notes.** `docs/connector-questions.md` line 322: "Tips: none in the pilot" (written before D122). D122 now says guests can tip at the pilot, with the POS side "a Mistral question". D8: tip is an optional line on payment, paid to the venue. The 10-21 law deliverable already asks Mistral whether its API can add a tip line in group А.
- **Not seen:** whether the `Бакшиш` item prints on the fiscal receipt by itself.

## 2. Square

- **Payment field.** `Payment.tip_money` is "the amount designated as a tip for the seller's staff". `amount_money` excludes the tip. `total_money` is the sum. [DOC] https://developer.squareup.com/reference/square/objects/Payment
- **Order field.** `Order.total_tip_money` is "the total amount of tip money to collect for the order". [DOC] https://developer.squareup.com/reference/square/objects/Order
- **Tip on create.** A Square staff reply says a `tip_money` on CreatePayment arrives as a tip, not a line item, and the order updates to match. [FORUM] https://developer.squareup.com/forums/t/total-tip-money-filed-in-order-is-omitted-in-docs/418
- **QR and online ordering.** Square Online can collect tips on pickup, local delivery and QR code orders: smart tips or three percentages, one optionally preselected, and the guest can change or remove it. [DOC] https://squareup.com/help/gb/en/article/6859-checkout-options-with-square-online-store
- **Money and reports.** Card tips go out with the day's deposit; processing fees apply on the total including tip. Tips show as their own column or line in exports, transfer reports and the Sales Summary. [FORUM, several years old] https://community.squareup.com/t5/Archived-Discussions-Read-Only/How-to-collect-my-tips-from-square/td-p/108593 ; fees: [DOC] https://squareup.com/help/us/en/article/5068-track-and-pay-out-tips-with-square-payroll
- **When it cannot be attributed.** Online-order tips are not linked to a team member. They sit under "Untracked Team Members" in the Team Sales report, and owners share them by hand. [FORUM] https://community.squareup.com/t5/Online-Store/Square-Online-Tips-where-do-they-go/m-p/716161
- **Unknown:** what the printed or emailed receipt shows for a tip. I found no Square page that says.

## 3. Pay-at-table and QR apps

- **Sunday.**
  - Tip shown in the app on the QR page (preset or custom), or on the terminal; bill and tip are one transaction. Servers get a push message for each tip. [DOC, French] https://intercom.help/sundayapp-help/fr/articles/11959372-comment-les-clients-laissent-ils-un-pourboire-avec-sunday-qr-code-et-tpe
  - Its "Tips Manager" can send tips to staff bank accounts, and the venue sets share rules, for example a share to the kitchen. [DOC, same article]
  - Tips are reported as their own total in the dashboard's Accounting area. [DOC, French; from a search snippet, page not opened] https://intercom.help/sundayapp-help/fr/articles/5936163
  - **Unknown:** how the tip is written into each POS. Its page on POS integration and the tips article do not say. https://sundayapp.com/?p=40643
- **me&u / Mr Yum.** A tip prompt comes before checkout, with a venue-set range and optional default. On Toast, tips are "processed through Toast the same way regular tips are". [vendor staff-training page] https://meandu.helpjuice.com/foh-staff-training-material-toast. Payout and fields: unknown.
- **Qerko (Czech).** Tip options 20 / 15 / 10 % / other, chosen before the guest swipes "Pay"; the page says the payment is written into the register. [PRESS] https://www.qerko.com/ and https://www.qerko.com/faqs. One report says the default is 10 %. [PRESS] https://cc.cz/s-jidlem-roste-chut-i-ceskemu-qerku-rychle-platby-vyrazily-z-restauraci-pouzit-je-lze-i-na-internetu/. **Unknown:** how the tip lands in a POS (item, payment, none) or in Czech fiscal records; the POS list page and the FAQ do not say. Its API docs (`docs.qerko.com`) were not readable to me beyond the landing page.
- **Toast.**
  - Orders API: `tipAmount` is "the currency amount of a tip or gratuity in the added payment". [DOC] https://doc.toasttab.com/doc/devguide/apiAddingPaymentsToACheck.html. Per the repo's 10-18 note, a payment can be edited only for its tip.
  - Card tips are credited to the venue's account and come in the daily deposit; the venue funds payouts (cash at shift end, or payroll). Online tips go to the bank account by default and can be assigned to a placeholder "online server". [DOC, dated 16.09.2026] https://intercom.help/toast-central/en/articles/14488068-how-toast-handles-and-distributes-tips
  - A third-party pay-at-table partner (storekit) reports the card as an "alternate" (other) payment, collects the tip at pay time, and has a setting "Send Order Tips as Service Charge" so a tip is not lost. [DOC] https://storekit.com/docs/guides/integrations/pos/toast/pay-at-table.md
- **Lightspeed.** Lightspeed's own Pay at Table accepts tips only on certain Verifone terminals. [DOC] https://k-series-support.lightspeedhq.com/hc/en-us/articles/5012416749211-Pay-at-Table. A phone-pay partner "reports each payment to Lightspeed with its own reference and tip amount"; the field name and form are not stated. [DOC] https://storekit.com/docs/guides/integrations/pos/lightspeed/pay-at-table.md. Order Anywhere: unknown.
- **Stripe Terminal on-reader tipping.** The reader shows three suggestions; the PaymentIntent is confirmed for an amount including the tip, and the tip is returned in `amount_details.tip.amount` (0 if none chosen). Bulgaria is on the availability list. [DOC] https://docs.stripe.com/terminal/features/collecting-tips/on-reader. This is for a physical reader. For Restro's online card form, the repo's 10-21 note found no tip parameter: the tip is simply a higher `amount` chosen before the hold (`docs/deliverables/2026-10-21-payment-provider-facts.md` section 8).
- **Bulgarian or Eastern European QR apps.** I found none that document tips. A myPOS article on QR ordering in Bulgaria does not mention tips. [PRESS] https://www.mypos.com/bg-bg/blog/success-stories/qr-tehnologii-v-restorantyorstvoto. Unknown.

## 4. Patterns

1. **Tip as a field on the card payment.** Square, Toast, Stripe Terminal, Lightspeed (partner reports a tip amount). Total = bill + tip; the POS keeps them apart for reports.
2. **Tip as a separate line or fee on the bill.** barsy's "Бакшиш" item; Toast's "tip as service charge" setting. This is the Bulgarian "БАКШИШ" department, in effect.
3. **Tip recorded only in the app's own system.** Sunday (own reports and payouts), Square Online and Toast online (no staff link). The POS may see only the card total.
4. **Who gets the money:** always the venue first; then payroll or cash (Toast), a bank transfer through the app (Sunday), or by hand (Square Online).

## 5. When the POS cannot record a tip

- Sunday: the tip stays in Sunday's reports and its Tips Manager. [DOC]
- Square Online and Toast online: the tip is booked, but unattributed to a person; the owner distributes it. [FORUM / DOC]
- Toast partner apps: the tip is taken at pay time and the card is posted as an "other" payment, with a service-charge fallback. [DOC]
- Qerko: unknown.
- None of these is built around a legal fiscal-receipt rule like Bulgaria's.

## 6. Bulgarian rules

- **Primary source.** NRA Central Office general opinion, ref. ВК-30-14766 of 23.10.2025, signed by deputy executive director V. Petkova. It covers a tip option on a POS terminal, paid into the venue's bank account, paid to waiters in cash at day end. I read the PDF itself on 10-25. [Marked "Ограничено ползване - TLP-AMBER"; found only as a copy at https://accountingnews.bg/userfiles/ВК-30-14766+от+23_10_2025+г.pdf, not on nra.bg; it guides NRA practice but does not bind courts.]
- **Fiscal receipt (pp. 9-10).** A tip is income "независимо от това как е платен" (cash or card), so it must appear in the fiscal device. Tip given before the receipt (a rounded-up sum or a percentage): it goes on the same fiscal receipt, in tax group "А" (no VAT). The letter suggests a department named "БАКШИШ" in group А with the article "бакшиш". A separate receipt for the tip alone is allowed.
- **Tip after the receipt (p. 10).** A second fiscal receipt in group А. If the guest has left (for example after the card authorisation), one receipt for several tips as a total is not a breach.
- **VAT (pp. 4-5).** A voluntary tip, not set by the venue as due, is outside VAT. A service charge shown on the bill is part of the price and carries VAT (CJEU C-404/99, cited in the letter).
- **Staff and tax.** Treated as employment income; social contributions are due. How the tip is paid or shared does not change that (p. 11).
- **Consumer law (secondary, from the repo's 10-21 note).** A pre-ticked or default tip risks a refund claim (ЗЗП чл. 62д). The tip must start at zero. `docs/deliverables/2026-10-21-pilot-law-working-answers.md`.
- **2023-2026 changes.** I found no change to Н-18 that is about tips. The NRA letter above is the 2025 development. A 2025 draft amendment to Н-18 (consultation 27.03-26.04.2025) is about online shops and card payments, not tips. [secondary: kik-info.com] I did not read the current Н-18 text on lex.bg this session; whether the draft became law is unknown.

## What this means for Restro

**(a) POS can record a tip on close.**
- Add the tip as one "БАКШИШ" line on the same bill, in group А, with no VAT.
- The guest chooses the tip before the hold. The card capture equals lines plus tip.
- For barsy: ask Lukanet and the venue for the tip item's id and its fiscal setup before building. Treat it as an item row, not as an over-payment.

**(b) POS cannot record a tip.**
- Do not offer the tip at that venue yet.
- If the venue insists: Restro keeps its own tip record (bill, amount, payment id) and shows the venue a daily total. The venue rings one "БАКШИШ" receipt for the day. The NRA letter tolerates this only where the guest has left. The accountant must confirm this reading.
- Never fold the tip silently into the bill total, and never post it as a menu item or a price change.

**(c) What the guest and the receipt show.**
- The guest sees the bill, a separate "Бакшиш" line starting at 0 (presets allowed, none preselected), and the total.
- Say it goes to the venue, which decides how to share it. Do not promise "100 % to your waiter".
- Never call it a service charge.
- The fiscal receipt shows one "БАКШИШ" line in group А. Restro's own confirmation shows bill, tip and total.

## Open items

- Lukanet: can `Accounts_place` add the tip item, and what is its `article_type` and fiscal setup?
- Mistral: can the API add a tip line in group А?
- Accountant: is a day-end summary receipt acceptable for tips paid from a phone?
