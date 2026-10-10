# A3 - Connector and sync pipeline (read-only review)

Paths are relative to `E:\Restro`. **Fact** = seen in code or docs; **Inference** = my reading of behaviour. Nothing was run, written or installed. `.env*` files were not opened. pg-boss types and `attorney.js` were read from the installed 12.35.1 copy.

## 1. Scope read

I read every file in scope. For evidence I also read `core/apply/{sync-config,barsy-venues,sources,job-runs}.ts`, the `schema.ts` tables (integrations, barsy_venues, source_*, job_runs, places, assets), `.dependency-cruiser.cjs`, and `change-set.ts`/`apply.ts`/web `integration/*` by grep only.

### 1.1 The implicit connector contract (derived from barsy)

| Step | Operation | Needs | Produces | Evidence |
|---|---|---|---|---|
| 0 Declare | host rules, concurrency 2, timeout 30 s, page sizes, credential shape | - | policy | `worker/config.ts:59`, `sync/limiter.ts:10`, `barsy/config.ts:11` |
| 1 Connect | ping and auth check | endpoint, credentials | ok / auth_failed / unreachable / host_refused | `jobs/barsy.ts:178` |
| 2 Discover | locations, languages, currencies, attribute keys, per-location category tree | connection | location list, tier-1 records, cached tree | `jobs/barsy.ts:180-232` |
| 3 Scope | a person picks a catalogue root per location | cached tree | scope | `sync/data.ts:29-69` |
| 4 Read full | page tree, items, option groups, modifiers; per-page ok flag | location, scope | raw pages, `pagesOk[]` | `sync/catalogue.ts:187-241` |
| 5 Read changes | tree fingerprint, then items changed since cursor; tree changed means full | cursor (instant minus 65 min, venue-local text) | raw items, fingerprint | `jobs/barsy.ts:368-397`, `sync/cursor.ts:9,30` |
| 6 Translate | pure: raw to ChangeSet, source records, link intents, asset requests, warnings | raw, mapping config, our ids, job, clock | `CatalogueMapping` | `barsy/mapping/types.ts:164` |
| 7 Tables | list places per location | location | place descriptors | `sync/catalogue.ts:551-607` |
| 8 Media | fetch URL on own origin, Basic auth after 401 | asset request | bytes | `sync/photos.ts:116-165` |
| 9 State | cursor, fingerprint, last runs, queued marks | - | `config.sync[bid]` | `core/apply/sync-config.ts:22-35` |
| 10 Errors | auth stops; host/credentials stop; timeout/5xx halve page; else retry | - | taxonomy | `sync/run.ts:105-117`, `sync/paging.ts:51` |
| 11 Write | none; allowlist empty and test-enforced | - | - | `barsy/write/index.ts:4`, `write/index.test.ts` |

### 1.2 Classification

| File(s) | Class | Should live |
|---|---|---|
| `barsy/{client,config,read-methods}.ts`, `read/*`, `mapping/{catalogue,sections,text,config,errors}.ts` | barsy | `connectors/barsy` |
| `barsy/errors.ts` | mixed (taxonomy generic) | kit `ConnectorError` kinds; barsy subclasses |
| `barsy/hosts.ts` | mixed | kit `normaliseHost`/`assertHost`; demo host stays in barsy |
| `barsy/{json,logger}.ts`, `mapping/allergens.ts` | generic | kit/core |
| `mapping/{types,source-records,ids}.ts` | generic shape, barsy names | kit (`Translated`, `RawRecord`, `describeSource`, `deriveId`) |
| `mapping/places.ts`, `testing/mock-server.ts`, `write/` | barsy | connector |
| `record/*`, `fixture*.ts` | mixed | kit recorder plus per-connector call list |
| worker `sync/{pull-lock,apply-chunks,errors}.ts` | generic | engine |
| `sync/limiter.ts`, `sync/paging.ts` | generic algorithm, barsy constants/errors | engine/kit, policy-driven |
| `sync/chunk.ts` | mixed (phase map keyed by barsy link names) | engine, phase by node type |
| `sync/run.ts`, `sync/context.ts`, `sync/host-policy.ts` | mixed | engine, with connector `classify`/`policy` |
| `sync/cursor.ts` | barsy | connector (opaque cursor) |
| `sync/data.ts` | mixed | `readLinks` engine; `VenueTarget`, picture queries connector |
| `sync/catalogue.ts` | mixed: fetch barsy; `syncFetched` (341-538) mostly generic | split |
| `sync/photos.ts` | mixed | engine `media-fetch` |
| `jobs/barsy.ts` | mixed | engine jobs; barsy connect/discover |
| `jobs/{index,types}.ts`, `registry.ts` | generic | stay |
| `publish/after-sync.ts` | mixed | stay, drop `barsyVenues` join |
| `core/jobs.ts` | mixed | neutral names/payloads |
| `core/sync-schedule.ts` | generic | stay |
| `core/sync-settings.ts` | generic, but holds venue-level publish policy | split |
| `core/apply/sync-config.ts` | mixed (keyed by `bid`) | per-location `sync_state` |

