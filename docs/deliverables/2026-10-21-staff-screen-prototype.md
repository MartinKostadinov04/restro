Made by: staff screen prototype agent (Opus), 10-21. For: Martin and the lead. Prototype: `2026-10-21-staff-screen-prototype.html` (open it in a browser; switches at the top).

# The staff screen: a static prototype

## Name: **Tonight**
Board Q5's name, kept: it says the scope (one service day), and it is short in Bulgarian ("Тази вечер"). It replaces GLOSSARY's "operations panel".

## Composition, and why
- **Header:** ordering's state as word, icon and colour ("Ordering on", "Bar 2 paused · Georgi 01:41", "Paused by Restro"), with **Pause ordering** beside it. The one venue-wide control is always on screen.
- **Alerts pane**, the heart: always visible on the left of the tablet, and the first tab, with a badge, on the phone. Cards in order of urgency:
  1. Restro's own pause (blue, plug icon, "lifts by itself", no button);
  2. unconfirmed sent orders (reference in 48 px, items, time, "Bill before this order", two answers);
  3. guard pauses, with "Resume table";
  4. a staff pause (amber, hand icon, "Lift pause");
  5. last orders;
  6. "Handled tonight", folded;
  7. a dashed "Call a waiter · Later" slot;
  8. a violet "Phase 2 · not built" payment card.
- **Work tabs:** Tables · Sent orders · Sold out (and Log, for managers). Tables are grouped by bar, because pauses and tickets go per bar. Each tile shows Closed ○, Open ✓, Paused ॥ or Alert ⚠, with a one-tap Open/Close. A table's sheet holds the bill, "New guests" and the sitting's sent orders.
- **Both devices:** the same parts; two columns on the tablet, one column and a bottom bar on the phone.
- **Roles:**
  - Staff on the shared tablet: no Log or Settings. Answers, "Resume table" and "Open all" take their own PIN. Lifting a pause takes a manager's PIN (Q4's default).
  - A manager on their own device: no PIN, plus the Log, the night summary, the Settings link and lifting pauses.
- **Telegram:** the same alert with "Done", edited to "✓ Done by Maria, 02:14". An unlinked user gets "Open the admin to do this".

## Tap counts (bar tablet, staff)
| Action | Taps |
|---|---|
| Open or close one table | **1** (closing offers Undo, not a dialog) |
| Answer an unconfirmed sent order | **1 + PIN** (manager's phone or Telegram: 1) |
| Resume a paused table | **1 + PIN** |
| New guests | **2**, with Undo |
| Pause one bar | **2** (Pause ordering, then Bar 2) |
| Open all / Close all | 2 + PIN / 2 |
| Mark an item sold out | **2 + typing** |

## Copied from comparable products
- **Toast:** snoozes online ordering from one dropdown with set durations ([Toast](https://support.toasttab.com/en/article/Managing-Third-Party-Availability-Through-the-Snooze-Feature-and-the-On-Off-Function)). Shared terminals use personal passcodes, with manager approval. Copied: the pause dropdown, the PIN on a shared device, a manager's PIN as override.
- **Square:** shows a pause and lets you resume at once from the Orders screen ([Square](https://squareup.com/help/au/en/article/8325-manage-order-timing-with-square)). Copied: the pause is always visible, with who set it and one tap to lift it.
- **Sunday for staff:** alerts per table, with servers filtering their tables ([Sunday](https://sundayapp.com/?p=43982)). Copied: the alert list as the heart, and the "Needs you" filter.
- **Kitchen display screens:** big ticket numbers, one tap per ticket. Copied: the large reference, one decision per card.
- **PagerDuty in Slack** (board Q5): you acknowledge from the chat and the message is edited. Copied for Telegram.
- **Platform reference:** no staff panel there; only its badge and empty-state patterns.

## Open UX questions (each with a recommendation)
1. **A PIN to open one table?** Recommendation: no, logged as "bar tablet". Only "Open all" needs one; the other guards still run.
2. **Who lifts a staff pause?** Q4's default sends a bartender who paused for ice to find a manager. Recommendation: staff lift a staff pause with their own PIN. Nobody at the venue lifts Restro's pause.
3. **Telegram "Done" on an unconfirmed sent order** doesn't record whether it landed. Recommendation: offer "Found on the bill" and "Not on the bill" there too, and keep "Done" for the other alerts.
4. **One answer also resumes the table, and closing uses Undo, not a dialog** (as prototyped). Recommendation: keep both; the sitting ends when the Undo window closes.
5. **Sold out for staff:** the code allows only owner and admin (`canMarkSoldOut`), while Q4 gives it to staff. Recommendation: give it to the staff default role in the roles work (TS1).
6. **"My tables" on a waiter's phone** needs table assignment, which Restro doesn't have. Recommendation: show all tables at the pilot, and add the filter with the watches.
7. **Bulgarian:** about 40% longer ("Затвори всички", "Има го в сметката"). Recommendation: buttons wrap, never truncate; the tile grid still fits ("BG lengths" switch).
