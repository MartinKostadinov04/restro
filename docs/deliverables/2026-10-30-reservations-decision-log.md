# Decision log: reservations, contesting the Club Biad MVP

Made by: the Port flow lead session, 10-30, with Martin. For: anyone who needs every reservations decision of this port at a glance. Sources: `2026-10-30-reservations-port-inventory.md` (RV rows), `2026-10-30-reservations-port-stories.md` (RS rows), `2026-10-30-club-biad-verdict.md`.

Martin's rule (10-30): every decision in the MVP's records is contested first and only then consumed here. Their rows are imported as **open**, grouped by feature, and become ours only through his answer.

**Status:** firm, later, on request, out, open. **Recorded in** names the binding text once a row is firm; an open row names the question that settles it. A decision Martin changes is marked as replaced, never deleted.

Features, in the order given to Martin 10-30: 1 Places and the floor plan; 2 A reservation and its life; 3 Walk-ins and waiting list; 4 Working the night; 5 Blocked places; 6 Closing the evening and undo; 7 Deposits; 8 Guest contact details and regular clients; 9 History and our Log; 10 Who may do what; 11 What the verdict put later.

## Feature 1: Places and the floor plan

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | A venue has 118 reservable places: 76 tables and booths, 42 bar stools (RV-362, RV-363) | One club's paper plan | out | Contested: each venue's own data (1.29, 1.37) |
| 1.2 | The plan is traced from a photo and written into the program; changing it takes a developer (RV-368, RV-474) | None recorded; they call it "not a survey" | out | Contested: replaced by 1.24 and 1.29 |
| 1.3 | Capacities are not inferred; once verified, warn when guests exceed them, with an audited override; unknown is neither zero nor enough (RV-398, built: no, RV-369) | Do not invent capacities | out | Contested: the idea carried into 1.22 |
| 1.4 | Bar stools are booked one by one, and a booking may mix stools of different bars (RV-363, RS-24) | None recorded | out | Contested: a venue's choice (1.37) |
| 1.5 | Tables 40 and 41 are one object "40/41", with an alias for old records (RV-364) | The plan shows them merged | out | Contested: a linked group (1.41), no alias |
| 1.6 | Retired stools stay readable as "старо място" on old records (RV-365) | Old records | out | Contested: replaced by 1.46 |
| 1.7 | Printed numbers 53, 55 and 59 each appear on two different places (RV-366) | The paper plan | out | Contested: replaced by 1.32 |
| 1.8 | Drawn around the places: walls, 26 room labels, 24 sofas, 28 columns, 9 notes (RV-368) | The paper plan | out | Contested: whatever the venue's folder holds (1.29) |

### Added by the contest

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.20 | A reservation holds spots, a layer the venue owns, optionally linked to a Table; amends "on Areas and Tables" in D101 | D95 lets a POS venue only rename, reorder and hide its tables, so a stool or a merged table cannot be a Table | firm | D134 |
| 1.21 | ~~The venue edits its own plan~~ Replaced by 1.24 | A plan in the program serves one club and needs a developer for every change | firm | D134 |
| 1.22 | A spot has an optional number of seats; over it warns and never refuses; set in the venue's reservation settings | Without it the warning and any fit by size cannot work | firm | D134 |
| 1.23 | ~~Minimum spend per spot stays out of this port~~ Replaced by 1.25 | Nightlife tools commonly offer it; their records never mention it | firm | D134 |
| 1.24 | A venue editor is wanted, but not generic yet: an agent makes the first plan from the venue's floor plan, with a folder of shapes and their attributes; then people adjust it by hand (move around) and by code feedback | Editing depends on each club's architecture and a full editor is hard (Martin 10-30) | firm | D134 |
| 1.25 | How reservations, song requests, ordering and menus work as one system is part of this grilling; minimum spend is decided there | The point of one platform is the ecosystem (Martin 10-30) | firm | D134 |
| 1.26 | Every decision is for many venues; the MVP is a demo tailored to one potential client and is input only | Martin 10-30 | firm | D134 |
| 1.27 | ~~A venue's reservation settings hold an explicit link between spots and Tables, any number on either side~~ Replaced by 1.34 and 1.35 | Reservations and the POS see a venue differently; matching by name is brittle (Square's SevenRooms help) | firm | D134 |
| 1.28 | A venue has one or more plans; a spot sits on a plan, not on an Area | A POS's halls need not match how a venue thinks of its floors | firm | D134 |
| 1.29 | The plan and its shapes are the venue's data, not program code; a new version keeps its spots, so reservations survive | One venue's plan must never need a platform release | firm | D134 |
| 1.30 | ~~By hand the venue moves, renames, seats, links, retires and adds spots~~ Replaced by 1.36 | Martin's middle ground (1.24) | firm | D134 |
| 1.31 | ~~A spot is a name, a shape, seats and links; no stool or merged-table concept~~ Replaced by 1.37 | What varies between venues becomes data, not rules | firm | D134 |
| 1.32 | A spot's name is unique in its venue; keep it obvious and practical | A hostess must be able to say one spot aloud | firm | D134 |
| 1.33 | The tools share venue, Tables, roles and PINs, service day and Log, with nothing synced between them; a reservation, an order and a song meet at the sitting | One platform, one record of a night | firm | D134 |
| 1.34 | Reservations never connect to the POS | We are not the POS (Martin 10-30) | firm | D134 |
| 1.35 | When building the plan, things can be linked into a group that acts as one unit; the group's settings have switches for a common reservation and a common ordering bill, which builds a pointer | Martin 10-30 | firm | D139 |
| 1.36 | Editing the plan (spots, seats, groups, links) is a permission held by default only by organisation owners and admins and Restro's admin team; Staff, Manager and venue Owner get it only through the role settings | Martin 10-30 | firm | D134 |
| 1.37 | Ordering does not need to know the difference between kinds of spot. For reservations each venue defines its own kinds in its shape folder: a legend symbol, a filter when choosing spots, default seats; rules per kind only when a need shows up | Martin 10-30; in the demo a kind changes only the drawing (RV-367) | firm | D134 |
| 1.38 | The reservation names the user on the phone: a venue setting in reservation settings, default yes. Shown only to phones past the location check of that sitting, never on the plain menu, never with a phone number, never in published files; Tonight shows the name beside the table | Martin 10-30, the ecosystem touch; rule 4 | later | D134, under "Later, deliberately" |
| 1.39 | ~~From the reservation, anyone who handles reservations~~ (narrowed by 1.61) From the reservation, someone with the permission can set the pay rule: venue's rule (default), everything on the bill, or pay-first applies. It is a fourth level on D122 §5, lasts for that sitting, and every change goes in the Log; a guest can never change it | Martin 10-30, the ecosystem touch | firm | D135 |
| 1.40 | A spot that is a table may name the table code that belongs to it, in Restro only and never the POS; booking works without it; a stool or a bar counter has none (1.68) | 1.39 needs a phone to find its reservation | firm | D134 |
| 1.41 | A linked group has two independent switches. Common reservation: booked only together. Common bill: a pointer inside Restro, so every member's code shares one order, one bill and one sitting, going to one lead table's POS bill; the POS still sees separate tables, so a round a waiter rings on another member stays on that table's bill | Amends D117's one order per table and D122's sitting per table | out | Contested: replaced by 12.23 (Martin 11-07) |
| 1.42 | Marking a table as taken opens its code for phones automatically, mainly by the hostess; a waiter can also open it; in one tap; a reservation setting, default yes; a table already open with another group asks "New guests?" | Saves a second step on Tonight | firm | D137 |
| 1.43 | Several spots on one reservation can be put on the same bill at any time, also after booking, with the same pointer as a linked group (1.41) and the same limit; default from a reservation setting, default yes; ends with the party | Martin 10-30 | firm | D139 |
| 1.44 | Reservation management stays apart from the bill: a closed POS bill changes nothing on the reservation. Once a party is seated and no custom duration is set, its spots stay reserved until the end of the night; staff can mark them free earlier. The pay rule lasts as long as the reservation, across sittings (1.62); the name is later (1.38) | Martin 10-30; their R2 agrees; clubs pay by the round | firm | D134 |
| 1.45 | Minimum spend: an optional amount per spot or kind in reservation settings, changeable per reservation; shows spend against it; information only, never blocks or charges | Martin 10-30: keep the idea, not now | later | D134, under "Later, deliberately" |
| 1.46 | Removing a spot is handled by Restro's team when it changes a venue's plan; old reservations keep the spot's name | Martin 10-30: "on the team side" | firm | D134 |
| 1.47 | ~~Only the seam is fixed now~~ Song requests are worked out after reservations finish and dispatched to an agent; putting the song on the table's bill is noted as an option for that work | Martin 10-30; D99 and D100 stand until then | later | D134, under "Later, deliberately" |
| 1.48 | Marking a spot free closes its table codes for phones, with a warning if the bill is still open | Otherwise a phone left behind can still order onto that table; Martin 10-30: warnings are very important | firm | D137 |

