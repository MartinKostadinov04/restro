# Guest API (#40): second opinion

Made by: an Opus review subagent for the #40 session, 10-20. For: #40, map #29. It reviews the session's first draft; the final design is `2026-10-20-guest-api-design.md`, which says what was taken (all six must-fix items and most "should" items) and what Martin decided instead. Filed as written, under D114.

Reviewer: Opus subagent, 10-20. Read: the draft, CLAUDE.md, D72/D75/D102/D111/D115–D118, the locking proposal and its second opinion, A5 §5.1–5.2, A6 F12/G13, and the code cited below.

## Verdict

The shape is right: two endpoints, the code in a header, the tenant resolved once through a pinned definer function and then normal RLS. The web never calls a POS, outcomes reach the phone through the state, polling sits behind a host interface, and faces stay pure. Most of it follows the Opus proposal faithfully. Six things need fixing before it is briefed:
- the 30 s memo lets a retired code keep writing;
- `since=version` misses changes that only time makes;
- retries have no time limit, so an edit can land twice or a Send can land minutes late;
- Turnstile's fail-open is undefined for a missing token, and Turnstile on Pay contradicts D118;
- a bill row's name for waiter-typed rows is a rule-3 decision the draft takes alone;
- the holder token has no server home that D117 allows.

The rest are "should" items: the seams, the reading's privacy, abuse levers and the version counter's mechanics.

## Findings

**1. must-fix: the memo outlives a retired code** (§2.3).
- What: code → (tenant, venue, table) is cached for 30 s per replica. A "New code" (D117: issued because the old one leaked) leaves the leaker able to add to and Send onto the freshly flushed bag for up to 30 s. A table that is hidden, or a venue that is no longer live, keeps working too, unless the cached `state` is re-read.
- Fix: keep the memo as a tenant hint only. Inside every tenant transaction, re-check the code in the query you already run, for example `… join tables t on t.id = $table and t.token = $code and not t.hidden`, plus `lockLiveVenue` on writes. That costs no extra round trip, and a retired code fails at once on every replica.

**2. must-fix: time-driven changes never bump `version`** (§3, §6).
- What: an `{unchanged}` answer is wrong whenever the clock alone changes the state: the undo window ends, a payment lock expires (lines return), the idle timeout parks the bag as "Earlier bag", or an order leaves the 2-minute window. Other phones would keep showing greyed lines or "Undo" until some unrelated write.
- Fix: store `next_change_at` (the earliest deadline) on the bag row. The GET treats `now() >= next_change_at` as changed and applies the expiry lazily under the row lock, or leaves it to a sweep run every few seconds.
- Also: the bag row is created "on first add" (locking proposal), but readings and pay-first payments can come before any add. Upsert the row in the helper of finding 11.

**3. must-fix: retries have no horizon** (§4, §6).
- Bag edits: the ring keeps the last 64 `actionId`s, so at the 60-a-minute per-table limit a retry after about a minute is applied twice.
- Send: "retried … once the phone is back" can place an order minutes after the guest has given up and called a waiter.
- Fix: the host sends `ageMs`, the milliseconds since the tap, a relative number so no clock sync is needed. The server answers a known `actionId` with its stored answer always. It refuses an unknown one older than 30 s (edits) or 60 s (Send, Pay) with `stale_action`; the host then refetches state.
- Turnstile tokens are single-use and valid for 300 s (checked: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). So the order inside the request must be:
  1. look up the `actionId` first;
  2. then call siteverify with `idempotency_key = actionId`, which the same page documents for safe retries;
  3. then the guards;
  4. then the write.
  
  Without this, a lost answer turns the retry into `human_check`.
- Rejections leave no row, so a repeat is evaluated again. Say so, and use a new `actionId` for a deliberate retry after a refusal, as the duplicate flow already does.

**4. must-fix: Turnstile placement and failure semantics** (§5, §7).
- (a) D118: "Pay-first orders and paying are never blocked, located or limited". A `human_check` refusal on `pay.start` blocks paying. Card-testing bots make a real case for a check on Pay (an inference, not a decision on file), but that case belongs to the payment map. Pull Turnstile on Pay back out of #40.
- (b) "Cloudflare down → fail open" is undefined for a missing or invalid token. If a missing token counts as an outage, a script simply omits it. Fix:
  - fail open only when the server itself observed siteverify unavailable (network error, 5xx or timeout over about 3 s, or `internal-error`);
  - fail closed on `invalid-input-response`, `timeout-or-duplicate` or a missing token;
  - count fail-opens and alert on them (#39 decides how).
- (c) Get the token at Send (execute mode), never at page load, because of the 300 s lifetime. Leave out `remoteip`: it is optional on the same page, and leaving it out sends less personal data.

**5. must-fix: names on the bill go past D75** (§3, bill line names).
- What: D75 lets the POS's own name stand in for a missing public name of a menu item, option or category, with a composer warning. The draft extends that to rows "a waiter typed" and to rows with no link to our items. Those can carry internal text ("staff comp", a guest's name, a discount label) that no composer ever warns about.
- Fix: for a row linked to an article, use our name, else the article's public name, else the D75 fallback. For a free-text or unlinked row, use a neutral label ("Other item") with its price. Put this to the lead or Martin as a rule-3 point; do not settle it in the API.

