# Menu Engine Data Architecture

Oct 8, 2026 · @Martin

Every menu value enters through one of four collection paths (manual editor, Barsy full pull, Barsy webhook, Barsy reconciliation). Each lands as a typed, sourced value in its own layer of one internal data source. It reaches a screen only through a deterministic resolver and an immutable snapshot, which every face renders under the same population rules. Faces differ in look only.

## At a glance

&#91;embedded content: data pipeline · 4 collection paths, 1 write path, 5 faces\]

Every source, the manual editor included, enters through `apply()`. Only the publisher writes what a shell reads, and orders leave through the outbox back to Barsy.

## Vocabulary

Every later section uses these terms in exactly this sense.

| Term | Meaning |
| --- | --- |
| Tenant | A restaurant group or club operator: one account, one or more venues |
| Venue | One physical outlet. Maps 1:1 to a Barsy venue (`bid`) on one Barsy installation (host) |
| Integration | A configured connection to one Barsy installation: host, API user, venues, webhook subscriptions, cursors |
| Template | A versioned schema tree: which node types exist, how they nest, which fields each carries |
| Menu | One instance of a template owned by a tenant ("Dinner", "Cocktails") |
| Node | One element of a menu: Menu, Section, Item, Modifier group, Option, Special |
| Placement | The fact that an Item appears inside a Section at a sort position. One Item can have several placements |
| Field definition | A typed slot on a node type: key, type, required, constraints, owner |
| Field value | A typed value for one field on one node, in one layer, with provenance |
| Source | Where a value came from: `manual`, `barsy:<integration>` |
| Source record | The raw object exactly as a source returned it (a Barsy article JSON), hashed and kept |
| Source link | The mapping from an internal node id to an external id (`barsy article 102751`) |
| Layer | One stack of field values for a node: source layers, manual, override, edition layers |
| Override | An explicit, recorded replacement of a source-owned value, carrying the source value it replaced |
| Edition | A context that may change a few fields: master, venue, service period ("today") |
| Change set | The normalized output of any adapter: a list of typed field writes with provenance, applied atomically |
| Resolved document | The menu after applying every rule: one value per field per node, for one venue and edition |
| Snapshot | An immutable, versioned, published copy of a resolved document. The only thing a shell reads |
| Shell | The runtime that loads a snapshot, applies population rules and builds the view model |
| Face | A presentation design (a phone menu, A4 print, a TV board). Renders the view model; owns no data logic. In the venue admin a face is a "template" of the gallery (D69), not to be confused with the schema Template above |
| Population rules | The shared, deterministic rules for what is shown, in which order, in which state |

## Schema layer

The template is the contract for what a menu can hold, and every menu document is an instance of its template tree.

### Node types

| Node type | Cardinality | Allowed parent | Purpose | Usual Barsy origin |
| --- | --- | --- | --- | --- |
| Menu | singular (root) | — | One menu: title, intro, schedule, languages | none (builder) |
| Section | many | Menu or Section (max depth 3) | A heading that groups items | category |
| Item | many | none: lives once, shown through placements | Something a guest can read about and maybe order | article |
| Modifier group | many | Item | A choice the guest makes, with min/max selections | combo (supplement) group, or builder-defined |
| Option | many | Modifier group | One choice inside a group, with an optional price delta | supplement article, or modificator |
| Special | series | Menu or Section | Dated entries ("today's fish"), each pointing to an Item and a date range | none, or a Barsy category marked as specials |

Nesting rules, enforced on every write: a `series` never sits under a `many`; an Item never contains an Item; an Option is always a leaf. Items are first-class rather than children of Sections because Barsy lets one article sit in several categories. A placement row (`item_id`, `section_id`, `sort_key`) records each appearance.

### Field definition

Each node type carries an ordered list of field definitions. A definition is data, so tenants can extend their template copy.

```json
{
  "key": "price",
  "type": "money",
  "required": "when_orderable",
  "localizable": false,
  "constraints": { "min_minor": 0 },
  "owner": "barsy",
  "overridable": "never_when_orderable",
  "visibility": "public",
  "critical": true
}
```

`owner`, `overridable` and `critical` drive the resolution rules (see Layers, ownership and resolution). `visibility: internal` keeps a field out of every snapshot.

### Type vocabulary and canonical value shapes

Every collection path must output exactly these shapes. Adapters convert, the store never guesses.

| Type | Canonical value | Notes |
| --- | --- | --- |
| `short_text` | `"Negroni"` | Max length per definition |
| `long_text` | `"Gin, Campari, vermouth"` | Plain text; line breaks allowed |
| `localized_text` | `{"bg_BG": "Негрони", "en_US": "Negroni"}` | Keys match Barsy's language keys |
| `number` | `12.5` | Optional unit label in the definition |
| `boolean` | `true` |  |
| `date` | `"2026-12-31"` |  |
| `datetime` | `"2026-12-31T23:00:00+02:00"` | Always with offset |
| `money` | `{"amount_minor": 1250, "currency": "EUR"}` | Integer minor units. Never a float |
| `measurement` | `{"value": 250, "unit": "ml"}` | Units from a fixed list (g, kg, ml, l, cl, pcs) |
| `range` | `{"start": 0, "end": 3, "unit": null, "stops": [1, 2]}` | Start and end, an optional unit, optional stops |
| `tags` | `["signature", "new"]` | Free strings |
| `enum` | `"vegetarian"` | One value from the definition's list |
| `enum_set` | `["gluten", "milk", "sulphites"]` | Allergens use the 14 EU codes; dietary labels a fixed list |
| `image` | `{"asset_id": "as_9f2…", "alt": {…}, "focal": {"x": 0.5, "y": 0.4}}` | Points to the asset store, never a URL |
| `file` | `{"asset_id": "as_71c…", "filename": "allergens.pdf", "size": 182044}` |  |
| `availability` | `{"timezone": "Europe/Sofia", "rules": [{"days": [5, 6], "from": "22:00", "to": "04:00"}]}` | `to` earlier than `from` means past midnight, which clubs need |
| `reference` | `{"node_id": "nd_4a1…"}` | Used by Specials |

### Standard Item fields

| Key | Type | Required | Default owner |
| --- | --- | --- | --- |
| `name` | localized\_text | yes | barsy (display override allowed) |
| `description` | localized\_text | no | builder (falls back to Barsy) |
| `price` | money | when orderable | barsy |
| `image` | image | no | builder (falls back to Barsy picture) |
| `allergens` | enum\_set | yes for food (may be an explicit empty set) | barsy when mapped, else builder |
| `dietary` | enum\_set | no | builder |
| `portion` | measurement | no | barsy (`amount_unit`) |
| `abv` | number | no | builder |
| `tags` | tags | no | builder |
| `availability` | availability | no | builder schedule, combined with Barsy's for-sale flag |
| `internal_note` | long\_text | no | builder, `visibility: internal` |

Ordering mode (decided 2026-10-08): each Item carries a builder-owned `order_mode` the venue owner sets: `orderable`, `ask_waiter` (shown with price, ordered through the waiter; e.g. bottle service, minimum spend) or `hidden`. It can only make an Item more cautious than Barsy: `orderable` still requires the computed `orderable` to be true.

`orderable`, `badges` and the formatted price are computed by the resolver and never stored as field values.

### Template versioning

Template versions are immutable and every menu pins one. Moving a menu to a new version runs explicit migration steps: adding a field changes nothing; renaming keeps an alias; changing a type converts values or archives them; removing a field archives its values. Nothing is deleted.

## The internal data source

The internal data source has four tiers, and data only ever moves down them: raw → layered → resolved → published. Every tier below raw can be rebuilt from the tier above it, so a bug in a mapping or a rule is fixed by re-running, never by hand-editing data.

| Tier | Store | Holds | Written by | Read by |
| --- | --- | --- | --- | --- |
| 1. Raw | `source_records` | Every object exactly as a source returned it, with a content hash and fetch time. A new version is appended only when the hash changes | Adapters | Mappers, debugging, replay |
| 2. Layered | `field_values` | One row per node × field × layer, with provenance | The change-set applier only | Resolver, editor UI |
| 3. Resolved | `resolved_documents` | One computed document per menu × venue × edition, plus validation results | The resolver only | Editor preview, publisher |
| 4. Published | `snapshots` | Immutable, versioned JSON (see Publishing and the snapshot contract) | The publisher only | Shell, via CDN |

### Supporting tables