### From the Fable check (`2026-10-30-reservations-feature-1-check.md`)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.60 | A common bill reads every member table's POS bills as one; phone rounds go to the lead; paying moves lines from any member; it ends when all read empty or staff end it; a group across bars warns when it is built | As worded in 1.41 a member table's bill is never read: a waiter's round there is invisible and left unpaid (check finding 1; `apps/worker/src/jobs/readings.ts:18`) | out | Contested: replaced by 12.23 (Martin 11-07) |
| 1.61 | The pay rule on a reservation needs a Manager-level permission a venue can give a hostess; a table's own rule still wins and the screen says so; caps and pace still apply | Today it needs an owner's own sign-in, and "everything on the bill" moves bottles into the unpaid channel (finding 2) | firm | D135 |
| 1.62 | The pay rule reaches a new sitting only after staff confirm it is still the same party ("Is this still Maria's party?") | Otherwise the next group at the table inherits them (finding 3) | firm | D135 |
| 1.63 | Plan editing is marked as not in the Owner default role | The Owner default holds every permission (finding 5; `packages/core/src/service/permissions.ts:120`) | firm | D134 |
| 1.64 | ~~A table code serves one seated party's name and pay rule at a time; a second arrival is seated with a warning and without them~~ Replaced by 1.68 | Two parties sharing a code would claim one greeting (finding 7) | out | Replaced by Martin 10-31 |
| 1.65 | Arrival and freeing run the usual open and close under the same permission; a role without it marks Arrived with one line saying the table stayed closed; Tonight shows both states; freeing waits for an unsettled payment | Lead's call (finding 4) | firm | D137 |
| 1.66 | Shapes are stored as checked geometry drawn by our own components, never raw markup; reservations get a named write path and tables in the write-target guard | Lead's call: a stored file must not run in staff screens (finding 6) | firm | D134 |
| 1.67 | Joining a table already in use carries its order over and its phones confirm their location once; the pace limit counts per table code | Lead's call (findings 8, 9) | firm | D137 |
| 1.68 | QR codes are for tables only. A code belongs to one table; a bar counter, a stool or another spot that is not a table has none, so those guests never order by phone | Martin 10-31: "bar counter will not work with qrs - they are for tables" | firm | D134 |

## Feature 2: A reservation and its life

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | A reservation holds its spots for the whole evening; arrival time is an estimate; staff release (R2, RV-386) | None recorded | out | Contested: end of the night stays the default, with a custom end time (2.20); answered by Martin 10-31 |
| 2.2 | Eight statuses: reserved, seated, waiting, finished, no-show, cancelled, closed, deleted; cancel has no button (RV-324) | None recorded | out | Contested: replaced by 2.22 and 2.23 |
| 2.3 | No way back from no-show or finished; reversing a no-show left to specify (R3, RV-387, RV-338) | None recorded | out | Contested: replaced by 2.24 |
| 2.4 | Any date accepts anything: a past date takes new bookings, a future date takes arrivals (R24, RS-35, GAP-11) | R24 asks for no horizon | out | Contested: replaced by 2.25 |
| 2.5 | Phone required for advance bookings, optional for walk-ins (R4, RV-321) | None recorded | out | Contested: replaced by 2.26 |
| 2.6 | Late warning from 15 minutes, in the list only, without releasing spots (R3, RV-318) | None recorded | out | Contested: replaced by 2.28 |
| 2.7 | Same phone on the same evening warns; refused records do not (R14, R27); built as a refusal and a tick box (RV-330) | One contact can organise separate groups | out | Contested: replaced by 2.29 |

