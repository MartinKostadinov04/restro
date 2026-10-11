# Table ordering UI: cart, ordering, live tab, server call, payment, receipt

All screens are UI only, driven by demo data and session state on `/menu`. They do not connect to any real restaurant system, payment provider or receipt generator. Every screen uses the existing colour roles, so all four themes and light/dark work without extra setup.

## What you will see

1. **Quick add on the menu**
   - A round "+" on each dish card. Tapping it adds the dish straight away when it has no required choices. When it does have required choices, the dish page opens.
   - Once a dish is in the bag, the "+" turns into a small "− 1 +" stepper.

2. **Dish page ordering**
   - Choice groups you can tap, showing whether each one is required and how many picks are allowed.
   - A note field.
   - A bottom bar with a "− qty +" stepper and an "Add to bag · price" button. The price updates as choices change.

3. **Bag bar and bag sheet**
   - A bar at the bottom shows the item count and total, with "View bag".
   - The sheet lists each item with its choices and a quantity stepper. You can remove or edit items, add a note to the kitchen and choose "Send to kitchen".

4. **Live tab (whole table order)**
   - Rounds are grouped in time order. Each round is marked as from the app or from the waiter, so waiter orders taken at the till appear too.
   - Each item shows its status: Received, Preparing, Served.
   - Shows a running total for the table and a "Pay" button.
   - Opened from a tab button in the header.

5. **Call a server**
   - A header button opens a short sheet with these requests: Call waiter, Bring the bill, Water, Cutlery, Other with a note.
   - After sending, a confirmation appears with a "Waiter on the way" state you can cancel.

6. **Payment flow**
   - Choose what to pay: Full tab, Split equally between N people, or Pay for my items.
   - Choose a tip (0/5/10/15%/custom).
   - Shows a promo code field and a short allergy note.
   - Pay buttons for Apple Pay, Google Pay, Card and Pay at the table with the waiter.
   - Processing, success and failure screens.

7. **Receipt**
   - A digital receipt with venue, table, date, items, VAT lines, tip, total and payment method, plus a fiscal reference placeholder.
   - Actions: Download PDF, Email receipt, Print / ask waiter. They are buttons only and show a confirmation message.

Motion: sheets slide up and fade in, cards give feedback when tapped, and steppers count smoothly. All of it respects reduced motion. Tap targets are at least 44 px, and the screens are keyboard and screen-reader friendly. Every new label is in both Bulgarian and English.

## Technical section

- Everything lives under `src/features/restro-face/`. New `ordering/` modules: `bag-store.ts` (reducer plus context, session-only), `live-tab.ts` (demo rounds including a waiter round), and the components `QuickAdd`, `Stepper`, `ModifierPicker`, `BagBar`, `BagSheet`, `LiveTab`, `CallServer`, `PaymentFlow`, `Receipt`.
- The face takes optional `ordering` callbacks and data props (`onSend`, `onCallServer`, `onPay`, `tab`). `/menu` connects them to demo handlers. When the props are absent, the face stays browsing-only, so the current contract still holds. Ordering is enabled only when `view.ordering.enabled` is true or the preview turns it on.
- Prices are shown as text the upstream shell provides wherever it exists. Totals in the demo come from the existing `minor` values plus one formatter on the preview side, kept out of the face's business logic.
- Reuse the existing Overlay (focus trap, Escape, scroll lock). Add `#bag`, `#tab` and `#pay` hash states so the phone's back button works.
- Strings go into `guest-strings.ts` (BG/EN).
- Tests cover: required choices block "Add", stepper totals, removing an item, the send action moving bag items into the tab, waiter rounds appearing in the tab, the split-equally amount, and tip percentages.
- Check with Playwright at 360/390/430 px and on desktop, in BG and EN, light and dark.
- Update `AGENTS.md` with a rule that ordering UI receives data and callbacks only.