**6. must-fix: the holder token's home** (§4 `pay.cancel`).
- What: D117 says the token is "never on orders, payments or logs", yet the server must check it, and `pay.start` does not carry it.
- Fix: `pay.start` carries the token. The server keeps only its hash on the lock record, the lease, not on the `payments` row, and clears it when the lock ends. Reserve this in the payment map's slot.

**7. should: put POS-touching projection in the worker** (rule 3 locality).
- Compute the `bn_`/`rd_` HMACs, the names via `source_links`, and the `seen` fingerprint once, when the worker writes the reading. Store a public projection plus a private `bn_` → POS-row map. The web's `guest-state.ts` then never handles a POS row id, and the forbidden-values test guards one module.
- Define `seen` over exactly the projected content: lines, quantities, totals and paid amounts, never the read time. Otherwise every refresh knocks "changed".

**8. should: Send must honour "two Sends at once make one order" (D117).**
- With per-line revs, the second Send finds its lines gone and gets `bag_changed`, which is the Opus wording, not D117's.
- Fix: if every `(lineId, rev)` it sends now sits in one order in flight, answer `pending` with that order's `subjectId`.

**9. should: the definer seam, made exact** (§2.2, G13).
- Name the function's owner. All tables are FORCE RLS (`rls-guard.test.ts:124-145`), so an owner without BYPASSRLS gets no rows: it fails closed, but it is broken. Supabase's `postgres` role probably has BYPASSRLS (an inference). Test with the same owner attributes in CI.
- `LANGUAGE sql STABLE`, `SET search_path = pg_catalog, restro`, schema-qualified names.
- Put `REVOKE … FROM PUBLIC` in the migration itself: `db:roles` revokes later (`packages/db/scripts/roles.ts:262-270`), which leaves a gap until it runs.
- The guard change needs Martin's or the lead's OK (D67), as the draft says.

**10. should: one deep module owns the order of the checks** (§8).
- What: the draft spreads one invariant across a "thin" route and several modules: resolve, verify the code, look up the `actionId`, verify human, guards, apply, project.
- Fix: one module, for example `core/guest/act.ts` with `readTableState(code, since, view)` and `actGuest(code, command, checks)`. It takes ports for `verifyHuman`, the clock and the HMAC key. The route is then an adapter: headers, size cap, Zod, status codes.
- Deletion test: without it, every route and test re-derives that order.
- Also: put pure bag rules (merge, limits, undo window, restore) in core as `applyBagCommand(bag, cmd, now)`. Both `core/apply/bag.ts` and the preview's in-memory server then use them, so there are not two implementations.

**11. should: make the version bump structural** (§3).
- Keeping one counter is sound, and simplest for phones, only if every writer (readings, order outcomes, payments, sweeps) takes the bag row first: that is the proposal's lock order.
- Fix: one helper, `withTableState(tx, tableId, fn)`. It upserts and locks the bag row, runs `fn` and bumps the counter. Add a review rule or test that order, reading and payment writers call it.
- Do not use triggers on `orders`: they would invert the lock order and risk deadlocks with Send.
- An alternative, if contention shows: an opaque cursor of per-source revisions, with no cross-row writes.

**12. should: `subscribe` belongs to the host** (§8).
- Faces get state through props. `ServiceBinding` (`packages/shell/src/services.ts:298-301`) should stay `{state, dispatch}`. Put `subscribe` on `createTableServices`.

**13. should: the location consent's wording is legal text** (§5).
- If each face words the consent line, a template could drop "not stored".
- Fix: fixed shell strings plus a face contract test that renders them. `consentGiven` is in no schema: make it a host call or a field the host strips before posting.
- If `ordering.locationCheck` is on and permission isn't `granted`, show the consent before the first POST instead of after a `location_needed` round trip.

