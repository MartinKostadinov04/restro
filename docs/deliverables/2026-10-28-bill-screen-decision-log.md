# Decision log: "What the guest's bill screen does and how paying from it works" (#45)

Made by: the part 2 lead (Opus), 10-28, with Martin, in two grilling rounds and a throwaway prototype (branch `proto/45-bill-and-pay`, `packages/shell/prototype-45-bill-and-pay.html`). For: anyone who needs #45's decisions at a glance. Map #29 "Ordering from the menu", part 2 (spec #102).

Every decision taken in the grilling, one row each. **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives. Only D-numbers and tickets bind; this log is the index to them. The binding text of #45 is D127's section "The guest's bill screen and paying from it"; the guest words are in `docs/guides/menu-template-functionality.md` → "Guest words: the bill and paying".

**Read before #45, not re-asked:** 54 points were already settled by D111, D112, D115, D117, D118, D120, D121, D122, D125 and D127 (the bill's lines and reading, greyed "Being paid" lines, picking per quantity, the order of the route, the deadlines, the embedded form, Apple Pay and Google Pay, "can't tell", the smallest card payment, the pauses, Bulgarian on the pay screen). The lead's list of them, with sources, was the grilling's starting point; this log holds only what #45 added.

## 1. Martin's answers, round 1

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | Pay-first at Send is one tap: Send sends the on-the-bill lines and opens the pay-first payment at once. If the guest leaves the card form, the pay-first lines stay in the order, "Not ordered until paid", with "Pay 24 EUR" to try again. | Joins D117's words to D127's single route, with no extra tap for the guest. | firm | D127, #113 |
| 1.2 | Lines paid in the app stay on the bill, greyed under "Paid in the app" (name, quantity, amount; never who paid), until the sitting ends. | At Mistral the paid lines leave the table's bill at once; without this, friends and the waiter see a smaller bill with no reason. Sunday, me&u, GoTab and Toast keep one bill with what is paid on it. Replaces "gone once paid" and "Your paid orders" (already dropped, R1 7.3). | firm | D127 |
| 1.3 | The tip: 5, 10 and 15 % of the chosen lines (rounded half-up) plus "Other amount"; nothing selected, so it starts at zero; the label "Tip: goes to the venue"; no tip row at all where the till can't record one on the bill. | The tips research: presets are usual (Square, Qerko, Sunday); we may not preselect; the guest must know it goes to the venue. | firm | D127 |
| 1.4 | The Paid screen offers "Payment confirmation": Restro's own page (the venue's name, date and time, the lines, tip, total in EUR, "Paid by card", the payment number) with "Save" (an image or PDF kept on the phone, never a lasting link) and the line "This is not your receipt. Your waiter brings the venue's receipt." No receipt look (no ЕИК/ДДС header, VAT lines, receipt number, УНП or QR code), no "бон" and no form of "фискален" anywhere, in either language. Not Stripe's receipt link. No electronic receipt at the pilot. | Martin first asked for research (round 1); `2026-10-21-receipt-and-payment-law.md` §2026-10-28 (PR #181): only the venue's fiscal device issues a receipt, neither pilot POS is NRA-listed, a payment confirmation is lawful, Н-18 чл. 7а ал. 3 bars "фискален" even in a disclaimer, Stripe's link expires after 30 days. Martin, 10-28: "Yes: a saveable Payment confirmation as recommended". Follows D125 3.7 ("Restro's own"); D122 §8's "the provider's" is replaced. | firm | D127 |
| 1.5 | Call a waiter offers the options the venue chose; with none chosen it is the single-step button. | Martin, 10-28. | firm | D127, #180 |
| 1.6 | The pay screen carries the law checklist: lines and total in EUR with VAT; the tip at zero; complaints and refunds go to the venue; an unambiguous "Плати X EUR" / "Pay X EUR"; the venue's legal name, ЕИК and address and the privacy notice behind links; "Payment processed by Stripe for [venue]"; all in Bulgarian, English as the second language. | `2026-10-26-pilot-law-working-answers.md` recommendation 4; one line and two links. | firm | D127 |