### Added by the contest

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.20 | A reservation may have a custom end time, which lets the spot be booked again after it; when it passes, staff get a warning and the spot is never freed by itself; a reservation setting holds the venue's default length, default until the end of the night | Martin 10-30 asked for custom duration; D101 named a time window | firm | D135 |
| 2.21 | The night list is sorted by arrival time; the calendar's shape goes to the screen plan (today, next day, marks on days with bookings) | Lead's call; the demo sorts by when a booking was made | firm | D135 |
| 2.22 | A reservation is Requested (online, not yet confirmed), Reserved, Waiting, Seated, Finished, No-show or Cancelled. Cancelled means the guest cancelled. Their "closed" goes to Feature 6 | Martin 10-31 | firm | D135 |
| 2.23 | A hostess can delete the reservations she made and a manager anyone's: it leaves every list and the Log keeps who deleted it and when. Deleting is made very hard to do by mistake: a confirmation that names the party. Only a manager can bring one back from the Log, until it is erased | Martin 10-31; CLAUDE.md and D83 let only the purge job remove a venue's rows | firm | D135 |
| 2.24 | Any hostess can work tonight's reservations: accept clients (mark Arrived, seat them, confirm online requests), mark No-show, and add reservations; both are on by default in the role settings. Changing details, cancelling or deleting stays with whoever made it and the manager. Undoing a no-show or a finish follows the same line. Replaces "anyone can put it back" and their R6 | Martin 10-31: "a simple RBAC hierarchical structure" | firm | D135 |
| 2.25 | ~~Dates are not restricted, in the past or the future.~~ Nobody books in the past: a night that has passed is read-only. Future nights have no limit, and the reservations screen opens on today's date each time, to lower the chance of working on the wrong night | Martin 10-31, narrowed 11-06: "nobody can book in the past - it becomes read only" | firm | D135 |
| 2.26 | Name is required. Phone is required by default, and a switch in reservation settings can make it optional | Martin 10-31 | firm | D135 |
| 2.27 | A prepayment switch in reservation settings, changeable on each reservation, with an amount. Paid through Stripe on the venue's own account: the money stays frozen on the guest's card until the booking is confirmed. The booking shows "Prepayment pending" and warns, and never cancels itself. Where the venue's settings make confirmation mandatory, Confirm takes the money and Decline releases it; where the venue confirms automatically, the money is taken at booking. Nobody answering for 5 days warns the hostess, and if Stripe's 7-day hold runs out the request stays open, marked as no longer paid | Martin 10-31, 11-06; D98, D125, D126 | firm | D136 |
| 2.28 | A late party gets a warning on the list and on the plan, and its spots are never freed by themselves; the minutes are in reservation settings, starting at 15 | Their R3 keeps the spot; a warning on the plan is new | firm | D135 |
| 2.29 | When a new booking's details match another on that night, a warning shows; it never refuses | Martin 10-31: we cannot do much more | firm | D135 |
| 2.30 | Guests book online. The club's website links to or embeds a booking page Restro hosts, so bookings land directly in Restro with nothing to sync; designed and built now, inside the reservations work, overturning the verdict's "staff tool first" and their R1. Amends D38 at write-up; D101's hosted page stands | Martin 10-31: "yes, we will do it now" | firm | D136 |
| 2.31 | An online booking arrives as Requested and a hostess confirms or declines it; a reservation setting lets a venue confirm automatically; any hostess can confirm and then owns it | Clubs choose who gets which table | firm | D136 |
| 2.32 | Each club chooses whether guests pick a table on the plan or only give night, time and party size. A booking that comes without a table must get one from the hostess | Martin 10-31: "it will probably depend on the club" | firm | D136 |
| 2.34 | For a booking taken by phone, the hostess sends the guest a payment link by email from the platform; the booking shows "Prepayment pending" until he pays. She can instead mark it paid in cash, which goes in the Log | Martin 11-06: through the platform to his email | firm | D136 |
| 2.35 | The booking page asks for the guest's email, and Restro emails Confirmed or Declined in the club's name. SMS stays a paid option for later (D101) | Martin 11-06: email | firm | D136 |
| 2.36 | ~~Reservation settings hold the club's working hours per weekday~~ Reservations read the venue's service hours, which already hold each weekday's opening, last orders and closing; reservation settings add only the one-off closed dates. Guests book online only inside them; a hostess may book outside them with a warning | Martin 11-06; the booking page would otherwise offer a closed Monday | firm | D136 |
| 2.33 | Each table has its own schedule within the club's working time, and any piece of it can be reserved. A reservation still holds the whole night by default (1.44, 2.20) | Martin 10-31: clubs book by the night, but timeframes stay possible | firm | D135 |

## Feature 3: Walk-ins and waiting list

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | A walk-in needs a free spot, starts as seated with every guest counted as arrived, and may have no name or phone; it still asks for an arrival time (RV-325, RV-326, RV-182, RS-23) | None recorded | out | Contested: replaced by 3.21 |
| 3.2 | A walk-in can be created on any date, past or future (GAP-11) | Not a recorded choice | out | Contested: replaced by 3.21 |
| 3.3 | A spot held by a live booking cannot take a walk-in that evening (RV-373) | Whole evening hold (2.1) | out | Contested: replaced by 3.26 |
| 3.4 | A party with no spot goes on the waiting list as a status of the date, in the order added, with name and phone required (RV-325, RV-379, RS-20) | None recorded | out | Contested: replaced by 3.23 |
| 3.5 | A free spot offers the date's waiting parties by the order added; the hostess chooses; one spot only; nothing happens by itself (RV-379, RS-31) | Capacity is unconfirmed | out | Contested: replaced by 3.24 |
| 3.6 | A party cannot go back to waiting: removing its last spot is refused (RS-37) | None recorded | out | Contested: replaced by 3.25 |
| 3.7 | Closing the evening turns waiting parties into "closed" (RV-140, RV-18) | None recorded | firm | D137 |

