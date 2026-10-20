# Restro

Restro turns a venue's menu into a page guests open on their phone from a QR code. This glossary is the project's own language: one word per concept, for docs, briefs, code names and interface text.

## Organisations and venues

**Organisation**:
The business that uses Restro. It owns venues, POS instances and domains.
_Avoid_: tenant, account, company

**Venue**:
One place guests visit, with its own menus, areas, tables and guest address.
_Avoid_: location, club, restaurant, store

**Source**:
Where a venue's items come from: one POS instance, or by hand. Fixed when the venue is created.
_Avoid_: menu source (that is the POS root a menu reads from)

**POS venue**:
A venue whose items come from a POS. Restro may hide, rename, reorder, regroup and enrich them, but never creates, deletes or re-prices them.
_Avoid_: barsy venue, till venue, synced venue

**Hand-made venue**:
A venue with no POS, whose menus Restro's users build and fully control. "By hand" is the source a hand-made venue is created with.
_Avoid_: by-hand venue, Restro venue, manual venue

**Venue state**:
Draft (never published, or unpublished), Live, Archived, or Deleted.

**Archived**:
A venue an owner has removed but can still restore, for 30 days. Guests and the admin no longer see it.
_Avoid_: deleted (while it can still be restored), binned

**Deleted**:
A venue that can no longer be restored: its own data has been purged.
_Avoid_: archived, removed

**Purge**:
The permanent erasure of an archived venue's own data, which makes it Deleted: 30 days after archiving, or at once when an owner deletes it permanently.
_Avoid_: hard delete, wipe

## POS and sync

**POS**:
The venue's own point-of-sale system (barsy, Mistral), which holds the items, prices and tables the venue actually sells from.
_Avoid_: till, cash register, ERP

**POS system**:
A kind of POS that Restro can connect to, such as barsy.
_Avoid_: vendor, provider

**Instance**:
One organisation's connection to one installation of a POS system, with its own credentials, settings and sync history.
_Avoid_: integration, connection, account

**Connector**:
Restro's adapter for one POS system: it reads that system's data and translates it into Restro's model.
_Avoid_: plugin, driver

**Sync**:
Reading a POS's current data into Restro. Sync only ever reads; it never writes into a POS.
_Avoid_: import, pull (on its own)

**Full read**:
A sync that reads everything the POS holds. Only a complete full read can conclude that an item was deleted in the POS.
_Avoid_: full pull, full sync

**Layer**:
One origin of a stored value: the POS, a user's manual edit, an override, or an edition. Restro's layers can only make the menu more cautious than the POS.

## Menus

**Menu**:
A set of sections and items that a venue shows guests. A venue can have several.
_Avoid_: catalogue, card

**Live menu**:
The one menu a venue shows guests by default, unless an area or table has its own.
_Avoid_: main menu, default menu