| Table | Key | Holds |
| --- | --- | --- |
| `tenants`, `venues` | id | Venue → integration, Barsy `bid`, timezone, currency, enabled languages |
| `integrations` | id | Barsy host, API user, credential reference (secret store, never in the database), status, webhook secrets, sync cursors |
| `pos_registrations` | venue\_id | The Barsy `pos_key` for that venue. Exactly one writer, because re-registering a POS silently deregisters the previous one |
| `templates`, `menus`, `nodes`, `placements` | id | The schema tree, menu instances, nodes (with `parent_id`, `node_type`, `status`) and Item-in-Section placements |
| `source_links` | (integration, external\_type, external\_id) | Internal node id ↔ external id, with state (`active`, `missing`, `deleted`), first and last seen, last hash |
| `overrides` | id | Explicit replacements of source-owned values: value, the source value at the time (basis), author, reason, state |
| `assets` | id | Images and files: origin (upload or Barsy), origin reference, checksum, CDN variants |
| `tables` | id | Barsy places synced per venue: `place_id`, `place_num`, salon, zone, opaque QR token |
| `jobs` | id | Every pull and reconciliation run: type, status, counters, error log |
| `webhook_inbox` | `X-Webhook-ID` | Every webhook received: payload, signature check result, processing state |
| `events` | sequence | Append-only changelog: node, field, layer, old → new, source, actor, job |
| `review_queue` | id | Proposed changes waiting for a person: new Barsy items, stale overrides, conflicts |
| `outbox` | id | Outbound order commands to Barsy (see Outbound) |

**Venue lifecycle (D76).** Owners and admins rename a venue; only an owner deletes it, after typing its name. Deleting **archives** it (`venues.archived_at`, null = live) and erases nothing, because history is append-only. One transaction sets the flag and releases the till link (`barsy_venues.venue_id` goes back to null, so the till venue is free for another venue); the venue's public code, menu, tables and QR tokens stay. Every core writer of one venue first locks its row (`FOR SHARE`, the delete takes `FOR UPDATE`) and refuses an archived one (`venue_archived`), so a save and a delete never interleave; `apply()` refuses writes into an archived venue's menu and its `venue:` scope. The admin's reads, the sync and its schedule, and the publish jobs leave an archived venue out. The worker withdraws the guest files by **removing** them (the venue index `v/<code>.json` and the table files `t/<token>.json`; no marker), keeping the QR tokens so a restore brings the same codes back, and whichever job runs last leaves what the database says. A restore clears the flag: the venue comes back without a till link and unpublished, the owner links the till again and publishes, and the same addresses work again. Erasing a venue for good is an operator task, never a button.

One row in `field_values` looks like this:

```json
{
  "node_id": "nd_7c3e…",
  "field_key": "price",
  "layer": "barsy",
  "scope": "venue:vn_beach",
  "value": { "amount_minor": 1250, "currency": "EUR" },
  "value_hash": "9a41c0d2",
  "source_record_id": "sr_barsy_article_102751_v4",
  "job_id": "job_webhook_88213",
  "actor": "integration:barsy-club-x",
  "observed_at": "2026-10-08T21:03:41+03:00",
  "mapping_version": 3,
  "valid": true
}
```

`scope` is `master` for values shared by every venue, or `venue:<id>` for Barsy values that differ per venue (price, for sale).

Layer names: `barsy`, `manual`, `override`, and `edition:<edition_id>` for venue and service-period editions.

### One write path

No adapter writes to tiers 2–4. Each adapter produces a change set and hands it to `apply(change_set)`, which runs in one database transaction:

1. Validate every write against its field definition (type, shape, constraints). Invalid writes are kept as rejected rows with a reason; they never replace the last good value.
2. Resolve identity: find the node through `source_links`, or create the node and link (see Identity and linking).
3. Skip writes whose `value_hash` equals the current value in that layer. Re-delivered webhooks and repeated pulls become no-ops.
4. Upsert the remaining `field_values` rows and append one `events` row per change.
5. Mark the affected menus dirty and queue a resolve.

Recommended storage: Postgres with `jsonb` for tiers 2–3 and the supporting tables, because change sets need transactions and placements and links need joins. Snapshots and assets go to object storage behind a CDN.

## Collection path A: the manual editor

The manual editor is a form generated from the template. Every save becomes a change set with source `manual` and goes through the one write path.

### How the form is built

The editor reads the node's field definitions and renders one input per type. Inputs cover short text, long text, number, boolean, date, file, image, tags, measurement, range, money (amount + currency, stored in minor units), localized text (one tab per enabled language), enum set (allergen and dietary chips) and availability (day and time windows, past midnight allowed).

Each field shows its state, so the person always knows who controls it:

| State | Shown as | Editable |
| --- | --- | --- |
| Owned here | Normal input | Yes |
| From Barsy | Barsy's value, read-only, with an Override button when allowed | Through an override only |
| Overridden | Your value, Barsy's value beside it, and Revert | Yes |
| Stale override | Warning: Barsy changed after you overrode it | Choose keep or take Barsy's |
| Locked | Barsy's value and "Change this in Barsy" | No (price on an orderable item, existence of a Barsy item) |
| Edition value | The venue or today's value over the master value | Only fields the edition allows |

### What a save writes

| Node | Field | The save writes |
| --- | --- | --- |
| Created by hand (no source link) | any | `manual` layer |
| Linked to Barsy | builder-owned (description, image, tags, dietary) | `manual` layer |
| Linked to Barsy | Barsy-owned and overridable (display name, or a translation in a language Barsy already holds) | An `overrides` row with the current Barsy value as its basis, plus the value in the `override` layer |
| Linked to Barsy | Barsy-owned and not overridable (price when orderable) | Nothing. Refused with "Change this in Barsy" |
| Any, inside a venue or service edition | fields the edition allows (hidden here, sold out today, featured) | `edition:<id>` layer |

Translations (decided 2026-10-08): a language Barsy lacks is added by hand in the editor's translations tab and saved per locale to the `manual` layer. It is not an override. `localized_text` resolves per locale: Barsy's value where Barsy holds that locale, ours where it doesn't. A menu's languages are the ones Barsy holds for it plus the ones added here. When Barsy's name for an item changes, our hand-added translations of it are flagged for review in the admin; they stay live meanwhile. A venue may later opt in to push our translations into its Barsy, if the API allows it; that would be an explicit, venue-approved exception to "sync never writes into Barsy" and is not researched yet.

### Creating structure by hand

People can add Sections with no Barsy counterpart, such as a curated "Signature cocktails" section; sections are layout. Items, Modifier groups and Options are made by hand only in a venue without a till (D64). In a venue with a till, the till is the only source of items, because nothing made here can reach the POS (D66); the venue enriches those items with photos, descriptions and tags. Hand-made nodes have no source link and are display-only: `orderable` is false. Display-only items in a till venue may come back later as an explicit setting.

### Linking and unlinking

1. **Link.** "Link to POS item" searches the cached Barsy articles (tier 1, not a live call). Choosing one creates the source link and triggers an immediate fetch of that article.
2. **Merge on link.** For every Barsy-owned field where the hand-entered value differs from Barsy's, the hand value is turned into an override (basis = Barsy's value) and a review item asks "keep yours or take Barsy's". Nothing is silently lost.
3. **Unlink.** The current Barsy values are copied into the `manual` layer, so the item keeps showing, and `orderable` becomes false.

### Concurrency, order and bulk edits

- Every save carries the node revision it was based on. If a webhook changed the same field since, the save returns a conflict showing the new value; edits to different fields merge.
- Sort order is builder-owned and stored as fractional `sort_key` strings, so moving one item writes one row. New items arriving from Barsy go to the end of the section their Barsy category maps to (decided 2026-10-08: our section map is generated from the Barsy tree as the default composition, then editable).
- Multi-select edits ("mark these 12 items vegan") are one change set, applied atomically.
- Saves land in the layers immediately but reach guests only on publish. The preview renders the draft resolved document through any face.
- Every save writes `events` rows with the user as actor.

## Collection path C: Barsy onboarding and the full pull

Onboarding connects one Barsy installation once; the full pull then copies its catalog into tier 1 and maps it into the `barsy` layer. A full pull is also the only operation allowed to conclude that something was deleted in Barsy.

### Onboarding steps

1. **API user.** The venue's Barsy admin creates a dedicated API user for us; only they can. Rights: view articles, list categories, list modifiers, webhook subscription, and later the account and client-order rights for ordering. Use one API user per integration per environment, because Barsy allows one webhook subscription per user per event type, so staging and production cannot share a user.
2. **Credentials.** Store host, username and password in the secret store. Test with `Misc_ping` and then `Misc_ping_user`; both return `1`.
3. **Venues.** `Barsys_getlist` lists the installation's venues. The admin maps each to one of our venues, which records its `bid`.
4. **Settings to discover.** `Languages_getlist` (which locales exist), `Currencies_getlist`, `Articledetails_gettree` (which characteristic keys exist, so the admin can map one to allergens and another to calories), `Places_getlist` (tables and salons, for ordering later).
5. **Scope.** Choose the catalog root category (`cat_id`), public articles only (recommended), placement mode (mirror the Barsy category tree, or curate our own), and the price context used for display (venue plus Barsy client).
6. **Ordering, later.** `Poses_register` once per venue; store the `pos_key` in `pos_registrations` with a single writer.
7. **Start.** Run the first full pull, subscribe the webhooks (path D), start the reconciliation schedule (path E).

