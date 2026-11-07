# Walk-through of st/foundation, once, before it goes to main (for Martin)

> Filed 2026-11-07 by a Sonnet bookkeeping session. Written from the two ledgers (the repair review's `findings.md`, the designer audit's `findings.md`), the merged pull requests #300, #310, #313, #314 and #317, and the code on `st/foundation` (70e88983). **Nothing here was run on screen**; where the code or ledgers did not say, it is written as an open point. Your answers go in the right-hand "Your answer" lines: *yes* (leave it) or *change it* (a word is enough).

What the two surfaces should feel like: the guest's page is a well-made template (D105); the owner's and staff's screens are calm, plain-worded, few taps (D107, D123). The older [ordering](2026-10-30-ordering-acceptance-walk.md) and [paying](2026-10-30-paying-acceptance-walk.md) guides still list what every ordering and paying screen does; two things in them are out of date: the guest page is no longer the plain test template, and "Only at tables a waiter has opened" is gone.

## 1. How to open it

Use your own port and database so your day-to-day setup (port 3000) and the Design lead's `restro_design` stay untouched. Here: port **3100**, worker health port **8181**, database **`restro_walk_st`**. In the repo folder, one terminal each:

```bash
git checkout st/foundation
```
```bash
pnpm install
```
```bash
pnpm db:local
```

