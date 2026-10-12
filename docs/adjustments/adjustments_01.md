# Adjustments 01

Session 10-11 to 10-12. Full decision texts: `docs/tracker.md` (search `| D77 |` etc.).

Three layers, kept apart:
1. **Platform:** everything after the data is in our own model; knows no POS.
2. **Integration layer:** how any POS (or "by hand") plugs in; knows no specific POS.
3. **barsy connector:** barsy's own fields and quirks only.

## 1. Platform (source-agnostic)

**Concluded**
- **The database layer stays SQL (one Postgres).**
  Data arrives as the till's JSON and leaves as the guest's JSON (the published snapshot). The rows in between are where sources (till, typed in Restro, per venue) are merged with history and rules, and where small frequent edits stay safe. Conversions run only on change, never per guest view. Analytics later reads from it (a separate reporting store only if volumes demand it).

**Built**
- **D76** Rename, delete (archive) and restore a venue (CF-18).
  Rename sits in the venue's Settings tab. Delete is owners only, after typing the name: the venue disappears, its guest page and QR codes stop working, and its till link is freed. Restore it from Settings › Deleted venues (for 30 days, then purged: D83).
- **D75 (platform part)** The composer warns "Menu name missing in {source}" when a name is the till's stand-in (see 3).

**Decided, to build**
- **D89** Hand-made venues have full control; POS venues can hide but not delete.
  Hand-made: create, edit and delete menus, sections and items. POS venue: hide, sold out, reorder, own name/description/photo over the till's, tags; never delete or create items or change prices, because the POS is the source and would bring them back. An item deleted in the POS leaves Restro after the next full read.
- **D88** A venue holds several menus; exactly one is live.
  Hand-made venue: add menus in Settings › Menus (each with ">" into the composer) or in the composer; pick the live menu in either place. barsy venue: its menus are what barsy designates for it, its public menu (live by default) and its till tree; other catalogue branches aren't its menus. Showing several menus at once is set per QR code or hall (to detail with Tables & QR). **Import menu** ("From other venue"): only between hand-made Restro venues, one-time copy; POS menus can't be copied (limitation for later).
- **D86** Venue states and the All venues card.
  States: Draft (not published yet, or unpublished), Live (published), Archived (in the organisation's bin until erased by the clock or by hand). The card shows the display name, the state, the POS connection (or "By hand"), the venue's name in that POS, and a link to the full menu preview. Needs an "Unpublish" action. The preview is the whole menu, not a table's view; its design is discussed with the design topic.
- **D85** New venue asks only what no source can give.
  From a POS: pick the instance and its venue, nothing to type; name, address and languages come from the source and can be edited later. By hand: name and languages; the address is generated from the name as an editable preview.
- **D84** Clean guest addresses: `<our domain>/m/<organisation>/<venue>`, no visible codes.
  Names are generated from the organisation's and venue's names (also for POS venues) and editable later; old names keep redirecting, so printed links never break. The venue name is unique within its organisation. With a custom domain (D80) the path parts it covers disappear (`menu.club.bg`, `menu.group.bg/club-sofia`). Path form chosen over subdomains as simpler to apply now.
- **D83** A deleted venue is restorable for 30 days, then purged; or "Delete permanently" at once from Organisation › Deleted venues.
  Chosen for scale: an unused venue shouldn't take space forever. The purge erases the venue's own data (menu, tables, published files, history); items another venue uses stay; its public and QR codes are never reused. Only the purge job may delete (its own database role). Amends D76.
- **D77 (platform part)** One central source of a venue's menu languages.
  One function in core works out a venue's languages from what the connector reports (about 20% coverage counts; a language the owner switched on is never removed; one main language per venue). Every step uses it: sync, new venue, settings, composer, checks, publishing.
- **D87** A venue's source is fixed when it is created (supersedes D78).
  Only the source is fixed; names, address and all other settings stay editable. Switching a hand-made menu to a POS is not supported in this version. No "Change…" on the venue: it confused. To use another till venue, another POS, or to go from hand-made to a POS, create a new venue from that source and delete the old one. Which menus a barsy venue has: D88. Which sections and items appear is the composer's job. (Demo Club Sofia's mixed 127 items: recreate the venue.)
- **D80** Custom domains for the guest menu.
  Per domain, the owner chooses: one venue (`menu.club.bg` opens its menu) or the whole organisation (`menu.group.bg/<venue>`). Subdomains only; only the guest menu and table codes are served there, never the admin. The owner sets it up in Settings › Domains: Restro shows the DNS record, checks it and turns HTTPS on (provider to confirm: Cloudflare for SaaS). QR codes then print with the domain; our address keeps working.

**Proposed**
- **P-06** Venue profile: address, phone, opening hours, description, website.
  A venue has none of these today. A till fills them when the venue is added; a person types them for a hand-made venue or over the till's values.
- **P-07** Make a venue's languages, time zone and closing time editable (today read-only).
- ~~P-08~~ became D84 (venue names unique within an organisation).

**Open**
- **T78** Should a name typed in Restro beat the till's stand-in name?
  Today the till's stand-in wins over a name typed in Restro's base layer. A name typed in the item sheet still wins. None of the current data is affected.