### The full pull, per venue

All calls carry `?bid=<venue>`, because prices and for-sale flags depend on the venue. Every call must finish within Barsy's 30-second limit, so pages are sized to stay well under it.

1. **Job.** Create a `barsy_full` job.
2. **Structure.** `Categories_getalltree` with `cat_id` = root and `only_public` = 1. Large catalogs use `articles_lazy_load_mode` = 2 so the tree comes back without every article. Store each category, and the tree itself, as source records.
3. **Articles.** `Articles_getlist`, paged with `offset` and `length` (at most 1000; smaller if a page nears 30 s). `extra_properties`: `ml_data`, `description_public`, `picture_url`, `article_details`, `categories`, `has_supplements`, `supplements`, `slug`. Each article is a source record with its hash.
4. **Combos.** For articles with supplements, `Articlesupplements_get`. Several go in one multi-method request to `POST /endpoints/json/`.
5. **Modifiers.** `Modificators_getlist`.
6. **Map.** Turn every changed source record into change-set writes (see Barsy to canonical mapping) and apply them in chunks through `apply()`, all tagged with the job id.
7. **Images.** Queue a download for each new or changed `picture`. Images are fetched in the background and never block the pull.
8. **Deletions.** Only if every page succeeded: source links that are `active` but absent from this pull become `missing`, and their nodes are hidden. A pull with any failed page skips this step entirely.
9. **Close.** Record counters (categories and articles seen, created, updated, unchanged, missing, failed), mark the job complete, queue a resolve. The publisher ignores a menu while its pull job is still running.

Barsy publishes no rate limit beyond the 30-second limit per call. Keep at most two concurrent requests per installation, and prefer one multi-method request over many small calls.

## Collection path D: Barsy webhooks

Webhooks are the main way Barsy changes reach us, typically within one to two minutes. A webhook only tells us which ids changed; the data itself is always fetched afterwards, through the same mapping and write path as the full pull.

### Subscriptions

Each integration subscribes with its own API user to its own URL, `https://hooks.<our-domain>/barsy/<integration_id>`, so every request identifies its installation and its secret.

| `event_type_id` | Barsy object | Our use | Fetch with |
| --- | --- | --- | --- |
| 1 | Articles | Menu items | `Articles_getlist` filtered by the changed ids, per venue |
| 6 | Categories | Sections | `Categories_get` |
| 8 | Modifiers | Options | `Modificators_getlist` |
| 2 | Accounts | Table and bill state (ordering, later) | `Accounts_get` |
| 5 | Orders | Order-row state (ordering, later) | `Orders_getlist` |
| 3 | Client orders | Pre-orders (later) | `Clientorders_get` |

Barsy sends a `HEAD` request when a subscription is created; the endpoint answers it with 200.

### The receiver: small and fast

1. Read the raw body.
2. Verify `X-Signature` = `sha256=` + HMAC-SHA256(body, secret), comparing in constant time. The secret comes from `Webhooks_get_subscription` and is stored on the integration. A failed check is stored and answered with 401.
3. Insert the payload into `webhook_inbox` with `X-Webhook-ID` as a unique key. A duplicate id means Barsy re-sent it: answer 200 and stop.
4. Answer 200 only after that insert is committed. Barsy holds changes until it gets a 200 and then drops them, so answering 200 before the payload is safe would lose data.

The receiver never calls Barsy and never does mapping work. Slow answers trigger Barsy's retries.

### The processor

1. Parse the payload into (type, id, operation) tuples. Example: `{"articles":[{"101811":"U","102750":"D","102751":"C"}]}`.
2. Coalesce them in a refetch queue keyed by (integration, type, id), with a 10-second debounce. Five updates to one article become one fetch; an update followed by a delete becomes a delete.
3. Fetch in batches. An article event does not say which venue changed, so re-fetch the article for every venue on that integration (`?bid=` each), because price and for-sale flags are per venue.
4. **C and U:** store the source record and apply the mapped writes (no-op when the hash is unchanged).
5. **D:** set the source link to `deleted` and hide the node. Hand-entered enrichment (photos, copy) stays on the node in case it needs relinking.

### Keeping the subscription alive

| Barsy behaviour (official docs) | Our response |
| --- | --- |
| Checks for changes once a minute | Expect one to two minutes from a Barsy edit to our inbox |
| Retries a failed delivery at 1, 2, 4, 8… minutes, capped at 60 | Nothing to do; changes are held for us |
| Emails the API user after every fifth failure | Point the API user's email at an ops mailbox |
| Deactivates the subscription after 14 days without a success | A daily job reads `Webhooks_get_subscriptions` and `Webhooks_get_events`. If it is deactivated: call `Webhooks_restart`, then run an incremental reconciliation, or a full pull if more than 14 days passed |
| One subscription per user per event type | One API user per integration per environment |

If reconciliation (path E) keeps finding changes that no webhook announced, mark webhook health as degraded and alert.

## Collection path E: Barsy reconciliation

Reconciliation is the safety net under webhooks. It re-reads Barsy on a schedule and catches anything a webhook missed. It uses the same mapping and the same `apply()`, so a change it finds that a webhook already delivered costs nothing.

| Loop | How often | Barsy call | Catches |
| --- | --- | --- | --- |
| Tree check | Every 10 min per venue | `Categories_getalltree` with the last `checksum` | Any structural change; skips all work when the checksum is unchanged |
| Incremental articles | Every 10 min per venue | `Articles_getlist` with `filters.last_update = ">" + cursor` | Changed articles whose webhook was lost or delayed |
| Stock (optional) | Every 5 min per venue, only if the venue wants stock-based sold out | `Articles_getlist` with `amount_last_update` and `has_amount` | Items that ran out |
| Nightly full pull | Once a day at the venue's quiet hour (configurable; clubs close late) | Path C in full | Deletions with no webhook, category moves, modifier changes, anything else |
| Subscription health | Daily | `Webhooks_get_subscriptions`, `Webhooks_get_events` | Deactivated subscriptions (see path D) |

### Cursor rules

- The cursor is stored per venue on the integration and advances only after a successful run.
- Each run asks for changes since the previous run's start time minus five minutes. The overlap covers clock skew between our servers and Barsy and Barsy's one-minute webhook cadence; unchanged hashes make the overlap free.
- Barsy also offers a marker stored on its side (`all_last_update = -1`, advanced by writing a detail value back). Do not use it: sync bookkeeping must never write into a venue's Barsy, so our footprint stays read-only.

### Prices that change by time

Barsy price lists can be time-based (happy hour). `current_price` reflects the rule active at the moment of the fetch, so a 10-minute loop can lag a rule boundary by up to 10 minutes. Two options, an open decision for the owner:

1. **Show the base price** (`actual_price`) on the menu and present promotions as a separate, scheduled badge. Simple and always correct; orders are priced by Barsy anyway.
2. **Follow live prices.** Read the price-rule schedule (`Pricelists_index`) and add targeted refreshes at each rule boundary.

## Barsy to canonical mapping

The mapping is versioned configuration per integration, not code paths scattered through workers. Because every Barsy object is kept raw in tier 1, changing the mapping means replaying tier 1 into the `barsy` layer, with no calls to Barsy.

### Categories → Sections

| Barsy field | Canonical field | Transform and notes |
| --- | --- | --- |
| `cat_id` | source link (`category`) | Identity only |
| `parent_id`, `cat_path_ids` | Section parent | Used only when the menu mirrors the Barsy tree |
| `cat_name_public_ml` | `title` (localized\_text) | `cat_name` is internal and never shown. Missing public name → validation warning |
| `description_ml` | `description` |  |
| `cat_picture` | `image` | Downloaded into the asset store |
| `category_color`, `category_icon`, `cat_public_view` | display hints | Faces may use them; never required |
| `slug` | `slug` |  |

### Articles → Items

| Barsy field (extra property needed) | Canonical field | Transform and notes |
| --- | --- | --- |
| `article_id` | source link (`article`) | Identity only |
| `article_name_public_ml` (`ml_data`) | `name` | `article_name` is internal and unique per catalog; never shown |
| `description_public` (`description_public`), `description_ml` | `description`, as fallback | Builder copy wins (see ownership) |
| `actual_price`, `current_price` | `price` | Parse as a decimal string, round half-up to 2 places, store integer minor units. Which one feeds `price` is the open price decision |
| `amount_unit` + `amount_type_id` | `portion` | Unit name from `Amounttypes_getlist` |
| `is_public` | source visibility | Combined with builder visibility by AND |
| `is_for_sale`, `is_for_sale_barsys` | for-sale flag, stored with venue scope | The per-venue exception list wins over the base flag |
| `delete_flag` | source link state `deleted` | Node hidden |
| `picture`, `picture_url` (`picture_url`) | `image`, as fallback | Downloaded; re-fetched only when `picture` changes |
| `article_details` (`article_details`) | `allergens`, custom fields, tags | Per mapping config: e.g. key "Алергени" → `allergens` through the synonym table, key "Калории" → a calories field. Unmapped keys are ignored |
| `categories` (`categories`) | placements | Only in mirror mode |
| `supplements`, `has_supplements` | Modifier groups and Options | One group per `supplement_group_id`; each supplement article is an Option, `supplement_price` becomes its price delta |
| `slug`, `article_color`, `article_icon` | display hints |  |
| `menu_id` | scope filter | Articles outside the configured catalog are skipped |
| `is_service` | scope filter | Services (cover charge, delivery fee) are skipped unless configured |
| `code`, `barcode`, `ref_num`, `export_id` | none | Kept in tier 1; used only for matching (see Identity and linking) |

