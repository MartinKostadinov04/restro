# Connector architecture review: POS neutrality, blind spots and partial support

Made by: an independent review agent (Fable), 11-10, read-only on branch `or/staging-chain-plan` (which carries `or/foundation`). For: Martin and the lead, to revise the connector-foundation roadmap (`docs/reviews/connector-architecture/readiness.md`, the CF list). It informs and never binds (D114). Words follow `GLOSSARY.md`.

How to read it: **Fact** means seen in the code or a document at the path given; **Opinion** is my judgement; **[S]** marks an outside source, with its address; **[unknown]** marks what nobody has confirmed. Nothing was run against a POS or a payment provider, and no test suite was run.

---

## For Martin, in plain words

**What you asked.** Can Restro connect to many POS systems and payment providers without the platform knowing which one it talks to, and what happens when a POS cannot do everything Restro offers?

**The short answer.** Half of Restro is already neutral and well made; the other half is still shaped like barsy, and the plan to fix it (the CF list from 10-11) is right in spirit but out of date.

- **The ordering and paying side is neutral.** When a guest orders or pays, the platform speaks to the POS through one interface that says only "put these lines on this table's bill", "move these lines", "close with a card". Each POS answers "done", "no" (with a reason) or "I can't tell", and the platform never guesses. Every POS declares a list of 21 things it can or cannot do, and each guest feature that depends on one simply disappears where it is missing: no tip row, no note field, "Ask your waiter to put your first item on", "Ask your waiter to pay". One shared test suite checks every connector the same way. Payment providers follow the same pattern. This part matches what the best comparable products do, and in some respects (never retrying a write; reading back after a timeout) is more careful than they are.
- **The menu side is not neutral yet.** Reading a menu from a POS still runs through barsy's own files: barsy's job names, barsy's password shape, barsy's venue table with its whole-number ids. There is no list of what a POS can give the menu (names, prices, sections, options, allergens, photos, sold-out, happy-hour prices), so nothing in the admin can adapt when one is missing. The second POS, Mistral, is exactly such a case: its documented interface gives a good menu but no photos, no allergens, no usable sold-out, and no options tied to items.
- **One decision needs a small reopening.** On a POS venue the owner's "sold out tonight" switch was removed, because "the POS says what ran out" (D124 §6). Mistral's interface cannot say it. On such a venue nobody could mark a drink sold out. The rules allow Restro to be *more* cautious than the POS, so the switch should come back exactly where the POS cannot say.
- **Three blind spots** compared with comparable software: no handling of a POS saying "slow down" (rate limits), no record of which version of a POS's interface we speak, and a thin picture of each connection's health in the admin.
- **The CF list.** Seven of its items are done. Of the rest, the two that matter most (the connector contract, CF-06, and moving the sync engine out of barsy's files, CF-07) are now on the pilot's critical path *even in the fallback where Mistral gives only a menu*, because today there is no way to plug a second menu source in at all. I propose re-scoping CF-06 to one declaration per POS covering both menu and service, adding three small items (a connector registry, a menu-side partial-support policy, connection health), and dropping or shrinking one (the switch preview, overtaken by "a venue's source is fixed at creation").

**What I did not find.** No sign that the platform leaks POS ids to guests, that money is handled as floats, or that a connector could write anything but a waiter's action. The guardrails hold.

**What only outside parties can answer** is listed at the end: above all whether Mistral has a second interface for tables and open bills, and whether barsy's and Mistral's test installations exist.

---

## 1. Scope read

Code: `packages/core/src/connectors/` (service and payment seams, their testing kits, `till-venues.ts`, `index.ts`), `packages/core/src/service-capabilities-config.ts`, `packages/core/src/seal/`, `packages/core/src/jobs.ts`, `packages/core/src/money.ts`, `packages/core/src/apply/{floor,tables,stock}.ts`, `packages/connectors/sim-pos/src/{connector,switches,scenario-file}.ts`, `packages/payments/{stripe,sim-pay}` (listing), `packages/barsy/src/{service,write,mapping}/`, `apps/worker/src/{service-connectors,connectors}.ts`, `apps/worker/src/jobs/{order-send,readings,floor,stock,payments}.ts` (heads and kind checks), `apps/worker/src/sync/context.ts`, `apps/web/src/connectors/`, `packages/db/src/schema.ts` (integrations, barsy_venues, places, tables, bars), `scripts/vendor-words.{config.ts,baseline.json}`.

Documents: `CLAUDE.md`, `GLOSSARY.md`, the review folder (`readiness.md`, R0, A1–A6, B1, `cf-16-design.md`), D41, D64, D66, D72, D79, D87–D92, D98, D110, D115, D122, D124–D127, D132, the architecture doc's Outbound and Paying sections and "Prices that change by time", `stack.md` (boundaries, rule enforcement), `docs/connector-questions.md`, `docs/deliverables/2026-11-06-zamboo-api-review.md`, `2026-11-07-mistral-what-we-need-from-the-api.md`, `2026-10-21-test-pos-design.md`, `2026-10-22-connector-fitness-decision-log.md`, the tracker's CF lines.

Outside sources: two research passes over the public developer documentation of Square, Toast, Lightspeed, Deliverect, Otter, Chowly, Olo, UrbanPiper, Spreedly, Primer, Hyperswitch, Merge and Apideck (sources listed at the end). Olo's and Chowly's developer documentation is behind partner logins, so little is cited for them.

---

## 2. Findings, most important first

Each finding: evidence, why it matters, what comparable software does, a recommendation, and the CF item it belongs to.

### F1. The service seam is neutral; its wiring is not. The worker binds it to one kind with an `if`.

**Evidence (Fact).** `apps/worker/src/service-connectors.ts:68-77`: `serviceConnectorFor` throws `no_service_connector` for any `integration.kind !== SIM_KIND`; `readsFloor` (`:50-52`) is `kind === SIM_KIND`. Every service job repeats `if (integration.kind === 'sim') assertSimAllowed(...)` (`jobs/order-send.ts:571`, `readings.ts:168`, `floor.ts:286`, `payments.ts:804,1428`, `stock.ts:280`, `service-hours.ts:274`). Meanwhile barsy's service reader exists and passes the read conformance suite (`packages/barsy/src/service/reader.ts`, `conformance.test.ts`) but no worker code can reach it. The payment side already does this right: `apps/worker/src/connectors.ts:45-62` builds a `Map<kind, PaymentProvider>` from the environment.

**Why it matters.** The seam (`packages/core/src/connectors/service/connector.ts`) is the best-designed part of the integration layer: eight operations, `done | refused | unknown`, `complete: false` concludes nothing, refusals with scope and the `not_supported` code, 21 declared capabilities (`capabilities.ts:13-73`), and a conformance suite that runs checks only where a capability is declared (`testing/suite.ts:59-200`). But the one place that turns an instance row into a connector is a hard-coded branch, so adding the Mistral or barsy service connector means editing six jobs. It is also the only place where "which kinds read a floor" is known, and that answer is a function of the registry, not of a constant.

**Comparable software.** Hyperswitch keeps every processor behind one trait set and a registry; adding one is a generator script plus trait implementations, with no edits to the payment flows ([S] https://github.com/juspay/hyperswitch/blob/main/add_connector.md). Apideck exposes the connector list and each connector's `supported_operations` as data ([S] https://help.apideck.com/en/articles/7773186).

**Recommendation.** A static `serviceConnectors.ts` registry in the worker, like `paymentProviders()`: `kind → (integration, policy) → ServiceConnector`, with the production refusal of `sim` inside the `sim` entry. `readsFloor(kind)` becomes "the registry has an entry". Wire barsy's reader into it (reads only; its `write/` stays empty until #47). Small, no migration. **New item CF-20, do first.**

### F2. The menu side has no connector contract, and the sync engine is still barsy's. This now blocks the pilot's own fallback.

**Evidence (Fact).** `apps/worker/src/sync/context.ts:99` throws for `kind !== 'barsy'`. Credentials are one shape: `packages/core/src/seal/credentials.ts:13` (`BarsyCredentialsSchema`, user and password), opened only by `openBarsyCredentials` (`seal/open/open.ts:129`). Job names and payloads are barsy's in core: `packages/core/src/jobs.ts:63-68,160`, and the asset-fetch payload accepts only a barsy article id (`:249`). The database allows two kinds, `integrations_kind in ('barsy','sim')` (`packages/db/src/schema.ts:531`), with `host` NOT NULL (`:510`). The simulated POS's menu is not synced at all: it is seeded through `apply()` from a scenario file (`packages/connectors/sim-pos/src/scenario-file.ts:69`). The vendor-word baseline confirms the shape: 27 words in `apps/worker/src/config.ts`, 39 in `jobs/barsy.ts`, 23 in `core/jobs.ts`, 21 in `core/apply/barsy-venues.ts` (`scripts/vendor-words.baseline.json`). `apply()` itself is neutral (CF-03 done: one `till` layer, one vendor word left in `apply/index.ts`).

**Why it matters.** The lead's 11-06 recommendation is: if Mistral opens no table-service interface, run the pilot with the menu read from Mistral and no ordering (`2026-11-06-zamboo-api-review.md` §7). Today there is no engine to plug a second menu source into: the only reader, cursor, limiter, paging, raw-record store and absence logic live inside barsy's files (A3's classification still holds; the tracker lists CF-07 as parked under D79). So CF-06 and CF-07 are on the critical path of *both* pilot outcomes, not only of the full one. A Zamboo menu reader also needs things barsy never did: a credential that is an API key in a query string, a host per venue, no delta read, no paging, one call per item for allergens and images, `204` empty answers and double-encoded errors (`zamboo-review` §4–§5).

**Comparable software.** Every integration platform fixes a small verb set and a declared contract: Airbyte's `spec / check / discover / read` with state as an opaque cursor (R0 §1.1); Merge keeps the raw record beside the normalised one (`remote_data`, [S] https://docs.merge.dev/merge-unified/supplemental-data/remote-data); Apideck the same with `raw=true` ([S] https://developers.apideck.com/guides/using-raw-mode). Hyperswitch's rule for a new connector's state mapping is the same as Restro's for service writes: anything not an explicit success or failure is `Pending` ([S] https://github.com/juspay/hyperswitch/blob/main/add_connector.md).

**Recommendation.** Keep CF-06 and CF-07 but re-scope them (section 4): one manifest per kind that declares the menu side as well as the service side, and an engine whose second real source is the Zamboo menu reader rather than the dropped spreadsheet (D65). The menu read contract should borrow the service seam's shapes (`Reading<T>` with `complete`, an error taxonomy with `rate_limited`, `auth` and `no_rights` apart) rather than invent a second vocabulary. **CF-06 (re-scoped), CF-07.**

### F3. Capabilities have one level (what the kind can do) and cover only service. Comparable products have two levels (what the kind can do; what this account was granted) and cover the menu too.

**Evidence (Fact).** `SERVICE_CAPABILITIES` are 21 booleans per connector (`capabilities.ts`); barsy's are a constant (`packages/barsy/src/service/capabilities.ts`), sim's derive from its switches. The worker writes the declaration to `integrations.config.service_capabilities` at the floor reading (`core/service-capabilities-config.ts`), and the service path reads back seven of them. D122 §3: "Restro checks none of them at setup." The only menu-side declaration is `TILL_LINK_TYPES` per kind (`core/connectors/index.ts:41-60`): which external types may link to which node types. There is no declaration of whether a kind gives names, prices per location, sections, modifiers with rules, allergens, images, availability, time-based prices, a deletion signal or a delta read. B1-Q9 (tell a missing right from a wrong password) is still open: 401 and 403 are one error.

**Why it matters.** Three consequences. (a) Nothing in the admin or the composer can adapt to a POS that lacks a menu feature (F4). (b) A right the venue forgot to grant looks like wrong credentials and stops the whole instance (B1-F10), instead of marking one feature degraded. (c) The owner never sees "what this POS gives you" before creating a venue from it, although D85 makes the POS the only thing they pick.

**Comparable software.** Two levels are the norm. Square puts `capabilities` on each *location*, not on the API ([S] https://developer.squareup.com/docs/locations-api). Merge has per-integration "supported features" and per-field coverage, and Common Model Scopes decide per linked account what syncs ([S] https://docs.merge.dev/merge-unified/crm/integrations/supported-features; https://help.merge.dev/articles/5950052-what-are-common-model-scopes). Apideck answers `supported_operations` per connector *and* per resource, and marks each connector Live, Beta or Auth-only ([S] https://help.apideck.com/en/articles/7773186; https://developers.apideck.com/apis/connector/reference/api-resources). Hyperswitch added a per-connector feature listing and pre-validates a payment method against it before calling the processor ([S] https://github.com/juspay/hyperswitch/pull/6612). Deliverect's channel registration answers with only the webhook URLs the channel supports ([S] https://docs.deliverect.com/doc/channel-api/operation/operation-post-/channel/register).

**Recommendation.** (1) Add a **menu capability set** to the manifest (section 3 names the flags). (2) Add a per-instance **granted** set beside the declared one: written at connect and at each probe from what the POS actually answers (a 403 on one method marks that capability `degraded`, the instance stays connected), with a `degraded` health state. (3) Show both in Settings › Integrations and on "New venue from a POS". **CF-06 for the declaration; new CF-19 for what the admin and the guest page do with it.**

### F4. There is no partial-support policy for the menu, and one decision assumes a POS can always say stock.

**Evidence (Fact).** D124 §6: "On POS venues the owner's 'sold out tonight' switch goes too: the POS says what ran out." The stock job (`apps/worker/src/jobs/stock.ts:1-11`) finds a run-out item only where the connector declares `itemAvailability` or where a refusal names the line. Zamboo's `GetMaterialAvailablity` returned `0.0` for an item on sale and cannot tell "out" from "not tracked" (`zamboo-review` §4), and its `SaveOrder` gives no line refusal because no round is added to a bill. So on a Zamboo venue no path marks an item sold out, and the owner has no switch either. The same holds for photos, allergens and descriptions: Zamboo's demo had none; D89 allows the owner's own over the POS's, which is the right fallback, but nothing tells the owner which fields the POS will never fill.

**Why it matters.** A guest orders a drink that ran out at 02:00; nobody could grey it out. Rule 5 lets Restro hide or mark sold out (more cautious), so an owner's switch is allowed wherever the POS is silent; D124 §6 removed it on the assumption that the POS speaks.

**Comparable software.** Deliverect documents snooze as "not supported by all channels" and gives the merchant busy mode and per-item snooze from its own side when the channel cannot ([S] https://developers.deliverect.com/v3.0-ordering-experience/reference/busy-mode). UrbanPiper lets stock be POS-controlled where the POS integrates and platform-controlled otherwise ([S] https://help.urbanpiper.com/pos-integrations/foodics/introduction). Chowly documents what a POS cannot do (no dayparted menus, no nested modifiers for some) as a feature matrix per POS ([S] https://help.doordash.com/en-ca/merchants/article/chowly-pos-integration-vs-other-order-protocols).

**Recommendation.** Adopt the policy in section 3 and the rule "a feature the POS cannot source falls to the next most cautious owner" in one place. The first case: the owner's sold-out switch returns on POS venues whose connector declares no availability source (neither `itemAvailability` nor a menu-side `availability` read). *Contradicts D124 §6 as written, but worth reopening narrowly: it keeps "one source of stock" wherever the POS is one.* **New CF-19.**

### F5. Locations and tables are still barsy-shaped (CF-05 not done), under neutral aliases.

**Evidence (Fact).** `barsy_venues` carries `bid integer`, `catalogue_root_cat_id integer`, `catalogue_id integer` (`schema.ts:542-560`); `places` has `bid integer NOT NULL` and `places_barsy_venue_fk` (`:1331,1353-1357`). Core and the worker read them as `tillVenueLinks` and `tillPlaces` (`core/connectors/till-venues.ts:10`; `apps/worker/src/connectors.ts:13`), and `TillLink.bid` is a number (`till-venues.ts:13-16`). Progress since 10-11: the platform's own `tables` and `bars` tables exist and are neutral (`schema.ts:1125,1180-1215`; `createTable` at `core/apply/tables.ts:876`; `applyFloor` writes bars and tables from any connector's floor reading), so hand-made tables and a service floor no longer need barsy. Zamboo's location shape is "one host per venue, plus `dbGuid`" (`zamboo-review` §1), text ids.

**Why it matters.** An alias hides the vendor word but not the shape: a second kind's locations cannot be stored, and "New venue from a POS, pick instance and venue" (D85) has no row to pick from. CF-16 solved catalogue sharing for barsy inside barsy's table; the neutral model still has no location on `source_links` (A1-F16).

**Comparable software.** Location discovery is a first-class step with its own ids and events everywhere: Chift consumer → connection → location, Toast `partner_added` per restaurant GUID, Square `ListLocations` (R0 §1.1).

**Recommendation.** CF-05 as planned: `connection_locations` with a text external id and per-location sync state; `places` becomes barsy's own mirror (or is folded into the generic one with a `kind`-specific payload column); credentials shape per kind and `host` nullable (A3-P14) go in the same migration. **CF-05, unchanged in intent, with F7 folded in.**

### F6. A POS saying "slow down" is not handled: no 429, no `Retry-After`, no backoff policy per kind.

**Evidence (Fact).** `grep` for `Retry-After|retryAfter` in `packages/` and `apps/` finds only the guest-side limiter (`core/service/guest-limits.ts`, `guest.ts`, `pin-guard.ts`). The service seam gives each connector an optional `callsPerSecond` and a cautious default of 5 (`connector.ts:37,63`), paced by the worker's per-instance budget; the sync side still treats a 429 as a failed page and asks for the next offset at once (A3-F8; `sync/paging.ts`). The simulated POS answers `busy` *before* doing anything, and the connector comment rightly says "No other POS is assumed to do so" (`sim-pos/src/connector.ts:16-19`).

**Why it matters.** Real POS APIs publish limits and expect the client to read them. A club with eight phones polling the bill and a worker walking the tables is exactly the load that trips them. Without a `rate_limited` error kind, a 429 on a read is "incomplete" (fine) but on a write is "unknown", which starts a read-back and may pause the table for nothing.

**Comparable software.** Toast: 20 requests/second and 10,000 per 15 minutes by default, `X-Toast-RateLimit-*` headers on every response and `Retry-After` on a 429, with the advice to pause all requests for that period ([S] https://doc.toasttab.com/doc/devguide/apiRateLimiting.html). Lightspeed X-Series: `Retry-After` as an HTTP date, and a job queue that defers after the first 429 rather than sleeping after every call ([S] https://x-series-api.lightspeedhq.com/docs/rate_limiting). Square: `RATE_LIMITED` with exponential backoff and jitter; limits undocumented ([S] https://developer.squareup.com/docs/build-basics/general-considerations/handling-errors). Spreedly opens a circuit per gateway and answers `503 circuit_breaker_open` ([S] https://developer.spreedly.com/reference/response-codes).

**Recommendation.** In the manifest: `rate: { callsPerSecond, concurrent, honoursRetryAfter }`. In the kit's error taxonomy: `rate_limited(retryAfterMs)`, mapped by each connector from its POS's documented signal only. In the engine and the service budget: a 429 or `Retry-After` pauses *that instance's* budget for the stated time, with jitter, and counts in connection health (F10); a write that was refused by a documented pre-write rate limit is `refused busy`, anything else stays `unknown`. **Fold into CF-06 (taxonomy) and CF-07 (engine); no separate item.**

### F7. Credentials: one shape, one host rule, no rotation path, and the next POS puts its key in the URL.

**Evidence (Fact).** The sealed envelope is strong and bound to tenant, instance and host (`core/seal/envelope.ts:8`); only the worker opens it. But the shape is fixed to user and password (`seal/credentials.ts:13`), the host rule is barsy's suffix (`apps/web/src/connectors/barsy/host.ts`), the only credential forms are barsy's (`apps/web/src/connectors/ui.tsx:41-43` branches on `data.kind === 'barsy'`), and "change credentials" is "connect again" (B1-Q5 refuses a host change while links exist, which is right). Zamboo's key travels as `?apiKey=` on every call, one key reads and deletes the whole customer base, and no scopes, expiry or rotation are documented (`zamboo-review` §6).

**Why it matters.** A second kind needs a different credential schema drawn by the admin from data (the web may not import a connector). Rotation without losing links is a routine operation at a venue (a staff member leaves). A key in a query string must never reach a log line, a Sentry breadcrumb or a proxy log.

**Comparable software.** Apideck vaults credentials per consumer, refreshes tokens automatically, and on a failed refresh enters a *degraded grace period* before the connection becomes `needs_auth` ([S] https://help.apideck.com/en/articles/8845314). Hyperswitch keeps per-processor credentials per merchant connector account and tells connector authors to rotate keys and never commit them ([S] https://github.com/juspay/hyperswitch/blob/main/add_connector.md). Primer separates sandbox and live hosts and scopes its API keys ([S] https://primer.io/docs/api-reference/get-started/authentication).

**Recommendation.** Manifest: `credentials: z.ZodType` per kind (user/password, api key, token), `hostPolicy` (suffix, exact, per-venue host, none) and `secretPlacement: header | query`, the last forcing the client to scrub URLs before any log. A "Replace credentials" action that re-seals under the same instance and host and keeps every link. Health states `needs_auth` and `degraded` (F10). For Zamboo specifically: a guardrail test in its package that the client calls only the menu endpoints and never `GetAttachedDbs` or the customer endpoints (the lead's own recommendation of 11-06). **CF-05 (schema), CF-06 (manifest), CF-08 (the package guard).**

### F8. Nothing records which version of a POS's interface an instance speaks, and nothing watches for the POS changing shape.

**Evidence (Fact).** Till writes carry `mappingVersion` (`core/change-set.ts:170`; `BARSY_MAPPING_VERSION`), which versions *our* translation. No field on the instance or in the manifest names the POS's API version; barsy's client sends no version header (none exists in its API); Zamboo is `v1` with no deprecation policy published [unknown]. Fixtures are recorded and replayed in tests, so a shape change is found only when someone re-records.

**Why it matters.** When a POS adds a required field or renames one, the first sign today is a Zod failure on a page at 23:00 on a Friday, which under rule 6 correctly concludes nothing and leaves the menu stale, silently.

**Comparable software.** Square pins a date version per request (`Square-Version`), stages every change as Beta → GA → Deprecated → Retired, and ships breaking changes only in a new version ([S] https://developer.squareup.com/docs/build-basics/versioning-overview). Apideck runs one live schema with a six-month grace period for breaking changes and tells clients to treat response enums as open sets ([S] https://developers.apideck.com/versioning). Merge promises no breaking changes on v1 ([S] https://help.merge.dev/articles/9686125-are-merge-s-apis-versioned). Lightspeed K-Series publishes a dated changelog with compare views and a feed ([S] https://api-docs.lsk.lightspeed.app/changes/0f22a20c).

**Recommendation.** Manifest `api: { version, pinnedPerRequest: boolean, changelogUrl }`, recorded on the instance at connect. Response schemas that tolerate unknown fields on *reads* (log once, keep going) and stay strict on *writes* and on anything published (rule 3's walk already does the latter). A cheap scheduled "shape probe" per kind against a sandbox where one exists (Stripe has one; barsy's and Mistral's are [unknown]) that fails the Restro team's alert, not the venue's menu. **CF-06 (manifest), CF-08 (probe and tolerance tests).**

### F9. Conformance exists for service and payment, not for menu reads; the fixture standard is still barsy's.

**Evidence (Fact).** `packages/core/src/connectors/service/testing/suite.ts` runs the read suite (writes are waiter actions; probe writes nothing; failed part → incomplete; stalled read → incomplete; availability answers every item) and the write suite (oldest bill of tonight; never a bill under payment; stalled round → unknown; second close refused; tip and email refused where undeclared; receipt file). The payment kit mirrors it. barsy passes the read suite on recordings (`packages/barsy/src/service/conformance.test.ts`). The readiness plan's menu checks K1–K16 and E1–E6 (`readiness.md` lines 146-150) were never built; the menu's rule-6 and rule-8 property tests are barsy-only (A1-F13, A3-F13 still hold). Four of five places recordings are unused (B1-F24).

**Why it matters.** The next menu connector (Zamboo) would be tested only by whatever its author writes. Rule 6's floor and ratio holds, the money chain, the id leak guard and deterministic translate are platform rules that every connector must prove, and today the proof lives in barsy's tests.

**Comparable software.** Airbyte's acceptance tests run the same spec/check/discover/read/incremental cases on every connector from recorded fixtures (R0 §1.1). Hyperswitch generates a connector test file and runs it against sandbox credentials ([S] https://github.com/juspay/hyperswitch/blob/main/add_connector.md). Toast and Olo add a human certification step, which does not scale down to five connectors and should not be copied.

**Recommendation.** CF-08's remaining half: a menu-read suite over a fixture transport (complete read → change set; one failed page → nothing concluded; empty and 30 % holds; money from decimal text; no POS id past the mapper; translate is pure and replays from tier 1; option names never cleared by a delta read) plus the fixture standard (redaction before write, consent label, facts-to-verify list) and the "request equals recording" test. **CF-08.**

### F10. Observability per connection is thin: three statuses and a run list.

**Evidence (Fact).** `integrations.status in ('new','connected','error')` (`schema.ts:536`); `job_runs` per instance (`:1025`); breakers and budgets are in-process (`jobs/breaker.ts`, `call-pacer.ts`); pauses are rows. D122 §7 promises the Restro team "its own raw POS call log for 31 days" (merged fix 28); I found no such table in `schema.ts` (grep for `pos_call`, `call_log`) and did not search further, so treat it as [unknown] whether it exists elsewhere. The admin's Settings › Integrations shows status and last runs (D81).

**Why it matters.** During a night the question is "is the POS slow, refusing, or down, since when, and for which venue?" A status of `error` with a last run cannot answer it; a manager cannot tell a rights problem from an outage; and the end-of-night reconciliation page (D122 §7) has nothing per connection to lean on.

**Comparable software.** Apideck stamps every answer with a request id and `x-apideck-downstream-error`, surfaces the connector's own rate-limit headers, and keeps a health state per connection ([S] https://developers.apideck.com/errors; https://help.apideck.com/en/articles/8845314). Square keeps webhook event logs and an Events API for missed events ([S] https://developer.squareup.com/docs/webhooks/overview). Spreedly maps every gateway's raw codes to three categories (platform outage, gateway outage, soft) and drives retries from them ([S] https://developer.spreedly.com/docs/gateway-error-code-mapping).

**Recommendation.** One `connection_health` row per instance, written by the worker: state (`ok | degraded | needs_auth | rate_limited | paused | down`), since when, last good call, last error kind, counts per error kind for the service day, p95 latency per operation; shown as a card in Settings › Integrations and as a line on the end-of-night page. Status `error` stays for the connect check only. **New CF-22, small; after CF-07.**

### F11. Money: one currency and one rounding rule, named after one POS.

**Evidence (Fact).** `CURRENCIES = ['EUR']` and "half-up like barsy" (`core/money.ts:2,9`). The chain itself is right (lossless text → BigInt → minor units; rule 8's property tests). Zamboo sends five-decimal floats, names no currency, and its VAT guid was all zeros while the rate hid in an item type's name (`zamboo-review` §5.1, §5.7).

**Why it matters.** Rounding direction and grain are POS facts, not platform facts. VAT must never be parsed from a name (the review already says so). Only EUR is fine for Bulgaria now and was decided (D122 §2).

**Comparable software.** Square applies taxes only where explicitly attached and documents the order in which discounts, service charges and taxes apply ([S] https://developer.squareup.com/docs/orders-api/service-charges). The platforms never compute a total themselves when the processor can: Toast tells integrators to call `/prices` before posting an order and to leave a mismatch to staff ([S] https://doc.toasttab.com/doc/devguide/apiCreatingOrders.html, via R0).

**Recommendation.** Manifest `money: { currency, rounding: 'half_up' | 'half_even' | …, grain }`, consumed by the money module's conversion for that kind; the comment "like barsy" becomes "as the kind declares". No VAT field in the menu model until a POS gives one as data; the guest's bill shows the POS's own totals (already so). **CF-06, small.**

### F12. Modifiers, combos and portions: the model has the shape, the gating is on the wrong flag, and the next POS cannot link options to items.

**Evidence (Fact).** The template has modifier groups and options with `price_delta` (`core/templates/venue-menu.ts:260-300`); a sent line carries `options: PosRef[]` up to 50 (`service/schemas.ts:312-318`). barsy's mapper drops `group_required`, min/max and the default option (B1-F17, on the "later" list) and the portion (B1-F16). D122 §4 says items with required options say "Order this from your waiter" *only* where `notesReachTicket` is undeclared: notes and option structure are different things. Zamboo's `GetModifiers` returns modifier sets but nothing links a set to an item, and `GetItemContent` answered 404 on every drink (`zamboo-review` §4).

**Why it matters.** An item that needs a choice (gin and which tonic) sent without one is a wrong order the bar must sort out; an item whose option rules are unknown is not safely orderable, however well notes print.

**Comparable software.** Toast carries `minSelections` and `maxSelections` on every modifier group and the Orders API rejects an order that breaks them ([S] https://doc.toasttab.com/doc/devguide/apiUsingMenusApiDataToSubmitProperlyFormedOrders_V2.html). Deliverect models product, modifier and modifier group with nesting ([S] https://developers.deliverect.com/page/product-types). Chowly's partner guide names nested modifiers as a thing some POSs cannot sync ([S] https://help.doordash.com/en-ca/merchants/article/chowly-pos-integration-vs-other-order-protocols).

**Recommendation.** Menu capability `modifiers: 'none' | 'groups' | 'groups_with_rules'` and a service capability `optionsOnLine` (the POS line accepts the chosen options; today implied by `notesReachTicket`). Orderable per item = price locked by the till *and* (no groups, or groups with complete rules). Elsewhere the item shows "Order this from your waiter". Finish B1-L6 (required, min, max, default) for barsy under the same flag. **CF-19 (gating), B1-L6 (barsy), CF-06 (flags).**

### F13. What is already right, and should be kept as is

- The service seam's two rules (a timeout is `unknown`, never a second write; a partial reading concludes nothing) and the read-back with `landed | absent | ambiguous` (`service/landed.ts`). Apideck's `outcome: "uncertain"` and Spreedly's `gateway_processing_result_unknown` with "check the gateway before retrying" are the same discipline ([S] https://developers.apideck.com/errors; https://developer.spreedly.com/reference/response-codes). Spreedly says outright that it never retries a transaction itself ([S] https://developer.spreedly.com/docs/syncing-your-gateway-transaction).
- Every POS and provider write recorded as `attempting` before the call, compare-and-set state changes, and a recovery job every 30 s (D127): this *is* an outbox, under another name. No separate outbox table is needed.
- Idempotency by Restro's own reference on a line and by payment id on the provider, with the capabilities `ownLineReference` and `idempotentAdd` declared honestly (barsy's are false until Lukanet answers C20/C21). Primer and Apideck both document that a reused key with a changed body is an error, which the kit should also check ([S] https://primer.io/docs/api-reference/get-started/idempotency-key.md; https://developers.apideck.com/errors).
- Provider notices: signature-checked, stored once by event id, never trusted for content, the object read back (D125 3.8). Square's own guidance for its webhooks is the same (dedupe on `event_id`, unordered, at least once) ([S] https://developer.squareup.com/docs/webhooks/overview).
- Refunds read and never made (D132), a restricted provider key, the no-refund guardrail test.
- Import boundaries and the vendor-word walls (`stack.md` lines 127-130; `vendor-words.config.ts`), which already register `mistral`/`zamboo` as words of a kind that has no package yet.
- The simulated POS's switches each tied to a question number, with the cautious default: the right way to build against an unknown POS.

---

## 3. Capability matrix and partial-support policy

### 3.1 The policy

Four outcomes, in order of preference, chosen per feature by the connector's declaration, never per venue by hand:

1. **Degrade gracefully:** the feature stays, with less (whole lines instead of part quantities; the base price instead of the happy-hour price; the POS's own name instead of a public one).
2. **Restro does it itself:** only where the rules allow Restro to be *more* cautious than the POS (rule 5) and the result reaches no POS record: hide, mark sold out, own photo, own text, own allergens, own sections, hand-made tables for a menu that is not ordered from.
3. **Fall back to the waiter:** the guest sees a still card or a plain sentence ("Ask your waiter…"); the staff screen keeps working. Used for every step that would need a POS write the POS does not offer.
4. **Hide the feature:** when a step could produce a wrong record or a guest success the POS never confirmed (D72). Paying without holds (D124 §4), ordering without a readable bill (D122 §1), ordering where the POS does not price the lines and no total can be read back.

Binding rules honoured: rule 5 (options 2 only hide or mark sold out, never un-hide or re-price); D72 (3 and 4 never show a local success); rule 7 / D110 (no option adds a POS write that is not a waiter's); D41 (no webhooks anywhere in the matrix); rule 6 (every "absent" conclusion still needs a complete read).

### 3.2 The matrix

Columns: the flag that gates it today (or **gap**); what barsy, the simulated POS and Mistral's documented Zamboo API give (Fact unless marked); what happens today where it is missing; the policy. "Zamboo" means the delivery API read on 11-06; a table-service interface, if one exists, is [unknown].

**Menu import**

| Feature | Flag today | barsy | sim | Zamboo | Today when missing | Policy |
|---|---|---|---|---|---|---|
| Names (public, per language) | gap | public name, else till name with a warning (D75) | seeded | BG + EN `altText`; no public/internal split | item shown under the till's name; no name → hidden (B1) | 1 degrade (D75); no name at all → 2 hide |
| Prices (per venue) | gap | per venue; base or current (D91 (10)) | seeded | one `basePrice`; `timeDiscount` fields [unknown] | item without a locked price is never orderable (resolve rule) | 1 degrade: shown "from the till" but not orderable; no price → 2 hide |
| Sections | gap | categories under the venue's root (D88) | seeded | `WebCategory` tag values; `GetDefaultMenu` names empty | everything lands in Unsorted | 2 Restro: the owner's own sections through the mapper (D92) |
| Modifiers with rules | gap (see F12) | groups and options; required/min/max/default dropped (B1-F17) | option groups | sets exist, not linked to items; `GetItemContent` 404 | item orderable without its options (wrong order) or, by D122 §4, waiter only where notes don't reach the ticket | 3 waiter for any item whose rules are unknown; `modifiers` flag |
| Allergens | gap | one characteristic key per instance (D82); partial sets written as complete (B1-F15) | seeded | `204` empty; free text, no code [unknown] | nothing shown unless the owner enters them | 2 Restro: owner's allergens (D89), with a composer notice "your POS gives none" |
| Images | gap | pictures fetched from barsy's own origin (T57) | seeded | none on the demo | owner uploads (D89) | 2 Restro |
| Sold out / availability | `itemAvailability` (service); menu side gap | `is_for_sale` flag at the read (D46); no pre-send check declared | switch | `0.0` for an on-sale item: unusable | **nobody can mark sold out on a POS venue (D124 §6)** | 2 Restro: the owner's switch returns where no POS source is declared (F4) |
| Time-based prices | gap | `current_price` at the moment of the read; rule boundaries missed up to one interval (cf-16 §Prices) | n/a | [unknown] | base price shown; the POS prices the round where it prices lines | 1 degrade: base price plus a scheduled badge (architecture option 1); never a time rule computed by Restro |
| Deletions / absence | engine (rule 6) | absence after a complete full read; `delete_flag` not read (B1-F8) | n/a | no delta read: every read is full | daily at the full read | 1 degrade; the flag `deleteSignal: absence \| flag \| tombstone` tells the engine what to expect |

**Tables and bars**

| Feature | Flag today | barsy | sim | Zamboo | Today when missing | Policy |
|---|---|---|---|---|---|---|
| Table list (floor) | implicit: `readsFloor(kind)` (F1) | `Places_getlist`; halls as areas; no bars | floor | none | POS venue gets no tables (places need a `bid`; `createTable` is for hand-made venues, D95) | 2 Restro: hand-made tables allowed on a POS venue whose connector declares no floor, **for the menu and Call a waiter only**; ordering onto a bill needs the POS's table (hide) |
| Which bar serves a table | `tableBar` | no (halls are areas) | switch | no | no bar; tickets, per-bar pauses and payment tables per bar do not apply (D124 §1) | 1 degrade (built) |
| Payment tables | `moveLinesToTable` + marked by a manager | by `Accounts_divide`, two calls (not declared) | switch | no | paying not offered (#116) | 4 hide (built) |

**Ordering**

| Feature | Flag today | barsy | sim | Zamboo | Today when missing | Policy |
|---|---|---|---|---|---|---|
| Read the table's bill with lines | implicit: the seam exists for the kind (F1) | `Accounts_getlist` (reader not wired, F1) | yes | **no** (R3) | menu only (D122 §1) | 4 hide ordering and paying; menu, Call a waiter and hand-made tables stay |
| Open a bill with the first items | `firstItemsOpenBill` | yes | switch | n/a (no bill) | "Ask your waiter to put your first item on" | 3 waiter (built) |
| Add a round to a staff-opened bill | `addToStaffOpenedBill` | not declared (C54) | switch | no | joins only Restro's own bill (D124 §3) | 1 degrade (built) |
| POS prices the lines / total readable | **gap** (`posPricesLines`) | yes: no price sent, current price used; total read back | yes | **no**: price required, nothing read back (R6, C12) | not represented: a connector could send the snapshot price | 4 hide ordering where the POS neither prices nor returns a total (D72: the guest must pay what was shown) — *a question for Martin, section 5* |
| Notes and options on the line | `notesReachTicket` | not stated | switch | `description` fields; printing [unknown] | no note field; fixed sentence | 3 waiter for items needing options (built) |
| Approval at the bar | `approvalAtBar` | not declared (Q82.4) | switch | `orderValidationType` [unknown] | no approval state | 1 degrade (built) |
| Split or move lines | `moveLinesToTable`, `movePartOfLineQuantity` | divide yes, move whole bill; part quantities yes | switches | no | whole lines only; no paying where no move | 1 degrade / 4 hide (built) |
| Cancel a sent order | none in the seam | reasons list exists | n/a | no | no cancelling after Send (D116) | 3 waiter, by decision (built) |
| Ask for the bill | Call a waiter option `bill` (#180) | n/a (Restro's own) | n/a | n/a | the call reaches Tonight | 2 Restro (built) |
| Did it land (reference, dedupe) | `ownLineReference`, `idempotentAdd`, `whoEnteredLine` | who-entered yes; reference and dedupe open (C20, C21) | switches | `ExtId` 409 on a new order only | read-back by matching; ambiguous → Unconfirmed | 1 degrade (built) |
| Stock check before Send | `itemAvailability` | not declared | switch | unusable | the POS's refusal that names a line, else nothing | see sold out above |

**Payments**

| Feature | Flag today | barsy | sim | Zamboo | Today when missing | Policy |
|---|---|---|---|---|---|---|
| Pay at the table | provider with holds (interface) + `moveLinesToTable` + `closeWithPaymentType` + payment tables marked (D125 2.3) | close with payment type yes; move not declared | switches | no close, no fiscal device | "Ask your waiter to pay." (D127) | 4 hide (built) |
| Part payments | `movePartOfLineQuantity`; whole-bill discount → waiter | yes | switch | no | whole lines; "Ask your waiter to split this bill" | 1 degrade / 3 waiter (built) |
| Tips | `recordTipOnClose` | waits on Lukanet (Бакшиш item) | `tipAsLine` | [unknown] | no tip row | 4 hide (built) |
| Receipt number on close | `receiptNumberOnClose` | not stated | switch | no | capture only on a done answer, `already_done` or a closed bill with Restro's reference; more "Payment unconfirmed" | 1 degrade (built) |
| Electronic receipt | `electronicReceipt`, `electronicReceiptFile` | asked (Q84) | switches | [unknown] | no email field; paper by the waiter | 3 waiter (built) |
| Refunds | provider `refundNotices`; POS storno not read | storno at the till | n/a | n/a | daily status list where no notices; storno to-do for staff | 3 waiter / venue, by decision (D132; built) |
| Wallets, 3-D Secure, minimum | provider capabilities | n/a | sim-pay | n/a | per provider, checked at connect | 1 degrade (built) |

**Gaps, named.** (1) No menu capability exists at all: eight rows above gate on nothing. (2) Two service facts are implicit in "which kinds have a connector" rather than declared: a readable bill and a readable floor. (3) `posPricesLines` is missing, and Zamboo is the case that needs it. (4) Option rules are gated on notes. (5) Sold out has no fallback. (6) The granted level (rights) does not exist, so a missing right is a wrong password. Everything in the payment block and most of the ordering block is covered and built.

---

## 4. The CF list, revised

### 4.1 Where the list stands (tracker lines 384-463; Fact)

Done: CF-01, CF-02, CF-03 (neutral till layer), CF-08a (workspace guard, vendor-word test, PR template), CF-09a and CF-09b (Settings › Integrations, D81), CF-12, CF-14 (D68, later D84), CF-16 (several venues per barsy account), CF-17 (D75), CF-18 (D76). Partly done: CF-04 (`publish.auto_paused` still on the instance, T76); CF-10 (hall id and weight stored; the rest with #71's floor reading). Open and parked under D79: CF-05, CF-06, CF-07, CF-08 (the rest), CF-11, CF-13. Built outside the list by spec #64 and #102: the service seam, the payment seam and both conformance kits, which deliver what CF-06 intended for the service side, and the neutral `tables` and `bars` tables, part of what CF-05 intended.

### 4.2 Should CF-06's contract be unified with the service and payment contracts? Yes, as one manifest and one kit, not one interface.

- **One manifest per kind** (data, in core, read by the web): label, `credentials` schema, `hostPolicy`, `secretPlacement`, `api.version`, `money`, `rate`, `menu` capabilities and link types and `deleteSignal` and `delta: 'none' | 'since' | 'ids'`, `service` capabilities (the existing 21 plus `readsBill`, `readsFloor`, `posPricesLines`, `optionsOnLine`), `media` policy. Payment providers keep `PaymentProvider` and `PaymentCapabilities` as they are (a provider is not a POS), but a provider package's manifest uses the same shape for credentials, host, api version and rate.
- **One executable connector per package**, imported only by the worker, exposing `menu?: MenuReader` (connect, discover locations, read full or since or by ids as raw records, translate purely), `service?: ServiceConnector` (as today) and `media?`. A kind may implement one or both: Zamboo's delivery API would be menu-only; a POS with no menu API but a table-service one would be service-only with a hand-made menu, which D66 forbids today and which the matrix would then have to revisit (not proposed now).
- **One kit**: the service kit's harness, `Reading`, `WriteOutcome`, refusal codes and guard functions (`waiterActionProblems`, `posIdLeaks`) are reused by the menu suite; the error taxonomy is shared (`auth`, `no_rights`, `rate_limited`, `timeout`, `network`, `server`, `bad_response`, `gone`).

### 4.3 Add, merge, drop, reorder

| Item | Change | Why |
|---|---|---|
| **CF-20 (new, S)** | Service connector registry in the worker; wire barsy's reader; `readsFloor` from the registry; one production refusal for `sim` | F1. Cheap now, costly once six jobs grow further |
| **CF-06 (re-scoped, M, Opus design)** | The manifest of 4.2; menu read contract on the service seam's shapes; error taxonomy with `rate_limited`; per-kind credential schema and host policy; `api.version`; `money`; the declared vs granted split | F2, F3, F6, F7, F8, F11, F12 |
| **CF-05 (as planned, L)** | `connection_locations` with text ids, per-location sync state, `host` nullable, credentials per kind, "Replace credentials" | F5, F7; A3-P14 folded in |
| **CF-07 (re-scoped, L)** | Engine extraction with the **Zamboo menu reader as the proving second source** (replaces the dropped sheet connector); raw stored before translate; replay; 429 and `Retry-After` in the limiter | F2, F6; D65 |
| **CF-08 (the rest, M)** | Menu-read conformance suite on a fixture transport; fixture standard; request-equals-recording; the Zamboo package's endpoint guard; the shape probe | F8, F9 |
| **CF-19 (new, M)** | The partial-support policy in the admin and the guest page: menu capabilities drive composer notices ("your POS gives no photos"), the owner's sold-out switch where no POS source, option-rule gating, `posPricesLines` gating, hand-made tables on a floor-less POS venue (menu and Call a waiter only), "what this POS gives" on New venue from a POS | F4, F12, the matrix |
| **CF-22 (new, S)** | `connection_health` per instance and its card; counts per error kind; the Restro team's call log confirmed or built | F10 |
| CF-04 | Finish T76 (`auto_paused` to the venue) | still open |
| CF-10 | Re-check what is left after #71 and D95; likely only the "which places get codes" card | partly done |
| **CF-11 (shrink or drop)** | D87 fixed a venue's source at creation and D88 made menus the POS's designated roots, so "switch the till venue or root" is largely gone. Keep only a preview on the holds CF-02 raises, if anything | overtaken |
| CF-13 | After CF-07, and now also the matrix, the manifest and the policy | F2 |
| Guide and template package | After CF-08, from A6's outline; add Hyperswitch-style generation (a template package with the manifest, a fixture transport and the suite pre-wired) | fast onboarding; [S] add_connector.md |

**Order:** CF-20 → CF-06 → CF-05 → CF-07 → CF-08 → CF-19 → CF-22 → CF-13 → guide; CF-04 and the CF-10 check at any time. **Opinion:** CF-20 and CF-06 can start before Mistral answers; they need no POS fact that is not already recorded. CF-07's Zamboo reader can be built from the OpenAPI description and the 11-06 recordings as fixtures; its first live read waits for Martin's go-ahead on which installation is a sandbox (A3). Nothing here touches webhooks or POS registration (D41).

---

## 5. Known, unknown, and the questions for outside parties

### 5.1 Mistral / Zamboo (all from `2026-11-06-zamboo-api-review.md` and `docs/connector-questions.md`, 11-06)

**Known (Fact, read or tested by the lead on 11-06):** a documented API, `Zamboo api v1`, OpenAPI 3.0.4, 45 endpoints, served without a login; it is the delivery and web-shop channel (Glovo, Bolt, Wolt, WebOrders). One `apiKey` in the query string, no scopes, no rotation. The menu reads well through the `WebCategory` tag path (61 items, 12 categories, priced); `GetAllItems` is the whole nomenclature including raw materials and cost prices. No tables, no open bills, no split or move, no close with a payment, no fiscal device, no receipts, no rights, no rate limit, no delta read, no paging, no versioning policy. `SaveOrder` creates a standalone order and refuses a repeated `ExtId` with 409. `GetMaterialAvailablity` returned `0.0` for an item on sale. Allergens answered `204` empty; no images on the demo; modifier sets not linked to items. Prices are five-decimal JSON numbers; VAT guids were zero. Neither barsy nor Mistral was on the NRA list on 10-18 (re-check before building).

**Unknown:** whether a second interface for tables and open bills exists and will be opened (A1, the one that decides everything); the written authorisation under Н-18 чл. 52з, ал. 5 and NRA listing (A2); whether `demorestaurant.zamboo.bg` is a sandbox safe for test writes (A3); the two enums (A4); where a `SaveOrder` lands and prints (A5); the `ExtId` guarantee under concurrency and over time (A6); how options are read for non-operation items (A8); allergen codes; the currency and rounding; a rate limit; a key in a header and scoped keys.

### 5.2 barsy (Lukanet)

**Known:** the signed-in reading of 10-18 and the service capabilities it supports (`packages/barsy/src/service/capabilities.ts`). **Unknown:** the test installation (Lukanet 13, C3); rights per method and the 403 shape (C8, C9, B1-Q9); whether a repeated add creates nothing and whether Restro may set its own line reference (C20, C21); the tip item through the API and the electronic receipt (D127 §Open, Q84); 429 behaviour and any `Retry-After`; the time zone of `last_update` (Q60); whether deletions bump `last_update` (B1-L5).

### 5.3 Questions to send

**Mistral**, beyond A1–A10 already on #48: (a) a published request limit and what a refused call looks like; (b) a header for the key and scoped keys, since one key reads and deletes customers; (c) the currency, the rounding grain and direction; (d) how they announce changes to `v1` and how long an old shape keeps working; (e) whether `timeDiscount` is computed by the server when a line is saved.

**Lukanet**, beyond Q82 and Q84: (a) the test installation; (b) the exact answer for a missing right on one method, so Restro can mark one feature degraded instead of the instance wrong-credentialed; (c) whether the API answers 429 and with which header.

**Stripe:** unchanged (the per-payment fee question in D125).

### 5.4 Questions for Martin (with recommendations)

1. **Sold-out on a POS that cannot say stock** (F4): bring the owner's switch back only where the connector declares no availability source? *Recommend yes; it narrows D124 §6 without breaking its reason.*
2. **Ordering where the POS does not price the lines and returns no total** (the `posPricesLines` row): hide ordering there, or allow it with the snapshot price (which is the POS's own base price, rule 5) and accept that a happy-hour price may differ? *Recommend hide: D72 and C12 say the guest pays what was shown, and nothing could prove it.* This only matters if Mistral's second interface prices like its delivery one.
3. **Start CF-20 and CF-06 now**, before Mistral answers? *Recommend yes; both are POS-neutral by construction and unblock either pilot outcome.*
4. **The Zamboo menu reader as CF-07's proving source**, built from the description and fixtures, with its first live read gated on A3? *Recommend yes.*

---

## Sources

Repository (branch `or/staging-chain-plan`, 11-10): paths as cited in each finding. Documents: `docs/reviews/connector-architecture/*`, the decisions named above, `docs/connector-questions.md`, `docs/deliverables/2026-11-06-zamboo-api-review.md`, `docs/deliverables/2026-11-07-mistral-what-we-need-from-the-api.md`, `docs/deliverables/2026-10-21-test-pos-design.md`, `docs/deliverables/2026-10-22-connector-fitness-decision-log.md`, `docs/tracker.md` (CF lines only).

Outside, read on 11-10 through two research passes (summaries, not raw pages, except where a page was fetched):
- Square: versioning https://developer.squareup.com/docs/build-basics/versioning-overview; idempotency https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency; errors and 429 https://developer.squareup.com/docs/build-basics/general-considerations/handling-errors; catalog sync and deletes https://developer.squareup.com/docs/catalog-api/sync-with-external-system; webhooks https://developer.squareup.com/docs/webhooks/overview; locations https://developer.squareup.com/docs/locations-api; service charges and taxes https://developer.squareup.com/docs/orders-api/service-charges.
- Toast: rate limits https://doc.toasttab.com/doc/devguide/apiRateLimiting.html; orders https://doc.toasttab.com/openapi/orders/operation/ordersPost/; retries https://doc.toasttab.com/doc/devguide/apiRetrySupport.html; modifier rules https://doc.toasttab.com/doc/devguide/apiUsingMenusApiDataToSubmitProperlyFormedOrders_V2.html; environments and sandbox https://doc.toasttab.com/doc/devguide/apiEnvironments.html; certification https://doc.toasttab.com/doc/devguide/integrationDevProcess.html.
- Lightspeed: K-Series to-go order https://api-docs.lsk.lightspeed.app/operation/operation-apeplacetogoorder; changelog https://api-docs.lsk.lightspeed.app/changes/0f22a20c; X-Series rate limiting https://x-series-api.lightspeedhq.com/docs/rate_limiting.
- Deliverect: channel registration https://docs.deliverect.com/doc/channel-api/operation/operation-post-/channel/register; busy mode https://developers.deliverect.com/v3.0-ordering-experience/reference/busy-mode; product types https://developers.deliverect.com/page/product-types.
- Otter: https://connect.cloudkitchens.com/docs/menu-integrations-operations/. UrbanPiper: https://api-docs.urbanpiper.com/downstream/getting-started/overview; https://help.urbanpiper.com/pos-integrations/foodics/introduction. Chowly (secondary, partner guides): https://help.doordash.com/en-ca/merchants/article/chowly-pos-integration-vs-other-order-protocols. Olo: developer docs gated; nothing cited.
- Spreedly: response codes https://developer.spreedly.com/reference/response-codes; syncing https://developer.spreedly.com/docs/syncing-your-gateway-transaction; error-code mapping https://developer.spreedly.com/docs/gateway-error-code-mapping; test gateway https://developer.spreedly.com/docs/test-gateway-guide.
- Primer: idempotency https://primer.io/docs/api-reference/get-started/idempotency-key.md; authentication https://primer.io/docs/api-reference/get-started/authentication; payment lifecycle https://www.primer.io/docs/concepts/payment-lifecycle.
- Hyperswitch: add a connector https://github.com/juspay/hyperswitch/blob/main/add_connector.md; connector features https://github.com/juspay/hyperswitch/pull/6612; fallback routing https://docs.hyperswitch.io/features/merchant-controls/smart-router/default-fallback-routing; reconciliation https://docs.hyperswitch.io/other-features/payments-modules/reconciliation.
- Merge: supported features https://docs.merge.dev/merge-unified/crm/integrations/supported-features; common model scopes https://help.merge.dev/articles/5950052-what-are-common-model-scopes; remote data https://docs.merge.dev/merge-unified/supplemental-data/remote-data; versioning https://help.merge.dev/articles/9686125-are-merge-s-apis-versioned; passthrough and timeouts https://docs.merge.dev/merge-unified/supplemental-data/passthrough-request/passthrough-requests.
- Apideck: coverage and statuses https://help.apideck.com/en/articles/7773186; resource coverage https://developers.apideck.com/apis/connector/reference/api-resources; errors, idempotency and uncertain outcomes https://developers.apideck.com/errors; versioning https://developers.apideck.com/versioning; raw mode https://developers.apideck.com/guides/using-raw-mode; connection health https://help.apideck.com/en/articles/8845314.
- The 10-11 benchmark (`R0-benchmark.md`) for Airbyte, Singer, Meltano, Chift, HubRise and Codat, not re-read.
