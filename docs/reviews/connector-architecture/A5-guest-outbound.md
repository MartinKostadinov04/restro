# A5: Guest side and outbound, readiness for a multi-connector architecture

Reviewer A5 · read-only · 2026-10-11 · paths relative to `E:\Restro`. **Fact** = seen in code or docs; **Inference** = my reading. Nothing was run or written, and no `.env*` was opened. Barsy behaviour appears only where the repo docs state it, marked "repo doc". Severity note: no finding blocks a second read-only till. "Blocker (ordering)" means it blocks the first order of any connector.

## 1. Scope read

- **Docs:** CLAUDE.md; tracker D12, D18, D19, D27, D29, D33, D38–D65, P43, T29, T47–T69. Data-architecture sections "Publishing…", "The visualization shell", "Outbound", "Failure modes". `stack.md` (jobs, repo, health). `docs/guides/shell-handoff/visualization-shell.md`. A1, A2, A3, R0.
- **Code read in full:**
  - `core/src/snapshot/*` (no tests), `core/src/guest-files.ts`.
  - `shell/src/{build,context,view-model}.ts`, `faces/qr-phone/src/manifest.ts`.
  - `web/app/{m,t,cdn}`, `web/src/guest/{load,context,cdn,guest-menu}`, `web/src/server/publish/table-token.ts`.
  - `worker/src/publish/{after-sync,files,rollover,table-tokens}.ts`, `barsy/src/write/*`.
- **Read in part:** `core/apply/{publish,tables}.ts`, `resolve/resolve.ts:56-141,677-726`, `core/jobs.ts`, `.dependency-cruiser.cjs`, `web/proxy.ts`, `db/table-access.ts`, `shell/testing/contract.ts`, `worker/jobs/publish.ts`.
- **Vendor words (Fact):** "barsy" appears 6 times in non-test code of the published surface (snapshot, shell, face, guest routes). All 6 are comments and none is code. In `worker/src/publish` all 5 hits are in `after-sync.ts`, and 4 of those are code lines.

## 2. Scorecard

| Part | Rating | Evidence |
|---|---|---|
| 1 Own model | 3 menu · 0 order | Strict, source-free shapes (`snapshot/schema.ts:203-217`). No order shape. `orderable` names no route. |
| 2 Connector plug | 0 (by design) | Publishing imports no connector (`.dependency-cruiser.cjs:37`). The write seat is empty and test-guarded (`barsy/src/write/index.test.ts`). No `write?` contract. |
| 3 Stages | n/a | Publish is the last stage: immutable snapshot, hash, rollback pointer (`apply/publish.ts:653`). |
| 4 Own ids | 4 snapshot, 3 table files | Strict schema + leak guard fed from all `source_links` (`publish.ts:544-554`) + property test (`snapshot/properties.test.ts:233`) + face markup test (`shell/testing/contract.ts:67,182`). Table label is not guarded (F7). |
| 5 Connections ↔ venues | 2 | Files need no connection (`files.ts:142-192`). Publish policy and pause are read via `barsy_venues` → `integrations` (`after-sync.ts:113-128`). |
| 6 Sync engine | 3 (publish jobs) | `stately` keys, repair tick (`rollover.ts`). |
| 7 Write-back | 0 | Expected before Stage 4. |
| 8 Contracts and tests | 4 faces · 1 evolution | Contract harness, JSON Schema export (`schema.ts:395`), frozen real demo snapshot. No version negotiation; strict re-parse (F2). |
| Tenancy | open gap | The public read path needs none (`.dependency-cruiser.cjs:157`). The order path has no tenant entry (F3). |
| UI by capability | clean | Shell and face never test a source. Admin side is A4's. |

## 3. Findings

### 3.1 Task 1: does a published field silently assume barsy?