### Modifiers → Options

| Barsy field | Canonical field | Transform and notes |
| --- | --- | --- |
| modifier `id` | source link (`modificator`) |  |
| name, description | Option `name`, `description` | Usually kitchen requests ("без лук", no onion) |
| type / operation | Option kind | Placed in a builder-defined "Requests" group with no price. Shown only if the builder enables it |

### Shared transforms

- Barsy language keys (`bg_BG`, `en_US`, `de_DE`, `es_ES`, `fr_FR`, `ro_RO`) map one-to-one to our locales. Every language Barsy holds for the menu's items is taken in; more languages are added by hand in the editor's translations tab (manual layer, per locale).
- Currency is the installation's system currency (EUR). The price formula matches Barsy's own rounding, so displayed and billed amounts agree to the cent.
- Every write records `mapping_version`, so a replay can tell which values a mapping change will affect.

## Identity and linking

Our own ids are the only ids the model, the snapshots and the shell use. External ids live in `source_links` and never leave the backend, so a Barsy re-numbering or a second POS can each be linked without touching anything downstream.

### Rules

- **Internal ids** are opaque and prefixed by kind: `nd_` node, `as_` asset, `sn_` snapshot, `tb_` table.
- **Items belong to the tenant's catalog, not to a menu.** Menus and Sections hold placements that point to catalog Items. The same Barsy article on the Dinner menu and the Bar menu is one Item with one set of photos and copy, placed twice.
- **Link key** = (integration, external type, external id). Barsy ids are unique per installation, and all venues on that installation share the catalog. So one article = one Item; what differs per venue (price, for sale) is stored per venue: those barsy-layer rows carry scope venue:\<id> instead of master.
- **One link per source per node.** A node has at most one Barsy link.

### Link lifecycle

| From | Event | To | Node effect |
| --- | --- | --- | --- |
| — | First seen in a pull or webhook | `active` | Created (hidden or in review, per publish policy) |
| `active` | Absent from a complete full pull | `missing` | Hidden |
| `active` or `missing` | `D` webhook, `delete_flag`, or missing for 7 days | `deleted` | Hidden; enrichment kept |
| `missing` or `deleted` | Seen again with the same external id | `active` | Shown again with its enrichment |

### Matching existing nodes to Barsy

When Barsy is connected to a menu that was already built by hand, each Barsy article is scored against the existing Items.

| Evidence | Strength | Action |
| --- | --- | --- |
| Same name after normalising case, accents and Cyrillic–Latin transliteration, and same price | Medium | Suggested, not ticked |
| Name similarity of 0.85 or more | Weak | Shown as a possible match only |
| Anything else | — | New Item |

Nothing links without a person confirming it, at least once during onboarding. Confirming a match is the link-and-merge step from path A.

### Relinking recreated items

Staff often delete a Barsy article and create a new one instead of editing it, which gives it a new id. When a new article appears whose name closely matches an Item whose link was deleted in the last 30 days, a review item asks: "Is the new 'Negroni' the old 'Negroni'?" Confirming moves the link onto the old Item, which keeps its photos, copy, placements and history; the newly created Item is discarded. Splits (one article becoming S and L sizes) are never automatic.

### Tables

A table is identified by (integration, venue, `place_id`). Its QR code carries a random 128-bit token mapped to the table, never the `place_id`, so a guest cannot edit a URL to order onto another table. Tokens can be rotated without reprinting the Barsy setup.

## Layers, ownership and resolution

The resolver is a pure function: `resolve(template, layers, rules, venue, edition) → resolved document`. The same inputs always give the same output. Each field's owner and combinator, declared in its field definition, decide which layers may supply it and how they combine.

### The layer stack

From lowest to highest: schema default → `barsy` → `manual` → `override` → `edition:<venue>` → `edition:<service period>`. Higher does not automatically win; the combinator decides.

### Combinators

| Combinator | Rule | Used for |
| --- | --- | --- |
| `source_first` | override → barsy → manual → default (first non-empty) | Barsy-owned fields: name, portion, translations |
| `builder_first` | manual → barsy → default | Builder-owned fields: description, image, sort order |
| `locked` | barsy only; overrides refused | Price on an orderable Item |
| `all_true` | every layer that has a value must say true | Visibility, for sale |
| `union` | the set of all values | Tags, dietary labels |
| `must_agree` | if two layers disagree the field is in conflict; a person chooses, and the choice is stored as an override | Allergens |

### Ownership matrix (Item)

