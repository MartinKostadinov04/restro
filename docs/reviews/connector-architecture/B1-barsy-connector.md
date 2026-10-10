# B1 - The barsy connector itself (read-only review)

Reviewer B1, 2026-10-11. Read-only: no commands that write, no database, no network, no `.env*`. Scope note from the lead: spreadsheet import is out of scope. Nothing below proposes or assumes it. Connector #2 is Mistral (no docs yet) or a no-till venue (D64).

## 1. Scope read

I read the whole barsy connector: client, errors, allowlist, reader and schemas, mapping (catalogue, sections, text, allergens, places, ids, source records), the fixtures (`articles-bid10-page1`, `tree-bid10`, `supplements-7183-burger`, `barsys`, `modificators-bid10`, `article-details`, `languages`, `currencies`, and `places-bid{10,102,70,1,40}`), the MSW harness, and the worker's `catalogue`, `photos`, `paging`, `host-policy`, `limiter`, `cursor`, `context`, `data`, `run` and `apply-chunks`. I also read `jobs/barsy.ts`, the barsy-facing parts of `server/integration/service.ts`, the picker cards, `core/apply/barsy-venues.ts`, `tables.ts` and `sync-config.ts`, and `conclude-full-pull.ts`. In the docs I read paths C, D, E, "Barsy to canonical mapping", "Tables" and "Failure modes", plus the tracker items you listed. I used A3 for the engine questions and did not repeat them.

I computed fixture statistics with read-only Python. The official docs are not reachable, so anything that needs them is marked **verify in docs**.

Biggest messages:
- The connector is well built on money, rule 6, SSRF and determinism.
- The gaps cluster in three places: what happens when scope changes (root, venue, host, settings), tables, and unrecorded response shapes.
- One assumption could hurt the pilot most: that a real club's "public" barsy data is filled in (F5).

## 2. Scorecard (barsy as connector #1)

| # | Part | Rating | Evidence |
|---|---|---|---|
| 1 | Own model | 2 | The mapper writes only canonical fields. But the layer is `barsy`, the source is `barsy:<in>`, locales are barsy's 11 keys (`core/locales.ts:7`), currency is the literal `'EUR'` (`mapping/catalogue.ts:55`). A1 owns the rename. |
| 2 | Connector plug | 1 | The package shape is right (read, pure mapping, testing, empty `write/`). There is no manifest, no capabilities, no settings schema, and no seam in the worker (A3-F1). |
| 3 | Stages | 2 | Tier-1 records are content-addressed and provenance is NOT NULL. But storage runs after translate (A3-F6), nothing replays, and there is no per-record quarantine (F9). |
| 4 | Own ids, theirs as links | 2 | The menu is clean: derived `nd_`/`sr_` ids, links in `source_links`. Tables are not: `places` and `barsy_venues` carry `bid` and `place_id` columns. |
| 5 | Connections and venues | 2 | A person maps barsy venue to venue, and venues exist alone. But there is no confirm, no preview, one root per bid, and a host change reuses the identity (F14). |
| 6 | Sync engine (barsy side) | 2 | Strong: pure `concludeFullPull`, race guard, page halving, cursor advances only on a complete run. Weak: no floor on empty reads (F1), no scope fingerprint (F2), 401 and 403 are the same error (F10). |
| 7 | Write-back | 0 | Empty by design (rule 7). |
| 8 | Contracts and tests | 2 | Recorded fixtures, MSW, and property tests for rules 6 and 8. But the MSW harness serves one fixture per method, the worker fake is not bid-aware, and four of five places recordings are unused (F24). |
| x | Tenancy, secrets, observability | 3 | Sealed credentials are bound to tenant, integration and host. Reads go through `withTenant`. Each run has counters and notes. The request id is logged. There is no per-connection health beyond run history. |
| x | UI driven by capabilities | 0 | The Integration UI is barsy-named end to end. |

## 3. Findings

Severity: **B-pilot** = blocker for the pilot, **B-2nd** = blocker for a second connector.

