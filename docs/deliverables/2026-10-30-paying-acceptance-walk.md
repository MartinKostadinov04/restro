# Paying in the app: acceptance guide (for Martin)

> Filed 2026-10-30 by the paying lead (part 2 of map #29, spec #102). For: Martin's acceptance of part 2 before the pull request from `or/foundation` into `main`. Nothing in this file was run to write it; it lists what to look at.

Everything in spec #102 is built on the branch `or/foundation`. This page says how to set up a local database for paying and what to look at, screen by screen. Each check is one thing to see; if it is not as written, note it and go on. Part 1 (ordering onto the bill, Tonight) is the Ordering lead's walk; this one assumes a guest can already order onto a table's bill.

**The guest page here is the plain test template, and a real venue can't order or pay on it yet.** Ordering and paying reach the server only from the hidden test template; the demo seed puts Demo Bar on it. On the templates a real venue uses, the bill, Pay and Call a waiter stay off until the menu designer's renderer lands (#171, #239; the repair review's RR-60). Judge what the guest can do and the words, not the look. Before any pilot you check ordering and paying again on the renderer, on both Basic and Editorial (named on #171).

Two kinds of check:
- **Local:** your PC, the simulated POS (`sim-pos`) and the simulated payment provider (`sim-pay`). No card, no Stripe. Sections A to F.
- **Sandbox:** the Stripe sandbox ("Restro Sandbox", test mode, never real money). Section G. Two of its checks need a staging deploy and a real phone, so they wait for your OK on staging.

## Before you start (once)

Do the ordering guide first ([2026-10-30-ordering-acceptance-walk](2026-10-30-ordering-acceptance-walk.md)): paying starts from a table with an order on its bill. Steps 1 to 6 are the same in both guides; you need them once.

1. **Check out the branch and install:** `git checkout or/foundation`, `pnpm install`.
2. **The local Postgres** must run (`pnpm db:local` in its own terminal).
3. **A separate database for this walk,** not `restro_accept` (its Demo Club is linked to the real barsy demo installation). Create an empty one, say `restro_accept_pay`, point `DATABASE_URL_OWNER` and `DATABASE_URL` at it and run `pnpm db:migrate` and `pnpm db:roles` yourself.
4. **The demo data:** `pnpm db:seed:dev` (with the demo menu, so without `SEED_DEMO_MENU=0`). It makes **Demo Bar**, a venue on the simulated POS, with ordering, Call a waiter, the bill and paying switched on for guests, drawn by the plain test template (the real guest template comes with the menu designer). Its bars and tables come from the simulator, read by the worker.
5. **Run, each in its own terminal:** `pnpm sim:serve` (the simulated POS), `pnpm dev` (the web app and the worker). Open http://localhost:3000 and sign in as the owner (`owner@demo-club.test`).
6. **Publish Demo Bar once:** Demo Bar › Composer › Publish, so the guest page takes the test template and the guest services.
7. **The paying lines in `.env.local`,** then restart `pnpm dev`:
   - `PAYMENTS_ENV=development` and `PAYMENTS_PROVIDER=sim-pay` (the simulated provider; Section G switches to Stripe);
   - the Turnstile test keys stay as `.env.example` has them (local only);
   - `SIM_PAY_NOTICE_SECRET` as `.env.example` shows.
8. **A phone for the guest:** set `PUBLIC_BASE_URL` to this PC's network address (for example http://192.168.1.20:3000) to scan from your phone on the same Wi-Fi, or open the table's guest address in a narrow browser window. Two phones (or two browser windows) for Section C.
9. **Acting as the waiter at the till:** `pnpm sim-pos waiter add-round --table 7 --items 2001:2,2502` puts a round on table 7's bill; `pnpm sim-pos ops` lists the rest.

## A. The owner's settings: Demo Bar › Settings › Paying

- **Paying is listed** between "Ordering and availability" and Staff and roles, for Demo Bar. It is never listed at a hand-made venue.
- **Before connecting:** "Connect {provider}" is the one filled button, with the line saying the provider asks for the business, bank and ID details and Restro never sees a password or key.
- **Connect:** with the simulated provider it connects at once ("Connected: …"). With Stripe it opens Stripe's own form (Section G).
- **"Before card payments can start"** lists what is still missing, in this order: the provider's own details, "I chose the card payment type in {source}", "Mark a payment table for each bar" (with "Go to Tables & QR"), "I turned off {provider}'s emails to guests about successful payments", "Fill in the venue's details below". Card payments turn on by themselves once every line is done ("Card payments are on."). There is no separate on/off switch (your 10-29 answer).
- **Smallest card payment:** starts at the provider's minimum; you can raise it, not lower it below the minimum; "Use {provider}'s minimum" puts it back.
- **Tips:** one line, no switch. Where the till can put the tip on the same receipt, "Guests can add a tip…"; otherwise "Tips aren't offered…". Which one you see depends on the simulator's scenario; both are correct.
- **The venue's details for guests:** legal name, ЕИК (9 or 13 digits), registered address, privacy notice link (must start with https://). Save is filled only while there are unsaved edits. While an account is connected, the details can't be emptied.
- **Disconnect…** asks "Disconnect {provider}?" with "Disconnect" / "Keep connected". While a guest is mid-payment it refuses ("A guest is paying right now…").
- **Read-only:** a member whose role can't connect payments sees the section with "Only someone allowed to connect payments can change these."

## B. Payment tables and Pay first

- **Tables & QR:** a table's menu has "Use as payment table". The confirmation names the bar and says its code stops for good. Afterwards the table carries the "Payment table" badge and its bar; guests never see it.
- **The banner** "Mark a payment table for each bar so guests can pay by card. Still missing for: …" lists the bars still without one, and goes once each bar has one.
- **Refusals:** marking a table that is open for phones says to close it in Tonight first; unmarking one a payment is going through says to try again in a few minutes.
- **Pay first, venue level** (Settings › Paying, "Pay first" card): "Items without their own choice" (on the bill / pay first), and "Pay first at every table".
- **Pay first per area and table** on Tables & QR, and **per item** on the composer's item sheet and the selection bar ("Pay first" / "On the bill").

## C. The guest pays (phone)

Open a table, have the waiter put a round on (step 9 above), and open the table's page on the phone.

- **The bill:** "Your table's bill", with "Updated {n} s ago"; the lines and amounts are the till's own.
- **Pay:** "What are you paying for?" with your lines to tick and "The whole bill". Nothing ticked: "Choose at least one line."
- **Tip** (where offered): "Tip: goes to the venue", starting at zero, with "Other amount".
- **The total and the legal lines:** "Your items", "Tip", "Total", then "Prices in EUR incl. VAT. Complaints and refunds: the venue.", "Payment processed by … for …", "About the venue" (opens in place; Martin 10-30) with "Company ID (ЕИК): …" / «ЕИК: …», and "Privacy". Both links are easy to tap.
- **Below the smallest card payment:** Pay is greyed with "Card payments start at {min}. Add an item or ask your waiter."
- **Paying:** "Preparing your bill…" (with "Pay later" to cancel), the card form (with the simulator, a single button), "Processing your payment…", then "Paid" with a payment number and "Show this number to your waiter. Your waiter brings your receipt."
- **The receipt by email (optional):** a wrong address says "Check the email address" (Martin 10-30). With an address, the Paid screen says the receipt was sent or requested to it. Receipt emails stay off until the sending address is set (see "Still yours" below).
- **The friend's phone:** while you pay, your lines read "Being paid" with no name, amount or timer, and paying them is refused ("Someone is already paying for this line."). Once paid they read "Paid in the app"; if you cancel, they come back.
- **Payment confirmation:** a paid line opens "Payment confirmation", "Paid by card", with "This is not your receipt. Your waiter brings the venue's receipt." and Save.
- **Refusals in plain words:** the bill changed while paying ("Your bill changed since you opened it."), card payments paused ("Card payments are paused right now. Ask your waiter."), cancelling too late ("Too late to cancel: the payment is being processed.").
- **Same amount twice:** paying the same amount again within minutes asks "Same amount as {n} minutes ago. Pay again?".
- **At the till** (`sim-pos`): the lines moved to the bar's payment table and that bill closed with the card payment type (and the tip, where offered).

## D. Pay first (phone)

Set an item to Pay first (Section B) and order it from the phone.

- **At Send** the phone asks for the card first; the order reaches the till only after the card is held.
- **Paid:** the order sits closed on a payment table of its bar; the phone shows the payment number. Pay-first payments take paper receipts only (no email).
- **Without paying** (Paying not ready): the item says "Order this from your waiter".

## E. Tonight (tablet and a manager's phone)

Most of these need a payment that went wrong. With the simulator, the Ordering lead or I can stage each one on request (the end-to-end fixtures already do).

- **"Payment not confirmed"** on top of "Needs you": the bill's close couldn't be proven. "Receipt printed" captures; "No receipt" releases the hold. A pay-first order asks "Is the order on the till?" with "On the till" / "Not on the till". On the shared tablet a manager's PIN is asked, and the PIN confirmation shows the true charge with the tip; staff rows stay tip-free (your 10-29 answer). A waiter's own phone shows "A manager or owner answers this." and no buttons.
- **The paying banner** for everyone when card payments pause or access is lost, with "Reconnect" only for those allowed to connect payments.
- **"Bring the receipt" / "Brought"** after a paid payment.
- **Refunds and disputes made in the venue's Stripe Dashboard:** "Storno done" on the payment, the dispute to-do and "Dispute evidence". A refund that failed at the bank shows a row; until the "Got it" button (Martin 10-30) is built, it leaves by itself after three days.
- **Undo:** each staff Undo works within its time window; afterwards «Твърде късно за отмяна.» / "Too late to undo.", and «Някой друг вече промени това.» / "Someone else has changed this since." when someone else changed it first (Martin 10-30).
- **End of night:** the payments, "To fix" (including earlier nights' open questions, marked «От вечерта на {date}» / "From the night of {date}"), the released payments with their reason, refunds and disputes, the totals. Staff see every amount without the tip; owners see the tip. The CSV export follows the same rule.
- **Log:** each payment step that matters (held, closed, captured, released, unconfirmed, staff answers), and the payment sheet with everything about one payment.
- **Telegram:** counts only, never amounts or tips.

### Words added during the build, still to confirm (from the Tonight screen plan)
- The released-payment reasons «сметката се промени» / "the bill changed", «трябва сервитьор за разделянето» / "a waiter has to split it", «артикул свърши» / "an item ran out", «касата не прие поръчката» / "the till didn't take the order".
- Disputes still open on End of night: «Още отворени спорове: {n}» / "Disputes still open: {n}".
- Money toasts don't name the person (the Log does).

## F. When things fail (optional, on request)

The route is covered by tests with a fault at every step (a crash, a timeout, the till or the provider refusing). If you want to see one, ask and one is staged on the simulator: a guest's payment that can't get a free payment table ("busy", released), the till not answering at the close ("Payment not confirmed"), the provider down (card payments pause and come back by themselves while ordering to the bill goes on).

## G. The Stripe sandbox

Switch `.env.local` to Stripe: `PAYMENTS_PROVIDER=stripe`, your restricted key as `STRIPE_SECRET_KEY` (already there since 10-26) and the sandbox publishable key as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_…). Restart `pnpm dev`.

1. **Connect:** Settings › Paying › "Connect Stripe" opens Stripe's hosted form; in test mode Stripe offers test values for every field. Back in Restro: "Connected: …", and the checklist from Section A. (Whether Stripe's form returns to a `localhost` address in test mode is not checked yet; if it doesn't, this step waits for staging.)
2. **A card payment** from the guest page with Stripe's test card 4242 4242 4242 4242 (any future date, any CVC): Paid, and in the Stripe Dashboard (test mode, the venue's connected account) the payment is captured for exactly the total.
3. **3-D Secure** (sandbox check 6, not yet run): test card 4000 0027 6000 3184 opens the bank's check inside the page, with no redirect, and ends Paid.
4. **Your sandbox check: a refund that fails.** Pay with test card 4000 0000 0000 5126 (Stripe's "refund fails" card), then refund it in the Stripe Dashboard. Stripe first shows the refund as made, then failed. Expected in Restro: the refund appears, then the refunded total drops back and the failed-refund row shows on Tonight. Without a staging address the notice can't reach your PC, so Restro only learns of it when it reads the payment back; the full check is on staging.
5. **Sandbox checks 4 and 5** (#117), on staging only: Stripe's signed notices reach the app, and Apple Pay and Google Pay show on a real phone. They need your OK for a staging deploy.

## Still yours, outside this walk

- **The address receipts are sent from.** Restro has no sending domain yet. Recommendation: a subdomain of Restro's own domain used only for mail, `receipts@mail.<restro's domain>`, shown under the venue's name ("Club X <receipts@mail…>"). Once you have the domain: verify `mail.<domain>` in Resend, then the address goes in `RECEIPT_FROM_ADDRESS` with `RESEND_API_KEY` (on the server, never in chat).
- **Staging:** your OK for the deploy that sandbox checks 4 and 5 need, PR #203 and PR #199 into main, and the staging migration.
- **The pull request from `or/foundation` into `main`,** after this walk; you merge it.

## What to report

One line per check that is not as written: the screen, what you saw, what you expected. Wording remarks: the key or the sentence as shown, and what it should say.