| Field | Meaning today | Barsy assumption | Verdict |
|---|---|---|---|
| `price`, `price_from`, `price_delta` | Integer minor units + currency (`schema.ts:166-167,193`) | None in the shape. The producer fills it from the locked till price (`resolve.ts:696-704`). | neutral |
| `modifier_groups`, `options` | ids, `min`/`max` (`:184-194`) | None | neutral |
| `badges`, `tags`, `dietary`, `allergens` | `new` from our `item_first_published`; ids from our vocabulary | None | neutral |
| `order_mode` | Owner intent `orderable \| ask_waiter` (D29) | None | neutral |
| `orderable` | Boolean (`:179`) | **Producer:** active barsy `article` link, barsy-priced here, barsy `for_sale` (`resolve.ts:56,131-137,705-711`). **Meaning:** "orderable by the one route that exists", with no route and no health. | shape neutral, derivation barsy-bound (A1), meaning incomplete |
| Sold out (`availability.state`, `live.json`) | `for_sale === false` (`build.ts:275`, `overlay.ts:24`) | A connector with no availability flag never writes `for_sale`, so its items are never orderable (tracker: "missing for_sale = not orderable"). | neutral, needs a capability default (A1) |
| Table context | `?t=` → `t/<token>.json` `{venue_slug, table_label}` (`guest-files.ts:42-49`) | Label falls back to the source's `placeNum` (`qr.ts:215-224`). Token checked by shape only (`guest/context.ts:61-65`). | neutral, two gaps (F5, F7) |
| `locales`, `currency` | Closed enums of barsy's 11 language keys, EUR | Barsy's set | minor, A1-F12/F14 |

### 3.2 Findings

| Id | Severity | F/I | Where | Why it matters |
|---|---|---|---|---|
| A5-F1 | blocker (ordering) | Fact | `schema.ts:178-179,353-355`; `overlay.ts:15-27`; `guest/context.ts:78`; `shell/context.ts:68-69` | Transient order availability has no home. `orderable` is baked into an immutable, hashed snapshot that publishes by policy (manual, 30 s merge, V11 hold; `publish.ts:653-660`). `live.json` carries only `sold_out`. The manager's menu-only switch and the health breaker (stack.md:120,164) cannot wait for a publish. `orderingEnabled` is hard-coded `false`, so the host has no source for it. |
| A5-F2 | blocker (ordering) | Fact | `schema.ts:380-383`; `load.ts:215`; `publish.ts:251-253` | Strict parsing plus silent fallback makes additions unsafe. A new key in `live.json` fails an old client's parse, and `loadMenu` turns that into "no overlay": sold-out marks vanish, the less cautious error. Stored snapshots are re-parsed with the current strict schema on every load, so a new *required* field breaks rollback, history and `writePublishFiles`. |
| A5-F3 | blocker (ordering) | Fact + Inference | `db/index.ts:61-69`; `schema.ts:806`; `guest-files.ts:34-49` | An anonymous guest request cannot reach its tenant. Order tables will be RLS tenant tables. `withSystem` sees none of them. `places.qr_token` is globally unique but behind RLS. Neither `t/<token>.json` nor `v/<slug>.json` names a tenant. **Inference:** the order route needs one deliberate, narrow seam. |
| A5-F4 | significant | Fact | `after-sync.ts:20,113-128,146,155`; `web/server/publish/load.ts:392-403`, `service.ts:186-193` | The only barsy-shaped code in scope. Policy and pause are read through `barsy_venues`; the origin literal is `'barsy'`. For X this is the wrong join. A venue with no connection gets "paused = false" and no auto-publish. |
| A5-F5 | significant (Stage 4) | Fact | `guest/context.ts:61-65`; `guest-menu.tsx:114-127,214`; `build.ts:404-408`; `next.config.ts` (no headers) | The table token is the only access control (D27). The shell gets any well-formed `?t=` although R11 says "valid". The label lookup that would prove it is cosmetic. The token sits in the URL and reaches the CDN as `Referer` once photos load from another origin, because no `Referrer-Policy` is set. |
| A5-F6 | minor | Fact | `shell/build.ts:284-292` | R11 gap: an available item with `order_mode: orderable` but `orderable: false` shows neither a control nor a hint. In a part-linked or no-till menu with ordering on, half the menu looks broken. |
| A5-F7 | minor | Fact | `qr.ts:215-224`; `tables.ts:186-194`; `table-tokens.ts:52-61` | `t/<token>.json` is outside the leak guard, and its label can be raw source text. `loadTokenFiles` joins `barsy_venues`, so a no-till venue publishes no table files (A2-F2). |
| A5-F8 | minor | Fact | `data-architecture.md:729-741`; `stack.md:83,101`; `visualization-shell.md:7,46,81,102` | Docs speak barsy where the contract must be neutral. "Outbound" names `Accounts_place`, `place_id` and `pos_key`. `stack.md` lists `pos_registrations.venue_id`. The face-author guide still names the `import` layer and "barsy POS" as the source. |
| A5-F9 | minor | Fact | `shell/testing/contract.ts:67`; `snapshot/*.test.ts` | No test fails when a vendor word enters a published path. The face harness allows `nd`, `as`, `tg` ids only, so it needs `od` for order status. The tests build items with `barsyItem` (A1-F13). |