## 2. Scorecard (area view)

| # | Part | Rating | One-line evidence |
|---|---|---|---|
| 1 | Own model | 2 | Mapper output is neutral in shape (`nd_`/`vn_` ids, minor units, `venue:<vn>` scope: `mapping/catalogue.ts:158,426`) but written to layer `barsy`, source `barsy:<in_>` (`:598`; `change-set.ts:17,36`) |
| 2 | Connector plug | 1 | Typed reader plus pure `mapCatalogue` are a good seed; no interface, capabilities or registry; `kind !== 'barsy'` throws (`sync/context.ts:94`) |
| 3 | Stages | 2 | Append-only, content-addressed tier 1 and full provenance; raw stored after translate (F6), no replay, no quarantine, mapping version is a constant (`types.ts:24`) |
| 4 | Own ids, theirs as links | 3 menu / 1 tables | Link PK `(integration,type,id)`; ids derived; but `bid integer` and `place_id` (`schema.ts:339,787`) |
| 5 | Connections and venues | 2 | Sealed credentials, status, schedule per connection; person-made venue map (`barsy-venues.ts:88`); but table `barsy_venues`, unique `venue_id`, kind CHECK |
| 6 | One sync engine | 2 | Lock, cursor, DST-safe schedule, rule-6 conclusion, per-venue try/catch exist and are tested, but inside barsy files; one pull slot per process |
| 7 | Write-back | 0 | Empty allowlist, test-enforced; no command or outbox contract (intended: rule 7, D41) |
| 8 | Contracts and tests | 1 | Recorded fixtures, MSW, recorder; no conformance suite; behaviours live in barsy-only worker tests |
| - | Tenancy / RLS | 4 | `withTenant` on every read (`context.ts:91`, `data.ts`); `tenantId` in every payload (`core/jobs.ts:55-65`) |
| - | Secrets per connection | 3 | Envelope bound to tenant, integration, host (`context.ts:104-109`); credential shape fixed to user/password |
| - | Observability | 2 | `job_runs` per connection, safe summaries; no per-connection health or alert, `barsy_*` kinds |
| - | UI by capabilities | 1 | Web gates on "barsy venue" (`web/.../gating.ts:29`) and `kind='barsy'` (`service.ts:149,480`) |
| - | Over-engineering | OK | Nothing speculative today |

## 3. Findings