| Field | Owner | Combinator | Override allowed | When Barsy changes after an override |
| --- | --- | --- | --- | --- |
| `name` | barsy | `source_first` | Yes, display only (receipts keep Barsy's name) | Override marked stale → review |
| `description` | builder | `builder_first` | n/a | Nothing; Barsy's text is only a fallback |
| `price` | barsy | `locked` when orderable, `source_first` otherwise | Only on display-only Items | n/a |
| `image` | builder | `builder_first` | n/a | Nothing |
| `allergens` | barsy when mapped, else builder | `must_agree` | Through conflict resolution only | Conflict re-opened; publish of that Item blocked |
| `dietary`, `tags` | builder | `union` | n/a | Barsy-mapped tags join the set |
| `portion` | barsy | `source_first` | Yes | Override marked stale → review |
| visibility | both | `all_true` | Builder can hide, never unhide | Barsy hiding wins at once |
| for sale | both | `all_true` (Barsy venue flag, builder schedule, today's sold-out) | Builder can mark sold out, never back on sale | Barsy taking it off sale wins at once |
| placement and sort | builder; the section map is generated from the Barsy category tree, then editable per venue | `builder_first` | n/a | New Items go to the end of their section |

The rule behind the asymmetry: the builder can always make the menu more conservative (hide, sold out) but never less safe than the till. Anything a guest could be charged for or harmed by follows Barsy unless a person explicitly resolves it.

### Overrides and staleness

An override stores its value and its basis, the Barsy value at the moment it was made. Each time the `barsy` layer changes for that field, the resolver compares the new Barsy value with the basis. If they differ, the override becomes stale. The field definition's policy then applies: `review` (default; the override stays in force and a review item opens), `keep`, or `drop` (Barsy's new value takes over).

### Computed fields

The resolver adds fields that are never stored:

- `orderable` = linked to a Barsy article AND has a price AND is for sale at this venue. The shell adds runtime context (ordering switched on, a table token present).
- `price_from` = Item price + the cheapest price delta among required modifier groups, when that differs from the Item price.
- `badges`: `new` (first published less than 14 days ago), plus badges derived from dietary labels and tags.
- `conflicts` and `warnings`: per node, for the editor and the publish gate.

### Resolution of one field

```text
for each node, for each field definition f:
    candidates = layers(node, f) filtered to the layers f.owner allows
    value      = combine(f.combinator, candidates)
    if f.combinator == must_agree and candidates disagree: mark conflict
    if f.overridable and an override exists and override.basis != barsy value: mark override stale
    validate(value, f) -> errors and warnings
add computed fields; drop fields with visibility = internal from the public view
```

## Validation and quality gates

Validation runs at three points, and each failure has one fixed consequence: a bad write is rejected, a bad node is left out of the snapshot, a bad menu is not published. One validator library serves the editor, the Barsy adapters and the publisher, so no path can be looser than another.

| ID | Check | Runs at | Failure means |
| --- | --- | --- | --- |
| V1 | Value matches its type's canonical shape and the definition's constraints | Write (`apply`) | Write rejected; the last good value stays; reason recorded |
| V2 | Money is a non-negative integer of minor units with a known currency | Write | Write rejected |
| V3 | Item and Section have a name in the menu's default language | Node (resolver) | Node left out of the snapshot |
| V4 | Every food Item has allergens set (an explicit empty set is allowed) | Node | Item left out of the snapshot |
| V5 | No allergen conflict between layers | Node | Item left out until a person resolves it |
| V6 | A priced menu's Item has a price | Node | Item left out |
| V7 | Every enabled language has a translation | Node | Warning; the population rules' language fallback applies |
| V8 | The image meets the minimum size the installed faces declare | Node | Warning; faces use their no-image layout |
| V9 | A Section has at least one visible Item | Menu (publish gate) | Section hidden, warning |
| V10 | The menu has at least one visible Item | Menu | Publish blocked |
| V11 | One change set hides or removes no more than 30% of visible Items | Menu | Automatic publish blocked; a person must approve. Protects against a wrong catalog root or a broken pull |
| V12 | No open stale override on a field whose policy is `review` | Menu | Warning in the publish dialog |

Rejected writes and left-out nodes appear in the editor's Data issues panel with the source, job, row or Barsy id, and the reason. A node left out of a snapshot is never silently gone: the editor shows it with its blocking issue.

## Publishing and the snapshot contract

The shell never reads the database. It reads one immutable snapshot per menu and venue from the CDN, plus an optional live overlay for sold-out states. Publishing creates the snapshot; a pointer file says which snapshot is current.

### Publish policy

| Change | Default policy |
| --- | --- |
| Barsy price change | Publish automatically |
| Barsy hides an Item or takes it off sale | Publish automatically (the safe direction) |
| Barsy puts an Item back on sale | Publish automatically |
| Barsy deletes an Item | Hide and publish automatically |
| New Item from Barsy | Publish automatically (decided 2026-10-08; hold for review or publish hidden stay configurable) |
| Hand edit in the editor | Published when someone presses Publish |
| Any change set that trips V11 | Hold for review whatever its type |

Automatic publishes within a 30-second window are merged into one snapshot.

### Files on the CDN

| Path | Contents | Cache |
| --- | --- | --- |
| `/snap/<snapshot_id>.json` | The snapshot. Never changes | Immutable, cache for a year |
| `/m/<menu>/<venue>/current.json` | `{snapshot_id, version, hash}` | 30 seconds, or pushed over SSE to always-on screens |
| `/m/<menu>/<venue>/live.json` | Live overlay: `{version, items: {"nd_x": {"sold_out": true}}}` from the service edition | 15 seconds |
| `/a/<asset_id>/<variant>.webp` | Image variants | Immutable |

Rollback is moving the pointer back to an earlier snapshot. The overlay lets bar staff mark items sold out ten times a night without publishing ten snapshots.

### Snapshot shape

Normalised by id, with ordering carried by the id arrays:

```json
{
  "schema": "menu-snapshot/1",
  "snapshot": {
    "id": "sn_5d2…", "version": 128, "hash": "b71e…",
    "published_at": "2026-10-08T21:04:12+03:00",
    "menu_id": "nd_m01", "venue_id": "vn_beach",
    "edition": ["master", "venue:vn_beach", "service:2026-10-08"]
  },
  "locales": { "default": "bg_BG", "available": ["bg_BG", "en_US"] },
  "currency": "EUR",
  "theme": { "palette": ["#f1f2f3", "…"], "font": "Inter", "radius": 4, "shadow": 2, "logo": "as_logo",
             "roles": { "light": { "background": "#f6f1e7", "…": "…" }, "dark": { "background": "#13201a", "…": "…" } },
             "scheme": "auto" },
  "assets": {
    "as_9f2": { "w": 1600, "h": 1200, "focal": { "x": 0.5, "y": 0.4 },
                "alt": { "en_US": "Negroni on ice" },
                "variants": { "thumb": "/a/as_9f2/w320.webp", "card": "/a/as_9f2/w640.webp" } }
  },
  "field_types": { "abv": { "type": "number", "label": { "en_US": "ABV" }, "unit": "%" } },
  "menu": { "id": "nd_m01", "title": { "en_US": "Bar" }, "intro": {}, "availability": null,
            "sections": ["nd_s1"] },
  "sections": {
    "nd_s1": { "title": { "en_US": "Cocktails" }, "description": {}, "image": null,
                "hints": { "color": null, "icon": null }, "sections": [], "items": ["nd_i1"] }
  },
  "items": {
    "nd_i1": {
      "name": { "bg_BG": "Негрони", "en_US": "Negroni" },
      "description": { "en_US": "Gin, Campari, vermouth" },
      "price": { "amount_minor": 1250, "currency": "EUR" }, "price_from": null,
      "image": "as_9f2", "allergens": ["sulphites"], "dietary": ["vegan"], "tags": ["signature"],
      "portion": { "value": 90, "unit": "ml" }, "badges": ["new"],
      "availability": { "state": "available", "schedule": null },
      "orderable": true, "modifier_groups": ["nd_g1"],
      "fields": { "abv": 24 }
    }
  },
  "modifier_groups": { "nd_g1": { "name": { "en_US": "Gin" }, "min": 0, "max": 1, "options": ["nd_o1"] } },
  "options": { "nd_o1": { "name": { "en_US": "Premium gin" }, "price_delta": { "amount_minor": 300, "currency": "EUR" } } },
  "presentation": { "face": "editorial-market", "options": { "layout": "two", "featureFirstSection": true } },
  "features": { "filters": true, "call_waiter": { "enabled": false, "kinds": [] },
                "bill": false, "ordering": false, "pay": false }
}
```

Each item also carries `order_mode` (`orderable` or `ask_waiter`); `hidden` items are left out of the snapshot (decided 2026-10-08).

#### The look, the template and the guest services (D69–D71)

Four fields were added to `menu-snapshot/1` after it first shipped. All are optional, and all come from venue settings, not from the menu document:

| Field | Holds |
| --- | --- |
| `theme.roles` | The eight colour roles (`background`, `surface`, `accent`, `on_accent`, `text`, `muted`, `accent_text`, `border`), each a lower-case `#rrggbb`, for a `light` and a `dark` screen. The publisher always writes it (see The theme, R13) |
| `theme.scheme` | The venue's light/dark policy: `auto` (follow the guest's phone), `light` or `dark`. Always written |
| `presentation` | `{face, options}`: the template the venue chose and its options (short lower-case tokens or switches, never id-shaped). Written only when the venue chose a template; without it the default template applies |
| `features` | The guest services the venue switched on: `filters`, `call_waiter` (`enabled` and the request `kinds`), `bill`, `ordering`, `pay`. Always written; a venue that has set nothing gets filters on and every service off |

**Optional forever, parser-first after deploy.** Inside `menu-snapshot/1` a new field is optional forever, so a snapshot published before it still parses (no `roles`: the shell derives them from the palette as it always did; no `features`: the defaults; no `presentation`: the default template). After the first deploy, a new field ships in the reader one deploy before the publisher writes it. A phone still running an older reader keeps its current menu on screen until it reloads, because the pointer poll ignores a snapshot it cannot parse. The live overlay's top level ignores keys it does not know; the snapshot itself stays strict for unknown keys. A breaking change needs a new schema version. One consequence of the new fields: the first publish of each venue after the deploy makes a new snapshot, because the look fields are always written.

### What a snapshot never contains

External ids (Barsy article, category, place ids), Barsy internal names, cost or delivery prices, `internal_note` and any other internal field, override bases, review state, or anything a guest should not see. The order backend maps `nd_` ids to Barsy ids on the server side.

## The visualization shell

The shell turns a snapshot into a view model by applying the population rules; a face only draws that view model. Every rule lives in the shell, so a new face can change how things look but never what is shown, in what order or in what state.

### What the shell does, in order

1. Load `current.json`, then the snapshot it names, then `live.json`.
2. Build the context: language (URL, then browser, then the snapshot default), the venue's local time, the channel (`qr`, `print`, `tv`, `kiosk`), the table token if any, whether ordering is switched on for the venue, and which guest services the platform supports (`capabilities`, all off until a service exists).
3. Apply rules R1–R15 below to produce the view model.
4. Hand the view model to the face with the host props: the asset base URL, the menu's languages, the table label, the font stacks, the colour scheme, the template's options from `presentation`, and the `services` binding when the host has one. The face gets nothing else.

The same snapshot, overlay and context always produce the same view model, so the rules are unit-tested without any face.

### Population rules