| Id | Sev | F/I | Where | What and why it matters |
|---|---|---|---|---|
| B1-F1 | B-pilot | Fact | `apps/worker/src/sync/catalogue.ts:451-508`; `core/sync/conclude-full-pull.ts:83` | A complete read that returns 0 articles or 0 sections still concludes every link `missing` (T62: 65 items hidden). The only guards are "all pages ok" and "exactly one mapped venue". Tests cover an empty answer only for the incremental (`sync-incremental.test.ts:215`). |
| B1-F2 | B-pilot | Fact | `core/apply/sync-config.ts:58-61`; `barsy-venues.ts:88-157`; `jobs/barsy.ts:370`; `service.ts:575-600` | Sync state (cursor, tree hash) is keyed by `bid` only. Changing the root, the venue or the mapping settings resets nothing. The incremental then runs against the new scope as a partial pull until the 12:00 full pull. A to B to A reuses a stale cursor. A price-source change applies to changed articles at once and to the rest next noon (mixed prices). |
| B1-F3 | B-pilot | Fact | `catalogue.ts:550-607`; `jobs/barsy.ts:518-519`; `schemas.ts:171-177`; `mapping/places.ts:29-49`; `barsy-venues.ts:180-186`; `db/schema.ts:791`; `web/server/tables/service.ts:84-92` | Tables are read only at the end of a full pull, which needs a root (T67). The schema keeps `place_id`, `place_num`, `salon_name`, `is_public` and drops `salon_id`, `salon_weight`, `place_type`, `type_name`, `persons_opt`, `place_name_full` and `pos`. Tier-1 keeps the raw object, so a backfill needs no barsy call. Fixtures show that T66's "no code unless public" is not enough: 9 of 11 `--` places in bid 10 are public. Five "Нов салон" halls hold only a `--` place. A public table named "Staff" exists. `salon_weight` is null or duplicated (9, 9, 10, 10). |
| B1-F4 | significant | Fact | `catalogue.ts:576`; `barsy-venues.ts:286-296` | Places are concluded with a constant `pagesOk: [true]`. A successful empty `Places_getlist` marks every table `missing`, and after 7 days `deleted`, which also removes its QR token. Paging or default length of `Places_getlist`: **verify in docs**. |
| B1-F5 | significant (pilot) | Inference | `reader.ts:163-171`; `mapping/catalogue.ts:277-285`; `schemas.ts:34`; `barsys.json` | The read assumes the club filled in barsy's public layer: public tree only (D56), public names only, no fallback to the till name, and `public_cat_id` unused. In the recording only bid 10 has `public_cat_id`. 27 of 60 articles have no public name. Pilot clubs are not using barsy's QR menu (Q1), so public data may be thin and the first pull could produce an empty or unnamed menu. |
| B1-F6 | significant | Fact + Inference | `mapping/catalogue.ts:390-397,540-548`; `worker catalogue.ts:363-375` | Option names come only from option articles inside this run's article list. In an incremental run that is the changed set, so a price change on a combo clears its option names (`clearField`). Where supplement articles sit outside the root, they are never named. In the fixture, 0 of 14 option ids are in the page. No incremental test has a combo. |
| B1-F7 | significant | Fact | `schemas.ts:112`; `catalogue.ts:307`; `catalogue.test.ts:378-393` | The shape of `is_for_sale_barsys` is unrecorded: the only recording has 31 `{}` and 29 `null`. "Exception wins over the base flag" is our reading (the param is called `limits_by_barsys`). Per-venue orderability depends on it. **verify in docs**. |
| B1-F8 | significant | Fact | `reader.ts:181-182`; `catalogue.ts:472-476`; `data-architecture.md:754` | The reader never asks for `delete_flag` articles, so the mapper's `deleted` branch is dead in production. Deletions land only at the 12:00 pull. A delete-and-recreate (new `article_id`, relink deferred by D40) shows the old and new item together until then. A missed daily pull is not caught up. |
| B1-F9 | significant | Fact | `schemas.ts:124`; `client.ts:376-389`; `paging.ts:82-85` | One malformed article fails validation of the whole page (500 items). The page is marked failed, not retried smaller, and rule 6 is then disabled for that pull. There is no record-level quarantine. |
| B1-F10 | significant | Fact + Inference | `client.ts:357-359`; `run.ts:105-107`; `catalogue.ts:604`; `data-architecture.md:284` | 401 and 403 are one error, and any such error puts the whole integration into `wrong_credentials`. A valid user missing the right for one method (the rights list omits places) looks like a wrong password, and the tick then skips the integration. Barsy's real answer for a missing right is unrecorded. |
| B1-F11 | significant | Fact | `reader.ts:68-89,181-194`; `articles-bid10-page1.json` params; `mock-server.ts:117-131`; `mapping/catalogue.ts:437-440` | The request actually sent (`cat_id_deep`, `cat_weight_deep`, no `slug` or `supplements`) was never recorded. The recording has `filters {}`, order `article_id`, length 60. The demo accepted the request (54 articles), but whether the order is total is unverified, and rule 6 relies on stable offsets. The mapper then sorts by id and discards barsy's item order, so item order in a section is article id, not the POS order. |
| B1-F12 | significant | Inference | `cursor.ts:1-33` | `last_update` is treated as venue-local time without offset (Q60 open). A wrong zone loses changes silently beyond the 65 minute overlap. The nightly pull is the only net. |
| B1-F13 | minor | Fact | `catalogue.ts:113-115`; `tree-bid10.json`; `jobs/barsy.ts:96,370-392` | The tree hash covers the whole installation tree including `child_articles_cnt` (root 675). Any article added anywhere triggers a full pull (at most once per 15 minutes). This is safe but wasteful. |
| B1-F14 | significant | Fact + Inference | `service.ts:474-512`; `mapping/ids.ts:22` | Changing the host updates the same integration row. Links and derived node ids hang on the integration id, and barsy ids are unique only per installation. A different installation's article 11 would land on the old node and keep the manager's photo and copy. |
| B1-F15 | significant | Fact | `mapping/catalogue.ts:331-334` | If an allergen text has recognised words and unknown ones, the recognised set is written as if complete. The unknown words appear only in run warnings. The real value shape was never recorded (T48). |
| B1-F16 | significant (product) | Fact | `articles-bid10-page1.json`; `article-details.json`; `core/templates/venue-menu.ts:102` | Portion is dropped (T49): `amount_unit` "0.05" with unit "л" on 25 of 60 drinks. The template already has `portion`. The "Грамаж" (weight) characteristic is ignored. This matters for a bar menu. |
| B1-F17 | minor | Fact | `supplements-7183-burger.json`; `core/money.ts:73-75`; `catalogue.ts:367-368` | Dropped: `selected` (default option), `group_required`, `article_max_selected`, `free_article_choice`. A negative `supplement_price` is refused. Group names are stored in the default locale only. |
| B1-F18 | minor | Inference | `mapping/catalogue.ts:286-289` | `description_ml` is used as the main text, with `description_public` as a fallback. No `description_public_ml` exists in the recording, so `description_ml` may be the internal description's translation. **verify in docs**. |
| B1-F19 | minor | Fact | `catalogue.ts:55`; `currencies.json` | `Currencies_getlist` is read and stored but never used. `rounding_strategy` is ignored. "Half-up like barsy" is our rule, unchecked against the docs. |
| B1-F20 | minor | Fact | `worker catalogue.ts:138-153`; `service.ts:99,265-267` | Price source, allergen key and default locale are parsed ad hoc in two places and held at integration level. `includeServices` is hard-coded false (`catalogue.ts:146`). There is no connector-owned schema. |
| B1-F21 | minor | Fact | `jobs/barsy.ts:186-191,226`; `barsy-venue-card.tsx:52-77`; `barsy-venues.ts:30-34` | Discovery keeps only `{bid, name}`. `menu_id`, `public_cat_id`, address, phones and work time stay only in tier-1 `barsy_venue` records. The picker shows names only. Delisted venues keep their rows. |
| B1-F22 | minor | Fact | `core/apply/tables.ts:111-133,171-204` | After a venue switch, the old bid's tables keep their tokens and `t/<token>.json` files. The stickers work, but the tab no longer lists them. |
| B1-F23 | minor | Fact | `catalogue.ts:295-315`; `photos.ts:132-153` | Photos on other hosts are refused (T57). A replaced picture under the same file name is not detected. A permanently refused picture is re-queued on every pull. |
| B1-F24 | B-2nd | Fact | `mock-server.ts:64-70`; `apps/worker/tests/fake-barsy.ts:159-186`; fixtures | The test kit is not reusable. The harness holds one fixture per method. The worker fake serves one tree and one places list for every bid and ignores `cat_id_deep`, `delete_flag` and `limits_by_barsys`. Only `places-bid10` is referenced by any test. The fixtures contain another customer's tree. |