- **T77** Re-withdraw a deleted venue's guest files if the queue was down.
  If the background queue is down at the moment of a delete, the guest page stays online until the venue is restored and deleted again.
- Demo Club Sofia's first publish: who presses it.
  Its guest page doesn't work at the new address until it's published once. Moot if the venue is recreated (D87).

## 2. Integration layer (any POS, or by hand)

**Decided**
- **D79** The pilot's till is Mistral; Mistral and the connector foundation are parked until after this phase.
  We're finishing the platform first (data, features, UI). The general connector work (CF-05, 06, 07, 08) and the Mistral connector come later, once Mistral's API docs arrive. Exception: the Integrations screen and named connections (D81) are built now.
- **D77 (integration part)** After each complete full read, a connector reports the languages its POS offers and how many guest-facing texts each one fills. The connector reports; core decides.

- **D81** Organisation Settings › Integrations is source-agnostic, built now (the screen part of the parked plan comes forward).
  The design below. Removing an instance is refused while venues are linked to it; a system can't be unselected while it has instances; the chosen systems are saved for the organisation.

- **D82** Settings ownership: the instance owns what's true for the whole connection, the venue owns what's true for that venue; neither edits the other's.
  - Instance: connection and status, allergen characteristic (barsy defines it once per installation), "Sync everything now", the history of all its venues.
  - Venue: main language, menu source and price, **sync mode: automatic or manual only**, with, when automatic, how often to check and the daily full-read time in the venue's own time zone; its own sync history and "Sync this venue"; publishing rules; the publish pause after a rollback (T76).
  - Moves from the connection to the venue: default language, sync schedule, rollback pause.
- **Menu source card (venue Settings) is two parts:** a common part for every POS venue (instance and its venue, sync mode and schedule, Sync this venue, history, held-sync warning) and a part supplied by that POS's connector, shown only for its venues (barsy: menu category, Base vs Current price). A hand-made venue shows neither. No "Change…" (D87).
- **Sync history is collapsed** (instance and venue): one line shows the last run (time, result, changes); the full list opens under a dropdown, so the page never becomes a long scroll.
- **Wording:** every settings text that mentions barsy will name the system by `{POS name}` inside its tab (the connector's label), never "barsy" hard-coded.

**Integrations screen (Martin's notes, 10-12)**
- An owner may have several venues on one POS instance, several instances of the same POS, several POS systems, or no supported POS (by hand).
- Organisation Settings › Integrations: choose your systems from the ones we support. Below that, one tab per chosen system, holding its connection forms (address, API key, password). "Add {POS name}" adds another instance.
- Each instance has a name the owner types (e.g. "barsy – Sofia"); per-instance settings (sync schedule, run history, POS-specific options) sit in that instance's section.
- New venue: choose the POS instance (only those with an active connection) or "By hand", then the venue from that instance. A venue already linked shows "linked to …" and can't be picked. "By hand" skips all of that; the backend works the same way.
- No till-venue overview in the instance tabs and no "Not used": the New venue dropdown already shows them.
- *Lead:* this is the screen design for the parked plan (CF-05 named connections, CF-06 forms per POS, CF-09 screens). Today: one barsy connection, no system picker or tabs, and till venues are added only from the Integrations list ("Add as venue").

## 3. barsy connector (barsy-specific)

**Built**
- **D75 (barsy part)** barsy's own name stands in for a missing public name (CF-17).
  barsy's guest name (`article_name_public`, `cat_name_public`) was empty for many items, so new venues showed nameless items. Now barsy's own name (`article_name`, `cat_name`, e.g. "Салата Цезар") is used, and the platform warns (see 1).

**Proposed**
- **P-01** Allergen setting: show a sample value beside each barsy characteristic.
  barsy has no allergen field, so the list shows every characteristic a venue defined ("Грамаж", "Годност в дни"…). A sample value makes the right one obvious.
- **P-02** Offer only barsy sales venues ("Търговски"), not production or service units.
  Demo Club Sofia ended up linked to a production unit ("Кетъринг/Bakery/Тропс"), which isn't a place guests order from.
- ~~P-03~~ became part of D87: barsy's public menu (`public_cat_id`) is the menu category, chosen automatically.
  barsy keeps several "menus" in one catalogue. Its "Публично меню" branch has proper guest names; the till's own branch mostly doesn't.
- **P-04** Decide which barsy price guests see (`actual_price` or `current_price`).
  barsy sends two prices that can differ: the demo espresso is 1.80 vs 1.17.
- **P-05** Save barsy's language list (`Languages_getlist`) on the connection, and count filled languages from barsy's guest-facing `_ml` fields (D77's report for barsy).
  barsy lists all 11 languages; in the demo only Bulgarian and English have text.

## Process

- **Built:** agents run only their own tests; CI runs the full suite before a merge.
  The full test round took 10–15 minutes per agent on the PC. Now GitHub runs it, and the lead merges only when it's green.
- **Open:** write this into `CLAUDE.md` (needs Martin's OK).
  The edit to the agents' rules file was blocked as a change to the agent's own instructions. Until then, each brief states the rule.

## Martin's notes
