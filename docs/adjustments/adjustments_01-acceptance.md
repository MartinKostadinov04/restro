# Adjustments 01: acceptance guide (for Martin)

Everything from `adjustments_01.md` that is built is on the branch `ad/foundation` (waves 0, 1 and 2; wave 3 as it lands). This page says how to bring your acceptance database up to date and what to look at, pair by pair. Each check is one thing to see; if it is not as written, note it and go on.

## Before you start (once)

1. **Check out the branch and install:** `git checkout ad/foundation`, `pnpm install`.
2. **The local Postgres** must run (`pnpm db:local` in its own terminal).
3. **Migrate your acceptance database yourself** (the agents never touch `restro_accept`): with `DATABASE_URL_OWNER` pointing at `restro_accept`, run `pnpm db:migrate` and then `pnpm db:roles`. The migrations go up to 0027 (instance names, several menus per venue, areas and tables, menu routes, venue addresses, the purge, the removed-instance flag).
4. **`.env.local`:** `DATABASE_URL` and `DATABASE_URL_OWNER` on `restro_accept`; `DATABASE_APP_PASSWORD`, `DATABASE_PURGE_PASSWORD` and `DATABASE_URL_PURGE` as `.env.example` shows (the same password in the last two). Without `DATABASE_URL_PURGE` the worker has no purge job, and "Delete permanently" only queues nothing.
5. **The demo data: skip the seed on `restro_accept`.** Your Demo Club Sofia there is linked to the real barsy demo installation (demo.barsyonline.com, its "Bar & Dinner" venue), and its menu comes from reads of it. `pnpm db:seed:dev` without `SEED_DEMO_MENU=0` would add a made-up instance (`dev-seed.test`) and made-up items into that same menu. If you do need the owner, the organisation or the venue recreated, run `SEED_DEMO_MENU=0 pnpm db:seed:dev`: it skips the made-up menu. The made-up menu is for the local development database and the tests only. To see the photo strip, mark a section horizontal in Composer › Structure; the menu starts in two columns with the guest switch.
6. **Run:** `pnpm dev`, then open http://localhost:3000 and sign in as the owner.

## Pair A: Integrations and Venues

- **Settings › Integrations:** the systems picker; a barsy instance has a name, its own tab with connection, status, system settings (the till text language), "sync everything" and history. Removing an instance is refused while a venue uses it.
- **Venues › New venue:** two steps: "from an instance's venue" (the instance's venues to pick from) or "by hand". A venue's source is fixed at creation.
- **All venues:** each card shows its state (Draft, Live, Archived), the instance and the POS venue name, and a preview link.
- **A venue's Menu source card:** the common part (which instance, which venue) and the connector part (barsy's own settings) are apart.

## Pair B: Organisation, bins, venue settings and publishing

- **Settings › General:** the organisation's name and address name; renaming the address name keeps the old guest links working.
- **Settings › Deleted venues:** a deleted venue lists when it will be erased; "Restore" brings it back as a Draft with its till linked again (or says who holds the till venue now); "Delete permanently" asks for the venue's name.
- **A venue's tabs:** Composer, Tables & QR, Settings (General, Publish, Versioning). The Publish button sits in the header on every tab, with the number of changes, a confirmation, and a dropdown per menu. Settings › Publish holds the automation rules for a till venue; saving them keeps a pause.
- **Settings › General › Menus:** several menus, one live; a deleted menu goes to "Deleted menus" for 30 days.
- **Unpublish:** the guest page answers "not available" until the next publish.

## Pair C: Tables & QR and the composer's Structure

- **Tables & QR:** the read-only address card; areas as sections with table cards (name, number, code status, the menu shown). A till venue renames, reorders and hides; a hand-made venue creates and deletes. The route picker sets the menu per venue, area or table.
- **Composer › Structure:** the menu switcher (the live one marked); rename in place; a confirmation before deleting; a section's horizontal toggle (the photo strip); the "Menu layout" control (list, one column, two columns; "guests may switch"); the "Overrides to review" badge on an item whose till text changed under our own.
- **A till venue** cannot create or delete till items or sections (only hide them); a hand-made venue can.
- **Guest page:** a horizontal section is the photo strip; the menu starts in the layout the composer set.

## Pair D: the composer's Design subtab and wording

- **Composer › Design:** the collapsed template line with "Change" and a phone preview per template; then the cards in order: logo and header name, guest functions, font (a dropdown drawn in each font), corners, shadow and screen, and the colours.
- **Colours, brand first:** "Your brand colour" fills Page and Panels with calm tints of it; both stay editable; a strongly saturated page gets a warning; "Advanced" shows the computed colours with Adjust / Reset and each pair's contrast; a pair that does not read turns Save off and is named.
- **The phone preview** stays beside the form while you scroll.
- **Wording:** no screen names "barsy" outside the barsy instance's own tab; the Bulgarian sentences added since your last review are listed in `docs/i18n-review.md`, grouped by screen.

## Wave 3: the purge rehearsal (on a throw-away venue)

1. Create a venue by hand named "Rehearsal", publish it, print one table's code (note the code in its guest address).
2. Delete it (Settings › General › danger zone), then Settings › Deleted venues: it says when it will be erased. Restore it: it is back as a Draft.
3. Delete it again, then "Delete permanently" (type its name). The toast says it is being erased; after the worker's purge (within a minute) the venue is gone from Deleted venues, and the old guest address and the table's code answer "not available" for good (never reissued).
4. Versions (Settings › Versioning): the live version and up to two earlier ones stay; older non-live ones go after 30 days.
5. A removed instance's data is purged 30 days after its removal (S9, once merged); nothing to see in a rehearsal except the removal itself.

## What to report

One line per check that is not as written: the screen, what you saw, what you expected. Wording remarks go against the key in `docs/i18n-review.md`.
