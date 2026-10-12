# Adjustments 01: platform Q&A and planning session (10-11 evening to 10-12)

A record of one working session between Martin (product owner, non-coder) and the lead agent. Martin asked questions, checked how things work, and decided upgrades, fixes and adjustments. This file collects all of it, so a later agent (Fable) can plan and build from it with the right context. Martin will add his own notes in a later section or file.

**How to use this file**
- It is a record, not a brief. Binding decisions live in `docs/decisions.md` (one line each) and in full in `docs/tracker.md` (search `| D77 |`). Where this file and the tracker disagree, the tracker wins.
- Read `CLAUDE.md` first; its rules apply to every change (one write path, provenance, barsy ids stay in the backend, guardrails only tighten, and so on).
- Statuses: **built** (merged), **decided** (Martin decided, not built), **proposed** (the lead suggested, Martin has not decided), **open** (a question).

## 1. Where things stand

- **Phase.** The current phase is the platform's own functionality on clean connector data: the data structure, the features and the UI (Martin 10-12). Mistral (the pilot venue's till) and the connector foundation are parked until after this phase (D79).
- **Branch.** `sh/foundation` (contains `cf/foundation`), last commit `18a39aa` at the time of writing. Pushed; CI runs the full gate on `cf/**` and `sh/**`.
- **Local acceptance setup** (Martin's PC):
  - web on port 3000 (`next start`);
  - the worker (`pnpm --filter @restro/worker dev`);
  - local Postgres 17 on 54329, database `restro_accept`, migrated to 0017.
  - Sign-in is the demo owner `owner@demo-club.test`. The password is `DEV_ADMIN_PASSWORD` in Martin's `.env.local`, which agents never read.
- **Acceptance data, as found on 10-11** (Demo Club organisation, barsy demo installation):

  | Restro venue | Linked barsy venue | Menu category | State |
  |---|---|---|---|
  | Demo Club Sofia | Кетъринг/Bakery/Тропс (bid 70, type "Производствен", a production unit) | 190 | 127 items in its menu: 1 from the current link, the rest left from earlier links (see 4.1) |
  | Магазин 1 | Магазин 1 (bid 1) | 730 | Empty: none of the shop's 22 articles sit under category 730 |
  | Test | none | none | Empty |

  Bar & Dinner (bid 10), Burgers (bid 102) and Услуги (bid 40) are not linked. Demo Club Sofia has never been published at its new address; whether Martin or the lead presses Publish is open (7.3).

## 2. Built in this session

### 2.1 barsy's own name stands in for a missing public name (D75, CF-17), built
- **Why.** On the acceptance data, a new venue showed items without names. barsy's public name (`article_name_public[_ml]`, `cat_name_public[_ml]`) was empty and our mapping never used barsy's own name (`article_name`, `cat_name`).
- **What.**
  - The mapping (`packages/barsy/src/mapping/{text,catalogue}.ts`, `nameText`) uses barsy's own name, under the default language, when the public one is empty in every language. This applies to items, options and sections.
  - The run records a warning per fallback.
  - The mapping version went from 1 to 2, so the next pull of every venue is a full one.
  - The composer shows "Menu name missing in {source}: its own name is shown" on item rows, section headers and the item sheet. This comes from `readNameFallbackNodeIds` in `apps/web/src/connectors/sync-reads.ts`.
  - Ids, cost prices, internal notes and other internal fields stay out of snapshots. New tests prove it in the mapping and in the leak guard.
- **Merged** `70f7a6f`.
- **Follow-ups, T78:**
  - (a) A name typed in the manual layer ranks below the till's stand-in, because `name` is `source_first`. Typing in the item sheet writes an override, which wins. Martin's data has no such names. Decide whether a stand-in should rank below the manual layer.
  - (b) Sections cannot be renamed in the composer.
  - (c) A public name only in a language the installation lacks gets the stand-in but no warning.

### 2.2 Rename, delete and restore a venue (D76, CF-18), built
- **What.**
  - **Rename.** A venue's name is editable next to its address (Settings tab), by owners and admins.
  - **Delete.** Owners only, after typing the venue's name. Delete archives the venue: migration 0017 adds `venues.archived_at`, and the app role still has no DELETE.
    - In the same transaction it releases the till link, so the barsy venue is free again in Settings › Integrations.
    - The worker withdraws `v/<code>.json` and the venue's `t/<token>.json` files. The guest page then says "This menu is not available". The QR tokens are kept.
    - Syncs and publishes of a deleted venue are skipped.
  - **Restore.** Owners only, from Settings › Deleted venues. The venue comes back without a till link and unpublished.
  - **Safety.**
    - Every core writer of one venue calls `lockLiveVenue` (`packages/core/src/apply/venue-lock.ts`). It holds a `FOR SHARE` lock against the delete's `FOR UPDATE`, so a save and a delete never interleave.
    - `apply()` refuses a deleted venue's scope and menu nodes.
    - Admin reads (`listVenues`, `getVenue`) return live venues only.
  - **Sign-in gate.** `proxy.ts` stays a cookie check, per the Next.js guide. The real checks run on the server.
  - **Extras the lead accepted:**
    - after a restore, Publish stays enabled with an "address is switched off" notice;
    - the guest page's unknown-venue text is now "This menu is not available".
- **Merged** `0c80c6c`, plus the fix `dbdc41c`. CI's vendor-word test caught new "barsy" words in core and the worker. The till-venue table now reaches core under a neutral name (`packages/core/src/connectors/till-venues.ts`, `tillVenueLinks`). The baseline went down, never up.
- **Open, T77 (a).** If the queue is down at the moment of a delete, the guest files stay online until the owner restores and deletes again. A way to re-withdraw them is needed.

### 2.3 Faster agent process (Martin 10-11), agreed, partly written down
- Agents run only lint, typecheck, deps:check and the tests of what they touched, plus a Playwright spec only if they wrote or changed it. No full `pnpm test`, `pnpm build` or Playwright suite on the PC.
- The lead pushes the task branch, waits for CI to go green, then merges.
- **Not yet in `CLAUDE.md`.** The lead's edit was blocked as self-modification and needs Martin's OK ("update CLAUDE.md"). Until then, every brief states the rule.

## 3. Decided, not built

### 3.1 D77: one central source of a venue's menu languages
- **Martin's goal (10-12).** Everything about localisation collected and managed centrally; every workflow pulls from there; the logic is the same everywhere.
- **Today's pipeline** (from the code):

  | Stage | Where | Decides | Source today |
  |---|---|---|---|
  | barsy sync | `packages/barsy/src/mapping` (`run.text`) | The language for barsy text without a tag | Organisation setting `integrations.config.default_locale`, chosen by hand |
  | Venue | `venues.default_locale`, `venues.enabled_locales` | The menu's languages and main language | Chosen by hand at creation, from all 11 |
  | Composer | translation tabs, new item and section dialogs, tags | Which languages can be typed | The venue's list |
  | Checks | `packages/core/src/resolve/resolve.ts` | Missing-translation issues | The venue's list |
  | Publishing | `packages/core/src/apply/publish.ts` | `locales {default, available}` in the snapshot | The venue's list |
  | Guest page | `packages/shell/src/text.ts` (`fallbackChain`, `pickText`) | The text a guest sees | The snapshot |

- **What is wrong.**
  - The till's real languages are never recorded or used.
  - The main language is set in two places that can disagree: the organisation-level barsy setting and the venue's own main language.
  - The admin language dropdown is the fixed list `LOCALES` (`packages/core/src/locales.ts`): barsy's 11 keys, checked against barsy's docs on 10-08, never read live.
- **Decided shape.**
  1. **The connector reports facts** after each complete full read, per venue:
     - the languages the till offers;
     - per language, how many guest-facing texts it filled. Guest-facing texts are public item names, public category names and descriptions. The till's own name counts only where no public name exists (D75). `article_name_ml` (the till's own names) is not the source: staff may translate those for the kitchen or bar tickets, not for guests.
  2. **Core decides, in one function** every workflow calls:
     - the sync's language for untagged text;
     - a new venue's starting languages;
     - the settings dropdowns, showing coverage (e.g. "English 82%");
     - the composer tabs, the resolver checks and the publisher.

     A language counts from about 20% coverage. A language the owner switched on is never removed.
  3. **One main language per venue.** The organisation-level barsy language setting goes away.
  4. **The guest-side fallback** (shell) is unchanged.
  5. **A guardrail test** stops workflows from reading `venues.enabled_locales` directly.
  6. **Record** a "Languages" section in the barsy mapping section of `docs/architecture/data-architecture.md` and in the live doc.