## 4. Walk-throughs

**(a) Second till "X".** Files in scope that change:

| For | File | Change |
|---|---|---|
| Read (menu, locations, categories, modifiers, per-location prices, availability, tables) | `worker/src/publish/after-sync.ts` | The one change (F4). Adjacent: `web/server/publish/{load,service}.ts`. |
| | `core/apply/tables.ts:186-194`, called by `table-tokens.ts` | Join by `places.venue_id` (A2-P4). |
| Webhooks | none | Bursts merge in the existing 30 s auto-publish window and V11 still gates. |
| Orders (Stage 4, any till) | `snapshot/{schema,overlay}.ts`, `worker/publish/{files,rollover}.ts` | `live.json` ordering block. |
| | `shell/src/{context,build,view-model,strings}.ts`, `shell/testing/{contract,fixtures}.ts` | R11, the view model, id kind `od`. |
| | `qr-phone/src/{manifest,item-card,face}.tsx` | Cart UI. Needs the D63 discussion first. |
| | `web/src/guest/{context,load,guest-menu}`, new `order-client.ts`, new `app/api/guest/*` | Guest order client and routes. |
| | new `connectors/x/write` | Stays beside `barsy/src/write`, which remains empty. |

None of the order-side files names X. Only `connectors/x/write` and its fixtures depend on X.

**Unchanged for X:** `snapshot/{build,leak-guard,errors}.ts`, `guest-files.ts`, `files.ts` (except `live.json`), `variants.ts`, `app/{m,t,cdn}`, `table-token.ts`, `cdn.ts`.

**(b) Venue with no till.**
- **Works (Fact):** manual publish, sold-out tonight, the `live.json` rollover (source-free), the guest page.
- **Broken:** table files (F7), auto-publish policy and the pause (F4). Ordering is off on purpose (A1-Q4).
- **For D12 it needs:** route `own`, the internal writer, a waiter view over `orders`, hand-made `places` with `venue_id` (A2-P4), and the tenant seam (F3).

## 5. Proposed adjustments

**Alignment.**
- **A1:** I agree the route goes in the resolve context. I make it `none | till | own` with `none` as the default, and static only. Health must never enter it, or a connection flap would re-hash snapshots.
- **A2:** I agree on `commands`. I add `orders`, `order_lines`, `command_attempts`, `places unique(tenant_id, id)` and the tenant seam.
- **A3:** I agree `write?` is optional. The queue isolation in A3-F7 applies to the command engine.
- **R0:** Our id as the key, and the state list, are right. **One disagreement:** R0 would make `orderable` require the *granted* `orders_write` capability. I would put granted capability only into the live `ordering.state`, so a reconnect never re-hashes the snapshot.

### 5.1 Stage 4 design (connector-neutral; no barsy calls)

**Principle.** An order is our business object. A command is one delivery of it to a writer. Payment (Stage 5) sits between them.

**Flow.**
1. **Guest request.** `POST /api/guest/orders` carries `{venue_slug, table_token, client_ref, snapshot_version, lang, lines:[{node_id, qty, option_ids}]}`. It carries no prices (repo doc, Outbound step 1). The tenant comes from the seam (P6).
2. **`placeOrder()`** lives in `core/apply/orders.ts`. This is the only legal door, since only `core/apply` may import the db write side (`.dependency-cruiser.cjs:74`); `tables.ts` is the precedent.
   - It resolves the token to a `places` row (`tb_`, must be `active`) and re-resolves the current menu.
   - It checks each line: orderable now, group `min`/`max`, quantity cap, `ordering.state` on.
   - One transaction stores `orders` and `order_lines` (`nd_` ids, price shown in minor units, `snapshot_id`, `service_date` via `serviceDate()`) and one `commands` row.
   - `commands.id` (`cm_`) is the idempotency key. `client_ref` is only a double-tap guard.
3. **Nudge.** The web calls `enqueueJob('command-send')` after commit. A one-minute `command-tick` repairs lost nudges and expired leases, the same pattern as `publish-live-tick`.
4. **Send.**
   - The worker leases the row (`pending` → `sending`).
   - A core reader maps `nd_` to the active till link and `tb_` to the place and location refs at send time. A missing or deleted link means `rejected`.
   - `toRequest` (pure) and `send` run, and an append-only `command_attempts` row stores a safe summary only.