## 4. Walk-throughs

**(a) Onboarding a real club**
1. **API user.** The owner follows the rights list (`data-architecture.md:284`). The code also calls venues, languages, currencies, characteristics, supplements, places and `Misc_ping_user`. A forgotten right shows up as "wrong credentials" (F10).
2. **Connect.** The host must end in `.barsyonline.com`. The connect job pings, reads the lists, and caches one tree per venue. A failed tree read is only a note while the status says connected.
3. **Pick the barsy venue.** Names only. A chain with many venues, shops and services is unreadable, and `public_cat_id`, the best hint of a guest venue, is not used (F21).
4. **Pick the root.** The whole installation's tree is shown with internal names, no article counts and no suggestion. The choice applies immediately (F2). In the demo only bid 10 has a `public_cat_id`.
5. **First pull.** It starts within a minute or two: no cursor means the incremental queues a full pull. Where it can go wrong:
   - thin public data (F5);
   - option names (F6);
   - the for-sale shape (F7);
   - partial allergen claims (F15);
   - dropped portions (F16);
   - the 30-second page limit, which halving handles.
6. **Tables.** Places come last in the pull, and a failure there is only a note. The tab groups by hall name. "Create codes for all tables" codes every place, including `--` 0, pagers, rooms, billiards and "Staff" (F3). The QR base URL is still localhost until set (D61).
7. **Publish.** Auto-publish follows the sync, with V11 and the "hold new items" option as the safety net.