- **Evidence (10-12, stored real barsy data, read-only):**
  - `Languages_getlist` (recorded 10-09) returns all 11 languages with no "active" flag. The docs describe it as the languages supported in the system, so it cannot tell what a venue uses.
  - Stored records: 933 articles and 33 categories. Every `*_ml` object carries all 11 keys, mostly null.

    | Field | Languages with text |
    |---|---|
    | `article_name_ml` | bg 264, en 323 |
    | `article_name_public_ml` | bg 391, en 321 |
    | `description_ml` | bg 100, en 87 |
    | `cat_name_public_ml` | bg 8, en 8 (only 2 keys present) |

  - Result: exactly two languages carry text, Bulgarian and English. Script: `scratchpad/languages-used.mjs` (lead's scratchpad, not in the repo).

### 3.2 D78: changing a venue's menu source archives its old menu
- **Martin (10-12).** When a venue goes from no till to a till, from one till venue to another, or to another menu category:
  - a dialog warns that the current menu will be replaced;
  - after the first complete read of the new source, the old menu's sections and items leave the venue for guests and the admin;
  - they stay restorable for 30 days in "Previous menus", then leave the admin for good;
  - nothing is erased from the change history (rule 2).
- **Why.** Between 21:35 and 21:36 on 10-11, Demo Club Sofia's till link changed three times: Bar & Dinner, Burgers, Кетъринг. Each full read added the new till venue's items, and the CF-02 deletion hold ("would hide 50 of 50", "94 of 104", "127 of 127") kept the old ones. So the venue holds 127 items from three till venues, and the 65 nameless ones will never get names (they belong to till venues it no longer reads).
- **Replaces** T62's "warn on root or venue change" and reshapes CF-11 (switch preview). It must also release the CF-02 hold for the replaced items.

### 3.3 D79: the pilot's till is Mistral / Zamboo; parked
- The pilot venue does not use barsy. The pilot waits for the Mistral connection; there is no hand-made interim menu.
- **Parked** until after the current phase:
  - the connector foundation: CF-06 contract and kit, CF-05 neutral data tables, CF-07 engine extraction, CF-08 conformance suite (plan: `docs/reviews/connector-architecture/readiness.md`);
  - the Mistral connector itself, which waits for Mistral's API docs (T69, Martin).
- **D66 stays for the pilot:** a venue with a till gets its items from the till only; hand-made items are for venues without one.
- **One Postgres database stays** (see 5).

## 4. Findings

### 4.1 Acceptance data
- Demo Club Sofia's mixed menu: see 3.2.
- Demo Club Sofia is linked to a production unit ("Производствен"), not a sales point.
- Магазин 1 is empty because its menu category (730) holds none of its 22 articles.
- No manual or override names exist on till-linked nodes (checked for T78 (a)).

### 4.2 What the barsy data looks like (demo installation, recorded responses in `packages/barsy/fixtures/demo/`)

```
barsy installation (one API user)
├── venues (Barsys_getlist, "търговски обекти"): 5
│     Bar & Dinner (bid 10, Търговски, catalogue 1)    Burgers (102, Търговски, 72)
│     Магазин 1 (1, Търговски, 10)                     Услуги (40, Търговски, 40)
│     Кетъринг/Bakery/Тропс (70, Производствен, 70)
│   each venue: halls and tables (Places_getlist), prices and for-sale in its own context (?bid=),
│   a till root category (cat_id; Bar & Dinner 1091 "Каса Kiosk")
│   and a public menu root (public_cat_id; Bar & Dinner 1171 "Публично меню")
└── catalogues (menu_id), shareable between venues
      └── category tree (Bar & Dinner: 83 categories, 3 levels, ~675 articles)
            top-level branches are separate "menus": Каса Kiosk, Публично меню (public names filled),
            English, Showx, Sakura Blagoevgrad, plus back-office groups (Напитки, Суровини, ...)
            └── articles
```

- **Article fields.**
  - **Guest-facing:** `article_name_public` with `_ml` (11 languages), `description_public` with `_ml`, `picture`, `is_for_sale`, `is_public`, two prices `actual_price` and `current_price`, `has_supplements`, characteristics `article_details`.
  - **Internal, never shown:** `article_name` (own name, except the D75 fallback), `delivery_price` (cost), `ref_num`, `code`, `barcode`, ids.
  - **Example:** the espresso (article 40) has actual 1.80 and current 1.17, which shows why the price choice matters.
- **Public names are sparse.** 51 of the first 60 Bar & Dinner articles and 48 of Burgers' 60 have no public name. Categories under "Публично меню" have them; most others do not.
- **Combos.** A combo (article 7183, a burger) has supplement groups ("Добавки", "Сосове") with "pick at most N"; each option is another article with a supplement price.
- **Modificators.** Free notes attached to categories (e.g. "Alternative Milk"). In the demo they are mostly barsy's test leftovers.
- **Tables.** Places sit in halls (`salons`); Bar & Dinner has 92.
- **Other.** 11 languages are listed; the currency is EUR.
- **Prices per venue.** barsy answers in a venue's context. In the demo, Bar & Dinner and Burgers return identical prices for catalogue 72.
- **barsy's definition of a venue** ("Търговски обект"): https://docs.lukanet.com/barsy.help/210-dictionary/barsy.html. It is any physical or virtual place of business (shop, restaurant, bar, warehouse, kitchen, delivery, online); one installation has any number; tills, stock and users belong to a venue; venues may share a catalogue. The API method that lists them: https://docs.lukanet.com/barsy.api/methods/barsys/getlist.html.

### 4.3 How a barsy connection is set up today
1. In barsy, create a dedicated API user (rule 9: one per connection and environment).
2. In Restro, go to Organisation › Settings › Integrations › Connect and enter the barsy address, user and password. The password is sealed; only the worker opens it, and the web app never calls barsy.
3. Restro checks the connection and lists the barsy venues: Add as venue, Link to existing, or Not used.
4. Per venue, in Settings › Menu source: pick the menu category and the price, then Sync this venue.
5. The worker then reads on a schedule: a regular change check and a daily full read. It never writes into barsy (rule 7).

### 4.4 The "how barsy data is read" settings card (Settings › Integrations)
- **Allergen characteristic.** barsy has no allergen field. Allergens live in an item characteristic (`article_details`) that each venue defines itself. The list therefore shows every characteristic of the installation (in the demo: "Годност в дни", "Алергени", "Грамаж", "трайност"). "Automatic" picks the one named "Алергени" or "Allergens".
- **Default language.** The language for barsy text without a tag. Today it is the fixed 11-language list; D77 replaces it.

## 5. Architecture answers (Martin's questions, 10-12)

- **Connectors piping into one standardised model: a good idea?** Yes. It is the standard design, and the platform is built that way:
  - our own records and ids;
  - one write path, `core.apply` (rule 1), for syncs and people alike;
  - every value carries its layer (till, manual, override), source and job (rule 2);
  - raw responses are kept separately (`source_records`, `source_links`);
  - venues without a till already work (D64).
- **Is it fully centralised today?** The translating is: `packages/barsy` is pure, and nothing else reads barsy's raw fields. Running the syncs and storing barsy-specific links are not yet; the vendor-word baseline (`scripts/vendor-words.baseline.json`) lists them:
  - the worker: `jobs/barsy.ts`, `config.ts`, `sync/*`;
  - core: `apply/tables.ts`, `jobs.ts`, `apply/barsy-venues.ts`;
  - the database: the `barsy_venues` table, barsy ids on tables;
  - the admin's integration screens.

  CF-05, 06 and 07 generalise these (parked, D79). The vendor-word test stops new leakage.
- **SQL or NoSQL; the schema.**
  - **Postgres is right.** Menu changes must be all-or-nothing across records, tenants are isolated by row-level security in the database, and relations need integrity. JSON columns give document flexibility where it is needed: raw payloads, settings, field values.
  - **The schema.** `field_values` stores one row per node, field, layer and scope, which is what makes several sources, per-venue values and provenance possible. Fields are defined as data (template-as-data). Its cost, more complex editing queries, is contained: the admin reads a resolved document, and guests read a published file (rule 4).
- **SQL for operations plus a document database for menu content?** Rejected (Martin agreed). We already have documents where reading speed matters: the published guest snapshot and the resolved document.
  - A second store would lose single transactions between content and operations (history, links, sold-out, publishing).
  - It would collide on concurrent writes by the sync and a manager.
  - It would duplicate items shared across venues.
  - It would need a second isolation model, and two backups restored to the same moment.

## 6. Proposed, not decided

| # | Proposal | Why |
|---|---|---|
| P-01 | Allergen setting: show a sample value beside each characteristic (e.g. "Грамаж: 250 г", "Алергени: глутен, мляко"), with the auto-detected one first | The right choice becomes obvious; the unrelated entries are explained |
| P-02 | "Add as venue" offers only sales venues (type "Търговски"), hiding production units ("Производствен") and services | Demo Club Sofia was linked to a production unit |
| P-03 | A venue's default menu category is barsy's own public menu root (`public_cat_id`) when one is set | Its names are filled ("Публично меню"); the till root's mostly are not |
| P-04 | Decide which barsy price guests see: `actual_price` or `current_price` (open decision P52) | They differ in the demo (espresso 1.80 vs 1.17) |
| P-05 | Save barsy's language list on the connection at every check (today it is read and dropped) | Input for D77 |

## 7. Open questions for Martin

1. "update CLAUDE.md": write the faster test process into the agents' rules (2.3).
2. P-01 to P-05 above.
3. Demo Club Sofia's first publish at its new address: Martin or the lead? Best after D78 cleans its menu.
4. T78 (a): should a name typed in Restro's manual layer beat the till's stand-in name?

## 8. Martin's own notes

_To be added by Martin._