| ID | Rule |
| --- | --- |
| R1 Visibility | A node is shown only if it is in the snapshot. Outside its schedule it is shown as scheduled ("from 18:00") on `qr` and `kiosk`, and left out on `print` and `tv` |
| R2 Order | Sections, Items, groups and Options appear in snapshot array order. A face may flow them into columns or pages but may not reorder or regroup them |
| R3 Language | For each text: requested language, then the menu default, then any available. Never empty. A fallback text carries its real language so the face can set the `lang` attribute |
| R4 Money | Formatted from minor units for the language's locale and the snapshot currency. `price_from` shows as "from …". Option deltas show as "+3,00 €" |
| R5 State | Each Item is `available`, `sold_out` (overlay or snapshot), `scheduled` or `unavailable`. The menu setting `sold_out_display` (`show` or `hide`) is applied here, never by a face |
| R6 Allergens | Every face must make each food Item's allergens reachable: icons or codes inline, a numbered legend (print), or a visible allergen-info link or QR code (TV). No face may omit them; EU food law requires this information |
| R7 Required slots | Name; price when priced; allergen access; state. A face that cannot render one cannot be installed |
| R8 Empty optional slots | Description, image, badges, portion, dietary, custom fields: an empty slot collapses. No face prints placeholder text such as "No value set" |
| R9 Text length | Names are never truncated; print and TV reflow or paginate instead. Descriptions may be cut only where the face offers a way to read the rest (`qr`, `kiosk`). Text that does not fit is a preview warning |
| R10 Images | The shell picks the asset variant from the face's declared slot size and pixel density, crops around the focal point, and uses the face's declared no-image layout when there is no image |
| R11 Ordering controls | Shown only if the Item is `orderable` and its order\_mode is orderable, ordering is on for the venue, the channel supports ordering, and a valid table token is present. An ask\_waiter Item shows its price and an "Ask your waiter" action instead |
| R12 Custom fields | Rendered through `field_types` with one renderer per field type, in template order, into one `extra_fields` slot |
| R13 Theme | Faces use theme tokens only, never hard-coded colours. The snapshot carries the venue's eight colour roles for a light and a dark screen (`theme.roles`); every text-on-colour pair reads at 4.5:1 or better. The shell checks the published roles again, repairs a failing text colour with the nearest readable one, and derives the roles from the palette when a snapshot has none. `theme.scheme` is the venue's light/dark policy, passed on to the face |
| R14 Determinism | No rule reads anything outside the snapshot, the overlay and the context |
| R15 Features | Fail-closed. A control for a guest feature (filters, call a waiter with its request kinds, the bill, ordering, pay) is allowed only when the venue switched it on, the platform supports it, the channel is interactive (`qr`, `kiosk`) and a confirmed table token is present; filters need the venue's switch and at least one tag or dietary chip on the menu, not a table. A missing, unreadable or unknown input means off. Allergen information is not a feature and has no switch (R6). The face marks each control with its `menu.*` slot, and a control that is off is not in the page at all |

### The theme (R13)

A venue chooses three colours in the Design tab: a **primary** (about 60%: the page), a **secondary** (about 30%: the panels behind photos, the header) and a **tertiary** (about 10%: badges, buttons, highlights). The publisher works out the eight roles for both schemes in OKLCH and never stores them, so a better derivation reaches every venue with its next publish.

| Role | Light screen | Dark screen |
| --- | --- | --- |
| `background` | The primary | The primary's hue at lightness 0.18, chroma reduced |
| `surface` | The secondary | The secondary's hue at lightness 0.24, chroma reduced |
| `accent` | The tertiary | The tertiary, lightened until it stands out (3:1) on the dark page |
| `text` | A deep, low-chroma ink in the primary's hue, darkened until it reads on page and panels | A light ink in the primary's hue |
| `muted` | The softest blend of the ink toward the page that still reads | Same rule |
| `accent_text` | The accent with its lightness moved until it reads on page and panels | Same rule |
| `on_accent` | The first of page, ink, white and black that reads on the accent | Same rule |
| `border` | 15% of the ink in the page | Same rule |

- **Readable for any three colours.** The seven pairs (`text`, `muted` and `accent_text` on `background` and on `surface`; `on_accent` on `accent`) read at 4.5:1 (WCAG AA). Where colour theory cannot reach it the ink falls back to black, white or the grey between. When the page and the panels sit on opposite sides of mid-grey, no colour reads on both, and only then the panels move in lightness (hue and chroma kept).
- **Overrides.** Any role of either scheme can be set by hand and is kept as set. A theme with a pair that does not read cannot be saved.
- **Presets and suggestions.** Four starting points exactly as the designer delivered them (Botanical, Midnight, Nordic, Terracotta), and colour-theory suggestions (complementary, analogous, triadic, split-complementary, monochrome) that turn one colour into three.
- **Fonts, corners, shadow.** Six families with Cyrillic letters (Inter, Manrope, Montserrat, Playfair Display, Lora, Unbounded), served by the web app itself so a guest's phone never calls a font host; corner radius 0–32 px; shadow 0–5.
- **Older venues.** A venue that only set a brand colour, or nothing, publishes as before: its roles come from its palette.

### The face contract

Each face ships a manifest. Installing a face validates the manifest against R6, R7, R9 and R15, and the contract tests run against it. The example is the manifest of the Editorial Market, the default template:

```json
{
  "face": "editorial-market",
  "version": "1.0.0",
  "channels": ["qr"],
  "slots": {
    "item.name": "required",
    "item.price": "required",
    "item.allergens": "required",
    "item.state": "required",
    "item.description": { "optional": true, "lines": 3, "overflow": "expand" },
    "item.image": { "optional": true, "variant": "card", "aspect": "4:3" },
    "item.badges": "optional",
    "item.portion": "optional",
    "item.dietary": "optional",
    "item.tags": "optional",
    "item.extra_fields": "optional",
    "item.modifiers": "optional"
  },
  "allergen_mode": "inline_codes",
  "no_image_layout": "text_only",
  "ordering": true,
  "paging": null,
  "features": ["filters", "call_waiter", "bill", "ordering", "pay"],
  "options": {
    "layout": { "type": "enum", "values": ["list", "one", "two"], "default": "two", "group": "look",
                "label": { "bg": "Подредба на менюто", "en": "Menu layout" } },
    "featureFirstSection": { "type": "boolean", "default": true, "group": "look",
                             "label": { "bg": "Първата секция като лента със снимки", "en": "Photo strip for the first section" } },
    "layoutSwitch": { "type": "boolean", "default": true, "group": "feature",
                      "label": { "bg": "Гостите могат да сменят подредбата", "en": "Guests can change the layout" } }
  },
  "tokens": ["color.background", "color.surface", "color.accent", "color.on_accent", "color.text",
             "color.muted", "color.accent_text", "color.border", "font", "radius", "shadow", "logo"]
}
```

- **`features`** lists the guest features the face has controls for. A feature the face does not list is never offered; one it lists is drawn only when R15 allows it. A face that lists `ordering` must declare `ordering: true`.
- **`options`** are the settings a venue may change, by camelCase key, each with a `type` (`enum` with its `values`, or `boolean`), a `default` and a `label` in Bulgarian and English, so the admin builds its form from the manifest. A `group` of `look` puts the option in the Design tab; `feature` puts it in the composer's Guest features panel. The shell's `resolveOptions` keeps a published value only where it fits the declaration and falls back to the default otherwise; the face keeps no defaults of its own.
- **Tokens.** The face lists the theme tokens its CSS reads (`palette.50` to `palette.950`, `color.<role>`, `font`, `radius`, `shadow`, `logo`).
- **Host props.** Every face receives the same props from its host: the view model, the asset base URL, the menu's languages and a language callback, the table label, the font stacks, the colour scheme, the venue's `options` and the `services` binding.

### The template registry (D69)

A venue's template is the `presentation.face` of its snapshot. Templates are code packages (`packages/faces/*`), listed in the web app in two files:

- `faces/manifests.ts` holds what is known without loading a template: its manifest, its names in Bulgarian and English, its picture and whether it is hidden. Server code reads this one (the Design tab's actions check that a template is real and visible, and what its options are).
- `faces/registry.ts` is built from it and adds `load()`, a lazy import of the template's components. Only client code imports it: a server module that imports the registry makes the build follow `load()` into the components and fail.

The default is `editorial-market`. A hidden template (`qr-phone`, kept for tests) is never offered, but a venue that already uses it keeps its menu; a name the registry does not know falls back to the default and is logged once. A guest downloads only the template its venue chose, as a separate chunk. A template can be listed only if it passes the face contract on every fixture: the registry test runs the shell's `faceContractSuite` for every entry. The venue picks its template in the Design tab, which previews the unsaved look on a phone frame, with the template's `look` options; the composer's Guest features panel holds the `feature` options and the service switches.

### Guest services: the face side of Stage 4 (D71, D72)

The faces draw the bag, the table bill, call a waiter, pay and the receipt before any backend exists, so the platform half can be built against a fixed contract. The two halves meet in the services contract of `@restro/shell`; the platform half is the Stage 4 design in `docs/reviews/connector-architecture/A5-guest-outbound.md` section 5.1.

- **Host to face: state.** `ServiceState` is the host's own record of the bill (rounds, lines, total), the waiter requests (with their status), the payment quote (subtotal, tip, VAT, total, the methods allowed) and the receipt. The face draws it and nothing else.
- **Face to host: commands.** The guest's actions are `order.send`, `service.request`, `service.cancel`, `pay.quote`, `pay.start` and `receipt.action`. Each carries an `actionId`, a uuid made once per user action and reused on a retry, so the host can answer a repeat with its first answer. A command carries our ids (`nd_`), quantities and notes, never a price, a barsy id or a table token.
- **The host answers** `accepted`, `rejected` or `pending`, with an optional message and a short reference.
- **No local success.** A face shows *pending*, then *accepted* or *rejected*, and never succeeds on its own: it adds no bill round, confirms no waiter and reports no payment. An order is "sent" only when the host accepts it or its bill holds the round; a rejected order keeps the guest's bag. A waiter is "on the way" only when a request of the host's says so. A payment is "paid" only after the host accepted it and its state holds a receipt that was not there before.
- **What the face may compute.** The bag estimate (unit price plus the chosen options, times quantity), labelled approximate, with the money module; nothing else. Totals, tips, VAT and splits come from the platform's quote.
- **Fail-closed.** A service control is drawn only when R15 allows it and the host bound `services`. In Stage 3 no host binds them and the platform supports none, so guests see no service.
- **The admin's preview** (the Design tab's "Preview guest services" switch) binds a demo host from the face's `./preview` subpath. It shows the services the venue switched on at a demo table, every sheet marked "Preview", and sends nothing anywhere. Guest pages never import it.