**(b) Switching the barsy venue or the root**
- **Root, same venue.**
  1. The row changes with no confirmation or preview.
  2. The cursor and tree hash are unchanged, so incrementals run: the new root's sections appear with only the recently changed items, while the old sections stay active.
  3. The 12:00 full pull, or a manual "Sync now", marks the old links `missing` (revived on return, `deleted` after 7 days).
  4. Auto-publish in between is guarded only by V11.
- **Another barsy venue.**
  1. The old bid is freed but keeps its cursor and root.
  2. If the new bid has no root, nothing syncs (T67), and the old menu stays published, stale, under the new venue.
  3. Once the root is set, the first full pull hides the old menu.
  4. The old tables and stickers linger (F22).
  5. Switching back reuses the stale cursor and hash: the menu stays hidden until noon, and shared articles keep the other venue's price and for-sale values.
- **Another installation (host change).** Choices and cache are reset, but links and nodes are not, so the id collision of F14 applies.

## 5. Proposed adjustments

**5.0 Barsy as connector #1 (target declaration, as data in the manifest)**
```ts
barsy.capabilities = {
  menu: true, prices: 'per_location', availability: 'flag',  // is_for_sale(_barsys); stock not read
  modifiers: 'option_groups',                                 // kitchen requests stay raw
  tables: { areas: true, types: true }, media: 'own_origin', languages: 11,
  deleteSignal: 'absence',                                    // lists hide delete_flag=1
  orders: false, payments: false,                             // write allowlist empty
  delivery: 'poll',                                           // webhooks exist, unused (D41)
}
```
- **Discovery.**
  - Locations are the `Barsys_getlist` rows (restrict mode). Hints: `menu_id`, `public_cat_id`, till `cat_id`, `public_name`, address, phones, website, work time, `lang_id`, `barsy_type_code`.
  - Areas are salons: `salon_id`, name, `salon_weight`.
  - Tables are places: id, area, number, type id and name, `persons_opt`, public flag, `place_name_full`.
  - Suggestions, never auto-choices: root = `public_cat_id`, guest venue = has a `public_cat_id`, default language = `lang_id`.
- **Settings schema.** Connection: host, user, password, allergen characteristic key. Per location binding: `bid`, root, price source, default locale, include services, table types that get codes, halls switched off, optional "use till name when there is no public name". Declared as data, so the web draws the form (it may not import barsy).
- **Required rights.** A manifest list per method, shown to the owner.

**Quick wins** (small, mostly no migration)