| Id | Sev. | F/I | Where | What and why |
|---|---|---|---|---|
| A3-F1 | blocker | Fact | `sync/context.ts:62-71,94`; `jobs/index.ts:41-45`; `catalogue.ts:195-241` | No connector seam. The session type carries `BarsyClient`/`BarsyReader`; the only job factory is `createBarsyJobs`; the pull calls `session.reader.*` directly. |
| A3-F2 | blocker | Fact | `db/schema.ts:313,325`; `core/apply/sources.ts:19`; `core/seal/credentials.ts:13`; `core/jobs.ts:36-49,74` | A second kind cannot be stored: kind CHECK is `('barsy')`, `host` is NOT NULL, credentials are `{user,password}`, job names and the asset payload regex say barsy. |
| A3-F3 | blocker | Fact | `schema.ts:339,348,787,807-811`; `data.ts:19-69`; `sync-config.ts:58`; `jobs/barsy.ts:505-520` | The location is a barsy venue: integer `bid`, tables FK to `barsy_venues`, state keyed by `bid`, the tick joins `barsyVenues`. |
| A3-F4 | blocker | Fact | `paging.ts:12-18,51`; `run.ts:15,105`; `pull-lock.ts:39`; `limiter.ts:10`; `chunk.ts:23-29,58`; `catalogue.ts:341-538` | The engine exists but is hidden inside barsy files (barsy errors, constants, lock name). `chunk.ts` orders by barsy link names; **Inference:** an unknown name falls to the article phase, so ordering depends on emission order. |
| A3-F5 | blocker (T50) | Fact | `catalogue.ts:457,478,492`; `core/jobs.ts:187-193,225` | The unit of work is the integration. Conclusion is skipped unless exactly one location is mapped, and it covers all the integration's links; job key and lock are per integration. Two locations would make B's pull mark A's items missing. |
| A3-F6 | significant | Fact | `catalogue.ts:363-394`; `mapping/sections.ts:46`; `types.ts:24,35`; `catalogue.ts:144-151` | Raw copy happens after translate: if `mapCatalogue` throws, the fetched data is never stored. No replay entry point exists (grep). Mapping config is flat keys plus a literal constant, not versioned data. |
| A3-F7 | significant | Fact + Inference | `connection.ts:13`; `pull-lock.ts:36,81`; `jobs/barsy.ts:140,265,413`; `registry.ts:121` | `PULL_LOCKS_MAX` is 1; incrementals use `waitMs: 0`; no `localConcurrency` is set (pg-boss default 1, `attorney.js:344`); a pull may run 45 min. **Inference:** a long pull of connection A makes B's incrementals skip and queues B's full pull behind it. Tracker "Pool cap" note agrees. |
| A3-F8 | significant | Fact | `limiter.ts:10,43`; `barsy/config.ts:11`; `paging.ts:82-85,105` | Rate policy is barsy constants keyed by host. No 429 or `Retry-After` handling anywhere (grep): a 429 is a "failed page" and the next offset is asked at once. |
| A3-F9 | significant | Fact | `run.ts:105-117`; `paging.ts:51-57`; `catalogue.ts:177,604`; `barsy/errors.ts:80-83` | Error taxonomy is barsy classes. A 200-with-auth-error body is undetected (admitted in a comment). |
| A3-F10 | significant | Fact | `jobs/barsy.ts:516,550`; `sync-settings.ts:4-5`; `sync-config.ts:22`; `after-sync.ts:114-127` | One global tick, cron tz fixed `Europe/Sofia`, `kind='barsy'`; settings per integration but state per `bid`; polling vocabulary only. `after_sync` and `auto_paused` are venue policy stored on the connection, and `integrationOfVenue` takes any row with `limit(1)`. |
| A3-F11 | significant | Fact | `photos.ts:132,148,168-173,216,270,285`; `catalogue.ts:295-306`; `core/jobs.ts:74` | The media fetcher is barsy-bound: own-origin only, Basic retry via `session.authorization()`, reads an article's `picture` field, writes `origin 'barsy'`. T57 open. |
| A3-F12 | significant | Fact + Inference | `schema.ts` (no webhook or outbox table); `catalogue.ts:187-194`; `sync-schedule.ts:144-167` | No push seat: engine modes are full and since-cursor only; `dueSyncs` is poll-only. **Inference:** a webhook connector can reuse the map, record, apply and mark path once a by-ids read mode and an inbox exist. |
| A3-F13 | significant | Fact | `testing/mock-server.ts:77,117`; `fixture.ts:44-61`; `tests/sync-full-pull.test.ts:217,312-446,564`; `.dependency-cruiser.cjs:99-113` | No conformance suite. Fixtures, recorder and MSW harness are barsy wire shapes; dependency rules name `@restro/barsy`. |
| A3-F14 | minor | Fact | `cursor.ts:9,30`; `sync-config.ts:24` | Cursor is "previous start minus 65 min as venue-local text" and stored as an ISO instant. Other sources need opaque tokens. |
| A3-F15 | minor | Fact | `data.ts:182`; `web/.../service.ts:220`; `jobs.ts` | Persisted names (`barsy-*` queues, `barsy_*` run kinds) are read by the web. A rename needs a drain and a legacy alias. |
| A3-F16 | minor now | Fact | `barsy/write/index.ts:4` | Write seat is empty. No command, idempotency or outbox contract; design before Stage 4 ordering (T29), not before a read connector. |