### Planned faces

| Face | Channel | Paging | Ordering | Allergen mode |
| --- | --- | --- | --- | --- |
| QR mobile: Editorial Market (built, the default template) and `qr-phone` (built, hidden, the test reference) | `qr` | Scroll | Yes | Inline codes |
| Kiosk | `kiosk` | Scroll, large touch targets | Yes | Inline icons |
| A4 print | `print` | Fixed pages | No | Numbered legend |
| TV board | `tv` | Rotating pages | No | Allergen-info QR code |
| Delivery feed | none (JSON export) | n/a | n/a | Allergen codes as data |

### Contract tests

A set of 13 fixture snapshots covers the hard cases: 60-character names, six languages, no images, sold out, scheduled, 300 Items, deep modifier groups, ask-the-waiter items, tags and dietary labels, custom colour roles, and the guest features all on and all off. Every face renders every fixture on every channel it declares, through the shell's `faceContractSuite`. The tests assert that each visible Item has every required slot (each slot carries a `data-slot` attribute), that only `nd_`, `as_` and `tg_` ids appear (never a Barsy id or an internal field), that the feature slots (`menu.filters`, `menu.call_waiter`, `menu.bill`, `menu.bag`, `menu.pay`) exist exactly when R15 allows them, that the face's CSS chooses no colour of its own, and that it styles nothing outside its own root (no `html`, `body` or `:root` rule). The tests read markup; they compare no screenshots. A separate Playwright run saves a matrix of screenshots (themes, schemes, languages, widths) for people to review.

## End-to-end traces

Four changes, followed from where they start to the guest's screen. A Barsy price change reaches guests in about two minutes; a sold-out mark from our editor reaches them in about 15 seconds.

### 1. A bartender changes a price in Barsy

1. **21:03:10** In Barsy, the Negroni goes from 11,00 € to 12,50 € at both venues.
2. **By 21:04:10** Barsy's once-a-minute check sends `{"articles":[{"102751":"U"}]}` to `/barsy/int_club`. The receiver verifies the signature, stores the payload in the inbox and answers 200.
3. **+10 s** The debounce window closes. One multi-method request fetches article 102751 with `?bid=1` and with `?bid=2`.
4. The new source records are stored (hash changed). The mapping writes `price = 1250` to the `barsy` layer with scope `venue:1` and `venue:2`, and appends two `events` rows.
5. The resolver recomputes the Bar menu for both venues. The policy for a Barsy price change is to publish automatically.
6. **+30 s** The publish window closes. Snapshot v129 is written for each venue and the pointers are updated.
7. **Within 30 s more** Phones pick up the new pointer; TV boards get it pushed. Total: about two minutes. An order placed in that window is still billed 12,50 €, because Barsy prices orders itself, and the confirmation shows Barsy's total.

### 2. The manager adds a photo and new copy by hand

1. The manager opens the Negroni in the editor. Name and price show as "From Barsy"; description and image are "Owned here".
2. They upload a photo and write a description. The save writes both to the `manual` layer, with the manager as actor.
3. The preview shows the draft through the QR and print faces. The print face warns that the description runs to four lines and will be cut to three.
4. They press Publish. Snapshot v130 goes out.

### 3. Staff delete an item in Barsy and recreate it

1. A `D` webhook for article 102751 arrives. The source link becomes `deleted`, the Item is hidden, and a snapshot is published automatically. The photo and copy stay on the Item.
2. A `C` webhook for new article 103020 ("Negroni") arrives. A new Item is created and published automatically, per the publish policy.
3. The relink check sees a deleted link with the same name from 4 minutes ago and opens a review item: "Is the new Negroni the old Negroni?"
4. The manager confirms. The link moves to the old Item, which keeps its photo, copy, placements and history; the new Item is discarded; the next snapshot shows the Negroni again.

### 4. The bar runs out of limes during service

1. A waiter taps Sold out on the mojito in our editor. The save writes `sold_out = true` to the `edition:service` layer for today.
2. The shell overlay `live.json` is regenerated: `{"nd_i7": {"sold_out": true}}`. No snapshot is published.
3. Within 15 seconds every phone shows the mojito as sold out and hides its order button (rule R11).
4. If staff instead take the mojito off sale in Barsy, an article webhook arrives and the change takes the trace 1 route, about two minutes end to end. When the venue turns on the optional stock loop, items that run out in Barsy's stock follow the same route.

## Failure modes and guarantees

The system is built so that no failure empties a menu or shows a guest something unsafe. When in doubt it keeps serving the last good snapshot, and the only thing allowed to run ahead of a person is a change in the safe direction (hidden, off sale, sold out).

This table covers the menu side. The ordering side's failure modes and the live-night safety kit (automatic menu-only mode, a manual switch for the manager, a phone alert when a paid order is not in Barsy within 60 seconds, a list of orphaned orders for staff to enter by hand) belong to the orders and payments spec, which is still to be written (tracker T29).

| Failure | What happens | Guarantee |
| --- | --- | --- |
| Barsy unreachable or timing out | Jobs retry with backoff; the integration shows as degraded in the editor | The last snapshot keeps serving; nothing is hidden because Barsy is down |
| A full pull fails part-way | Pages already applied stay (they are valid updates); deletion detection is skipped; the publisher waits | Absence means deletion only after a complete, successful pull |
| A webhook never arrives | The 10-minute incremental loop or the nightly pull finds the change | Every Barsy change lands within 10 minutes, or by the next morning for deletions |
| A webhook arrives twice | The inbox's unique `X-Webhook-ID` stops the second; unchanged hashes make any re-fetch a no-op | Re-delivery changes nothing |
| A forged webhook | Signature check fails; stored and answered 401 | No unsigned payload is processed |
| Our receiver is down | Barsy retries and holds the changes; the daily health job restarts a deactivated subscription and reconciles | No change is lost, even past Barsy's 14-day cut-off |
| A Barsy call exceeds 30 seconds | The page size halves and the call retries | Large catalogs still sync |
| A wrong catalog root or mapping hides most Items | V11 blocks automatic publish | A bad configuration never reaches guests unreviewed |
| A mapping bug | Fix the mapping, bump `mapping_version`, replay tier 1 | Repaired without calling Barsy |
| Barsy credentials revoked | Calls return 401; the integration goes to error and the tenant admin is alerted | Data stays as it was |
| The POS key is invalidated (the POS was registered elsewhere) | Order calls fail with the POS error and alert | Only one owner may re-register; nothing registers itself automatically |
| Clock skew between us and Barsy | The 5-minute cursor overlap absorbs it | No change falls between two incremental runs |
| A hand edit and a webhook touch the same Item | They write to different layers; the resolver decides. Same-layer edits are caught by the editor's base revision | No write silently overwrites another |
| Allergen data disagrees between sources | V5 leaves the Item out until a person resolves it | A guest never sees allergen data that a source contradicts |
| A bad snapshot is published | Move the pointer back to the previous snapshot | Rollback in one step, within 30 seconds at the edge |

## Outbound: orders and tables

Ordering is not built yet, but it is the reason Barsy ids, venue scopes and tables are modelled the way they are. The order path runs the opposite way to collection: the menu is pulled from Barsy and merged, while orders are pushed to Barsy as commands. Barsy remains the system of record for bills.

The face half of this path is built (D71, D72): see Guest services under The visualization shell. It fixes what the guest's phone sends (commands with an `actionId`, never a price) and what it draws (the host's state, never its own success). The platform half is the Stage 4 design in `docs/reviews/connector-architecture/A5-guest-outbound.md` section 5.1, where the order is our business object and a command is one delivery of it to a writer.

This section is an outline, not a spec. The orders and payments spec is still to be written once Lukanet answers (tracker T29): table sessions, orders, order lines (price shown and price billed), payment shares, payments, refunds, a payment inbox and an append-only money-events table, each with its state machine, plus a failure table per payment route.

