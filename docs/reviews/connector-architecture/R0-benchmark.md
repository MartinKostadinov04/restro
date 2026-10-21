# R0 External benchmark: how integration platforms define connectors

## 1 Scope read

I read the public docs of Airbyte, Singer and Meltano, Merge, Codat, Chift, Deliverect, HubRise, Toast and Square. In the repo I read only `docs/architecture/data-architecture.md`, skimmed as asked. **[S]** marks what a page says. **[I]** marks my inference. **†** means I only saw a search-result summary of that page, or my direct fetch failed. Mistral has no public docs, so nothing below is about Mistral.

Airbyte, Singer and Meltano move bulk data into warehouses. The hospitality hubs and POS APIs (Deliverect, HubRise, Toast, Square) are nearest to Restro's domain, and the unified APIs (Merge, Codat, Chift) sit between. [I]

### 1.1 Recurring patterns

| Pattern | What the sources say [S] | Read-across to Restro [I] |
|---|---|---|
| **Contract operations** | Airbyte: every actor has `spec` and `check`. Sources add `discover` (a catalog of streams) and `read(config, catalog, state)`, which emits RECORD, STATE, LOG and TRACE ([protocol](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol)). Singer: a tap takes config plus optional state and emits SCHEMA, RECORD and STATE, with a separate discovery mode ([SPEC](https://raw.githubusercontent.com/singer-io/getting-started/master/docs/SPEC.md), [DISCOVERY](https://raw.githubusercontent.com/singer-io/getting-started/master/docs/DISCOVERY_MODE.md)). Deliverect: the integrator exposes register (register/active/inactive), menu, order-status, snooze and busy-mode webhooks ([channel flow](https://developers.deliverect.com/page/channel-flow)). | A small fixed verb set fits: check, discover locations, read (full or since a cursor), translate. Write is optional. |
| **Capability declaration** | Meltano: plugins declare capabilities (`catalog`, `discover`, `state`, `test`, `about`…). `state` is "required for incremental" ([syntax](https://docs.meltano.com/reference/plugin-definition-syntax)). Singer: per-stream metadata `inclusion`, `forced-replication-method`, `valid-replication-keys` ([DISCOVERY](https://raw.githubusercontent.com/singer-io/getting-started/master/docs/DISCOVERY_MODE.md)). Chift: each route is Implemented, Not supported, On request or To be analyzed, and each connector is Live or Beta ([Odoo POS page](https://docs.chift.eu/connectors/pos/odoo_pos)). Deliverect: the register reply returns only the URLs the channel supports, and empty ones are skipped † ([registration](https://developers.deliverect.com/reference/channel-registration)); snoozing is "not supported by all channels" † ([help](https://help.deliverect.com/en/articles/7979011-snooze-items-to-temporarily-remove-them-from-menus)). Square: a location carries `capabilities`, for example `CREDIT_CARD_PROCESSING` ([locations](https://developer.squareup.com/docs/locations-api)). HubRise: OAuth scopes such as `catalog.read` and `orders.write` ([guide](https://www.hubrise.com/developers/integration-guide)). Codat: a dataset status of `NotSupported` ([status](https://docs.codat.io/core-concepts/status)). | There are two levels: what the connector can do (a static manifest) and what this connection was granted (rights or scopes). "Unsupported" is a normal state, not an error. Nobody ties UI to a vendor name. |
| **Location mapping** | Chift: consumer → connection → location. In "Chift manages locations" mode, one consumer is one connection is one location. Otherwise the caller passes `location_id` ([concept](https://docs.chift.eu/unified-apis/pos/concepts/location)). Toast: a partners webhook sends `partner_added`, `partner_removed` and `partner_updated` with `restaurantGuid`, `managementGroupGuid` and an admin-entered `externalRestaurantRef` ([webhook](https://doc.toasttab.com/doc/devguide/apiPartnersWebhook.html)). Toast also says to poll the partner restaurants endpoint as a backup and to stop all calls once a location removes you ([checklist](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistGeneral.html)). Square: `ListLocations`, and it recommends letting the seller pick a location in your app ([locations](https://developer.squareup.com/docs/locations-api)). Deliverect †: `locationId` is theirs, `channelLocationId` is the merchant's id on the channel, and `channelLinkId` is generated when the channel is added to a location ([registration](https://developers.deliverect.com/reference/channel-registration)). HubRise: connect at location level; each location belongs to one account ([guide](https://www.hubrise.com/developers/integration-guide), [accounts](https://www.hubrise.com/developers/api/accounts)). | Location discovery is a first-class operation. A person (or an admin-entered ref) makes the link. Adding or removing a location is an event. Account or group above a location is optional metadata. |
| **Sync state** | Airbyte: state per stream is preferred and opaque to the platform. It is passed back only after the destination committed it. Cursors are inclusive and delivery is at-least-once ([protocol](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol), [incremental](https://docs.airbyte.com/platform/using-airbyte/core-concepts/sync-modes/incremental-append)). Incremental sync does not describe delete detection; full refresh drops deleted rows ([full refresh](https://docs.airbyte.com/platform/using-airbyte/core-concepts/sync-modes/full-refresh-overwrite)). Merge †: store the time you *started* pulling and pass it as `modified_after` ([help](https://help.merge.dev/en/articles/6188145-the-modified_after-timestamp)). Native delete detection is partial; "enhanced" detection is a full sync every 3 days ([deleted data](https://help.merge.dev/en/articles/5392795-deleted-data)). Square †: `begin_time` plus `include_deleted_objects`. The webhook body carries only a version timestamp. Store the API-returned `latest_time`, not your own clock ([sync guide](https://developer.squareup.com/docs/catalog-api/sync-with-external-system), [blog](https://developer.squareup.com/blog/new-webhook-event-for-syncing-with-square-catalog/)). Toast: a `menus` webhook plus polling `/metadata` every 30 minutes ([webhook](https://doc.toasttab.com/doc/devguide/apiMenusWebhook.html)). HubRise: catalog and inventory events carry no state, so you GET afterwards. Unacknowledged events are dropped after 6 retries ([callbacks](https://www.hubrise.com/developers/api/callbacks)). | The cursor belongs to the connector and is opaque to the platform. A webhook is a hint; you fetch afterwards, with polling as the backup. Deletes need a complete read or tombstones. Restro already does all of this for Barsy. |
| **Id mapping** | Merge †: its own immutable `id` plus `remote_id`, with remote-id uniqueness not guaranteed ([help](https://help.merge.dev/articles/6270133-the-merge-id)). Toast: GUIDs, plus partner-private external IDs `{authority}:{id}` that must be unique for orders, checks and selections ([identifiers](https://doc.toasttab.com/doc/devguide/portalToastIdentifiers.html)). HubRise: `ref` should be "unique, auto-generated, and stable" ([catalogs](https://www.hubrise.com/developers/api/catalogs)); `private_ref` is visible only to the client that set it ([concepts](https://www.hubrise.com/developers/api/general-concepts)). Square: `#` temp ids are mapped to real ids in the response ([catalog](https://developer.squareup.com/docs/catalog-api/what-it-does)). | Everyone keeps their own id plus an external-id link. External ids can be duplicated or re-issued, so link rows need state and last-seen. Restro's `source_links` already has both. |
| **Write-back** | Square: the idempotency key is "a unique string". Reusing it with a changed request errors ([idempotency](https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency)). Webhooks are retried for 24 h with no ordering guarantee. `event_id` is the dedupe key, and the Events API is for reconciling missed events ([webhooks](https://developer.squareup.com/docs/webhooks/overview)). Codat: writes are async, with statuses Pending, Success, Failed and TimedOut and a `pushOperationKey`. A timed-out write "may still change data" ([push](https://docs.codat.io/using-the-api/push)). Codat †: `Idempotency-Key` GUID, 90-minute cache, 422 on a different body, 409 while in progress ([idempotency](https://docs.codat.io/using-the-api/write-data/idempotency)). HubRise: order status goes new → received → accepted…; alert if an order stays `new` about 5 minutes; `ref` uniqueness is not enforced and duplicate behaviour is undocumented ([guide](https://www.hubrise.com/developers/integration-guide), [orders](https://www.hubrise.com/developers/api/orders)). Deliverect: cancel reuses the original `channelOrderId`; the page states no retry or idempotency rules ([flow](https://developers.deliverect.com/page/channel-flow)). Toast †: call `/prices` before `POST /orders`; a mismatch is left to staff ([creating orders](https://doc.toasttab.com/doc/devguide/apiCreatingOrders.html)). | The platform needs its own idempotency key, an outbox, a status callback or poll, an explicit "unknown outcome" state, and reconciliation. Vendors differ widely, so this is per connector. |
| **Testing / certification** | Airbyte acceptance tests: spec, connection, discovery, basic_read, full_refresh and incremental. Incremental covers resume from state, sampled slices and a far-future state returning nothing. Fixtures are config, configured catalog, `expected_records.jsonl` and `abnormal_state`. Strictness is low or high ([CAT](https://docs.airbyte.com/platform/connector-development/testing-connectors/connector-acceptance-tests-reference)). Meltano SDK †: `get_tap_test_class` plus `SuiteConfig` ([testing](https://sdk.meltano.com/en/main/testing.html)). Toast: formal application and certification † ([overview](https://doc.toasttab.com/doc/devguide/apiPartnerIntegrationOverview.html)). HubRise: free test orders and a log review, with no formal gate ([guide](https://www.hubrise.com/developers/integration-guide)). | A shared suite plus recorded fixtures scales down to 3–5 connectors. Human certification programmes do not. |
| **Extras / passthrough** | Merge: `remote_data`, raw and unnormalised, plus authenticated passthrough ([remote data](https://docs.merge.dev/merge-unified/supplemental-data/remote-data)). Chift: a header that adds `raw_data`, plus a `forward` route ([raw data](https://docs.chift.eu/developer-guides/unified-api/raw-data)). HubRise: `custom_fields`, 8 KB, no namespacing documented ([extensions](https://www.hubrise.com/developers/api/extensions)). | Keep a raw copy plus a small extras bag, and do not widen the core model for one source. |

### 1.2 How connector-developer guides are structured [S]

| Guide | Sections |
|---|---|
| Airbyte ([best practices](https://docs.airbyte.com/platform/connector-development/best-practices)) | Principles (reliability first, fail fast, fail actionably) → integration-testing checklist → check-connection checklist → rate-limiting checklist → maintenance. It also says to log at least every 5 minutes. |
| Toast ([checklist](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistGeneral.html)) | Initial setup → authentication → restaurant connections → rate limits → error management → integration documentation. |
| HubRise ([guide](https://www.hubrise.com/developers/integration-guide)) | Overview → general best practices → checklist for ordering apps → checklist for EPOS. |
| Deliverect † ([POS guide](https://developers.deliverect.com/docs/building-a-pos-integration)) | Numbered build order: registration → product sync → orders → status. |

Common shape [I]: principles → connection and locations → read → write → errors and limits → test checklist → go-live → maintenance.

## 2 Scorecard
n/a

## 3 Findings
n/a

## 4 Walk-throughs
n/a

## 5 Proposed adjustments

Each adjustment is anchored to the patterns in 1.1 and is [I].

1. **Make the connection an organisation-owned object, and let venues exist without one.**
   - Rename `integrations` to `connections`. Each has a connector type, a secret reference, a status, a schedule, cursors per location and scope, and a private `state jsonb`. `pos_key` moves into that state.
   - Replace `venues.bid` with `venue_source_links(venue, connection, external_location_id, confirmed_by)`. A no-till venue (D64) simply has zero rows.
   - Anchors: Chift, Toast, Square.
2. **Use neutral vocabulary.** Write the source as `connector:<connection_id>`, `owner: source | builder`, and layer classes `till`, `import`, `manual`, `override`, `edition`. The combinators (`source_first`, `locked`) are already neutral.
3. **Add a connector manifest plus granted capabilities, and drive the UI from them.**
   - `orderable` should require the `orders_write` capability as granted, plus a link and a price.
   - A no-till venue has an empty capability set. The editor then hides "Link to POS item", `orderable` is false, and sold-out works through the edition layer only.
4. **Extract one sync-engine spec from paths C to E.**
   - Engine primitives: job, lock per connection, location and scope, cursor commit only after success, a `complete` flag as the only licence to infer deletions, backoff by error kind, and a health state.
   - Barsy's numbers (30 s, two concurrent requests, page halving) become Barsy manifest values.
5. **Make quarantine an explicit stage.** `translate()` returns writes or a `Quarantine {reason, field}` tied to the `source_record` id, so a mapping fix can replay it. This extends the rejected-rows rule in `apply()` step 1.
6. **Add an adapter conformance suite on recorded fixtures only**, adapted from Airbyte's acceptance tests. Seven tests per connector:
   - Check with good and bad credentials.
   - Stable location ids across two calls.
   - Two full reads give hash-identical records.
   - Resuming from a checkpoint yields nothing, or only records at or after the cursor.
   - A far-future cursor yields nothing.
   - Golden change sets for the recorded records.
   - An injected page failure gives `complete=false`, and the engine hides nothing.
7. **Generalise `outbox` to `commands`.** Keep our id as the idempotency key and add an `unknown_reconcile` state (Codat's TimedOut warning). Barsy's `account.uuid` becomes just the Barsy mapping of our key.
8. **Use one generic webhook route per connection**, `hooks/<connection_id>`. The connector verifies the request and returns hints plus a dedupe key (Barsy `X-Webhook-ID`, Square `event_id`). The engine owns the inbox.
9. **Add an `extras jsonb` bag** on translated writes for source quirks.
10. **Treat the spreadsheet import as a degenerate connector, as an option only.**
    - Connect means the file is accepted. There is no location discovery. A read is full only, and `complete` is true when the whole file parsed.
    - The manual editor stays outside the contract.
    - The contract sketch is in Appendix A.

## 6 Keep as is

These already match the benchmark [I]:
- Tier-1 raw `source_records` with hashes, and replay on a mapping change.
- The single `apply()` write path.
- Field-level provenance with `mapping_version`.
- `source_links` keyed (integration, external_type, external_id), with its lifecycle states.
- "Deletion only after a complete pull", and cursors that advance only after success.
- The inbox with a unique id, acknowledging only after a durable insert.
- External ids never reaching snapshots.
- The V11 mass-change guard.
- A server-generated order uuid with an outbox.
- Person-confirmed matching, and "sync never writes into the till".

## 7 Open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | Can a venue have two live tills? | Allow at most one authority (`till`) connection per venue in v1. Allow any number of import and manual sources. |
| 2 | Connection per organisation or per venue? | Per organisation. Locations then map to venues, as Chift and Toast do. |
| 3 | Are capabilities static or discovered? | Both. The manifest says what the connector can do, and `connect()` returns what this connection was granted. HubRise scopes and Square location capabilities are the precedent. |
| 4 | How do we prepare for Mistral without docs? | Do not pre-design. Validate the contract on Barsy, the file import and a fake in-memory connector. Mistral is the first real test, and every operation except `connect` and `read` stays optional. |
| 5 | What if a source cannot signal deletion? | Add a `delete_signal` capability of full_read, tombstones or none. With none, never auto-hide; open a review item. Merge's native vs enhanced detection shows this gap is common †. |
| 6 | What happens when a location is removed at the source (Toast `partner_removed`)? | Set the connection or location to degraded, keep serving the last snapshot, and force `orderable=false`. |
| 7 | Where do rate limits live? | In the manifest as defaults, with a per-connection override. Default concurrency is 2. |
| 8 | Should the suite hit live sandboxes? | No. Use recorded fixtures only, with a manual live check before onboarding a venue. |

## 8 Rules for the future connector guide

Suggested guide outline: principles → manifest → connect and locations → read → translate and quarantine → webhooks → write → errors and limits → tests and fixtures → go-live checklist → maintenance.

1. Fail fast and fail actionably: `connect()` checks permissions, and `userMessage` says what to fix.
2. Source ids never leave the connector except into `source_links`.
3. The cursor is opaque. Advance it only after a complete run. Prefer source-supplied times over the local clock. Overlap and unchanged hashes make re-reads free.
4. `complete=true` is the only licence to infer a deletion.
5. `translate` is pure. Unknown units or allergens go to quarantine, never guessed.
6. A webhook is a hint: verify it, dedupe it, acknowledge only after a durable insert, and fetch the data afterwards.
7. Every write carries our idempotency key. An unknown outcome means reconcile, never a blind retry under a new key.
8. Declare capabilities honestly. Unsupported means absent, not stubbed.
9. Classify errors (auth, config, rate-limited, transient, source-changed). Emit a heartbeat on long reads.
10. Keep redacted recorded fixtures and golden change sets, and pass the conformance suite.
11. Quirks go in raw and extras. Never widen the core model for one source.
12. Secrets are per connection and never logged.

## Appendix A: Restro connector contract v1 (sketch)

```ts
// Engine owns: schedule, locks, cursors, retries, raw storage, apply(), health (ok|degraded|auth_error|paused).
type Cap = 'locations'|'menu'|'prices'|'availability'|'tables'|'orders_write'|'payments'
         |'since_cursor'|'push_hints'|'delete_signal'          // delete_signal: full_read | tombstones | none
type Manifest = { id:string; version:string; caps:Cap[]; mappingVersion:number;
                  limits?:{maxConcurrent:number; pageSize:number}; configSchema:JsonSchema }
type Fail = { kind:'auth'|'config'|'rate_limited'|'transient'|'source_changed'|'unsupported';
              retryAfterMs?:number; userMessage:string }
type ReadEvent =
  | { record:{ type:string; externalId:string; raw:unknown; fetchedAt:string } }
  | { gone:{ type:string; externalId:string } }               // tombstone, only if the source sends one
  | { checkpoint:string }                                     // opaque; engine commits after a good run
  | { done:{ complete:boolean } }                             // false => engine never infers deletions
interface Connector {
  manifest: Manifest
  connect(cfg:Json, secret:Secret): Promise<Ok<{ label:string; granted:Cap[] }> | Fail>
  discoverLocations(c:Conn): Promise<Ok<{ externalId:string; name:string; tz:string; currency:string; active:boolean }[]> | Fail>
  read(c:Conn, loc:string, scope:'menu'|'tables'|'availability', from:'full'|{ cursor:string }): AsyncIterable<ReadEvent>
  translate(r:SourceRecord, ctx:{ mappingVersion:number }): Writes | Quarantine   // pure; Writes may carry extras
  verifyHook?(req:RawRequest, secret:Secret): { ok:boolean; dedupeKey:string; hints:{ type:string; externalId?:string }[] }
  write?: { send(cmd:Command, c:Conn): Promise<{ state:'accepted'|'unknown'; ref?:string } | Fail>
            status(cmd:Command, c:Conn): Promise<CommandState>; cancel?(cmd:Command, c:Conn): Promise<Fail|void> }
}
type Command = { id:Uuid /* our idempotency key */; kind:'place_order'|'cancel_order'|'set_availability'; venueId:string; payload:Json }
type CommandState = 'pending'|'accepted'|'rejected'|'failed'|'unknown_reconcile'|'done'
```

The sketch has 28 lines. A spreadsheet connector declares only `menu` and `prices`. A no-till venue has no connection at all.

## Appendix B: Deliberately not copied (it only pays off at hundreds of connectors)

- **Airbyte:**
  - Docker image per connector, the stdout JSON protocol, and socket mode with protobuf.
  - GLOBAL and LEGACY state types.
  - Destination sync modes (append, dedup, overwrite).
  - User-selectable streams and fields.
  - The declarative YAML CDK and Connector Builder.
  - Support tiers (Airbyte, Enterprise, Marketplace, Custom).
- **Singer / Meltano:**
  - Per-stream JSON-schema discovery and stream maps.
  - `ACTIVATE_VERSION` (our snapshots cover it).
  - Hub, lockfiles, plugin inheritance and variants.
- **Unified APIs:**
  - Customer-facing field-mapping UIs with JSONata (Merge).
  - Live passthrough and raw-data headers as product features (our raw tier and extras are enough).
  - A paid "enhanced delete detection" tier.
  - Chift's pre-built sync flows and per-connection billing.
- **Hospitality hubs:**
  - Hosting registration webhooks for third-party partners (we call vendors; we are not a hub).
  - Deliverect's busy mode, courier, prep-time and per-channel scopes.
  - HubRise's active and passive callback duality and multi-client private refs.
- **POS APIs:**
  - Toast's partner certification, IP allowlisting and scope-by-certification.
  - Square's version-stamped three-way merge (only needed if catalogs are ever written back).
- **Platform machinery:** distributed token buckets and a connector marketplace. A per-connection concurrency of 2 and a manifest is enough.

Caveat on sources: several Deliverect, Merge, Codat and Toast points (marked †) come from search summaries, not full pages. Deliverect's channel-integration-overview and FAQ pages returned 404 to my fetch. Square forum posts report webhook and `begin_time` anomalies that I did not verify, so test those against a sandbox before relying on them.

---
*Lead's note (10-11):* R0 read only the architecture doc, not the code. Its "`venues.bid`" and "rename `integrations` to `connections`" reflect the doc, not the schema: the mapping lives in `barsy_venues`, and A1 recommends keeping the `integrations` table name with "connection" as UI wording only. Reconciled in `readiness.md`.