**14. should: abuse levers held by anyone with a code** (§7).
- Cloudflare Free, checked (https://developers.cloudflare.com/waf/rate-limiting-rules/):
  - 1 rule;
  - counts by IP only;
  - 10 s period and 10 s block;
  - matches only on path or verified bot, not method;
  - no custom counting.
  
  "600 per 10 s per IP" uses the zone's only rule, so nothing is left for sign-in or `/api/events`.
- Levers needing no location:
  - empty or fill the bag;
  - burn the table's 60-a-minute edit budget, so real guests get `rate_limited`;
  - restart `pay.start` every 2 min, which holds "Someone is paying" and greys pay-first lines;
  - open `view=bill` on many codes, which multiplies POS reads per connection.
- Fixes:
  - a per-code token bucket in process memory for GETs, which stores nothing;
  - raise the edit budget to about 120 a minute and count the trips;
  - a per-connection reading budget in the worker;
  - for the payment map: start the lock only when the checkout session is created, and step up after repeated abandoned locks.

**15. should: privacy leaks** (D111, D118).
- The code is already in `/t/<code>` and in `/m/…?t=<code>` (`table-token.ts:116`, `guest-menu.tsx:174`), so it is in Railway's logs and Cloudflare's cache keys. "Never in a path, query or log" overclaims; say "the API adds no new place". A later fix outside #40: redirect to `#t=`, because a fragment never leaves the phone.
- Sentry is not installed yet. When it is, scrub `request.data` and every header for `/api/guest/*` in `beforeSend`. Test that a payload with a position and an `Authorization` header produces no event field holding them.
- `logError` logs Postgres messages (`apps/web/src/server/log.ts:15-24`). Never pass the code or a position as a query parameter that a cast could echo.
- Null `action_id` on orders at the end of the service day (from the proposal; the draft dropped it).
- Free-text notes reach every phone, the POS and 18 months of orders; see the questions.

**16. should: flushing the bag when the bills close is a transition** (§10, `sweepBags`).
- What: at a table with no open POS bill, the normal case before a waiter opens it (D118), "all bills closed" is always true, so the bag would be flushed at every reading.
- Fix: flush only on the change from at least one open bill to none, and never drop lines a payment holds.

**17. nit.**
- "No cookies": admin session cookies share the origin, so say "the route reads no cookie".
- A5-P13's rule "guest code never imports `core/apply/orders`" must target `apps/web/src/guest/**`, not `app/api/guest/**`.
- Next route handlers have no built-in body cap, so enforce the 8 KB cap while reading the stream.
- `CommandResult.message` must never carry POS error text.
- `orders[].ref` comes from `od_`.
- Add the D118 trip counters to §10.
- Don't change `pay.start(quoteId, method)` now (D72's quote); reserve names only.

## Taken from #39 or the payment map (pull back)

- #39:
  - the 10 s connection notice and disabling edits, Send and Pay (§6);
  - Turnstile's fail-open policy and its alert;
  - raising `next` under overload;
  - the staleness thresholds and wording for `bill.status` and `onBill: 'unknown'`;
  - what `unavailable` shows.
- Payment map:
  - `pay.start`'s new shape, `pay.cancel`;
  - the `payments[]` phases;
  - `below_minimum`, `lock_expired`;
  - Turnstile on Pay;
  - the knock's `pending` → proceed path for payments.

## Questions for Martin

1. **What does a bill show for a row a waiter typed or an item not on the menu?** Recommend a neutral "Other item" with its price, never the POS's own text.
2. **Does any change to the bill refuse a bill payment ("your bill changed")?** That includes a friend's new round that the payer isn't paying for. Recommend: only a change to the lines being paid or to the total owed.
3. **A second Send of the same lines:** "Your table's bag changed", or "Already on its way"? Recommend "Already on its way" (D117).
4. **How long do Added, Not sent and Unconfirmed stay on screen,** with the reference? The draft says 2 minutes. Recommend Unconfirmed stays until the table's bills close.
5. **Anyone with a photo of the code can empty the bag or keep "Someone is paying" up from outside.** Accept for the pilot and count it? Recommend yes, and revisit after the pilot.
6. **Guest notes:** shown to the whole table, sent to the POS, kept 18 months. Keep free text? Recommend a 100-character limit, no notes kept past the service day, and the lawyer's view on retention.
7. **On iPhone, Safari may ask for location again on later visits** (an inference, not checked). D118's "checks again without a prompt" may not hold. Recommend adding this to Martin's field test.
8. **The connection notice after 10 s with edits disabled:** is that the right wait for a club? Recommend letting #39 settle it, at about 10 s.
