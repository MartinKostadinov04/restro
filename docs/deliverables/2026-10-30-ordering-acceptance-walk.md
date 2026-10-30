# Ordering in the app: acceptance guide (for Martin)

> Filed 2026-10-30 by the ordering lead (part 1 of map #29, spec #64). For: Martin's acceptance of part 1 before the pull request from `or/foundation` into `main`. The set-up was run on a fresh local database to write it; the checks below list what to look at and were not walked screen by screen.

Everything in spec #64 is built on the branch `or/foundation`. This page says how to set up the local demo and what to look at, screen by screen. Each check is one thing to see; if it is not as written, note it and go on. Paying (part 2) has its own guide, [2026-10-30-paying-acceptance-walk](2026-10-30-paying-acceptance-walk.md): do this one first, since paying starts from a table with an order on its bill.

**The guest page here is the plain test template.** The real guest template is designed last (D122) and comes with the menu designer (#168). Until then the only template that orders is the hidden test one, and the demo seed puts Demo Bar on it. Judge what the guest can do and the words, not the look. **A real venue can't order yet:** Editorial Market, the template venues get, doesn't draw the shared order until #239. Accepting this guide accepts how ordering behaves, not the screens real guests will see.

## Before you start (once)

Steps 1 to 6 are the paying guide's "Before you start"; you need them once for both guides. The paying lines in `.env.local` can wait until the paying guide.

1. **The branch:** `git checkout or/foundation`, `pnpm install`.
2. **The local Postgres** in its own terminal: `pnpm db:local`.
3. **A separate database,** say `restro_accept_pay`; point `DATABASE_URL_OWNER` and `DATABASE_URL` at it, then `pnpm db:migrate` and `pnpm db:roles`.
4. **The demo data:** `pnpm db:seed:dev`. It makes **Demo Bar** on the simulated POS, with ordering, Call a waiter, the bill and paying switched on for guests, drawn by the test template. Running it again puts those back.
5. **Run,** each in its own terminal: `pnpm sim:serve` (the simulated POS), then `pnpm dev` (the web app and the worker). Open http://localhost:3000 and sign in as the owner (`owner@demo-club.test`).
6. **Publish Demo Bar once:** Demo Bar › Composer › Publish, so the guest page takes the test template and the guest services. Its two bars and twelve tables come from the simulator, read by the worker.
7. **Acting as the waiter at the till:** `pnpm sim-pos waiter add-round --table 7 --items 2001:2,2502` puts a round on table 7's bill; `pnpm sim-pos ops` lists the rest. Table 1 to 6 are the Main hall (Main bar), 7 to 12 Upstairs.
8. **Three windows:** your own sign-in (owner); a second browser, or a private window, made the **bar tablet** in Section B; and the guest's phone (your phone on the same Wi-Fi with `PUBLIC_BASE_URL` set to this PC's address, or a narrow browser window). A second phone, or a second narrow window, for the friend at the table.
9. **The location check is on by default.** For Sections D to F switch it off (Settings › Ordering › "Check guests are in the venue"); Section G turns it back on.

## A. The owner's settings: Demo Bar › Settings

- **Your password again:** after 15 minutes, changing a setting asks "Enter your password to change settings". A PIN never opens settings.
- **Hours:** a line per weekday ("{opens} – {closes} · last orders {last}"), times after midnight marked "(next morning)". Wrong times say why ("Last orders must come after opening.", "Closing must be before the night ends (07:00)."). "Same hours on" copies a day to others. "Before opening": the connection check from two hours before, with an alert 30 minutes before if the POS still doesn't answer.
- **Ordering:** "Only at tables a waiter has opened"; "Largest order on the bill without paying first" (or "No limit"); "Check guests are in the venue" with the venue's spot ("I'm at the venue – use this spot"), how far counts as inside and how long a passed check lasts; "Most orders per table in 15 minutes"; "A waiter call waits". Turning the check off warns: "Anyone with a photo of a table code could order onto that table's bill."
- **Staff and roles › People:** "Add person" with a name and a role, no email. It shows "{name}'s PIN is {pin}. They use it on the bar tablet." The eye button shows a PIN again; "New PIN" makes another. Add one Staff and one Manager for the next sections.
- **Staff and roles › Roles:** Staff, Manager and Owner are marked Default and can't be changed ("Copy one to change it"). A copy can take or lose rights, grouped as Tonight, Records and Settings; you can't give a right you don't hold.
- **Staff and roles › Shared devices:** in the second browser, signed in as you, "Make this browser a shared device", named "Bar tablet". From then on it asks a PIN for every action and can't open settings.
- **Alerts:** "On their phones" per person, with the devices where Restro is installed. "Telegram group" and the per-person Telegram link need a Telegram bot set up on this PC (`TELEGRAM_BOT_TOKEN`), and phone alerts need push keys (`VAPID_…`). Both are optional here; without them, look only at the words.

## B. Tables & QR

- **Codes:** each table has "Create code", then "Code active". "New code" asks "Make a new code for table {table}?" and says printed stickers stop working. A scanned old code tells the guest "This table code has changed. Scan the code on your table again."
- **Print sheet:** six codes on each A4 page, area by area; hidden areas and tables are left out.
- **The QR dialog** shows the address in the code. Open table 7's address on the guest phone for the next sections.

## C. Tonight before guests (the bar tablet)

- **Empty state:** "Tables aren't open yet", "Open them for phones to start ordering."
- **Open one table:** tap table 7, enter a staff PIN: "Table 7 is open for phones". A wrong PIN says "Wrong PIN. Try again."; too many wrong ones make the tablet wait.
- **Open all:** asks a manager's PIN ("This PIN belongs to staff. A manager's PIN is needed." for a staff PIN): "{k} tables opened for phones", with Undo for a few seconds; afterwards "Too late to undo."
- **Tables** by bar, each Open, Closed or Paused, and "{o} of {t} open for phones".
- **On your own phone** (your sign-in, not a shared device) the same screen needs no PIN; the Log names you.

## D. The guest orders (phone)

- **Table not open:** the menu shows as usual, with "Ask your waiter" instead of ordering.
- **Adding:** "Add to bag" on an item puts it in "Table order". The friend's phone shows the same order within a couple of seconds.
- **Changing:** one more / one less; Remove shows "{name} removed" with Undo.
- **Send:** the button says what it does ("Send 3 items"). The phone that tapped shows "Sending…"; every phone shows the lines "Being sent", then "Added to your bill". At the till (`sim-pos`), the round is on table 7's bill.
- **Same again:** sending the same order within minutes asks "Same as 4 minutes ago. Send another?" with "Send another" / "Cancel".
- **The bill:** "Your table's bill" with the till's lines and total, and "Updated {n} s ago"; an item the menu doesn't know reads "Other item".
- **Notes:** at a POS that can't take notes, a fixed line "Allergies or special requests? Tell the staff."; an item with a required choice says "Order this from your waiter".
- **Earlier order:** an order left untouched for a while is set aside; the phone offers it back as "Earlier order" with "Restore" until the table's bill closes.
- **Call a waiter:** the waiter button offers the kinds (waiter, the bill, ice, water, glasses, clean the table, card terminal), then "A waiter is on the way". On Tonight, Needs you shows "Table 7: Ice" with "Handled".
- **Weak signal:** turn the phone's Wi-Fi off mid-order: "Weak connection. Nothing new was sent yet, we keep trying."
- **First item:** on a table with no bill yet at a POS where Restro can't open one, Send says "Ask your waiter to put your first item on, then send again."

## E. When something goes wrong

Each is staged on the simulator; `pnpm sim-pos scenario demo-bar` puts the plain demo back afterwards.

- **Out of stock in the POS:** `pnpm sim-pos waiter sold-out --article 2003` (Mojito). The phone greys Mojito out ("Sold out"); an order holding it offers "Send the other {n}". Tonight shows "Out of stock in {source}: Mojito. Greyed out on the menu." If it runs out at the very moment of Send, nothing of that order is sent: "Nothing was sent: something ran out. Send the rest when you're ready."
- **The POS doesn't answer at Send:** `pnpm sim-pos scenario send-unconfirmed`, open table 1, send one Mojito. The phone says "Not confirmed: show {ref} to your waiter", with "Show this to your waiter" (the items, the time, the reference large). Tonight: "Sent order not confirmed", "Bill before this order: {amount}", "Is it on the bill?" with "Found on the bill" / "Not on the bill". Table 1 is paused until someone answers.
- **The order lands but the answer doesn't:** `pnpm sim-pos scenario send-lands-then-hangs`, the same Send: Restro reads the bill back and finds it, "Added to your bill", with no question for staff.
- **The POS is down:** `pnpm sim-pos waiter offline --login restro`. Within a minute every phone says "Ordering is paused right now, please order from a waiter." and keeps the order; Tonight shows "Restro paused ordering because it can't reach {source}…" with no button. `online` brings it back and the pause lifts by itself.
- **A staff pause:** "Pause ordering", All bars or one bar: "Ordering at {scope} was paused by {who} at {time}." "Resume ordering" asks a manager's PIN.
- **Last orders and closing:** set today's last orders ten minutes from now: the phone shows "Last orders at {time}", then "Ordering from phones has closed for tonight". At closing every table closes for phones by itself.

## F. Tonight during the night

- **Needs you** comes first, ordered by what costs most to leave: an order that couldn't be confirmed before a waiter call. Empty: "Nothing is waiting".
- **A table's sheet:** "{bar} · open since {time}", its sent orders and bill, "Close for phones" (with Undo) and "New guests". New guests asks "New guests at table 7?" and says the old order and the phones' permissions are cleared while the bill in the POS stays; the friend's phone has to scan again.
- **Close all…** asks "Close all tables for phones?" with "Close all" / "Keep open".
- **Sent orders:** every order of the night with its state (Waiting, Sending, Checking, Added, Not sent with a reason such as "sold out" or "ordering was paused", Check the bill), searchable by reference or table.
- **Log:** filter by Orders and tables, Pauses and alerts, Settings and staff; each line names the person, "the bar tablet", "A guest's phone" or "Restro". "Night details are kept 31 days. Settings and staff changes are kept 18 months."
- **Export:** a date range, "Download sent orders" and "Download the Log".
- **End of night:** "To fix" (an order still unconfirmed), the sent orders ("{n} sent · {a} added · {ns} not sent · {u} unconfirmed"), the totals, and "Download CSV".
- **The alert sound** on the tablet, with "Mute the alert sound".

## G. The location check (phone)

Turn "Check guests are in the venue" back on and set the spot where you are ("I'm at the venue – use this spot").

- **First add:** a short consent screen saying the venue and Restro check the location so only guests at the table can order onto its bill, never stored, with "Allow" and "Not now".
- **Not now:** the order and the bill stay hidden with "Allow location to see and add to your table's order and bill."; your own "Allow location" brings the consent back.
- **One check is enough:** after one passed check, adding more asks nothing for the sitting (2 hours by default). Removing a line and Undo never ask.
- **Failed:** move the spot far away (or deny location): "We could not confirm you are at the venue.", with "Call a waiter" and "Cancel".

## Still yours, outside this walk

- **The words still to confirm** from the Tonight screen plan, Bulgarian included: read them as you go and note any you'd change.
- **The pull request from `or/foundation` into `main`,** after this walk and the paying one; you merge it.
- **Staging:** the migrations and the deploy wait for your OK, as before.

## What to report

One line per check that is not as written: the screen, what you saw, what you expected. Wording remarks: the sentence as shown, and what it should say.