| Id | What | Why | Size | Risk | Migr. | Depends | Tier | Order |
|---|---|---|---|---|---|---|---|---|
| B1-Q1 | Floor on conclusions: skip absence when the read has 0 articles or 0 sections, and skip it for places when the list is empty but rows exist. Reuse `concludeFullPull`'s evidence, add a note. | F1, F4 (T62) | S | rule 6, add a property test | n | - | Sonnet, lead reviews | before |
| B1-Q2 | Scope fingerprint in sync state, a hash of root, bid, price source, allergen key, locale, services and mapping version. A mismatch makes the incremental queue a full pull, reusing `jobs/barsy.ts:370`. | F2 | S | one extra pull on rollout | n | - | Sonnet | before |
| B1-Q3 | Incremental never clears option names: write or clear a name only when the option article is in the batch or in its stored record. | F6 | S | low | n | - | Sonnet | before |
| B1-Q4 | Hash the root's subtree without `child_articles_cnt`. Try `Categories_getalltree` `cat_id` (**verify in docs**). | F13 | S | low | n | - | Sonnet | after |
| B1-Q5 | Refuse a host change while links exist, or create a new integration and detach the old one. | F14 | S | UX | n | - | Sonnet | before |
| B1-Q6 | Suggest `public_cat_id`. Show article counts (`child_articles_cnt`) and venue hints in the pickers by reading the stored `barsy_venue` record, as `service.ts:183-192` does for characteristics. | F5, F21 | S | low | n | - | Sonnet | before |
| B1-Q7 | Impact preview and confirm before switching venue or root: "N items will be hidden, M found". | F2 (T62) | M | UI | n | Q1, Q2 | Sonnet | before |
| B1-Q8 | One recording session: a non-empty `is_for_sale_barsys`, an allergen text, a `delete_flag=1` article, a combo whose options are outside the root, the exact request the reader sends, and a rights-limited user. Add a test that the reader's request equals a recording. | F7, F10, F11, F15 | S | needs demo admin and Q73 | n | T39 | Sonnet | before |
| B1-Q9 | After Q8, split 401 from 403: a missing right marks a capability degraded and leaves the integration connected. | F10 | S | depends on the recorded shape | n | Q8 | Sonnet | before |
| B1-Q10 | Assert that the system currency is EUR at connect, and warn otherwise. | F19 | S | low | n | - | Haiku | after |

**Larger changes**

| Id | What | Why | Size | Risk | Migr. | Depends | Tier | Order |
|---|---|---|---|---|---|---|---|---|
| B1-L1 | Tables as a first-class resource: read at mapping time, independent of the root, with its own absence conclusion. Add `salon_id`, `salon_weight`, `place_type`, `type_name`, `persons_opt`, `place_name_full`, backfilled from tier-1. Defaults: tables and bar stools get codes, hide `--` and halls that hold only a `--` place, group by `salon_id` ordered by weight then id. (T66, T67, A3 P12.) | F3 | M | QR token job | y (additive) | Q1 | Sonnet | before |
| B1-L2 | Per-record validation in the reader: bad records go to quarantine with their id. A record whose id is readable counts as seen, so it is never wrongly `missing`. | F9 | M | rule 6 | n | A3 P1 | Sonnet, Opus review | before |
| B1-L3 | Readiness report at connect and before the first pull: fill rates for public names, public tree, allergens, pictures, `is_for_sale_barsys`. Optional "use till name" fallback, default off. | F5 | M | low | n | Q6 | Sonnet | before |
| B1-L4 | Manifest as data (capabilities, settings schema, rights, discovery shape) and `translate` split from `read`, over stored payloads for replay (A3 P1-P3, A1). Prove with a test that translating stored payloads equals translating parsed responses. | F20, scorecard 2-3 | L | over-design | y | A1, A3 | Opus design, Sonnet | before |
| B1-L5 | Fresher deletions: if the docs say deletion bumps `last_update` or `delete_flag:1` is listable, ask for them in the incremental. Otherwise add an hourly light read of ids and flags that counts as a full read. Webhooks later. | F8 | M | rule 6 | n | docs | Opus (rule 6) | after |
| B1-L6 | Mapping completeness: portion with unit conversion, "Грамаж", combo defaults and flags, option names outside the root via `search_article_ids` (**verify in docs**), a decision on negative deltas. | F16, F17, F6 | M | template fields | n | Q8 | Sonnet | after |
| B1-L7 | Barsy test kit in `@restro/barsy/testing`: a fake installation that is bid-aware and honours `cat_id_deep`, `delete_flag` and `limits_by_barsys`. Wire in all five places recordings. Scrub fixtures of other customers' data. Feeds A3 P10. | F24 | M | low | n | A3 P10 | Sonnet | before |
| B1-L8 | Keep barsy's item order through the pipeline, once Q8 proves the sort. | F11 | S | low | n | Q8 | Sonnet | after |