1. **The shell sends a cart, never prices:** `{table_token, client_uuid, items: [{node_id, qty, options: [node_id]}]}`. In the face's `order.send` command the lines are `{itemId, optionIds, qty, note}` and the key is its `actionId`; how that key maps onto the order API's own key is for Stage 4 to settle.
2. **The order API resolves the context.** Token → table → venue, `bid` and `place_id`. Each `nd_` id → its active Barsy link; Options → supplements or modifiers. Items that are not `orderable` in the latest snapshot and overlay are refused.
3. **It builds one `Accounts_place` call:** `account.uuid` = our server-generated order id (Barsy's official deduplication key; never the client's id, because Barsy would refuse a corrected cart retried under it after the guest has paid), `place_id`, `external_source` tagging our app, `lang_id` = the guest's language, `flag_close_account` = 0 (whether 1 creates and closes the account in one call is Q47). Rows carry `article_id`, `amount`, modifiers and supplements, and no price, so Barsy prices them.
4. **Outbox.** The command is stored first, then sent by a worker with the venue's `pos_key`, because creating accounts requires a registered POS. On a timeout it retries with the same UUID; Barsy refuses a second account with that UUID.
5. **Rounds.** v0 is pay per order (decided 2026-10-08): an order can hold many items and is paid when placed, and the guest app shows the table's orders together like a tab. Open (Q21): does each paid order become its own Barsy account, created and closed, or a round on one table account? In the round model, later orders call `Accounts_place` with the stored `account_id`.
6. **Table state.** Account and order webhooks (types 2 and 5), plus `Places_getlistwithaccountsonly`, keep each table session in step with what staff do in the POS (move, merge, split, close).
7. **Totals** are read back with `Accounts_get` and shown with Barsy's own formula.
8. **Approval** happens in Barsy: incoming accounts land in "For confirmation" (POSX, Accounts > For confirmation) for the user assigned to the table's zone; if the place has no zone, or that user has no active session, every user sees it. Barsy's help pages describe no popup or sound for it. Barsy's web-order guide also describes an account that is created and closed automatically, with no staff review. Requirement (2026-10-08): with or without confirmation, the waiter must learn of every app order inside the venue's existing Barsy setup (POS, bar printer or screen), never on a separate device of ours. Whether bar tickets print for an automatically closed account is open.
9. **Payment** uses `Accounts_getpaymentlink`. Confirm with Lukanet which flow produces exactly one fiscal receipt before building it. Preferred route (2026-10-08): Barsy's payment link, if it supports Apple/Google Pay and split payments and prints exactly one fiscal receipt; Stripe Connect is the fallback. Barsy's settings include how many hours a payment link stays active.

Decided 2026-10-08 for v0: the QR token is the only table access control (orders are prepaid); delivery is to the table only; the time other guests have to pay their share of a split order is a venue setting; and no call that writes to Barsy is made against a live venue — a Barsy test installation is required first. How the bar ticket identifies an app order (order number, first name, table) follows what Barsy can carry; to check in the `Accounts_place` docs.

## Build order and open decisions

Build the internal model and one face first, with no Barsy at all. Barsy then becomes one more source feeding a model that already works.

Stack (decided 2026-10-08): TypeScript end to end: a Next.js web app and a pg-boss worker on Railway (EU), Postgres for data and jobs, Cloudflare R2 for files. AI coding agents write the code; Martin manages and makes the decisions. The build order below is not decided yet: planning comes first (see the Restro tracker, conflict C1).

The full stack design, costs, environments and how CI enforces the nine rules are in the Stack tab.

1. **Core.** Template, canonical store, `apply()`, manual editor, resolver, publisher, snapshot, QR face. Done when a hand-built menu publishes and renders on a phone.
2. **Barsy read.** Onboarding, full pull, mapping configuration, tier 1 replay, the matching screen. Done when a Barsy catalog becomes a published menu with photos.
3. **Barsy live.** Webhook receiver and processor, reconciliation loops, subscription health. Done when a Barsy edit reaches a phone in under 3 minutes and a deliberately dropped webhook is caught within 10.
4. **More faces.** Print and TV faces, the contract-test fixtures, the live sold-out overlay.
5. **Ordering.** Outbox, POS registration, table sessions, payment, only after Lukanet confirms the fiscal flow.

### Decisions for the owner

- [x] Placement: decided 2026-10-08. Our own section map, generated from the Barsy category tree as the default composition and editable per venue. A new Barsy item lands at the end of the section its Barsy category maps to.
- [ ] Display price: Barsy's base price plus promotion badges, or the live current price?
- [x] New Barsy Items: decided 2026-10-08. Publish automatically; V11 still blocks mass changes.
- [ ] Allergens: which Barsy characteristic key holds them for each client, or are they entered in our editor? First check what Bulgarian law requires (and re-check per country before any expansion), then whether pilot venues hold allergens in Barsy.
- [x] Languages: decided 2026-10-08. Per menu: every language Barsy holds for it, plus any added by hand in our translations tab; BG + EN for the pilot. Open: should our translations later be written back to Barsy? That would need a change to rule 7 (sync never writes into Barsy).
- [ ] Nightly pull time per venue (clubs close late).
- [x] Sold-out Items: decided 2026-10-08. Shown greyed out, with no order button.
- [ ] Card payment: which Barsy flow prints exactly one fiscal receipt (ask Lukanet)? Preferred route (2026-10-08): Barsy's payment link, if it supports Apple/Google Pay and split payments and prints exactly one fiscal receipt; Stripe Connect is the fallback.
- [ ] Service day: the hour a venue's day ends (proposed 07:00), used for sold-out resets, table tabs, stats and money reconciliation. Service editions are named by service day, not calendar date.
- [ ] Barsy bill model (Q21): one Barsy account per paid order (recommended: the only model with documented deduplication) or rounds on one table account.
- [ ] Split rules: how a bill is split, who pays the leftover cent, what happens when the payment window expires, and whether an order reaches the bar only when fully paid. The window must not outlast Barsy's payment-link lifetime.
- [ ] Writes to a live Barsy: the allowlist of calls allowed against a live venue (order placement, webhook subscribe and restart). POS registration stays manual until a test installation proves it cannot disturb the venue's own POS.
- [ ] Sold out: Barsy's for-sale flag or stock as the source, with our toggle for managers only, or our toggle for waiters too (trace 4 assumes waiters use our editor, which conflicts with "no separate device").
- [ ] Default order\_mode for items published automatically.
- [ ] Call waiter and request bill in v0: only if Barsy's API can message staff (Q48).
- [ ] Which menu each table or zone shows.
- [ ] Allergens on drinks: check V4 covers "food" only and no field marks an item as food; EU rules may cover drinks too (legal check, Q42).

## Sources

Barsy API reference (Docs 2.0; free registration required):

- [Direct connection: hosts, Basic auth, multi-method requests, `bid`](https://docs.lukanet.com/barsy.api/usage/raw.html)
- [Downloading articles: incremental sync, 30-second limit](https://docs.lukanet.com/barsy.api/integrations/20-articles.html)
- [Webhooks: event types, signature, retries, deactivation](https://docs.lukanet.com/barsy.api/integrations/40-webhooks.html)
- [Accounts\_place: parameters, `uuid`, `original_current_price`](https://docs.lukanet.com/barsy.api/methods/accounts/place.html)
- [Accounts\_getpaymentlink](https://docs.lukanet.com/barsy.api/methods/accounts/getpaymentlink.html)
- [Categories\_getalltree: the menu tree and its fields](https://docs.lukanet.com/barsy.api/methods/categories/getalltree.html)
- [Registered POS requirement](https://docs.lukanet.com/barsy.api/faq/91-posnotfound.html)
- [Setting the POS key](https://docs.lukanet.com/barsy.api/examples/set_pos_key.html)
- [Duplicate-account protection](https://docs.lukanet.com/barsy.api/faq/41-account-create-duplicate-protection.html)
- [How Barsy calculates a bill total](https://docs.lukanet.com/barsy.api/faq/100-calculations.html)

Barsy help (public):

- [Zones and accounts for confirmation](https://docs.lukanet.com/barsy.help/120-posx/110-zones.html)
- [Client order vs. account](https://docs.lukanet.com/barsy.help/210-dictionary/client-order.html)
- [Order rows in an account](https://docs.lukanet.com/barsy.help/210-dictionary/account-order.html)
- [Web order scenarios](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)
- [Settings reference: order verification, payment-link lifetime](https://docs.lukanet.com/barsy.help/extra/settings.html)
- [Account: states, fiscal receipt on closing](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)

Other:

- [Lukanet Postman: Barsy API collection](https://www.postman.com/lukanet/lukanet-public/documentation/pm1rtc4/barsy-api)
- Passport system: `SynexCloud/Platform` branch `main`, read for this document: `OntologyController`, `TemplateController`, `PassportController`, `SkuController`, `ImportController`, the `MassImportCoordinator` and `MassImportWorker` jobs, `Pages/Ontology/RenderGraph.jsx`, `Pages/Passport/View.jsx`.
