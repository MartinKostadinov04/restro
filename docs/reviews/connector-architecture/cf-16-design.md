# CF-16 design: several venues on one barsy account

Follows barsy (T71, D73): items live in catalogues (`menu_id`) that venues can share; prices and for-sale are per venue. One page; the code is the detail.

## Sync units
- **Venue pull** (full or incremental), one per mapped venue. Everything it asks barsy carries that venue's `?bid=`, so price and for-sale are read in the venue's own context (as before).
  - The **full pull** reads the venue list (`Barsys_getlist`, refreshes every venue's catalogue), the venue's tree, the **whole catalogue** (`Articles_getlist` with `filters.menu_id`, a documented filter, 10-08 doc check; recorded in `articles-bid*-menu72.json`), the supplements of the combos under the venue's root only, the modificators and the places.
  - The **incremental** still reads the venue's root (`cat_id_deep`) and concludes nothing.
- **Places read** (`places-read`, new job): `Places_getlist` for one mapped venue, needs no catalogue root (T67).
- **Items** are one per article for the installation (article links unchanged). A pull maps only the articles under its venue's root, into that venue's sections, with price and for-sale written `venue:<vn_>`.
- **Sections** are per venue. A category's section link is `category:<catId>` when no such link exists or its section is already in this venue's menu; otherwise `category:<catId>@<vn_ id>` (an existing `@venue` link is always reused). One venue therefore never gets a new key: today's links, node ids and placements stay exactly as they are.

## Job keys and locks
- `barsy-full-pull`, `barsy-incremental`, `places-read`: singleton key `<in_>:<vn_>`, so two venues never drop each other's jobs. A full pull deferred by a busy lock re-queues with `<in_>:<vn_>:later:<s>`.
- Still **one pull at a time per installation**: the advisory lock `restro:barsy-pull:<in_>` is kept. Why: barsy allows two concurrent requests per installation and a pull already uses both (the limiter), so parallel pulls would not be faster; serial pulls also keep the catalogue conclusions of venues that share a catalogue free of races. A full pull waits up to 60 s for the lock; an incremental or places read does not wait.

## Where state lives
- `barsy_venues.catalogue_id` (new): `Barsys_getlist.menu_id`, written by the connection check and by every full pull.
- `barsy_venues.price_source` (new, D73): `actual_price` or `current_price` per venue. Null falls back to `integrations.config.price_source`, then `actual_price`. The Mapping card writes the setting of the venue it is shown in.
- `integrations.config.sync.<bid>` (unchanged keys) plus `places_read_at`, `places_queued_at`.
- `integrations.config.schedule.time_zone` (optional, new): the zone of the daily full read; default `Europe/Sofia`. The settings form keeps it when it saves.
- **Venue absence of an item:** a till-layer `visible = false` at `venue:<vn_>` (venue beats master), cleared by the mapping when the item is under the venue's root again.

## A complete read
Every page of the pull succeeded: all article pages, every supplement call, every modificator page. Any failure → nothing is concluded (rule 6), for the catalogue and for the venue.

## Absence
- **Per catalogue** (from a complete read of the whole catalogue): item links whose current source record (the one `last_hash` names) says `menu_id` = this catalogue. Seen = every article listed. An item outside this venue's root but in the catalogue is seen, so it is never concluded absent because a root does not hold it. Option groups and options follow their combo: covered when this pull mapped the combo, or the combo is absent from the read. Hold (CF-02): an empty read, or more than 30% (and at least 5) of the catalogue's active items.
- **Per venue** (from a complete read of the venue's root): its section links (sections under its menu) go missing or deleted as before; items on its menu (placed in its sections) that its root no longer holds are hidden in this venue only (above). Hold: no section seen while sections are active; or more than 30% (and at least 5) of the venue's shown items would be hidden.
- A catalogue hold holds the venue's moves too; a venue hold leaves the catalogue's moves alone.
- No catalogue known (venue list unreadable and nothing stored): the pull reads the root, concludes nothing per catalogue, and says so.
- The "exactly one mapped venue" limit is gone.

## Schedule (D73)
One schedule per integration: the minute tick reads the integration's settings and time zone, queues each mapped venue's change check and, at the integration's daily time, every venue's full pull. Mapped venues whose places were never read get a `places-read` (again after 10 minutes if it did not run). The venue's own time zone no longer moves the daily read.

## Publishing
A pull that changed something queues the automatic publish of every mapped venue on the same catalogue (shared items change for all of them; an unchanged menu publishes nothing).

## Prices that change by time
`current_price` is the price under the rule active at the moment of the read, in the venue's context; the menu follows a rule boundary only at the next read (up to the interval late). `actual_price` is the base price. Which one a venue shows is now its own setting. Following time-based rules (happy hour: a base price with a badge, or reading `Pricelists_index` and refreshing at boundaries) stays the open decision of the architecture doc; not built here.

## Stored data
Migration `0016_venue_catalogue` (expand only): the two nullable columns, `price_source` backfilled from `config.price_source`, `catalogue_id` backfilled from the stored `Barsys_getlist` records. No link, node or value is rewritten.