### Added by the contest

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.20 | When two hostesses offer the same spot or party, the second gets a clear refusal, never a silent move | GAP-77: today the party moves silently and its first spot is released | firm | D134 |
| 3.21 | A walk-in: the hostess puts the table on the spot, no name needed, and the table goes red as used. It happens now, so it has no date or time to fill in; the table's code opens as on any arrival | Martin 10-31 | firm | D137 |
| 3.22 | A waiter opening a table on Tonight that the hostess has not seated is warned: nobody was seated here, are you sure you want to open it | Martin 10-31 changed my proposal of a warning to the hostess | firm | D137 |
| 3.23 | A person goes on the waiting list for the night asked about. If they are also open to another night, the hostess adds them there separately; nothing is automated | Martin 10-31: the safest option | firm | D137 |
| 3.24 | For now the waiting list is a simple queue: nothing fills in by itself, the hostess picks from it by hand and calls the guest; automation is reviewed later when the process is known in detail | Martin 10-31 | firm | D137 |
| 3.25 | Taking a table back from a party, or a waiting party leaving, uses the standard operations; no special workflow and no extra status | Martin 10-31 | firm | D137 |

## Feature 4: Working the night

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | Expected and arrived guests are kept apart (Arrived 3 of 8); the first arrival marks the whole party seated; arrived can rise above expected, and arrival always opens a number dialog (R9, R10, R21, RS-32 to RS-34) | Do not free tables because guests are missing | out | Contested: replaced by 4.20 |
| 4.2 | Move, Add places and Choose places are three names for replacing a party's tables (RV-336, RS-36 to RS-38) | None recorded | out | Contested: replaced by 4.21 and 4.22 |
| 4.3 | Swap two parties as one step, or not at all (R13, RV-337) | No moment where a third party can take a table | firm | D137 |
| 4.4 | Copy to another evening: same details and tables, no arrivals and no deposit; a conflict creates nothing (R15, RV-331) | None recorded | firm | D137 |
| 4.5 | Hostesses may edit past and closed reservations (R27, RV-334) | None recorded | out | Contested: replaced by 4.25 |
| 4.6 | Any action may carry a reason; only blocking requires one (RV-342) | None recorded | firm | D137 |

## Feature 5: Blocked places

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | A block has a required reason and no date, and lasts until someone unblocks it; closing a night does not clear it (R16, R19, RV-345) | None recorded | firm | D137 |
| 5.2 | Blocking a table with bookings shows every affected reservation; the hostess moves or cancels them first; nothing moves by itself (R20; built as a one-sentence refusal, RV-345) | Never silently displace a reservation | out | Contested: replaced by 5.20 |

### Added by the contest (Feature 5)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.20 | A block is a reservation on that table, with no special workflow: it cannot be placed where a party is already booked, the hostess moves that party with the normal Change tables, and a party sitting there now keeps the table until it leaves | Martin 11-06: "reservation is reservation" | firm | D137 |

## Feature 3 and 4: added by the contest, round 3

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.26 | A party can be seated on a table reserved later that night: the hostess sees who holds it and from when, and one tap seats them with their end time at that hour. Two parties on one table at the same time are refused, naming who is in the way. A reservation setting turns the early seating off, or sets a minimum seating window | Martin 11-06: yes with a setting to turn off or set a minimum window | firm | D137 |
| 3.27 | After a waiter opens a table nobody was seated at, it goes red on the hostess's plan so she seats nobody else; if it is reserved, his warning names the reservation and its hour | Martin 11-06 | firm | D137 |
| 4.20 | Arrived is one tap: the party is seated and all its tables go red, with an optional guest count the hostess can change later. Over the seats warns (1.22); on a booking for another date she is warned | Martin 11-06; their demo asks for a number every time | firm | D137 |
| 4.21 | One "Change tables" screen replaces Move, Add places and Choose places: the hostess taps tables on and off, the reservation moves and the new table's code opens. This is the reservation stage only | Martin 11-06: moving on their demo is the reservation stage | firm | D137 |
| 4.22 | Moving a party that has already ordered is a bill move, not a reservation move: staff pick the bill up in the POS and move it to the other table, through Tonight as a waiter would (D110, D122). Restro opens and closes the digital menus to match: the old table's code closes, the new one's opens | Martin 11-06 | firm | D137 |
| 4.23 | Swapping two parties stays one step, inside the same Change tables screen: tapping a table that belongs to another party asks to swap with it, so one screen covers moving and swapping | The lead's call on Martin's "how would it be easiest" 11-06; a swap by hand needs a free table in between, which a full club does not have | firm | D137 |
| 4.24 | Copy to another night stays, as a small action on the reservation: it keeps the details, leaves out arrivals and prepayment, and lets the hostess pick other tables when those are taken. A walk-in cannot be copied, having no details | The lead's call 11-06; Maria's birthday group comes back | firm | D137 |
| 4.25 | ~~Once a night has ended, only organisation owners and admins and Restro's admin team can edit its reservations~~ A night that has passed is read-only for everyone: no booking, no edit, no deletion. It is read in the Log and in the month of plans (9.21). A venue that wants corrections turns on editing the past in its settings (13.19) | Martin 11-06: "nobody can book in the past - it becomes read only", which leaves nobody to edit it either; one permission fewer | firm | D137 |

## Feature 6: Closing the evening and undo

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 6.1 | A hostess presses "End the evening", which previews the counts and then finishes the seated, marks the reserved as no-show and closes the waiting (R18, RV-404, RV-140) | None recorded | out | Contested: replaced by 6.20 |
| 6.2 | The whole close can be undone within five minutes, all or nothing, only if nothing changed since (R22, RV-408) | None recorded | out | Contested: replaced by 6.21 |
| 6.3 | A closed evening is not a stored thing: new bookings can still be added to it and the close can run again (GAP-80, GAP-78) | Not a recorded choice | out | Contested: a closed night is a stored thing; Restro already keeps service days. Replaced by 6.20 and 6.22 |
| 6.4 | Closing warns that deposits are not returned and changes no deposit (RV-140, RV-339) | None recorded | out | Contested: replaced by 6.23 |