5. **Status.** `command-reconcile` calls `status()`. A webhook later only nudges that same call (D41: poll first).
6. **Guest polling.** `GET /api/guest/orders/<od_>` needs the `od_` id plus the table token. Its response schema is strict and holds no external ids.
7. **Breaker.** K consecutive `failed` or `unknown_reconcile` results, or an age over 60 s, pause the venue. That feeds `publish-live` and the Telegram alert (stack.md:164).

```ts
interface OrderWriter {   // optional part of a connector
  caps: { orders: 'place' | 'place_cancel'; dedupe: 'key' | 'lookup' | 'none'; status: 'poll' | 'push' }
  toRequest(cmd: Command, t: Targets): Request          // pure, golden-tested
  send(cmd: Command, c: Conn): Promise<Sent | Fail>     // Fail: rejected | not_delivered | unknown
  status(cmd: Command, c: Conn): Promise<CommandState>  // by our key or the source ref
  cancel?(cmd: Command, c: Conn): Promise<Fail | void> }
```

**Command states.**

| State | Meaning | Exits |
|---|---|---|
| pending | stored, not sent | sending |
| sending | lease held (`lease_until`) | accepted, rejected, failed, unknown_reconcile. An expired lease becomes `unknown_reconcile`, never `pending`. |
| accepted | definite yes + source ref | done |
| unknown_reconcile | ambiguous (timeout, crash mid-send) | `status()` by our key. Resend under the **same** key only if `dedupe: key`. Staff alert at 60 s. |
| rejected | definite no | terminal; guest sees "ask your waiter" |
| failed | provably not delivered after the backoff cap (refused, DNS, 401/403/429) | terminal; staff alert; can trip the breaker |
| done, cancelled | confirmed, or withdrawn before send | terminal |

**Guest view of an order.** `received` (pending/sending), `sent` (accepted/done), `problem` (rejected, failed, or unknown past 60 s). A problem shows "We couldn't confirm your order. Please ask your waiter" with a short reference. The order also appears in the admin's orphaned-orders list (stack.md:164).

**Capabilities.** A static manifest, narrowed by what `connect()` granted (R0).

| Flag | Drives |
|---|---|
| `orders: none \| place \| place_cancel` | Whether a route is allowed; the admin Ordering card; `ordering.state` |
| `dedupe: key \| lookup \| none` | Whether a resend is allowed |
| `status: poll \| push \| none` | Reconcile schedule |
| `payments: none \| link` | Stage 5 |
| `requires_registration` | An onboarding step. The POS key is connector-private connection state, not a `pos_registrations` table. |
| write mode `off \| test \| live` (per connection, default `off`) | D33 and rule 7: `live` only by Martin's explicit action |

**Barsy mapping (repo doc, `data-architecture.md:735-738`).** `account.uuid` is our server-generated id, a second account with that `uuid` is refused, and account webhooks are types 2 and 5.

**Table context.** `tb_` enters only at step 2, from the token. It is stored as `orders.place_id` with the composite foreign key `(tenant_id, place_id)`. The command carries `tb_`, and the writer maps it at send time. The token is never stored on the order, because "New code" retires tokens (`tables.ts` header).

**Venues without a till (D12).** `writer = 'internal'` with `connection_id` null. `send` makes the order visible in the waiter view. `status` is the waiter's own actions. Same lifecycle, no network, and it runs without seal keys.

**Payment (Stage 5).** The order waits in `awaiting_payment` and the command is created on `paid` (P42, recommended). The outbox knows nothing about payment.

**Snapshot and shell, without breaking `menu-snapshot/1`.**
- **Snapshot:** no change. `orderable` is documented as "orderable by the venue's route as of publish".
- **`live.json`:** gains an optional `ordering` block. It carries only `on | paused`; internal reasons stay in the admin, because a public reason string could name a vendor.
- **Fail-closed asymmetry:** `sold_out` is a caution, so absence is harmless. `ordering` is a permission, so absence means no controls. State this explicitly. The server re-checks at order time, so a stale CDN copy costs one refused order.
- **Shell:** controls need `ctx.orderingEnabled` ∧ `overlay.ordering.state === 'on'` ∧ an interactive channel ∧ a confirmed token. The view model gets `ordering.state` and a `notice`, additively, so Martin's external shell (D63) keeps working.
- **No per-display-channel reasons yet.** One venue-level state is enough until a second interactive channel exists (D38).

```json
{ "version": 128, "items": { "nd_…": { "sold_out": true } },
  "ordering": { "state": "on" } }
```

### 5.2 Adjustments