**Section**:
A named group of items inside a menu.
_Avoid_: category (the POS's word), group

**Item**:
Something on a menu a guest can see, usually with a price.
_Avoid_: product, article, dish, drink

**Item schema**:
The set of fields an item can have, such as name, description, price, photo and allergens.
_Avoid_: template (that is the phone design)

**Placement**:
An item's membership of a section and its position there. Placements are layout, kept apart from what an item is.

**Mapper**:
Restro's own arrangement of a POS venue's sections and items over the POS's structure: order, grouping, hidden entries, own sections.

**Dictionary**:
Restro's own texts written over a POS's names.
_Avoid_: translations (for this specific overlay)

**Enrichment**:
What Restro adds to an item beyond the POS's data: texts, photos, tags, allergens.

**Tag**:
A venue-defined label on an item, such as a dietary label, shown to guests.
_Avoid_: badge, label (on its own)

**Sold out**:
An item that stays visible but greyed out with no order button, because the POS stopped selling it or a manager marked it sold out for tonight.
_Avoid_: unavailable, out of stock

**Hidden**:
An item or section guests do not see at all.

## Publishing and design

**Composer**:
The admin screen where a venue's menus are arranged (Structure) and styled (Design).
_Avoid_: editor, builder

**Publish**:
Making a menu's current draft the version guests see.

**Version**:
One published state of a menu. A venue keeps the live version and up to two restorable ones.

**Template**:
A guest phone design a venue picks in the Design tab, such as Editorial Market.
_Avoid_: face (the template's code), theme, skin; never for the item schema

**Guest page**:
The page a guest opens on their phone: one venue's menu in that venue's template.
_Avoid_: guest menu, public page, shell (the host code around a template)

**Guest feature**:
A service a venue can switch on for guests, such as the bag, the bill or calling a waiter. Guests see it only once Restro supports it.
_Avoid_: guest function, service screen

## Tables and addresses

**Area**:
A part of a venue with its own tables, such as a hall or a terrace.
_Avoid_: hall, salon, zone, room

**Table**:
A place in an area where guests sit and scan a table code.

**Table code**:
The QR code on a table; it opens the menu routed to that table.
_Avoid_: QR token, QR link, sticker

**Open table**:
A table with at least one open POS bill, which a waiter has started. Guests order on the bill only at an open table.
_Avoid_: seated table, active table, occupied table

**Menu routing**:
The rule that picks which menu a table code opens: the table's own menu, else its area's, else the venue's live menu.

**Guest address**:
A venue's public web address, on Restro's domain or on the organisation's own domain.
_Avoid_: URL, link, slug

**Service day**:
A venue's business day, which ends at 07:00 local time by default, not at midnight.
_Avoid_: day, night, shift

## Ordering and bills

**Bag**:
The items the guests at a table have picked on the guest page but not yet sent. One per table, shared by every phone opened from its table code. Pay-first items stay in it until someone pays for them.
_Avoid_: cart, basket

**Earlier bag**:
A bag left unchanged for the venue's idle time, set aside so the table can restore it until its POS bills close.
_Avoid_: old cart, saved bag

**Order**:
What leaves a table's bag in one Send, or in one payment for pay-first items. It goes into the venue's POS as a round on the table's open POS bill, or on a new POS bill when the table has none, and is then part of the table's bill. A pay-first order is a POS bill of its own, paid and closed at once.
_Avoid_: request (that is a song request), ticket

**Order state**:
Where an order stands. **Waiting**: stored, waiting for the table's turn. **Sending**: on its way to the POS. **Checking**: no answer came, so Restro is finding out whether it landed. **Awaiting approval**: in the POS, waiting for the bar to approve it (only where the venue uses approval). **Added**: the POS has it. **Not sent**: certainly not in the POS. **Unconfirmed**: still unknown after the check.
_Avoid_: pending, accepted, rejected, failed, unknown

**Read-back**:
Reading a table's POS bills to find out whether a round that got no answer reached the POS.
_Avoid_: reconcile, lookup

**Reading**:
Restro's short-lived copy of a table's open POS bills, shared by every phone at the table and shown with its age. Kept for minutes, never as a record.
_Avoid_: snapshot (that is the published menu), cache, sync

**Approval**:
The bar confirming an on-the-bill order in the POS before it counts as added. A venue setting, where the POS supports it.
_Avoid_: confirmation, acceptance

**Table pause**:
A stop on ordering at one table after one of its orders ends Unconfirmed. The rest of the venue keeps ordering.
_Avoid_: table lock, blocked table

**Venue pause**:
A stop on ordering and paying at every table of a venue, while the menu and the last reading of each bill stay. Started by Restro when it can't work with the POS, or by the owner's "Pause ordering" switch.
_Avoid_: breaker, outage mode, menu-only, offline

**Pre-opening check**:
Restro's check, before a venue opens, that it can work with the venue's POS. A failure is fixed before guests arrive; until then the venue opens paused.
_Avoid_: health check, smoke test

**Log**:
A venue's record of what happened in service, one entry per step: orders and each of their states, payments, pauses, alerts and tripped guards. Searchable by the venue for a month.
_Avoid_: history, audit trail, orphaned-orders list, activity feed

**Operations panel**:
The Restro screen a venue's staff use during service, mostly for its alerts; staff keep working in the POS as before.
_Avoid_: staff app, waiter screen, dashboard

**Round**:
Items added to a bill at one time, by a guest's order or by a waiter.
_Avoid_: batch, course

**Bill**:
Everything still open at a table: its open POS bills, with what is owed and anything already paid against them. A POS bill that closes drops off it. Guests see and pay one bill per table, however many POS bills sit behind it.
_Avoid_: tab, check, ticket, account, visit (Restro has none)

**POS bill**:
One bill as the venue's POS holds it: items owed plus the payments made against it, open until settled, then closed with a fiscal receipt. The table is an optional label on it, and a table can hold several open POS bills at once.
_Avoid_: account (barsy's word), сметка (in English text), check

**Payment mode**:
Whether an item is paid on the bill or paid first, when it is ordered. A venue default, an override per item, and a table can have prepayments disabled.
_Avoid_: payment type, prepaid flag

**Split**:
Moving chosen items off a POS bill onto a new one, so they can be paid on their own.
_Avoid_: divide, separate

**Part payment**:
A payment that leaves its POS bill open with something still owed.
_Avoid_: partial (on its own), instalment

**Group payment**:
Several guests' cards settling one bill, or one share of it, together.
_Avoid_: split payment (a split moves items), split tender

**Location check**:
Checking, before a phone adds to or sends on-the-bill items, that it is at the venue. The location is used once and never kept.
_Avoid_: geofence, geolocation, GPS check

**Location pass**:
What a phone holds after passing the location check: for the venue's set time (2 hours by default), its on-the-bill actions at that table need no new check. Another table needs a new check, and no pass lasts past the service day. Restro keeps no copy.
_Avoid_: location token, geo session, verified device

## Song requests and payments

**Song request**:
A song a guest asks the DJ to play, paid or free. Lives in a venue's request queue for one service day.
_Avoid_: bid (the amount on a request), track, song (alone)

**Paid request**:
A song request with money held on it. Ordered in the queue by its total amount.

**Free request**:
A song request with no money. Queued behind every paid request, in the order it arrived.

**Boost**:
Adding money to a song request that is already in the queue, under your own name.
_Avoid_: bid up, top up

**Backer**:
A guest whose money is on a song request. A request has one or more backers.
_Avoid_: contributor, bidder

**Request queue**:
A venue's song requests for the current service day, in play order.
_Avoid_: playlist, bids, list

**Lock window**:
The playing request and the next N requests, which no request or boost can displace. N is a venue setting.
_Avoid_: freeze, buffer

**Played**:
A song request the DJ accepted and played; its holds are captured.

**Skipped**:
A song request the DJ passed over; its holds are released or refunded.

**Hold**:
Money reserved on a guest's card for a request, not yet taken.
_Avoid_: authorisation, pre-auth, freeze

**Capture**:
Taking held money. Happens when the DJ accepts a request.

**Release**:
Letting a hold lapse without taking the money.
_Avoid_: cancel, void

**Refund**:
Returning money that was captured.

**Payment provider**:
A company that moves card money for a venue: myPOS, Stripe. Plugged in through a connector, like a POS system.
_Avoid_: PSP, gateway, acquirer

**Payment account**:
A venue's own account at a payment provider, into which its guests' money is paid. One per venue.
_Avoid_: merchant account, wallet

**Guest session**:
One phone's anonymous visit to a venue's guest page, with or without a table code. Never an account.
_Avoid_: user, account, login

**DJ**:
The organisation role that runs a venue's request queue.