## Feature 7: Deposits and prepayment

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 7.1 | A deposit is information only: no money is taken, moved or returned; the hostess records an amount, one of five states and a method (R8, RV-340, RV-341) | The club does not use deposits today (their Q26) | out | Contested: replaced by 7.20; prepayment through Stripe is 2.27 |
| 7.2 | Deleting or cancelling a booking with a deposit demands a state: to return, returned or retained; no-show, finish and the evening close never touch it (RV-339) | None recorded; kept in the simpler shape of 7.20 and 6.23 | firm | D136 |

## Feature 8: Guest details and regular clients

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 8.1 | Each hostess keeps her own private list of regular clients with a private note, which no other hostess sees; up to 2000 (RV-167, RV-196, RS-50, RS-56) | None recorded | out | Contested: replaced by 8.20 |
| 8.2 | Typing three letters of a name suggests a regular and fills in the phone (RS-51) | Fewer keystrokes | firm | D140 |
| 8.3 | Nothing erases a guest's name or phone, ever; how long they are kept was left to the owner and a lawyer (GAP-67, RV-422, RV-423) | The owner deferred it | firm | D140 |

## Feature 9: History and our Log

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 9.1 | Every reservation change is kept with who, when, the night, before and after, and an optional reason; readable per reservation, per night and per calendar day (RV-343, RV-344) | None recorded | firm | D141 |
| 9.2 | A past night's plan shows the tables used or reserved that night, each reachable (R24, RV-410, RV-380) | None recorded | out | Contested: replaced by 9.21 |

## Feature 10: Who may do what

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 10.1 | Each hostess has her own profile; sign-in may be remembered on a work phone; leaving stops her access and her sessions (R25, RV-411) | No shared profiles | firm | D141 |
| 10.2 | Reservations are for hostesses only, not for waiters or other staff; a staff account alone grants nothing (R1 clarification, RV-385) | None recorded | out | Contested: replaced by 10.21 |

## Feature 11: Switching from what the club uses today

### Imported from their records (not yet ours)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 11.1 | Restro fully replaces what the club uses today, with no parallel register, no sync and no connector; existing confirmed bookings need a verified way in, still to come (R26, RV-413) | The old photos | firm | D135 |

## Features 6 to 11: added by the contest, round 4

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 6.20 | The service day's close (07:00 by default) ends the night's reservations by itself: the seated become Finished, those who never came No-show. Ending the night early is an admin action: it previews what changes, warns when it runs before the club's closing hour and names how many bills are still open, and then closes every table code so no phone can order. What staff do afterwards in the POS is theirs | Martin 11-06, tied to the orders; a night nobody closes would otherwise stay open | firm | D138 |
| 6.21 | There is no bulk undo of a close. A reservation closed by mistake is put back one at a time by an admin, and the Log keeps it. A party still at its table keeps its code open | Martin 11-06: "only the admin do that"; a bulk undo breaks as soon as anything moved, which is how theirs reports a false success (GAP-78) | firm | D138 |
| 6.22 | A closed night is a stored thing: Restro's own service day already records it, so a close cannot run twice and a booking added to a closed night warns | The lead's call; their version marks nothing, so the close can run again (GAP-80) | firm | D138 |
| 6.23 | Closing the night never moves money. What happens to a prepayment afterwards follows the club's own refund policy: the venue refunds in its Stripe dashboard, Stripe's notice reaches Restro, and the refund is recorded against the reservation with its storno to-do. Restro's key cannot refund (D122 §5, D125, D127) | Martin 11-06: "that depends on the refund policy of the club, what we can do is give them the infrastructure to refund them through stripe" | firm | D138 |
| 7.20 | One money record on the reservation: an amount, how it came (cash, card, bank transfer, online) and whether it has been given back. It is filled in by hand, or marked by itself when an online payment succeeds; an online prepayment is one more option in the same form | Martin 11-06; their five-state field and hidden method serve nobody | firm | D136 |
| 7.21 | Deleting or cancelling a reservation that has money on it asks what happens to the money and logs the answer; a no-show and the night's close never touch it | Their R8 without the five states | firm | D136 |
| 7.22 | The booking page shows the club's own prepayment and refund wording, a venue setting, so the guest reads it before he pays | The lead's call; the club's policy is the club's, and the guest must see it before paying | firm | D136 |
| 8.20 | The list of regular clients belongs to the venue, so every hostess sees it. The manager also has a private list, by default, and the setting can change that; the rest follows from it | Martin 11-06; a private list per hostess loses the club's regulars when she leaves | firm | D140 |
| 8.21 | A guest's name, phone and email are kept while the venue uses Restro; nothing is wiped on a timer. A guest who asks to be forgotten is erased by the purge job (D83's role), and his old reservations keep only the party and the table. The term and the wording of the request go to the lawyer | Martin 11-06: "if you were a customer would you want your account name and phone number wiped out?"; their owner also asked for a legal review (RV-420, RV-423) | firm | D140 |
| 8.22 | A guest's card shows how many times he has come and how many times he did not, counted from this venue's own nights only; nothing is shared between venues | Martin 11-06; it is what a hostess wants when a regular asks for the best table | firm | D140 |
| 9.20 | Reservations write to the same Log as ordering (D122 §9), readable by night and by reservation; no separate reservation history | Martin 11-06; one record of the night is the point of one platform | firm | D141 |
| 9.21 | A past night's plan is readable one month back, showing the tables used and reserved then, each opening its reservation. Older nights stay readable as records in the Log | Martin 11-06: "we keep a month backwards" | firm | D141 |
| 10.20 | A hostess signs in with her own profile and PIN like any other staff member; deleting a reservation or editing a past night needs her own password sign-in, as the settings already do (D122 §7) | Martin 11-06 | firm | D141 |
| 10.21 | Working with reservations is a permission, not a job title: any role a venue makes can be given it, and no role has it because of its name. There is no reservations-only account | Replaces their "hostesses only"; Restro's roles are built this way | firm | D141 |
| 11.20 | At the switch-over the club's existing confirmed bookings are typed in by hand: no import, no connector and no period of running both | Martin 11-06: "we cant automate everything, once they use only us that wont be a issue" | firm | D135 |
| 6.24 | Ending the night is an admin action and stays one: a club that wants someone else to do it handles that through its own role settings, which is what the permission list is for. Closing every table code is part of ending the night at every venue, reservations or not, with the same open-bills warning | Martin 11-06: "Admin is admin ... our work is to do a RBAC"; and yes to every club | firm | D138 |