| Id | What | Why | Size | Risk | Migr. | Depends | Tier | When |
|---|---|---|---|---|---|---|---|---|
| A5-P1 | `LiveOverlaySchema` ignores unknown top-level keys (`z.looseObject`); `items` values stay strict. Test that an old-shape parser accepts a newer file. Write the "parser first, producer second" rule. | F2 | S | low | n | none | Haiku | Before |
| A5-P2 | Evolution rule: inside `/1`, new fields are optional forever (as tag `color`, `schema.ts:201`). A breaking change is `/2` via a union on the `schema` literal in `parseSnapshot` (`errors.ts:66`), parsed by `withBody` too. Keep the real demo snapshot as a frozen `/1` corpus test. | F2 | S rule, M union | low | n | P1 | Sonnet | Rule before; union with T63 |
| A5-P3 | `Referrer-Policy: no-referrer` on `/m/*` and `/t/*` (`next.config.ts` headers). The host passes `tableToken` to the shell only after `loadTableLabel` confirmed it. | F5 | S | low | n | none | Haiku | Before |
| A5-P4 | Pure `orderingStatus({route, enabled, managerPause, breaker, health, caps})` in core. `venues.settings.ordering = {route, enabled}`. Two typed columns for the machine-set pause. `buildLiveOverlay` adds the block; `queueLiveRollovers` also asks on a state change. Fast-check: removing any input never turns controls on. Go-live is one manager action: manual publish plus `enabled`. | F1 | M | medium: new safety state | y (small) | A2-P6, P1 | Sonnet, Opus review | Stage 4, first slice |
| A5-P5 | Shell and view model as above. R11 change: an available non-orderable item shows `askWaiter` while ordering is active. BG/EN strings; additive `qr-phone` manifest 1.1.0; property test. | F1, F6 | S–M | low | n | P4 | Sonnet | Stage 4. The UX needs Martin (D63). |
| A5-P6 | Tenant seam: `SECURITY DEFINER` function `restro.guest_table_by_token(text)` returning `(tenant_id, venue_id, place_id, state)`. `EXECUTE` is granted to `restro_app` in `scripts/roles.ts`. The `rls-guard` and `app-role` tests pin it as the only granted routine. | F3 | M | high (tenancy) | y | none | Opus | Stage 4, first |
| A5-P7 | `orders`, `order_lines`, `commands`, `command_attempts`; id kinds `od`, `cm`. RLS, composite foreign keys, `TABLE_ACCESS`. Writers `placeOrder`, `leaseCommand`, `recordOutcome` in `core/apply/orders.ts`. Transitions are a pure table with property tests: no exit from a terminal state, and an expired lease never returns to `pending`. | F1, F3 | L | high (money path) | y | A2-P4, P6 | Opus | Stage 4 |
| A5-P8 | Worker engine: `command-send` (`stately`, key = command id), `command-tick`, `command-reconcile`. Own queues and concurrency, never behind a pull lock (A3-F7, `pull-lock.ts:36`). The breaker feeds P4. Reuse `defineJob` (`jobs/types.ts:87`), `prepareJob`, `trackedRun` (`sync/run.ts:55`). | A3-F7 | M–L | medium | n | A3-P2, P7 | Opus design, Sonnet build | Stage 4 |
| A5-P9 | Writer contract and conformance suite. In-memory writer first (D39 mock). Suite: same key twice gives one effect; a timeout gives `unknown_reconcile`; commands and attempts hold no external id; export list equals allowlist (generalise `barsy/src/write/index.test.ts`). The barsy writer comes last, on the test installation only (D33), with its allowlist entry recorded by Martin. | parts 7–8 | M | medium | n | A3-P1, A3-P10, P7 | Sonnet, Opus review | Stage 4 |
| A5-P10 | Guest order API and client. Strict Zod both ways. Limits per token and IP (Cloudflare, stack.md:38). The client only `fetch`es from `web/src/guest/order-client.ts`. Add `od` to the harness id kinds. Walk every response against the forbidden-values set. | F9 | M | medium | n | P6, P7 | Sonnet | Stage 4 |
| A5-P11 | Internal writer and waiter view over `orders`. | D12 | S–M | low | n | P7, P9, A2-P4 | Sonnet | After Stage 4 |
| A5-P12 | `after-sync.ts` and the two web joins read policy from the venue; origin `'connector'`. `loadTokenFiles` by `places.venue_id`. Table label from a connector `display_name`, run through the guard. | F4, F7 | S–M | low | y (with A2) | A2-P4, A2-P6, A1-P9 | Sonnet | Before |
| A5-P13 | Vendor-word test (`barsy\|mistral\|lukanet` in code, not comments) over the published paths and `worker/publish`. At Stage 4, add dependency rules: connector writers only from `apps/worker`; guest code never imports `core/apply/orders`. Pin both in `scripts/depcruise-rules.test.ts`. | F9 | S | low | n | P12 | Haiku | Test before; rules at Stage 4 |
| A5-P14 | Rewrite "Outbound" as the neutral command contract (states, capabilities, our-id key), with the barsy mapping as an appendix. `stack.md`: registration state is connector-private. Hand-off guide: "the venue's till" and the D65 layer list. This is the T29 skeleton. | F8 | S | none | n | none | Sonnet, lead reviews | Before |