## 4. Walk-throughs

### (a) Second till "X" (locations, modifiers, per-location prices, availability, tables, webhooks, order API)

| Area | Files and tables that change |
|---|---|
| Connector | New `packages/connectors/x/*`: client, schemas, mapping, fixtures, mock, `classify`, later `write/` |
| DB | `integrations` (kind CHECK, `host`, credentials), `barsy_venues` to location table with text id, `places` FK, `assets_origin` CHECK, new per-location `sync_state` |
| Core | `change-set.ts` Source/Layer, `apply.ts:116-123,374,1337,1771`, `field-definition.ts:124`, `resolve/combine.ts` (neutral till layer, T68, other reviewers); `jobs.ts`, `sync-settings.ts`, `sync-config.ts`, `seal/{credentials,open}.ts` (mine) |
| Worker | `context.ts`, `run.ts`, `catalogue.ts`, `data.ts`, `photos.ts`, `paging.ts`, `host-policy.ts`, `cursor.ts`, `jobs/barsy.ts`, `jobs/index.ts`, `config.ts` (`BARSY_*`), `after-sync.ts` |
| Webhooks | New `webhook_inbox`, web receiver route, `connection-process-inbox` job, kit HMAC helper, `read(mode: ids)` |
| Orders | `connectors/x/write/` plus outbox (T29), later |
| Web (outside my scope) | `integration/*`, `server/integration/{service,gating,view,host}.ts` become capability-driven |

Without the foundation, X would copy `catalogue.ts` (661 lines) and `jobs/barsy.ts` (621 lines) and be barsy-shaped twice.

### (b) Venue with no till

- **Sync path: no change.** The tick only selects mapped, connected locations (`jobs/barsy.ts:505-520`), so such a venue is never touched. This is the right opt-in.
- **Menu:** `createMenuAction` provisions an empty menu by hand (`web/src/composer/actions.ts:209`).
- **Tables: broken.** `places` needs a `barsy_venues` row (`schema.ts:807-811`); only the pull writes them (`upsertPlaces`). No QR codes without a till.
- **Publish policy:** there is no home. `after_sync` and `auto_paused` sit on the integration config, so the venue is manual-only and the rollback pause is a no-op (`after-sync.ts:184-190`). Acceptable now, wrong for a venue with only a spreadsheet.
- **Out of scope but relevant:** I found no production code that creates a venue; `provisionVenue` callers are scripts and tests (grep).

### (c) Spreadsheet import as connector #2