## 2. The lead's calls, accepted by Martin with round 1

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | Card errors stay in Stripe's own form text (it is translated); Restro adds only "Pay later" (before the hold), "Call a waiter", and after the provider's time runs out "Your time ran out. Nothing was charged." with "Pay again", the ticks kept. | D117's "Try again / Pay later" predates the embedded form, which already lets the guest retype a card. | firm | D127 |
| 2.2 | The paying phone keeps its payment handle in the browser for the sitting (`localStorage`, never in an address), so a closed or reloaded page comes back to where the payment stands and shows the payment number. Without the handle, the guest asks the waiter; Tonight lists receipts to bring by table and number anyway. | The number is what the waiter matches the paper receipt to (#45 comment 2). | firm | D127, #114 |
| 2.3 | Every end state and refusal is worded calmly in Bulgarian and English, never asks the guest to pay twice, never names a step of the till or a POS id, and says "Nothing was charged" wherever true. Martin read them in the prototype. | #114 must find every guest word in #45 or D127. | firm | D127 |
| 2.4 | The smallest card payment is measured on what is held (the lines plus the tip), as the provider does; no item suggestions at the pilot; a bill left under it says only "Card payments start at 0,50 EUR. Add an item or ask your waiter." | The default is 0,50 EUR, so it is almost never hit. | firm | D127 |
| 2.5 | Choosing lines: nothing ticked on opening; a visible "The whole bill"; a tick per line; the Pay button shows the live total; the quantity menu (default "all") only where the connector can move part of a line, whole lines elsewhere. | `2026-10-18-split-payments.md`: "my items" and "pay the rest" are the two modes in scope. | firm | D127 |
| 2.6 | Group payment (several cards) draws no placeholder now; the template must leave room for a later "Share the bill" next to "The whole bill". | Group payment is later (D122 §8). | later | D127, #57 |
| 2.7 | Paying off at the venue: no Pay button, the line "Ask your waiter to pay." Card payments paused while ordering works: Pay greyed with "Card payments are paused right now. Ask your waiter." The ordering pause keeps its own line. | The ordering pause line would be false during a Stripe-only pause. | firm | D127 |
| 2.8 | No location pass means no bill and no order on screen, so nothing to pay: the screen says why, with "Allow location" and Call a waiter. The guide's "paying never needs a pass" is dropped. | D122 §4 already hides the bill without a pass; D118 3.8 is superseded by it. | firm | D127 |

## 3. Martin's answers, round 2 (Call a waiter)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | Restro offers a fixed list; each venue ticks which its guests see: Call the waiter (`waiter`, always on), Bring the bill (`bill`), Ice (`ice`), Water (`water`), Glasses (`glasses`), Clean the table (`clean_table`), Card terminal (`terminal`, off by default). Words in Bulgarian and English are ours; no venue-typed options and no note at the pilot. | Every word must be translated and checked; a free note invites personal data and abuse. The ids replace D71's list (`cutlery`, `other` go). | firm | D127, #180 |
| 3.2 | One open call per table: a second option while the call is open is added to it; Tonight shows "Table 7: Ice, Water" and staff mark it Handled once; the guest sees "Waiter called: Ice, Water". | Less noise on the staff screen than one call per tap. | firm | D127, #180 |

## 4. From the prototype (the lead's, Martin: "feels right")

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | For pay-first lines, the tip row sits on the order screen above "Send and pay 24 EUR". | The tip is fixed before the hold, and one tap leaves no other screen for it. | firm | D127 |
| 4.2 | A Pay refused with "Your bill changed since you opened it." shows the fresh bill and clears only the ticks on lines that changed or went; other ticks stay. A friend's new round never refuses it. | D111: one short message, no list. | firm | D127 |
| 4.3 | "Can't tell", lines that could not go back and a card not charged after the bill closed all show one screen: "The venue is checking the payment. You don't need to do anything." | The guest is never asked to pay again; staff and owners are alerted. | firm | D127 |
| 4.4 | The Paid screen: "Paid", the payment number in large type, the table, the lines, tip and total, "Show this number to your waiter. Your waiter brings your receipt." and "Back to the bill". | #45 comment 2; D122 §8. | firm | D127 |
| 4.5 | A Pay with the same amount as this phone's payment in the last 15 minutes first asks "Same amount as 4 minutes ago. Pay again?" with "Yes, pay" and "Back". | D117's friendly check, worded for paying. | firm | D127 |
