# Adjustments 01

Session 10-11 to 10-12. Full decision texts: `docs/tracker.md` (search `| D77 |` etc.).

## Built
- **D75** barsy's own name stands in for a missing public name; the composer warns (CF-17).
  New venues showed items with no name, because barsy's guest name field was empty. Now the till's own name ("Салата Цезар") is shown, with a warning in the composer until a proper name is filled in barsy or typed in Restro.
- **D76** Rename, delete (archive) and restore a venue (CF-18).
  Rename sits in the venue's Settings tab. Delete is owners only, after typing the name: the venue disappears, its guest page and QR codes stop working, and its barsy link is freed. Nothing is erased; restore it from Settings › Deleted venues.
- Agents run only their own tests; CI runs the full suite before a merge.
  The full test round took 10–15 minutes on the PC per agent. Now GitHub runs it, and the lead merges only when it's green.

## Decided, to build
- **D77** One central source of a venue's menu languages, from guest-facing texts (about 20% coverage).
  barsy lists all 11 languages, but the demo menus only have Bulgarian and English filled in. One place in the code will work out a venue's real languages from the filled texts, and every screen and step (sync, composer, checks, publishing) will use it.
- **D78** Changing a venue's menu source archives its old menu (restorable 30 days).
  Switching Demo Club Sofia between three barsy venues piled up 127 items from all of them. From now on, a switch (or going from a hand-made menu to a till) warns first, replaces the old menu, and keeps it restorable for 30 days.
- **D79** The pilot's till is Mistral; Mistral and the connector foundation are parked until after this phase.
  We're finishing the platform itself first (data, features, UI). The general connector work and the Mistral connector come later, once Mistral's API docs arrive.

## Proposed
- **P-01** Allergen setting: show a sample value beside each barsy characteristic.
  barsy has no allergen field, so the list shows every characteristic a venue defined ("Грамаж", "Годност в дни"…). A sample value makes the right one obvious.
- **P-02** "Add as venue" offers only sales venues (not production or service units).
  Demo Club Sofia ended up linked to a production unit ("Кетъринг/Bakery/Тропс"), which isn't a place guests order from.
- **P-03** Default menu category = barsy's public menu (`public_cat_id`).
  barsy keeps several "menus" in one catalogue. Its "Публично меню" branch has proper guest names; the till's own branch mostly doesn't.
- **P-04** Decide which barsy price guests see (`actual_price` or `current_price`).
  barsy sends two prices that can differ: the demo espresso is 1.80 vs 1.17.
- **P-05** Save barsy's language list on the connection.
  Restro reads it during the connection check and then drops it. D77 needs it.

## Open
- Write the faster test process into `CLAUDE.md` (needs Martin's OK).
  The edit to the agents' rules file was blocked as a change to the agent's own instructions. Until then, each brief states the rule.
- Demo Club Sofia's first publish: who presses it.
  Its guest page doesn't work at the new address until it's published once. Best after D78 cleans up its menu.
- **T78** Should a name typed in Restro beat the till's stand-in name?
  Today the till's stand-in name wins over a name typed in Restro's base layer. A name typed in the item sheet still wins. None of the current data is affected.
- **T77** Re-withdraw a deleted venue's guest files if the queue was down.
  If the background queue is down at the moment of a delete, the guest page stays online until the venue is restored and deleted again.

## Post-connector platform: concluded
- **The database layer stays SQL (one Postgres).**
  Data arrives as the till's JSON and leaves as the guest's JSON (the published snapshot). The rows in between are where sources (till, typed in Restro, per venue) are merged with history and rules, and where small frequent edits stay safe. Conversions run only on change, never per guest view. Analytics later reads from it (a separate reporting store only if volumes demand it).

## Post-connector platform: decided, to build
- **D80** Custom domains for the guest menu.
  Per domain, the owner chooses: one venue (`menu.club.bg` opens its menu) or the whole organisation (`menu.group.bg/<venue>`). Subdomains only; only the guest menu and table codes are served there, never the admin. The owner sets it up in Settings › Domains: Restro shows the DNS record, checks it and turns HTTPS on (provider to confirm: Cloudflare for SaaS). QR codes then print with the domain; our address keeps working.

## Post-connector platform: proposed
- **P-06** Venue profile: address, phone, opening hours, description, website.
  A venue has none of these today, so a connector can't fill them and a person can't type them. A till fills them when the venue is added; a person types them for a hand-made venue or over the till's values.
- **P-07** Make a venue's languages, time zone and closing time editable (today read-only).
- **P-08** Venue address names unique within an organisation, needed for `menu.group.bg/<venue>` (D80).

## Martin's notes
