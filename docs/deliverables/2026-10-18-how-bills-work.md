# How bills work: tables, parallel bills and part payments

Made by: the lead session (Opus), 10-18, for Martin. Martin asked for it after the grillings #35 and #36 disagreed ("I don't know if you tie bills to a table, if paying partially opens a separate bill, if a table can have bills in parallel"). For: every later grilling of map #29 (#37 onward), to start from the same facts rather than from each other's workarounds.

This is a summary of research already filed. It adds no new facts. Sources:
- `2026-10-18-bill-in-pos-systems.md` (Toast, Square, Lightspeed, Simphony, Microinvest, Zamboo);
- `2026-10-18-barsy-api-reference.md` (barsy, read signed in);
- `2026-10-18-how-qr-apps-write-orders-into-pos.md` and `2026-10-18-table-visit-in-other-software.md` (other QR products, #36).

What binds is D111–D113 and the decision #36 records.

## 1. The three answers

These are true in barsy and in every POS read.

- **A bill is the real object; a table is only a label on it.** A bill holds the items owed and the payments made, stays open until it is settled, and is then closed with a fiscal receipt. The table is an optional field on the bill. Bills with no table exist: the bar, delivery, a named tab. No POS has a "table" or "visit" record of its own. "The table is busy" means "at least one bill on it is open". barsy's tables carry only a count of their open bills.
- **A table can hold several open bills at once.** A waiter usually keeps one bill per table and adds each new round to it. A second group at the same table, or a guest who wants to pay separately, gets a second bill on the same table. Staff can merge a table's bills in one action (barsy: `Accounts_mergebyplaceid`, which merges into the oldest).
- **Whether paying part opens a separate bill depends on how it is paid:**

| How | What happens in the POS | barsy | Restro |
|---|---|---|---|
| **Pay for my own items** (split by items) | The chosen lines move onto a new bill, which is paid and closed with its own receipt. The rest stays open. | `Accounts_divide`, then pay and close | Chosen (D112): it gives a clean receipt and avoids the Н-18 чл. 26а form |
| **Pay an amount** off the bill (or an equal share) | No new bill: a payment is recorded on the open bill, which stays open until the remainder is zero. | `Payments_create` with the bill in its `accounts` list, or a payment link with `request_sum` | Parked: whether a fiscal receipt prints, and how чл. 26а applies, is unknown (Q82.1) |
| **Pay first** (pay before the order goes in) | A bill is opened, paid and closed in the same moment, labelled with the table. | `Accounts_place` with the payment and closing in one call | Chosen for pay-first items (D112, D113) |

## 2. How a waiter works, and so how Restro works

A digital waiter (D110) does the same:
1. The first round on an empty table opens a bill.
2. Every later round is added to that bill.
3. A guest who wants to pay their own part gets their items split onto a new bill, which is paid and closed.
4. Whatever is left is paid at the end, and the bill is closed.

A closed bill drops off the floor plan and lives only in the POS's reports. The waiter links bills to people by the table plus memory, and sometimes a name on the bill (barsy: `account_alias`, a client).

What other QR products do agrees with this. Toast (group ordering), Qerko (`toBill` when the table has an open bill, `toTable` when it is empty) and storekit on Lightspeed add a guest's round to the table's open bill. No product documents "a new bill for every order" as its design.

## 3. Why #35 and #36 disagreed

- **#35 (D112) chose a new POS bill for every guest order.** The reason was technical. barsy refuses a duplicate only when a *new* bill is created (`uuid`). For a round added to an existing bill, it documents no protection and no way to look the round up. So after a timeout, sending again could double the drinks.
- **#36 found that this is not how anyone else works.** It proposed the waiter's way instead: add rounds to the table's open bill. If a call times out, never send it again; read the bill back and look for rows entered by Restro's own POS user after the order went out. barsy records who entered each row: `OrderData.user_name`, and Restro has its own POS user under rule 9. Martin accepted this on 10-18 (#36, Q16–Q18). It replaces D112's "one POS bill per order".
- **The guests' view did not change:** one bill per table (D111). Under #36 it is the table's open POS bills. A bill that closes (a paid split, a pay-first drink) drops off it, as it drops off the waiter's floor plan. There is no "visit".

## 4. What is still unknown

- **Whether "read back instead of resending" works in practice.** It is Restro's design, not a documented barsy feature, so it must be proven on barsy's test environment before it is built. If Lukanet confirms that an integrator can set `order_ref_id` on a row (Q82.3), the check can use Restro's own id instead of the POS user.
- **Paying an amount off an open bill** (the second row of the table): Q82.1, and the fiscal form of чл. 26а.
- **Mistral:** none of this has been read for it yet (`docs/connector-questions.md`).
