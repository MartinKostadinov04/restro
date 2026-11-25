# The database in plain words

**For Martin, 11-09.** Written after the D103 foreign-key decision, because a decision about the
database is hard to take without a picture of it. No code in here. Every table below is real and
counted from `packages/db/migrations/`; the words in **bold** are `GLOSSARY.md`'s.

The authority stays the architecture doc (`docs/architecture/data-architecture.md` and the live
artifact it mirrors). This file is the plain-words view of it, nothing more.

## How to read it

One database. Two containers inside it: `restro`, which holds all fifty-nine of our tables, and
`pgboss`, which the job queue made for itself. A table is a list: one kind of thing, one row per
thing, the same columns on every row.

The tables fall into eight groups. The groups are a way of talking about them, not a wall in the
database — D103 wants six real walls (separate schemas) and they do not exist yet.

## 1. Who owns what — 12 tables

`tenants` is the **organisation**: the account that owns venues. Nearly every table carries a
`tenant_id`, and the database itself refuses to show one organisation another one's rows — not the
code, the database. That is the most important thing in here. The few tables outside that rule are
deliberate and written down: `provider_notices` belongs to the platform and has no tenant at all,
`worker_heartbeats` is machine bookkeeping, `templates` may be a Restro-wide design with no owner,
and the sign-in tables keep the organisation under their own column.

`auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_organization`,
`auth_member` and `auth_invitation` are the sign-in tables. They are not ours — the Better Auth
library owns their shape. A guest is never in them: a **guest session** is anonymous.

`operators` and `venue_roles` say which person may do what, in which venue.
`organization_slug_history` and `venue_slug_history` keep old web addresses working after a
rename.

## 2. The venue and its rooms — 7 tables

`venues` is one club. `areas` and `tables` are its rooms and its **tables**, in our own model: an
**area** holds tables, and a table has a **table code** behind its QR. `bars` are its **bars**.
`menu_routes` is **menu routing**: which menu a given area or table shows. `service_days` is the
**service day** (the night, which ends at 07:00). `pauses` holds the **table pause**, the **venue
pause**, the **connection pause** and a pause of one bar.

## 3. The menu — 11 tables

This is the part the project calls the menu engine, and the one most of the nine rules protect.

`nodes` is every **item** and every **section**, one row each. `field_values` is every value on
them — a name, a price, a photo — one row per field per **layer**, which is why a POS's price and
our own note sit on the same item without either overwriting the other. `placements` is the
**placement**: which section an item is in, and where in the order. Layout is kept apart from what
an item is, on purpose.

`menus` is the **menu** itself, `tags` are **tags**, `assets` are the pictures. `events` is the
append-only record of every menu change ever applied. Nothing in the app may delete from it; the
one exception is the purge job, when a venue's data is erased for good.
`source_records` and `source_links` remember what a POS sent and which of our items it became.
`tombstones` and `item_first_published` remember what used to exist.

## 4. Publishing — 3 tables

`snapshots` are the published files a **guest page** reads. `publish_pointers` say which snapshot
is live and which **versions** are restorable. `templates` is the list of phone designs
(**templates**) a venue can pick.

Guest pages read those files and never the database. That is rule 4, and it is why a club's phones
keep working when the database is busy.

## 5. The POS plug — 4 tables

`integrations` is one POS **instance**: one login into one POS. `places` is what a POS says its
own tables are, in the POS's own fields. `barsy_venues` belongs to the one **connector** we have
written. `job_runs` is every **sync**: what it read, and whether it finished.

A POS's own ids live here and in `source_records`, and nowhere above the integration layer. That
is rule 3.

## 6. Tonight — 14 tables

The service night, almost all of it built in the last few weeks.

`sittings` is a **sitting**: one group of guests at one table, from arrival to the bill.
`table_orders` is their running order. `sent_orders` is each **sent order** that went to a bar,
with its **sent order state**; `sent_order_notes` is what staff wrote on one. `bill_readings` is a
**reading** of the **POS bill**. `locks` is what stops two phones acting on the same table at
once. `waiter_calls` is a guest calling a waiter. `log_entries` is the **Log**: one row per step
of the night, which is what **Tonight** shows.

`alerts`, `staff_members`, `staff_assignments`, `shared_devices`, `push_subscriptions` and
`worker_heartbeats` are the staff and machine side of the same night.

## 7. Money — 6 tables

`payments` is one **bill** being paid. `payment_lines` are the items it covers. `payment_steps`
are the steps a payment goes through (**hold**, **capture**, **release**). `payment_refunds` are
**refunds**. `payment_accounts` is a venue's **payment account** with the **payment provider**.
`provider_notices` is what the provider tells us, signature-checked.

No card number and no card details are in any of them. Amounts are whole cents, never decimals.

## 8. Guest events — 1 table

`guest_events` is one row per thing a guest's phone did: opened a page, looked at a section, sent
an order. No names, no phone numbers, nothing personal. This is what the analytics questions get
answered from.

Plus `purge_log`, which records the one job allowed to erase a venue's data.

## The chain

Most of the database is one chain, and it reads the way the night runs:

> **organisation** → **venue** → **area** → **table** → **sitting** → **sent order** → payment

A row near the end of the chain holds the id of the row before it. A **sent order** knows its
sitting. A payment knows its sitting, its table, its bar and its sent order.

## Hard links, and the decision you took

A **hard link** (the computer word is foreign key) is a rule inside the database that says: this
id must point at a row that exists. With one on a payment's table id, a payment that names table
12 when no table 12 exists is refused. The bad row never gets stored at all.

Where they are today:

- The menu, the venue and the night are full of them. A table knows its area, and the database
  makes sure that area exists.
- `payments` has six into the rest of the data: the venue, the table, the **payment table**, the
  sitting, the bar and the sent order.
- `guest_events` has **none**. Its ids are plain text with a shape check. That is deliberate: one
  day guest events are written at the edge, by something that is not even in this database, and a
  hard link would make that impossible.

That difference is the whole of the 11-09 decision. D103 first asked for no hard links on both
money and guest events; you narrowed it to guest events. Money keeps its six, because a payment
that points at nothing is a bug we want the database itself to catch, and nothing has ever asked
for payments to move out.

## What is not true yet

Worth knowing, because it is easy to read D103 and assume otherwise:

- **The six containers do not exist.** D103 wants core, auth, jobs, guest events, money and
  bookings each in their own. Only the queue has one (`pgboss`, which it made itself); all
  fifty-nine of our tables are still in `restro`, and the reservation tables will land there too
  (#323). The split is the rest of T85 and has not been done.
- **Nothing checks the hard-link rule.** That is ticket #342, which your answer today unblocks.
- **Nothing is deployed.** There is no staging database and no production database: the Supabase
  account holds no Restro project today, and `docs/guides/pilot-readiness.md`'s items O2 and O3
  (the production accounts, and migrations reaching staging) are both still open. Every table
  above exists in the migrations and on test machines.

## If you want to look

The migrations are plain text and in order. `packages/db/migrations/0000_foundation.sql` is the
first night of the project; `0045_guest_events.sql` is last week. Each file says what it adds and
why. `0028_service_tables.sql` is the one that built Tonight, and `0030_payment_tables.sql` is the
one this decision is about.