- **Fits the contract** with `delivery: upload`, no host, no credentials, no schedule. Engine steps must be optional: `openIntegration` throws `no_credentials` for null credentials (`context.ts:97`), and the tick must skip upload connectors.
- **Needs an integration row** (kind `sheet`, one per profile): `source_links` and `source_records` have FKs to `integrations` (`schema.ts:505-509,555-559`), while `Source` is `import:<profile>`.
- **Dry run** is a new engine stage (translate and diff, no apply). The same stage serves T62's "show what the next full pull will hide".
- **Completeness** is "processed + rejected equals total", not `pagesOk[]`: the engine needs `accounted == expected`.
- **Mirror mode** is "hide, never delete", but `concludeFullPull` rejects a non-finite grace period (`conclude-full-pull.ts:72`), so it needs a `neverDelete` option (P13).
- **The file** is stored as an asset, but `assets_origin` is `upload|barsy` and `inspectImage` accepts only images. A new file kind is needed.
- **Attaching rows to a till item** (Barsy article id column) is a cross-connection link; `apply()` support is for other reviewers.
- **New dependency** for XLSX/ODS parsing needs Martin's OK.

## 5. Proposed adjustments

### 5.1 Engine questions, answered

- **Scheduling:** keep `dueSyncs` (pure, DST-safe) and the one-minute tick. The unit becomes (connection, location). `capabilities.delivery` decides which loops exist. Tick cron tz becomes UTC; venue tz stays in `dueSyncs`. Connector policy supplies defaults.
- **Lock and pool cap:** merge full and incremental into one queue per connector kind with a pg-boss `group` per connection (`groupConcurrency`) and `heartbeatSeconds` for hung jobs, replacing the connection-holding advisory lock. **Inference:** group semantics are unverified, so spike first and keep the lock as fallback.
- **Error taxonomy:** kit kinds `auth | config | rate_limited(retryAfterMs) | timeout | network | server | bad_response | gone`. Engine table: auth stops and marks the connection; rate_limited backs off; timeout/server halve the page; bad_response quarantines the page.
- **Host policy, rate:** connector `policy` declares exact-or-suffix hosts, production hosts, concurrency, rps and timeout. One `CONNECTOR_ENV` and a per-kind config object replace `BARSY_*`.
- **Photos:** a generic `media-fetch` job. The connector's `AssetRequest` carries owner ref, source record hash, URL, allowed origins and auth mode (`none | connection`). The "still current" check compares the hash.
- **Versioned mapping:** `connection.mapping = {version, options}`; translate reads tier 1; a `connection-replay` job re-translates without calling the source. Replay must go through V11 and the hold setting, never silently un-hide.
- **Push:** declare `delivery: push | both`. Web receiver stores the raw body (kit HMAC scheme as data, no connector import), answers 200 after commit; worker debounces by (connection, type, id) and runs `read(mode: ids)` through the same apply path. Poll stays as reconciliation.
- **T50:** unit key `connection:location` for job key, lock and conclusion. Each link type declares scope: articles connection-wide; categories and places location-wide (external id prefixed with the location). Conclusion covers only links the unit saw.
- **Capabilities:** a typed object (menu, prices, perLocationPrices, availability, modifiers, tables, orders, payments, media, languages, delivery). The engine skips steps by it, conformance fails on undeclared output, and the worker writes it to the connection row at connect so the web reads Postgres, never the connector.
- **Discovery of kinds:** a static array (`defineConnectors([...])`), no dynamic loading. Replace the SQL CHECK with a pattern; an unknown kind in the database shows as `unsupported`.

### 5.2 Layout and registry

```
packages/connector-kit/     contract, Capabilities, ConnectorError, deriveId/describeSource, readPages, host policy, HMAC schemes, testing/ (conformance, FixtureTransport, recorder)
packages/connectors/barsy/  client, read, mapping, fixtures, testing, write/ (empty)
packages/connectors/sheet/  parser, profile, mapping
apps/worker/src/engine/     tick, sync, lock, chunk, limiter, media, runs;  apps/worker/src/connectors.ts = static registry
```

```ts
interface Connector<C, S> { kind: string; capabilities: Capabilities; policy: Policy; credentials: z.ZodType<C>
  connect(c): Promise<ConnectResult>; discover(c): Promise<Discovery>
  read(c, unit: Unit<S>, mode: 'full' | { since: string } | { ids: string[] }): AsyncIterable<RawPage>
  translate(raw: RawRecord[], ctx: TranslateCtx): Translated      // pure, deterministic
  classify(e: unknown): ErrorKind; media?(r: AssetRequest): MediaAuth; write?: Commands }
```