## 6. Keep as is

- **Strict allowlist schema plus the leak guard.** It collects every `source_links` external id whatever the source, and the error paths are redacted (`errors.ts:41-63`).
- **The rule-3 and rule-5 property tests** (`snapshot/properties.test.ts`) and the shell's "overlay only adds caution" property (`shell/src/properties.test.ts:184`).
- **The pure shell (R14), the view-model boundary, and the face contract harness with its markup id check.** The external shell depends on these.
- **Rule 4, enforced by `guest-page-reads-published-files-only`.**
- **Immutable snapshots, hash, and pointer rollback.**
- **The 15 s `live.json` path:** `publish-live` is `stately` with retries, `publish-live-tick` repairs it, and it is registered without seal keys.
- **The empty barsy write allowlist with its test.** Generalise it; do not weaken it.
- **Table tokens that are random, opaque, and published only by the worker job.**
- **`serviceDate()`.** Reuse it for orders and tabs.

## 7. Open questions

1. **One `place_order` per order, or append to an open account?** Recommend one per order (P41). Rounds become new orders, and the key stays trivial.
2. **Create the command at placement or after payment?** Recommend the order state decides. Stage 4 releases at once (mock); Stage 5 releases on `paid` (P42).
3. **Tenant seam: function, directory table, or tenant in the token?** Recommend the function. It duplicates no data, grants one routine, and is testable.
4. **`ordering` in `live.json` or a new file?** Recommend `live.json` after P1. A new path shape would touch the store's four-shape allowlist.
5. **Show "Ask your waiter" on non-orderable items while ordering is on?** Recommend yes. This is an unspecified UX choice, so Martin should confirm (D63).
6. **Guest status endpoint auth.** Recommend the `od_` id plus the table token, no personal data, lapsing with the service day.
7. **Who may set write mode to `live`?** Recommend Martin only, per connection, after a recorded test-installation run (D33, rule 7).
8. **Store raw command bodies?** Recommend no: a hash, a safe summary and the source ref only.

## 8. Rules for the connector guide (guest side and outbound)

1. Publishing never imports a connector. A connector reaches guests only through `apply()`, and never writes `orderable`; core computes it from the role and the venue's route.
2. No vendor word in the snapshot, shell, faces, guest routes or `worker/publish`. A test enforces it.
3. A table's `display_name` is a human label of 40 characters or fewer, never an internal id. It is published.
4. The writer is optional. Declare `orders`, `dedupe` and `status` honestly; unsupported means absent, not stubbed.
5. Commands carry our ids (`nd_`, `tb_`, `cm_`). The writer resolves external refs at send time through core's reader and never stores them on an order.
6. Derive the source's idempotency key deterministically from `cm_`. Never use a random per-attempt key.
7. An unknown outcome means `status()`. Resend only under the same key and only with `dedupe: key`. Never use a new key.
8. `toRequest` is pure and has golden fixtures. `send` is the transport and classifies errors as rejected, not delivered, or unknown. Money is integer minor units.
9. Provide `status()` as a poll. A webhook is only a nudge to that call.
10. Every write call is a named export on Martin's allowlist, recorded in the tracker. The test asserts exports equal the allowlist. Write mode defaults to `off`.
11. The admin and the guest `ordering` state derive from capabilities and health, never from the connector's kind.
12. Published-file changes are parser-first: loosen the consumer, deploy it, then emit. Inside `/1`, new fields are optional forever.

### Critical Files for Implementation
- E:\Restro\packages\core\src\snapshot\schema.ts
- E:\Restro\packages\core\src\apply\publish.ts
- E:\Restro\packages\shell\src\build.ts
- E:\Restro\apps\worker\src\publish\after-sync.ts
- E:\Restro\apps\web\src\guest\guest-menu.tsx
