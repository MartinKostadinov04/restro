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
- **D97** Publishing moves into the venue's Settings.
  The venue page has three tabs: Composer (Structure, Design), Tables & QR, Settings. Settings has sub-tabs General, Publish (automation) and Versioning (versions, restore, log). The Publish button stays top right; warnings that need action show under the header on every tab.
- **D96** Publishing simplified.
  - Versions: the live one plus up to 2 earlier ones can be restored; anything but the live version is purged after 30 days, even among the last 2. The change log is kept 2 months.
  - A Publish button sits top right on every tab, greyed when nothing changed, with a change count and a confirmation listing the changes. With several menus it becomes a dropdown: each menu, its areas in brackets, and its number of changes. "Open the guest page" sits beside it.
  - The Publishing tab loses "On guests' phones now" and "Changes waiting". "Rules" becomes Automation settings (POS venues only: sync mode and publish after sync). The "hold new till items" rule goes. Warnings (held publish, paused, address off) appear only when they apply.
- **D95** Tables & QR: areas, tables and menu routing.
  barsy venues: halls and tables come from barsy; rename, reorder, hide only; non-public places hidden by default. Other POS: decided after reading their docs. Restro venues: you make your own areas and tables. Menu routing for every venue: venue-wide menu → area menu overrides it → table menu overrides the area; one menu per level, no guest switch. The name field says it's the name guests see, with barsy's number beside it; each area shows its tables as a grid of cards.
- **D94** Tables & QR: the codes' address is shown, not asked for.
  The card stops asking for a base address or an "own link" pattern (the pre-domain workaround). It shows where the codes lead (your verified domain, else our address), links to Organisation › Domains, and keeps the test link and the printing warning. The local Wi-Fi testing address is developer configuration.
- **D93** Colour system upgrades, from an audit against current practice (WCAG 2.2, CSS Color 4/5, Material 3, Radix, Tailwind 4).
  The core is sound: perceptual OKLCH, gamut-safe, 4.5:1 text contrast, roles instead of raw colours, a proper dark transform. The gaps are at its edges. Built with the D92 designer work; every change is additive (old snapshots and templates keep working).
  - **Must, part 1. One source of truth for every colour that carries text or meaning.** The template mixes about 40 shades itself (`color-mix(in srgb)`), unchecked and blended non-perceptually. The engine adds roles for what is missing:
    - status: error, success and their text colours, for the service screens' rejected and accepted states;
    - disabled and sold-out text, selected or soft-accent chip fills, the focus ring, the backdrop behind sheets, and a strong border for controls.
    - Purely decorative tints may stay in the template, blended `in oklab`. A contract test checks every text-on-colour pair the template actually draws.
  - **Must, part 2. Contrast for controls (WCAG 1.4.11, 3:1).**
    - The strong border and the focus ring reach 3:1 against page and panels.
    - When the chosen highlight colour sits too close to the page (below 3:1), it is kept as chosen, buttons get the strong outline, and the Design tab says why.
  - **Must, part 3. Brand-first colour card** (fits D92's merge of "brand" and "custom").
    - The card starts with "Your brand colour", which becomes the highlight (Tertiary). Page and panels are pre-filled as calm tints of it, through the monochrome suggestion, and stay editable.
    - A warning appears if the page colour is strongly saturated, since it covers about 60% of the screen.
    - Reason: an owner typing a bright brand colour as "Primary" gets a fully coloured page.
  - **Should, part 4. Dark screen.** Strong accents are also toned down a little, not only lightened, so they don't "vibrate" on a dark page.
  - **Should, part 5. Second readability check (APCA).** WCAG 2 stays the hard, legal rule. APCA (the perceptual method behind the WCAG 3 draft) is added as a second check: body text at least Lc 75, small secondary text at least Lc 60, both screens. If it fails, the colour is nudged further.
    - Implemented in-house, like OKLCH, so no new dependency. Check APCA's licence terms before shipping.
  - **Should, part 6. "Increase contrast".** A stronger variant (text 7:1, secondary text 4.5:1, borders 3:1) for phones set to `prefers-contrast: more`.
  - **Not now:** wide-gamut (Display-P3) colours and Windows forced-colours mode.
- **D92** Composer has two subtabs, Structure and Design; the designer is simplified.
  - Structure: POS venues may create their own sections too, placed through the mapper (amends D90). Each section is vertical or horizontal (e.g. promotions, top picks as a row). Menu layout (list, one or two columns) is set here: a default, and whether guests may switch.
  - Design: choose a template (stored shells, phone preview pop-up with the general menu preview). Cards in order: logo and menu header name → guest functions (own section) → font (dropdown), corners, shadow, screen → colours (only Primary, Secondary, Tertiary; no presets, no swatch palette). A sticky phone preview beside it.
  - Template chooser at the top, collapsed by default. Header name per menu (defaults to the venue name). Computed colours and the dark screen are hidden under a collapsed "Advanced".
  - Horizontal sections reuse the shell's delivered feature strip, now for any section the composer marks; the layout switch is the shell's own. A design change reaches guests on the next publish of the venue's menus.
- **D91** Gaps closed after a user-side review.
  Organisation › General (name and address name). The purge also clears data of removed POS instances and items no venue uses. A QR code on an unpublished menu falls back to the live menu. Hand-made venues' languages are the owner's choice. A domain on a deleted venue says "not available" and is detached on purge. Deleted menus go to a 30-day bin in the venue's settings. A POS venue may move items between sections. Roles (RBAC) are left for later.
- **D90** Consistency fixes after reviewing the venue and menu decisions.
  Restoring a deleted POS venue re-links its till venue if still free (else refused, naming who took it). A POS venue's structure is our own mapper (order) and dictionary (names), starting as a copy of the till's: reorder, rename, hide; no own sections; syncs never touch them. Each menu has its own draft and published version; the venue is Live when its live menu is published. One shell and design per venue, the same for all its menus.
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
- ~~**T78**~~ Answered by D90/D91: a name typed for a POS item goes into the dictionary, which beats the till's stand-in.
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
- **Menu source card (venue Settings) is two parts:** a common part for every POS venue (instance and its venue, sync mode and schedule, Sync this venue, history, held-sync warning) and a part supplied by that POS's connector, shown only for its venues (barsy: Price shown, Base vs Current; the menu category is no longer a setting, D88). The allergen characteristic is a barsy instance setting, not a venue one. A hand-made venue shows neither. No "Change…" (D87).
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
- **P-04 → decided (Martin 10-12):** "Price shown" stays a barsy venue setting (the barsy part of Menu source): Base price (`actual_price`, default) or Current price (`current_price`, after barsy's price rules, can change during the day).
  The demo espresso is 1.80 vs 1.17. Current price carries a warning that time-based rules (happy hour) may show late, until Lukanet confirms whether items count as changed when a rule starts (Q43).
- **P-05** Save barsy's language list (`Languages_getlist`) on the connection, and count filled languages from barsy's guest-facing `_ml` fields (D77's report for barsy).
  barsy lists all 11 languages; in the demo only Bulgarian and English have text.

## Process

- **Built:** agents run only their own tests; CI runs the full suite before a merge.
  The full test round took 10–15 minutes per agent on the PC. Now GitHub runs it, and the lead merges only when it's green.
- **Open:** write this into `CLAUDE.md` (needs Martin's OK).
  The edit to the agents' rules file was blocked as a change to the agent's own instructions. Until then, each brief states the rule.

## Martin's notes