Worker job list with two kinds: `[heartbeat, ...publishJobs, connectionTick(connectors), connectionConnect, mediaFetch, ...connectors.flatMap(c => syncJobFor(c))]`. That is three generic jobs plus one `sync-<kind>` queue per kind, with retry and concurrency from `c.policy`, not N times every job.

Dependency rules: `connectors/*` may import only the kit, pure core and zod (not db, apps, assets, or each other); only `apps/worker` imports connectors; the web imports none. These replace `barsy-only-from-worker` and `web-no-barsy`, each with a case in `scripts/depcruise-rules.test.ts`.

### 5.3 Adjustments

| Id | What | Why | Size | Risk | Migr. | Depends | Tier | Order |
|---|---|---|---|---|---|---|---|---|
| P1 | Contract and kit (types, Capabilities, `ConnectorError`, `RawRecord`/`Translated`, move `deriveId`/`describeSource`) | F1, F9 | M | over-design; fit it to barsy plus sheet only | n | - | Opus | before |
| P2 | Extract the engine; barsy becomes `connectors/barsy`; neutral job names; plan (dry-run) hook; all existing worker tests pass unchanged | F1, F4, F10, F15 | L | rule 6 and lock regressions | y (drain queues, kind aliases) | P1 | Opus design, Sonnet moves | before |
| P3 | Raw-first store, `connection.mapping` as data, `connection-replay` | F6 | M | replay un-hides; gate with V11 | y (3 config keys) | P2 | Sonnet, Opus review | before |
| P4 | Sync unit (connection, location): location table with text id, `sync_state`, link scope, conclusion per unit (closes T50) | F3, F5, F14 | L | rule 6, schema | y | P1, T68 locations | Opus | before |
| P5 | Isolation: queue per kind, pg-boss groups, heartbeat, per-connection backoff and breaker; retire advisory lock if the spike passes | F7 | M | group semantics unverified | n | P2, P4 | Sonnet | after, before 2nd till live |
| P6 | Error and rate policy: `rate_limited`, `Retry-After`, limiter per connection from `policy` | F8, F9 | S | low | n | P1 | Sonnet | before (inside P2) |
| P7 | Generic `media-fetch`, neutral `assets.origin` plus `origin_ref` | F11 | M | touches publish | y (CHECK) | P2 | Sonnet | after, before X |
| P8 | Venue-level publish policy: `after_sync`, `auto_paused` to `venues.settings.publish`; `new_items` stays on the connection | F10, walk-through (b) | M | the Publish tab depends on it | y (copy keys) | - | Sonnet | before |
| P9 | Push seat: slot now; later inbox table, kit HMAC, `connection-process-inbox`, `read(ids)` | F12 | S now, L later | D41 bans webhooks until a test installation | y at build | P2, P4 | Opus at build | slot before, build after |
| P10 | Conformance suite ported from `tests/sync-*.test.ts`, `FixtureTransport`, generic `connector:record`, new dependency rules | F13 | M | low | n | P1 | Sonnet | before (with P2) |
| P11 | Sheet connector: slim CSV with a fixed profile first, then XLSX/ODS and profile UI | proves non-polling, credential-less source | M slim, L full | new parser dependency needs Martin's OK | y (kind) | P1-P4, P13 | Sonnet | slim before, full after |
| P12 | Hand-made tables: `places.venue_id`, nullable location | walk-through (b) | M | QR token job | y | T68 | Sonnet | before |
| P13 | `concludeFullPull` `neverDelete` (hide-only) option | spreadsheet mirror mode | S | rule 6; add a property test | n | - | Opus | before P11 |
| P14 | Open kind and credentials: CHECK to pattern, `host` nullable, per-kind credential schema, same envelope AAD | F2 | S/M | secrets | y | P1 | Sonnet, lead reviews | before |

Not to build: dynamic plugins, per-connector tables, a mapping DSL, an outbox before T29, or a webhook inbox before a connector needs it.