Then, in a fifth terminal, make an empty database called `restro_walk_st` (open point 1: the old guides don't give the command) and put these in your `.env.local`, *only for this walk*:

- `DATABASE_URL` and `DATABASE_URL_OWNER` ending in `/restro_walk_st` instead of `/restro`
- `BETTER_AUTH_URL=http://localhost:3100` and `PUBLIC_BASE_URL=http://localhost:3100`
- `WORKER_HEALTH_PORT=8181` and `WORKER_REVEAL_URL=http://localhost:8181`
- `PAYMENTS_ENV=development`, `PAYMENTS_PROVIDER=sim-pay` (paying only needs the simulated provider here)

```bash
pnpm db:migrate
```
```bash
pnpm db:roles
```
```bash
pnpm db:seed:dev
```
```bash
pnpm sim:serve
```
```bash
PORT=3100 pnpm dev
```

(On PowerShell: `$env:PORT=3100; pnpm dev`.) Open http://localhost:3100 and sign in as `owner@demo-club.test`. The seed makes **Demo Bar** on the simulated POS with ordering, Call a waiter, the bill and paying switched on, and twelve tables read by the worker. Open Demo Bar › Studio and press **Publish** once so the guest page takes the current look. To act as the waiter at the till: `pnpm sim-pos waiter add-round --table 7 --items 2001:2,2502`; `pnpm sim-pos ops` lists the rest. For the guest's phone, use a narrow browser window (about 390 px) on table 7's address (Tables & QR › tap the code), or your phone with `PUBLIC_BASE_URL` set to this PC's address. Switch the location check off in Settings › Ordering for sections 3 to 5, back on for 3.5.

## 2. The owner's admin (laptop, then once on your phone)

**2.1 Venues list and Demo Bar.** *See:* one card per venue, state Draft or Live, Open / Preview menu. Two taps from the list to any screen in the venue (the admin map `docs/guides/admin-map.md` lists every screen). *Your answer:* does it feel clean and findable? yes / change it.

**2.2 Studio › Structure (the menu composer).** Tap a section, hide an item, mark one sold out, rename. *See:* each is one or two taps with an Undo, no confirmation boxes. A **sold-out item no longer appears on the guest menu at all**. The staff line used to say "Greyed out on the menu"; #317 (DA-14) changed it. *Your answer:* does the new sold-out wording read right? yes / change it (DA-14).

**2.3 Studio › guest features ("Функции за гостите").** Switch Call a waiter, Bill, Ordering and Pay on and off. *See:* the switches take effect on the guest page after the next Publish. *Your answer:* clear which switch does what? yes / change it.

**2.4 Studio › Design.** *See:* Simple level (Style tiles, three colours, fonts, logo, layout) and Advanced; **My styles**; a live preview beside it with Phone, Tablet and PC widths; Undo, Done, Cancel. Pick a Style, press Done, Publish. The five Styles are the heart of what you are judging: *do they look good, and does each one feel right for a club?* yes / change it, per Style. (The audit could not judge this; only you can.)

**2.5 DA-18, the open eye item.** Set the layout to *Large* names with *two columns*. *See:* the dish name is drawn at 14 px, *smaller* than the 16 px price beside it. The audit ruled it an accepted departure from the old look. *Your answer:* leave / change it (DA-18).

**2.6 Deploy-day note, DA-O4.** On the day this goes live, every live venue's page moves to the **Basic** look; each owner gets a Style back by picking one and publishing. Not a screen: *do you accept that?* yes / change it.

**2.7 Settings › Ordering, Paying, Staff and roles.** Skim only. *See:* plain words, no greyed buttons for a role that may not act (RR-80, RR-90). Settings › Ordering's location check is on by default.

## 3. The guest's phone (menu → bag → bill → call → location → weak line)

**3.1 Menu.** Open table 7's address. *See:* the page in the Style you published. *Your answer:* happy with the look on a real-feeling phone width? yes / change it.

**3.2 Bag and Send.** Ask a waiter to open table 7 first (section 4.1), then add two items and Send. *See:* "Sending…", then "Added to your bill". With a pay-first item below the venue's smallest card payment (#300, DA-1): that part is drawn greyed with **"Your bill is under the minimum for card payment"** and a **Pay cash** button, and the other lines still send. If another payment runs: **"Another payment is in progress, try again in a moment"**. *Your answer:* are these three lines the words you want? yes / change it (DA-1).

**3.3 Bill.** *See:* the till's lines and total; a discount line reads **"-4,00 €"** as its own line (#300, DA-8). *Your answer:* does a minus line read right for a guest? yes / change it.

**3.4 Call a waiter** (#313, #317). Tap it, pick Ice, then add Water while the call is open. *See:* one call showing both kinds joined; there is **no Cancel button** (a deliberate choice: the team cannot take one back). Bulgarian: when staff mark it handled the phone says **«Повикването е прието»**. With the connection cut mid-call: "We can't reach Restro right now. If nobody comes in a few minutes, please ask a waiter in person", with "Try again". Refusals now say why (calls off, kind not offered). *Your answers:* (a) is "no Cancel" fine? (b) is «Повикването е прието» the right Bulgarian for "your call was handled" (it also reads like "accepted")? yes / change it (DA-2, DA-10, DA-27, DA-7). DA-O14 stays open: the pay, bill and location sheets lock instead of offering "Try again"; is that a difference you care about?

**3.5 Location check** (#314). Switch the check on, scan, tap **Allow**, then check the stop. *See:* **"Stop location check"** on the bag, the bill, Pay and Call a waiter sheets, even with Bill off. After Not now or Stop, tapping "+" now says "Allow location to see and add to your table's order and bill" with an **Allow location** button over the menu bar (DA-22). *Your answer:* is the stop easy to find and the reason clear? yes / change it (DA-9, DA-22).

**3.6 Weak connection** (#314, DA-23). Turn the phone's Wi-Fi off, add an item. *See:* the line **"Weak connection. Nothing new was sent yet, we keep trying."** on the menu itself, not only inside the bag. *Your answer:* yes / change it.

**3.7 Pay (drawn, parked for now).** *See:* a slim **"Payment in progress, tap to see"** line on the menu while a payment is unsettled (DA-24); the **Paid** number is now large (48 px) so a waiter can read it across the bar (DA-11); the tip resets after a payment starts (DA-6). Only the simulated provider is used here; the real card form is not part of this walk. *Your answer:* is the Paid number big enough to read from arm's length? yes / change it.

## 4. Staff: Tonight screen (tablet window ~1180 px, then your phone)

**4.1 Open tables.** Make a shared device ("Bar tablet") in a second browser; open table 7 with a staff PIN ("Table 7 is open for phones"). *See:* wrong PIN says so. The tablet takes only a staff account (#306). *Your answer:* does opening a table feel like few taps? yes / change it.

**4.2 Needs you.** Make a call from the guest phone. *See:* "Table 7: Ice" with **Handled**; it appears within about ten seconds; Needs you comes first, then the tables. After Handled, the Log line carries the table. *Your answer:* readable at first sight (calm, one accent, per your 10-21 note)? yes / change it.

**4.3 Sent orders, Log, End of night.** *See:* a sent order shows its POS bill number; Log lines name who did it ("· who"); money rows on a manager's phone show the tip, on the tablet they don't (by design). *Your answer:* skim; anything confusing? yes / change it.

**4.4 Offline.** Turn the tablet's Wi-Fi off, press Handled. *See:* the screen stays, with one calm line (RR-78, RR-88), not the browser's offline page.

## 5. Open wording and design points for your judgment

1. Sold-out staff text (DA-14) and the sold-out guest menu: item gone, not greyed.
2. «Повикването е прието» (DA-2 in Bulgarian).
3. "Your bill is under the minimum for card payment" and "Pay cash" (DA-1).
4. No Cancel on an open call (DA-10).
5. Large name, two columns: name smaller than price (DA-18).
6. The five Styles: your taste call.
7. DA-O14: three different behaviours for a lost call (see 3.4).
8. DA-O4: every venue lands on Basic on deploy day.
9. DA-O16: "Stop location check" is also on the Pay sheet, so a guest can stop the check with the card form open and the bill hides at once (see 3.5). Leave it, or take it off Pay?
10. DA-O17: the call panel's title should say why a call was lost (no connection vs. refused); this waits until paying is released.

## Open points I could not resolve

1. **Creating the empty database `restro_walk_st`:** no guide gives the command; the lead should supply it (or set the whole thing up for you as for the repair-review hands-on).
2. *(Resolved by the lead: DA-O16 and DA-O17 sit in the ledger on `or/foundation`; added to section 5 as points 9 and 10.)*
3. **Guest features** sits in the Studio per the Bulgarian string "Функции за гостите"; I did not confirm its exact tab or button name in the English admin.
4. **The `PORT=3100` hint** relies on Next's standard variable; not tried, and the web app's `BETTER_AUTH_URL` must match the port or sign-in fails.