## 6. Keep as is

- The lossless money chain: `parseBarsyJson` keeps the exact number text, then `decimalToMinor` with BigInt and half-up, negatives refused, with property tests (rule 8).
- The read allowlist, the empty write seat, the client's refusal of any other method, and the manual-redirect POST.
- The two-layer host guard and credentials sealed with tenant, integration and host bound in. Logs carry request ids but no bodies or secrets.
- Page halving with per-page accounting, the 3-failure stop, and a cursor that moves only after a complete run.
- Pure `concludeFullPull` with its race guard, and the lock that keeps pulls from overlapping.
- Deterministic ids and content-addressed source records, with venue-scoped values under our `vn_` id, never the bid.
- The never-guess rules: internal names are not shown, allergen negations count as unknown, and a deeper category is flattened with a warning.
- The photo SSRF controls and the "is this job still current" check against the link's record.
- The fixture recorder, which refuses to overwrite.

## 7. Open questions

1. **Is the public layer filled at the pilot clubs?** Recommend: get the read-only user (Q73) and run the recorder plus the readiness report (L3) before the pilot. If it is thin, ask Lukanet whether a read-only user can read the till tree (D56) and decide on the name fallback.
2. **`is_for_sale_barsys` and `limits_by_barsys`:** exception list or restriction list, and what shape when non-empty? Recommend: record one (Q8).
3. **Do deletions bump `last_update`, and can `delete_flag:1` be listed with a time filter?** Recommend: decide L5 on the answer.
4. **`last_update` time zone (Q60).** Recommend: one timed change on the demo during T39.
5. **Which rights does each method need, and how does a missing right answer?** Recommend: record it (Q8), then publish the rights list from the manifest.
6. **Places:** meaning of `place_type` 1 (`--`), where null `salon_weight` sorts, `place_article_id`, `pos`, paging and `delete_flag` of `Places_getlist`. Recommend: one Lukanet question (T39); until then hide `--` and halls with only `--`.
7. **Does `menu_id` mean "venues sharing one item set"?** Recommend: use it as the grouping key for T50 and A3's unit design.
8. **Host change:** new integration or refuse? Recommend: refuse while links exist.

Still to check in the docs: whether `actual_price` is per venue; `description_ml` public or internal; `cat_public_view` values; `articles_lazy_load_mode` 1 vs 2; `rounding_strategy`; and whether a custom barsy domain exists beyond `.barsyonline.com`.

## 8. Rules for the connector guide (from this area)

1. Every field a connector uses needs a recorded non-empty sample. Unrecorded shapes go in a "facts to verify" list.
2. The request the reader sends must equal a recording, enforced by a test.
3. Validate per record, not per page. A bad record is quarantined and counted as seen.
4. Never conclude absence from an empty or sharply smaller read. The engine enforces a floor and a ratio hold.
5. Sync state is keyed by scope and mapping settings. Any change forces a full read.
6. Changing a location, a root or a host shows an impact preview and asks for confirmation. External ids never survive a host change.
7. Public versus internal text: never show internal text. A fallback is an explicit setting, default off.
8. Distinguish bad credentials from a missing right, and publish the required rights.
9. Declare how deletions are signalled (list filter, webhook, absence) and how fresh they are.
10. Every source field is mapped, kept raw, or explicitly dropped. A coverage test fails on an unclassified field.
11. Tables and the menu are separate resources, each with its own absence conclusion.
12. Settings are a versioned schema owned by the connector, split into connection-level and location-level.
13. Fixtures must not hold other customers' or real personal data.

### Critical Files for Implementation
- E:\Restro\apps\worker\src\sync\catalogue.ts
- E:\Restro\apps\worker\src\jobs\barsy.ts
- E:\Restro\packages\core\src\apply\barsy-venues.ts
- E:\Restro\packages\barsy\src\mapping\catalogue.ts
- E:\Restro\packages\barsy\src\read\reader.ts