## 6. Keep as is

- Pure `concludeFullPull`, the `pagesOk` completeness rule, the race guard (`catalogue.ts:492`), and the "skip when incomplete" notes.
- Content-addressed source records and `deriveId`; deterministic, pure mapping with warnings instead of throwing per record.
- `dueSyncs`/`nextSyncRuns` (pure, DST-tested) and per-venue try/catch in the tick.
- Chunking invariants in `chunk.ts`, and `applyAll`'s abort checks.
- Sealed credentials bound to tenant, integration and host; opened only inside `withIntegration`; the `seal-open-only-from-worker` rule.
- `trackedRun`'s scrubbed summaries, no-retry-on-auth, and refused writes copied to `job_runs`.
- Same-origin media guard with magic-byte and size checks; host policy refusing production hosts in staging.
- Read-only client with a doc-URL allowlist; empty `write/` guarded by a test; MSW with `onUnhandledRequest: 'error'`.
- The `defineJob`/registry convention with dead-letter queues and safe error rethrow.

## 7. Open questions

1. **Unit of pull:** (connection, location) or per venue? Recommend (connection, location) with declared link scope.
2. **Lock replacement:** are pg-boss groups enough to exclude full against incremental across nodes? Recommend a one-day spike before P5; keep the advisory lock if not.
3. **Queue per kind or shared?** Recommend per kind; 3 to 5 kinds is cheap and isolates a hung connector.
4. **Publish policy home?** Recommend the venue (P8).
5. **Webhook verification placement?** Recommend the web route verifies with kit HMAC schemes declared as data, so the web imports no connector.
6. **Sheet connection granularity?** Recommend one integration row per profile, so the existing FKs and `import:<profile>` keep working.
7. **Replay trigger?** Recommend a manual button, passing V11 and `new_items = hold`; never automatic.
8. **Plan stage for T62?** Recommend yes: reuse P2's dry run for the root-change warning and the 30% hold.
9. **Mistral (T69):** reserve only the slots (push, ids, opaque cursor). Design connector #3 after its documents exist.

## 8. Rules for the future connector guide (from this area)

1. One package per kind, exporting one `Connector`; imports only the kit, pure core and its own libraries; never db, apps, or another connector.
2. Declare capabilities honestly; conformance fails on undeclared output and on a declared but unimplemented step.
3. Read-only by default; every outbound call is on an allowlist with its doc URL. Writes are commands with an idempotency key and need an allowlist entry approved by Martin.
4. Return raw records first (type, external id, scope, payload); translate is pure and deterministic from tier 1, and one bad record yields a warning or quarantine, never a throw.
5. External ids appear only in links, source records and external-id fields; node ids derive from (kind, connection, type, id) via `deriveId`.
6. Declare link scope per external type (connection-wide or location-wide).
7. Every read reports per-unit completeness; absence is concluded only from a complete read; declare how deletion is signalled.
8. Money from decimal text through the money module; state the time zone of every timestamp; cursors are opaque strings you produce.
9. Classify every failure into a kit error kind; never put URLs with queries, credentials or bodies in messages.
10. Declare concurrency, rps and timeout; honour `Retry-After`; the engine enforces them.
11. Media: return `AssetRequest`s with allowed origins and auth mode; never fetch inside translate.
12. Fixtures are recorded and redacted with `connector:record`; hand-made ones are flagged; no test touches a real network.
13. Mapping config is data with a version; bump it on any behaviour change; replay must work from tier 1.
14. Per-connection sealed secret; endpoint allowlist; staging refuses production hosts.
15. No code in a connector names another kind.

### Critical Files for Implementation
- E:\Restro\apps\worker\src\sync\catalogue.ts
- E:\Restro\apps\worker\src\jobs\barsy.ts
- E:\Restro\apps\worker\src\sync\context.ts
- E:\Restro\packages\core\src\jobs.ts
- E:\Restro\packages\barsy\src\mapping\types.ts