## The check of Features 2 to 11: Martin's answers, round 5

From `2026-11-06-reservations-features-2-11-check.md`. The eleven technical findings are the lead's and are taken as recommended; the rows below are Martin's answers of 11-06 and the lead's calls that follow from them.

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 12.1 | A prepayment is a third kind of payment in the platform's own payment records, with no table, no sitting and no POS step: held at booking, taken on Confirm, released on Decline, and carrying its reservation. The provider's refund and status notices cover it like any payment | Check finding 1: every payment today is a bill payment at a table, and a prepayment kept anywhere else would make a refund notice match nothing | firm | D136 |
| 12.2 | Stripe's own email is proof that a card was charged, not a Bulgarian fiscal receipt: only the venue's fiscal device issues one, which is why D125 turns Stripe's guest receipts off and D127 emails the POS's receipt instead | Martin asked 11-06 whether Stripe gives a receipt | firm | D136 |
| 12.3 | The warning before a hold lapses goes 48 hours before that payment's own expiry, not after a fixed five days: Stripe gives each payment its expiry and a Visa hold can be 4 days 18 hours | The lead's call 11-06 on the reviewer's correction; never ask Martin a timing | firm | D136 |
| 12.4 | Deleting a reservation works on the PIN plus the confirmation that names the party, with the Log naming the person; the password rule stays for the actions whose class needs it. A hostess has no account, and the engine refuses a PIN any settings-class permission | Martin 11-06: yes; check finding 2 | firm | D135 |
| 12.5 | Everything that happens to a guest's reservation or his money reaches him by email: confirmed, declined, cancelled, the prepayment taken, a hold released, and the night's end declining a request he never heard about | Martin 11-06: "whatever happens with someone's reservation or online payment has to pass through an email - i thought thats obvious" | firm | D136 |
| 12.6 | At the night's end an unanswered request is declined, its hold released and the guest emailed; a party still waiting becomes Not seated; a block is untouched. So "a request never cancels itself" means never before its night has passed | Martin 11-06 through 12.5; check finding 3 | firm | D138 |
| 12.7 | What guests may do on the booking page is a venue setting: request a night only, choose a zone, or pick the table on the plan, which is the full ability. Automatic confirmation applies only where the guest picked the table, so the table itself stops the next booking; a booking without a table waits for a hostess | Martin 11-06: "picking a table is full capability but that should be flexible to fit requirements from different owners"; check finding 4 | firm | D136 |
| 12.8 | The booking page is drawn by the same renderer in the venue's Style, so a club's booking page matches its menu; its branding, layout and flow are fixed across clubs, with no per-club rework. The Design lead is warned before it lands | Martin 11-06: "yes but the branding, the UI and UX is fixed"; check finding 7 | firm | D136 |
| 12.9 | **The PIN line on a shared device, Opus's answer of 11-06, which Martin took in advance as the default (configurable in the role settings):** one rule decides it — if the tap only says where people are sitting tonight it is a tap; if it writes the booking book, touches money, touches a guest's details or ends the night, it is four digits. Quick: arrived or seated, seat a walk-in, change the guest count, add to the waiting list, give a waiting party a table, change a party's tables, swap two parties, free the tables, open or close a table from the plan, "New guests", mark a no-show. PIN: create a booking, confirm or decline an online request, copy to another night, edit a booking's details, cancel, delete, restore, put back a reservation the night's end closed, set the pay rule, record a cash deposit, mark a prepayment taken at the till, start a refund follow-up, block or unblock a table, end the night (with its preview). Own sign-in and never a PIN: erase a guest's details | Martin 11-06 asked for Opus's judgement and said he would agree with it. Its reason: tonight's floor is self-correcting and everyone sees the plan, while a wrong line in the booking book is invisible for days and the venue needs to know whose hand did it; the PIN is spent where it buys accountability, never where it buys a second of friction at the door | firm | D141 |
| 12.10 | ~~Two of Opus's recommendations reach past reservations and wait for Martin's own nod: making a table's open and close quick on Tonight as well (today it asks for the PIN there), without which the rule stops being predictable; and letting one PIN hold the person for about five minutes of further work on that device, so a run of record work is typed once so a run of record work is typed once~~ | The lead's call to flag them: both change behaviour already built and shipped for other screens, which Opus's brief did not cover | out | Both answered by Martin 11-07: replaced by 12.11 and 12.12 |
| 12.11 | A device remembers the person and keeps him signed in: his session on that device stays active, and his permissions decide what he may do. On a device nobody owns, typing the PIN starts that person's own short session on it rather than authorising one action, so a run of record work is typed once. There is no second rule counting actions on top of the permissions | Martin 11-07: "each person has its own attributes, they are a user with permissions, its that simple", then "if you meant to remember devices and keep them active, thats for sure, thats good ux". It is one mechanism, a session, not a timed exception to the PIN; row 10.1 already allows a remembered sign-in on a work phone | firm | D141 |
| 12.12 | A table's menu is opened by seating the party, not by a separate tap: marking the guests present on their table is what makes that table's code live, so the hostess never opens the menu as an action of its own. What closes a table's menu is a separate question, not settled by this row | Martin 11-07: "I specifically want to unlock the menu upon seating them on their table and marking the guests present, now when the menu is being closed is something else". It also removes the PIN question Opus raised, there being no open tap on the hostess's plan to make quick | firm | D137 |
| 12.13 | Seating a party onto a table that is already open with another group sends "New guests", never the plain open, which would hand the new party the old group's cart, its sent order and its phones' location passes. A table nobody is on is opened by the seating itself | Verified in the code 11-07: `openTable` leaves a standing sitting alone and reports nothing opened (`packages/core/src/service/sittings.ts:197`), while ending a sitting empties the order (`sittings.ts:210`). Row 1.42 already asks "New guests?" | firm | D137 |
| 12.14 | What closes a table's menu stays as ordering already has it, and seating does not change it: the everyday closer is the bill disappearing from the POS on a complete reading (D122 §4); freeing the spot closes the codes with 1.48's warning when the last reading still showed lines or a payment is unsettled; a reservation move closes the old table and opens the new one. Only one setting is added, 1.42's "open on seating", default yes | Opus 11-07: the plan should be able to open a table easily and close one only deliberately, because ending a sitting throws away the guests' cart and their phones' location passes | firm | D137 |
| 12.15 | The explicit open and close stay on the Tonight screen. Seating covers the booked party; the tap covers what it cannot, including a table a waiter opens with nobody seated (3.27), a spot that is on no plan, and a role that may open tables without touching reservations (10.21) | Opus 11-07; removing it would strand those cases | firm | D137 |
| 12.16 | Correction to 12.10: opening or closing one table on Tonight never asked for a PIN, so there was no inconsistency to fix. Only the whole-floor actions (open all, close all, undo open all) ask for one, and they keep it: many tables at once, and nobody watching each | Verified in the code 11-07 (`packages/core/src/service/commands.ts:222` and `:376` mark single open, close and New guests quick on a shared device). The earlier check mis-stated it and the lead relayed it | firm | D137 |
| 12.17 | Ending the night early keeps a table whose card is still held, closing every other code (the ordering side's `keepPaying`); otherwise the close would cancel a guest's held card mid-payment. The night's end hooks onto the venue's closing hour, which already closes codes, not onto the service day's close, which refuses while payments or sent orders are open | Verified 11-07: the closing hour closes tables (`apps/worker/src/jobs/service-hours.ts`), the day's close does not. Amends 6.20 and 6.24 | firm | D138 |
| 12.18 | A party on several tables is one reservation but, as ordering stands today, several open tables with a bill each: the one common bill rows 1.41 and 1.60 describe is not built yet. Reservations must not assume it, and it is named in the build plan | Opus 11-07; Martin 10-31 described tables 111 to 114 cumulating on one bill, which is the ordering stage's work, not the reservations screen's | firm | D139 |
| 12.19 | The club's working hours are not a reservations setting: the venue's service hours already hold each weekday's hours, and a weekday with no hours is a closed day. Reservations read them; only one-off closed dates are new. Amends 2.36 | Verified 11-07: `packages/core/src/ordering-settings.ts` requires a closing time per open weekday and treats a weekday as null when the venue is closed. Two places holding the same hours would disagree the first time one is changed | firm | D136 |
| 12.20 | The night's end needs no fallback hour: on any night the club is open there is a closing time, which already closes every table code and spares a table whose card is held; a night with no hours is a closed day, which has no reservations (2.36). The early end stays the admin's action of 6.20 | Verified 11-07 (`packages/core/src/service/closing-hour.ts:24`, `apps/worker/src/jobs/service-hours.ts:121`). Closes the unknown Opus left open | firm | D138 |
| 12.21 | More people joining a party already at its table is not "New guests": nothing on the table changes, the sitting stands and their cart survives; only the reservation's guest count rises. "New guests" is for a different group taking the table after the first has gone. Amends 1.67 | Verified 11-07: ending a sitting empties the order (`sittings.ts:210`), and there is no table command for a guest count, so the count lives on the reservation | firm | D137 |
| 12.22 | Seating a party on a table whose previous bill is still open in the POS warns the hostess before it opens, because the new party's first order would otherwise land on the old bill. It is 1.48's warning, moved to the arrival as well as the freeing | Opus 11-07: the check before opening looks at payments, hidden and vanished tables, never at a bill left open; nothing guards this today | firm | D137 |
| 12.23 | **A linked group, as Martin defined it 11-07:** the tables are marked as one group and the cumulation happens inside Restro only. Every order still goes to the POS on the table it was made at, so the ticket names the real table and the POS records it there; payments settle on tables too. Restro keeps the pointers, and shows the bill and the settlement grouped by table yet cumulative for the group. There is no lead table and no common POS bill | Martin 11-07: "the cumulation occurs within our software... when ticket comes out from ordering it shows the actual table it came from and in the pos it is being recorded there, the bill review and settlement comes in a grouped format by table but yet cumulative for the group". It also fixes 1.60's own objection, that under a lead table a waiter's round on a member table was never read | firm | D139 |
| 12.24 | A group is made either on the reservation in advance or from Tonight on the night, and stays editable from Tonight: tables can be added to it or taken out while the party is sitting | Martin 11-07 | firm | D139 |
| 12.25 | A group belongs to a stretch of one night, not to the tables: the same tables can hold a later reservation the same date, so a group covers only its own party's time and ends when that party's tables are freed or the night closes | Martin 11-07: "grouping is also time related when multiple reservations happen on the same date" | firm | D139 |
| 12.26 | A table joining a group that is already sitting keeps the lines it already has, and the group's total includes them from that moment; taking a table out of a group leaves its lines on it | The lead's call 11-07, following from 12.23: with no common POS bill there is nothing to move, so joining and leaving are only pointer changes | firm | D139 |
| 12.27 | A group is one thing, not two switches: tables in a group are booked together and reviewed together. Nobody has to choose between a common reservation and a common bill, because 12.23's format already settles table by table inside the group, so four couples on one booking can still pay separately. A party that wants nothing shared is simply not grouped | The lead's call 11-07: Martin described one act, "indicated as the same group", and a second switch would be a setting serving a case the grouped-by-table format already covers. Replaces 1.41's two switches | firm | D139 |
| 12.28 | A guest at a grouped table sees the group's whole cumulative bill, every table's lines included. That is the point of being grouped: the party asked for it, and a party that does not want it is not grouped | Martin 11-07: "he sees everything, but thats intentional, otherwise if they dont want that the hostess is not going to group that tables, that was a desire of the group to do isnt it?". Replaces the lead's recommendation of a per-table view | firm | D139 |
| 12.29 | There is nothing on a bill to attribute to a person: Restro never keeps which phone ordered which line, grouped or not, so a bill is tables and lines only. A guest who wants to cover part of it pays partially; there is no per-person tally to pay | Martin 11-07: "we dont keep per user orders from device, if somebody whats to pay for something else they pay partially and thats it". Verified 11-07: device ids exist only for staff devices (`packages/core/src/service/identify.ts`), never for a guest's phone | firm | D139 |

## The final check of 11-07: the lead's calls and the last three questions

From `2026-11-07-reservations-decisions-final-check.md`. Items A1 to A3 are Martin's, asked as round 7. The rest are settled here.

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 13.1 | A waiter opening a table nobody is seated at is warned only when that table is reserved later tonight or blocked, not every time | Check A4: a warning on every open is clicked through by the second hour, and 3.27 already names the case that matters | firm | D137 |
| 13.2 | The "open on seating" setting is dropped: seating always opens the table. A venue that switched it off would have a hostess marking guests present with no menu and no tap to open one (12.12) | Check A5; the setting contradicts Martin's 11-07 answer, and no club wants the off position | firm | D137 |
| 13.3 | A reservation's tables are its group, always: there is no separate grouping step for a booking on several tables, and a party that wants separate bills is booked as separate reservations | Check A6, following 12.23 and 12.27; a per-venue default (1.43) would leave a four-table booking ambiguously grouped | firm | D139 |
| 13.4 | How long a table is held and the shortest gap before a later booking are one setting, the table's turn time, as the trade keeps it (OpenTable's turn time) | Check A7: 2.20 and 3.26 are the same idea written twice | firm | D135 |
| 13.5 | Martin's answers stand where the check would simplify them: the manager keeps a private list of regulars, configurable in settings (8.20), and the quick/PIN line stays configurable in the roles (12.9) | Checks A8 and A9 are preferences, not contradictions; Martin decided both explicitly. The consequence of the second, that what a PIN means in the Log varies by club, is the club's own choice | firm | D141 |
| 13.6 | Seating a party onto a table a waiter already opened asks whether these are the same guests: yes keeps the sitting and its cart, no sends "New guests" | Check B1; without the question 12.13 would throw away a round the waiter already rang | firm | D137 |
| 13.7 | Marking a party present on a table other than the one it booked is one gesture on the plan, not Change tables followed by Arrived | Check B2; it is the commonest thing that happens at the door | firm | D137 |
| 13.8 | Change tables carries the open-bill warning too (1.48, 12.22), not only arrival and freeing | Check B3 | firm | D137 |
| 13.9 | The words are fixed: a night has "passed" when its service day has ended; "the night's end" is the venue's closing hour, which closes the codes; 6.21's putting a reservation back lives between the two; a booking made after the closing hour is told it will be marked No-show | Check B4; three different moments were being called the same thing | firm | D138 |
| 13.10 | A booking taken by phone with a prepayment: the form asks for the email, the link captures the money as soon as he pays, a hold that lapsed and is then confirmed offers the link again, and the list filters on "Prepayment pending" | Check B6 | firm | D136 |
| 13.11 | Every state on the plan carries a label and a legend, never colour alone | Check B7; D107's clean screens, and a hostess at 02:00 under club lighting | firm | D134 |
| 13.12 | Cancel and Delete are told apart in one line each, on the buttons: Cancel is the guest's doing and keeps the booking on the night; Delete removes a booking that should never have existed | Check B8 | firm | D135 |
| 13.13 | Grouping tables from Tonight is quick under the table permission; a phone at a grouped table pays its own table; paying a whole group in one tap is the ordering side's work (12.18) | Check B9 | firm | D139 |
| 13.14 | A person's session on a shared device ends when the device has been idle a few minutes, not after a fixed stretch | Check B10; it is how a POS front end does it, and it never cuts someone mid-task | firm | D141 |
| 13.15 | Erasing a guest on request also clears him from the venue's regulars and from the manager's private list, notes included; the wording the lawyer confirms says that the payment provider keeps its own record of the card | Check B11 | firm | D140 |
| 13.16 | Round 7, the three the check leaves to Martin: a bill paid at the bar cutting a seated party's phones (A1), who may touch a booking another hostess made (A2), and correcting a wrong No-show on a night that has passed (A3) | The check's verdict: ready to ticket once these three are answered | out | Answered by Martin 11-07 as 13.18 to 13.21 |
| 13.17 | The group work is an ordering-stage ticket of its own, filed 11-07 as issue 319, built on its own branch from `or/foundation` in parallel with the hostess screen; reservations do not wait for it | Martin 11-07: "i would communicate it as a ticket to the proper channel and start building in parallel". The bills live on the ordering side, so the two do not touch the same files | firm | D139 |
| 13.18 | Anyone with the reservations permission works tonight's and future bookings, whoever made them: a hostess on duty cancels, edits and seats a booking her colleague took, and a booking the website confirmed by itself has no maker to belong to. The hierarchy stays where it was aimed: deleting someone else's booking, and restoring one, are the manager's | Martin 11-07: yes. Amends 2.24; check A2 | firm | D135 |
| 13.19 | A night that has passed stays read-only, a wrong No-show included: the history is there for audits, not for accounting, so the manager asks the hostess what happened and that is the end of it. A venue that does want corrections switches on editing the past in its settings, which is one switch over every past-editing ability and a manager-class permission | Martin 11-07: "the history is for audits, not for accounting... if they request an edit we could group that as configurable edit the past in settings". Replaces the lead's recommendation of a manager flip; check A3 | firm | D135 |
| 13.20 | A guest's visit and No-show counts (8.22) can therefore be wrong where a hostess forgot to mark an arrival, and are left wrong: they tell a hostess roughly whether a regular turns up, and are never a record of money | Follows from 13.19; written down so nobody later "corrects" it into an accounting figure | firm | D140 |
| 13.21 | Confirming a prepayment raises a to-do at the till to issue the fiscal receipt, with its number typed back onto the reservation, since Stripe's email proves a card was charged but is not a Bulgarian fiscal receipt (12.2, D125, D127). Whether that is enough, and who issues it when the guest never arrives, is a question for the accountant, not a gate on the build | The lead's call 11-07, by Martin's standing rule that a fact an outside party knows is a question to them. It is the cautious default: a receipt always exists for money taken | firm | D136 |
| 14.1 | Where a staff sign-in lands follows the person's role: the first screen his permissions allow, Reservations before Tonight, and someone with both lands on Reservations. No setting now; a different home screen would belong on the role | Martin 11-08: "depends on the persons role", answering the one open call left by the tickets (#326) | firm | D141 |
