Made by: Opus design agent for #51, 10-21. For: the ordering lead.

# The simulated test POS and the simulated payment provider: how the pilot's workflow is built and tested before Mistral answers

A technical proposal for #51 (map #29). It informs and never binds (D114). The lead decides the rows of §8 and takes the one question in it to Martin. It builds on D98, D110, D115 and D122 (§1, §3, §4, §6, §8, §9), the Mistral list (`2026-10-21-mistral-questions.md`), the service-data design §2 (`2026-10-21-service-data-design.md`), the payment facts (`2026-10-21-payment-provider-facts.md`) and the feasibility study §9 (`2026-10-17-payment-providers-feasibility.md`). Words follow `GLOSSARY.md` and D122 §2. The terms module, interface, seam, adapter and depth are used as the `codebase-design` skill defines them.

## In plain words

Restro gets two fake systems: a **simulated POS** that behaves like the one-bill POS Martin described, and a **simulated payment provider** that holds, captures and refunds pretend money. Each one sits behind the same interface the real Mistral connector and the real myPOS package will use later. Wherever Mistral or myPOS hasn't told us how something works, the fake has a switch. The switch starts on the careful answer, so the platform is built for the hard case. One shared test suite checks the fakes now. The same suite will check the real connectors later, so the platform can't quietly come to depend on the fake.

## 1. Where the seams go

Two interfaces in the integration layer, each with real adapters later and a simulated adapter now:

- **The service connector interface** (POS-neutral; the integration layer owns it, connector packages implement it). It has eight operations:

  ```ts
  interface ServiceConnector {
    capabilities: Capabilities                        // D122 §3, read at wiring time
    probe(ctx): Promise<ProbeResult>                  // D122 §6: same path as an order
    readFloor(ctx): Promise<Reading<Floor>>           // tables, their bar, payment tables
    readTable(ctx, t): Promise<Reading<TableBills>>   // open POS bills with lines
    addLines(ctx, t, lines, ref): Promise<WriteOutcome>
    isolateLines(ctx, t, picks, pt, ref): Promise<WriteOutcome>
    readIsolated(ctx, pt): Promise<Reading<TableBills>>
    payAndClose(ctx, pt, amountMinor, ref): Promise<WriteOutcome<{ receiptNo?: string }>>
    undoIsolate(ctx, pt, t, ref): Promise<WriteOutcome>
  }
  type Reading<T> = { complete: true; value: T } | { complete: false; reason: string }
  type WriteOutcome<R = {}> =
    | { kind: 'done'; result: R }
    | { kind: 'refused'; code: RefusalCode }        // a definite "no": bill_closed, bill_locked,
                                                    // needs_first_item, no_rights, busy, …
    | { kind: 'unknown' }                           // a timeout: read back, never guessed (D115)
  ```

  The interface is small, and the behaviour behind it is large. The saga, the queue per bar, the locks, the deadlines and the Log stay in the platform (D122 §8, board review system finding 4). Two rules are part of the interface, not only the types. A timeout is always `unknown`, never `refused`. A `Reading` that isn't complete concludes nothing (rule 6, D122 §6).
- **The payment provider interface** (D98): capabilities, start a hold (with its hosted or embedded checkout), status, capture (an amount), release, verify a notice. D98 lists refund in it. Restro's key never refunds (D122 §8), so `refund` exists only so a provider can say it is refused.

Each seam has a real second adapter in sight: barsy for the connector (it isolates by `Accounts_divide` on the same table, not by a move: `docs/connector-questions.md`), and myPOS for the provider. That makes them real seams, not hypothetical ones. Mistral is the third adapter.

## 2. The simulated test POS

### 2.1 The package

- **Name:** `packages/connectors/sim-pos`, published as `@restro/sim-pos`. The integration kind is `sim`. "sim" is no vendor word, so `scripts/vendor-words.config.ts` needs no change. It is the first package under `packages/connectors/`, where the config already expects barsy to move.
- **Imported only by `apps/worker`.** Today's `barsy-only-from-worker` and `web-no-barsy` rules are generalised into `connectors-only-from-worker` and `web-no-connectors` over `^packages/connectors/`. That tightens the guard and loosens nothing (D67).
- **Its parts.** The interface is the connector. Everything else is implementation or test support.
  1. `engine/`: the simulated POS itself. It is a pure state machine with an injected clock and a seeded random source, and does no I/O.
  2. `wire/`: the simulated POS's own small HTTP protocol. It is **POS-shaped, not Restro-shaped**: list tables, read a table's bills and rows, add rows, move rows to a table, void, close with a payment type. The connector composes these into the eight operations, the way the Mistral connector will compose Mistral's calls. If the wire mirrored the connector interface one to one, the connector would be a pass-through, and the hard part of a real connector would never be tested.
  3. `connector.ts`: the `ServiceConnector` adapter. It is an HTTP client over `wire/`, with the same host guard as barsy (rule 9's spirit). It refuses any non-local, non-allowlisted host and refuses to run in production.
  4. `server.ts`: a standalone Node `http` server around the engine. It serves `wire/`, the waiter control (§2.5) and nothing else. It needs no new dependency.
  5. `./testing`: MSW handlers backed by the engine (as `@restro/barsy/testing` is backed by fixtures), an in-process transport, and scenario files. Tests import it, and nothing in production does.
- **Writes and D110.** The simulated POS is the first connector with writes. D110 says the empty-export test on `packages/barsy/src/write/` becomes "every exported write is one of the waiter actions" in the ticket that adds the first write. That guard should be built once, in the conformance kit (§5), and applied to `sim-pos` from its first commit. Barsy's empty-export test stays until barsy gets writes.
- **Scope line.** CLAUDE.md allows no ordering or payment backend code "until the tracker says so". These packages are that code, so the lead opens them in the tracker before a build agent starts.

### 2.2 Its state

The engine keeps everything in memory, in one serialisable object, so a scenario can be saved, loaded and replayed:

- **logins:** POS users (Restro's API user, waiters "Maria" and "Ivan"), each scoped to one or more bars;
- **bars:** each with a ticket printer, which is a list of printed tickets;
- **tables:** each with a number, a hall, one bar, and a `payment` flag for payment tables;
- **bills:** each with a table, a state (open or closed), lines, a lock holder, an optional whole-bill discount, payments, and a receipt number when closed;
- **lines:** each with an article, a quantity, a unit price in minor units, a note and options, who entered it, when, and an optional caller reference;
- **catalogue:** articles with prices and a sold-out mark, the data the scenario's menu is made from (§4);
- **a call log:** every wire call with its outcome, for tests and the control page.

Money inside the engine is integer minor units. On the wire, prices are decimal strings by default. The switch `pricesAsJsonFloats` sends them as JSON numbers, so the connector's lossless parse through `money` stays tested (rule 8).

Postgres-backed state was considered and rejected. The simulated POS would become a second writer of Restro's database outside both write paths (rule 1, D122 §9). It would also put a POS's tables into Restro's schema. In-memory state, with an optional JSON snapshot file for the staging demo, keeps it what it pretends to be: a separate system.

### 2.3 What it takes from D122 §1, and what it doesn't claim

These behaviours are Martin's own statements (D122 §1), built in without a switch:
1. A table has one bill. The switch `billsPerTable` exists only to test D115's several-bill path; see the table below.
2. Staff take part of a bill by moving lines to a free payment table, then take the payment and close it there.
3. Each table belongs to one bar.
4. A sent order prints whole on one ticket at the table's bar.
5. Nothing records "served".

Everything else is a switch. Anything neither D122 §1 nor a switch defines **throws `undefined_behaviour`** (HTTP 501 on the wire), as barsy's MSW harness already answers 501 rather than invent. Examples are moving lines off a bill with a whole-bill discount (Q37) and closing the day while a payment table is open (Q29). A test that hits one fails loudly. It can't pass on a friendly guess. The simulator claims nothing about Mistral: its readme says so, and so does every switch's comment.

### 2.4 Capabilities and switches

**Capabilities.** The simulator declares D122 §3's list from its switches. "Close a bill with a chosen payment type" and "open, pay and close a sale in one call" are the two paying ones. "Cautious" means:
- for a capability: not declared, so the platform takes the fallback D122 §4 describes;
- for a behaviour: the answer that makes the platform's job harder.

**Profiles.** Two named profiles:
- `cautious`: every switch below at its default;
- `pilot`: `cautious` plus `moveLines` and `closeWithPaymentType` on. That is the least the payment route needs. Martin's facts make it likely, but Mistral hasn't confirmed it through the API (Q11, Q4, Q26).

Tests of paying run on `pilot`. Everything else runs on both.

| Switch | Cautious default (other values) | Mistral Q | What the platform must survive with the default |
|---|---|---|---|
| `billsPerTable` | `one` (`several`) | 10 | Martin's fact. `several` tests D115's "oldest open bill" path. |
| `firstItemsOpenBill` | off | 40, 22 | A first sent order on a table with no bill is refused: "Ask your waiter to put your first item on". |
| `approvalAtBar` | off (on: lines wait, the ticket prints on approval) | 3, 14 | No "Awaiting approval" state. |
| `lineShowsWhoAndWhen` | off | 15 | "Did it land" matches new lines by article and quantity against the reading before Send. More sent orders end Unconfirmed. |
| `lineCarriesCallerRef` | off | 15 (C21) | No exact match by Restro's reference. |
| `repeatSafeAdd` | off | 15 (C20) | A timed-out add is never resent (D115). |
| `addIsAllOrNothing` | off | 15 (C18) | A timed-out add may land only some of its lines (§2.6). |
| `lateLandingMs` | 120 000 (0) | 15, C52 | A line may land after the minute of reading back. Late lines go to the reconciliation, never to a resend. |
| `moveLines` | off (`pilot`: on) | 11 | With it off, no paying (D122 §4 fallback). |
| `movePartialQuantity` | off | 11 | Whole lines only (D122 §8). |
| `moveReprintsTicket` | on | 11 | A move prints at the bar again. Tonight and the demo show it, because a reprint at a bar is a real risk to the pilot. |
| `emptiedBill` | `closes` (`staysOpen`) | 30 | `undoIsolate` must bring lines back to a table whose bill has gone. |
| `readsTableBar` | off | 16 | Bars can't be read. This is unknown territory (§8 row 12). |
| `oneLoginPerBar` | on | 19 | One connection pause per bar's login (D122 §6). |
| `notesReachTicket` | off | 31, 13 | No note field. Items with required options say "Order this from your waiter". |
| `readClosedBills` | off | 24 | Restro's own records are the only history. |
| `closeWithPaymentType` | off (`pilot`: on) | 4, 26, 36 | With it off, no paying. |
| `oneCallSale` | off | 4, 12, 13 | No pay-first sale in one call. |
| `ticketOnOneCallSale` | off | 13 | A one-call sale may not reach the bar. |
| `receiptNumberOnClose` | off | 25, 39 | The receipt number is missing on the payment record, and staff are alerted per D122 §8. |
| `closeSucceedsWithoutPrinter` | on | 25 | A close can succeed with no receipt (a fault, §2.6). |
| `electronicReceipt` | off | 38 | Paper only. On: the close takes the guest's email and the POS sends the electronic receipt itself (#186). |
| `electronicReceiptFile` | off | 38 | Needs `electronicReceipt`. On: the close returns the POS's receipt file instead, and Restro sends it (#186). |
| `closeCarriesNote` | off | 35 | No "for Table 7 · ref K7Q" on the close. |
| `severalPaymentsPerClose` | off | 20 | One payer per close. |
| `tipAsLine` | off | 41 | A tip is never written to the POS. It stays on Restro's payment record. |
| `readAllOpenBillsInOneCall` | off | 28 | Reads go table by table, within `rateLimit`. |
| `rateLimit` | 1 call at a time, 5 per second | 28 | Queues and backoff hold under a strict limit. |
| `trainingMode` | off | 27 | Declared only, for the capability list. |
| `pricesAsJsonFloats` | on | (none) | A wire-format choice, not a POS claim. It keeps rule 8's parse tested. |

When Mistral answers, a third profile, `mistral-as-answered`, is filled from the answers. The whole suite runs on it, and each difference from `pilot` becomes a ticket.

### 2.5 The waiter control

A test, a demo or a person at a laptop can act as staff at the POS's front end. The same operations are offered three ways:
- `engine.waiter.*` in tests;
- `pnpm sim-pos waiter <op>` from the command line;
- a plain control page served by `server.ts` at `/control`.

The operations:
- put a first item on a table (opens its bill);
- add a round;
- void a line, or part of its quantity;
- move lines between tables;
- close a bill with cash or card;
- lock a bill, as if open on a terminal, and unlock it;
- in `several` mode, split and merge bills;
- mark an article sold out;
- take a login offline, and bring it back.

The page also shows each bar's printed tickets and the call log. It is the simulated POS's own screen. It is not in `apps/web` and never in Tonight, so no POS-shaped code reaches the platform. On staging it sits behind a shared token from the environment and never on a public route.

### 2.6 Fault injection

A **fault plan** is a list of rules: *on the n-th call of `wire` method M (or when a predicate on the state holds), do F*. It is deterministic by default. A seeded `chaos` mode draws faults at given rates for soak runs, and the failing seed is printed so the run can be replayed. The faults:

- **Lands, then times out:** the write applies, and the answer never comes. This is the central case for D115 and D122 §4 "did it land".
- **Times out before landing:** nothing applies.
- **Lands partly:** only with `addIsAllOrNothing` off. A prefix of the lines lands.
- **Lands late:** the write applies after `lateLandingMs`.
- **Partial read:** one table's bills are missing, or a read fails midway. The connector must return `complete: false` (rule 6).
- **Refusals:** `bill_closed`, `bill_locked`, `no_rights` (Q33), `busy` (rate limit), `article_unknown`, `sold_out`.
- **Slow answers:** a fixed or random delay, to test the 3-second probe (D122 §6).
- **Login offline:** every call of one login fails, which drives connection pauses.
- **A waiter's round slips in:** a waiter adds a line between `isolateLines` and `readIsolated`. D122 §8's last check must release the hold, return the lines and alert staff.
- **A waiter voids a line:** after the guest confirmed. The platform may capture less only after a fresh read of the real table shows the void.
- **A waiter closes the bill:** between Restro's read and its write.
- **A close prints no receipt:** with `closeSucceedsWithoutPrinter` on.

## 3. The simulated payment provider

### 3.1 The package

- **Name:** `packages/payments/sim-pay`, published as `@restro/sim-pay`. It has no provider's name and implements D98's interface.
- **Placement:** wherever #53 puts provider calls. The board review noted that Pay may need the provider's session while the guest waits, which CLAUDE.md's worker-only rule doesn't cover. The simulator copies the placement #53 chooses for myPOS and must not decide it.
- **Parts:** the same shape as `sim-pos`:
  1. a pure engine with an injected clock;
  2. a server with the provider's hosted checkout page and a "dashboard" control page;
  3. `./testing` with MSW handlers and an in-process transport.

### 3.2 Its behaviour

- **Hold:**
  - A checkout session leads to approval, decline or abandonment.
  - The hosted page has buttons for each outcome. Test card numbers map to outcomes, so Playwright can drive it.
  - The 3-D Secure outcomes are passed, failed, abandoned, not needed, and "authenticates, then declines".
  - The result is recorded for the evidence D122 §8 asks for.
- **Capture:**
  - full, or a lower amount when `partialCapture` is declared;
  - one capture per hold;
  - after expiry, refused;
  - a transient failure that succeeds when retried (round 2 §5.2's retries).
- **Release:** in full, or partially when declared.
- **The 7-day hold expiry:** a hold expires by itself at `maxHoldDays` on the injected clock, so tests jump the clock rather than wait.
- **Refunds:** made only from the dashboard control ("in the dashboard", D122 §8), in full or in part. A refund through Restro's key is refused with `forbidden`, which proves "Restro's key can create, take and cancel only".
- **Disputes:** opened, won or lost from the dashboard.
- **Notices:**
  - signed with HMAC over the body with a test secret;
  - delivered with a retry schedule until acknowledged;
  - with switches to repeat a notice, swap the order of two, delay one, drop one, send one unsigned, or send one with a bad signature.
  - D122 §8 requires that unsigned notices are dropped and counted, and that each is stored once by its id.
- **Status query:** with a look-back window. When notices are off, Restro must poll, including the daily 30-day check for refunds (D122 §8).

### 3.3 Capability flags, with cautious defaults

The flags come from feasibility §9 and the facts' closing list. Each carries its verified status, which here is always `simulated`.

| Flag | Cautious default | Stands in for (Q76 unless noted) |
|---|---|---|
| `canHold` | on (the route needs it) | pre-authorisation per merchant |
| `maxHoldDays` | 7 | hold length for a bar or club; D122 "plan for 7-day" |
| `holdExpiresBySelf` | on | (none) |
| `partialCapture` | off | partial completion |
| `captureMoreThanHeld` | off | tips over the hold; the tip is fixed before the hold |
| `releasePartial` | off | (none) |
| `checkout` | `redirect` (`embedded`) | embedded SDK with a hold; #49 row 1.3 |
| `wallets` | off | Apple Pay and Google Pay |
| `threeDS` | `always` | myPOS mandatory 3DS (facts §11) |
| `pushesStatus` | on | notification retry schedule |
| `refundNotice`, `disputeNotice` | off | (D122 §8 then falls back to the daily status check) |
| `signature` | `hmac` | (none) |
| `idempotencyKey` | off | (none): retrying a hold checks its status first |
| `restroKeyCanRefund` | off | key limited to hold, completion, cancel, status |
| `providerEmailsGuest` | on | turning off the payer's emailed receipt |

With `partialCapture` off, D122 §8's "captures a lower amount" can't happen. The fallback is to release the hold, return the lines and ask the guest to pay again (§8 row 9).

## 4. Environments

| Environment | POS | Payment provider | What it proves |
|---|---|---|---|
| CI, unit (`core`, connector packages) | sim engine, in process | sim engine, in process | the saga, the sent-order and pause state machines, matching after a timeout, and the property tests (§5) |
| CI, integration (worker and Postgres) | `sim-pos` connector over MSW, backed by the engine | `sim-pay` over MSW, with notices posted to the notice handler | the real HTTP client, `applyService` writes, timeouts end to end, the conformance suites, on both profiles |
| CI, e2e (Playwright) | `sim-pos` server process | `sim-pay` server with its hosted page | guest Send and Pay, Tonight's alerts and actions, "Show this to your waiter" |
| Local development | `pnpm sim:serve`: both servers, the control pages and the CLI | `sim-pay` | building and demoing by hand, on the dev seed's simulated venue (§6) |
| Staging, demo venue | `sim-pos` as its own staging service | myPOS sandbox if Q76 confirms holds and 3DS there; otherwise `sim-pay` | the deployed stack, real network latency, a real 3DS page, signed notices over the internet |
| Staging, barsy | barsy's test installation (Lukanet, D33) | none | the existing menu sync; #47's read-back (C52, C18, C21); later barsy's own waiter writes |
| Mistral's test installation (Q27, later) | the Mistral connector | myPOS sandbox | the Mistral connector passes the same conformance suite; the rehearsal before the pilot |
| Production | real POS only; a `sim` instance is refused | real provider only | (the pilot) |

Notes:
- **barsy's public demo host** stays read-only. #47's writes go only to the test installation Lukanet provides with its own API user and cash desk, because the public demo is shared with everyone.
- **CI cost** is no concern while the repository stays public (memory: GitHub Actions minutes). The two profiles run on every PR. A pairwise matrix over all switches runs weekly and by hand.
- **Mistral's test installation** depends on Q27. D122's opening allows "training mode" for demo and staging. On a pilot venue's own installation, that may collide with rule 7 (§8, question for Martin).

## 5. Conformance and property tests

**The connector conformance suite.** It lives in the integration layer's test kit, `@restro/core/connectors/testing` or wherever CF-06's "connector contract, kit and conformance skeleton" lands; this un-parks part of CF-06. It is POS-neutral and takes a harness of four things:
1. the connector;
2. a waiter driver for that POS;
3. a clock;
4. the declared capabilities.

Each check runs only where its capability is declared, and otherwise checks the declared fallback:
- **Readings:** `readTable` returns lines in minor units. A read with a failed part returns `complete: false`, never a shorter list.
- **Adding lines:**
  - `addLines` puts lines on the table's bill (the oldest one with several);
  - with no bill and no `firstItemsOpenBill`, it is refused with `needs_first_item`;
  - on a closed or locked bill, it is refused definitely.
- **Timeouts:** every timeout surfaces as `unknown`, never as `refused`, and never as a second write.
- **The payment route:**
  - `isolateLines` then `readIsolated` gives exactly the picked lines;
  - `undoIsolate` restores the real table's total;
  - `payAndClose` closes once, and a second call is refused.
- **Writes and ids:**
  - every exported write is one of D110's waiter actions (the D110 guard);
  - no output carries a POS id outside the backend-only `PosRef` type (rule 3).

Every real connector must pass the suite:
- **barsy:** against its MSW fixtures in CI now (reads), and its writes later;
- **Mistral:** against its own fixtures, and by hand against its test installation, never in CI against a live system.

**The provider conformance suite** works the same way:
- hold, then capture (partial only where declared);
- release, and expiry;
- notices verified, stored once, and correct when out of order;
- a refund through Restro's key is refused.

It runs against `sim-pay` in CI and by hand against the myPOS sandbox.

**Property tests** (fast-check):
- **Rule 6:** for any fault plan that makes a reading partial, the reading reducer ends no sitting, clears no order, lifts no pause and gives no "Your bill changed" (D122 §6).
- **Rule 8:**
  - for any lines, moves and voids, money is conserved: the sum over all bills equals the lines entered minus the voids;
  - the amount captured equals the total the payment table closed with, exactly, in minor units;
  - prices sent as JSON floats parse to the same minor units as the decimal strings.
- **A model-based saga test** (`fc.commands`): it mixes guest steps, waiter actions and faults. It checks four things:
  1. never a capture without a close of exactly the confirmed lines;
  2. never a close without a hold;
  3. never a resent round;
  4. the lines are always somewhere, never lost.
- **Rule 5:** this applies to the simulated catalogue once its menu read goes through the generic sync. It checks that a sold-out mark or a price from the POS is never made more permissive. Until then, barsy's existing rule-5 properties cover it.

## 6. The demo venue and the dev seed (#26)

- **#26 stays as written.** A POS venue on the made-up barsy instance `dev-seed.test`, fed by barsy fixtures through `apply()`, tests the menu rules of D87, D89 and D90.
- **A third seed venue, "Demo Bar"**, sits on a `sim` instance. It tests ordering and paying. It has:
  - two bars ("Main bar" and "Upstairs"), six tables each, and two payment tables per bar;
  - about 30 articles, with prices that exercise half-up rounding, one item with required options, a pay-first item, a sold-out item, and a table whose bill has a whole-bill discount (to hit Q37's `undefined_behaviour` refusal path);
  - Table 7 already open by "Maria" with a €46.00 bill, D122's own example.
- **Its menu:** the existing sync reads only barsy (the generic sync is CF-06/07, parked). Until then the seed writes the scenario's catalogue through `apply()` with POS provenance (`till:<in_…>`, rule 2), and the simulated POS loads the same scenario file. This needs a `sim` entry in `TILL_LINK_TYPES` and `INTEGRATION_KINDS`, and the `integrations_kind` check widened. That is a migration (§8 row 8).
- **Its tables, bars and payment tables** come from `readFloor`, like any POS venue.
- **Scenario files:** `quiet-night`, `busy-friday` (all tables open, `chaos` faults at a low rate) and `payment-trouble` (the waiter's round slips in, a voided line, a dropped notice). The local control page and the staging demo load them by name.
- `SEED_DEMO_MENU=0` skips Demo Bar too.

## 7. Risks

1. **The platform overfits to the simulator.** This is the main risk.
   - **Recommendation:**
     - keep the wire POS-shaped (§2.1), so the connector does real work;
     - make every unknown throw (§2.3);
     - default every switch to cautious, and run both profiles;
     - before the interface is frozen, write barsy's mapping of the four payment steps on paper (`Accounts_divide`, `Accounts_close`, merge back), as the second adapter that keeps the seam honest;
     - vary the simulator's id shapes (numbers, strings with spaces, UUIDs), so no code assumes one;
     - take timings from #47's measurements, never from the simulator;
     - when Mistral answers, run `mistral-as-answered` and treat every difference as a ticket, not a tweak to the simulator.
2. **The simulator grows into a product.** Recommendation: it covers D122's list and the switches above. A new switch needs a Mistral question number, or it isn't added.
3. **A `sim` instance reaches production.** Recommendation:
   - the worker refuses the kind when `NODE_ENV=production`;
   - the web app hides it from the source picker there;
   - a test pins both.
4. **The staging control page is open to anyone.** Recommendation: a token from the environment, never a guessable route, and no guest data in it.
5. **The simulated provider lets card-like data near Restro.** Recommendation: test card numbers exist only on `sim-pay`'s own page, on its own origin, as on a real provider. Restro's service tables keep no card digits (D111), and a test checks it.
6. **The staging demo's state is lost on redeploy.** Recommendation: accept it. A vanished bill is a real "bill closed" event, and the JSON snapshot covers longer demos.
7. **A rule collides with whole-bill payment.** D122 §4 ends a sitting when "a complete reading shows it gone or empty after it held lines". Paying the whole bill moves every line to a payment table. With `emptiedBill: closes`, a reading in mid-payment ends the sitting, and `undoIsolate` then returns lines to a dead sitting. Recommendation: §8 row 10.

## 8. Decision table

| # | Proposed decision | Why | Who decides |
|---|---|---|---|
| 1 | The simulated POS is `packages/connectors/sim-pos` (`@restro/sim-pos`, kind `sim`), imported only by `apps/worker`. The rule becomes `connectors-only-from-worker` over `packages/connectors/`. | #51's brief and CLAUDE.md's three layers; a neutral name; the guard tightens | lead |
| 2 | The connector interface is the eight operations of §1, with `unknown` for timeouts and `complete: false` for partial readings as part of the interface. | A deep interface with the saga kept in the platform; rules 6 and D115 enforced at the seam | lead |
| 3 | The simulator is a pure engine, a POS-shaped wire, the connector, a standalone server and MSW handlers, with in-memory state and an optional JSON snapshot. No Postgres. | Two transports make a real seam; no second database writer | lead |
| 4 | The switches and defaults of §2.4, the `cautious` and `pilot` profiles, and `undefined_behaviour` for anything unstated. | #51: cautious defaults; invent no POS behaviour | lead |
| 5 | The fault plans of §2.6, deterministic, with seeded chaos. | Reproducible failures | lead |
| 6 | The waiter control as engine calls, a CLI and the simulator's own page. Never in `apps/web`. | No POS-shaped code in the platform | lead |
| 7 | The simulated provider is `packages/payments/sim-pay`, with the flags and defaults of §3.3. Its placement follows #53. | D98; Q76 unknowns | lead |
| 8 | Add kind `sim` (core's connector maps, the `integrations_kind` check, a migration) and refuse it in production. | The demo venue needs a source instance | lead (migration; staging migration needs Martin's OK as usual) |
| 9 | Without `partialCapture`, a voided line means release, return and pay again. | D122 §8 assumes a lower capture | lead |
| 10 | **May change D122 §4:** a reading taken while a payment of the table holds its lines on a payment table doesn't end the sitting. The sitting ends after the close and capture, or on the first complete reading after `undoIsolate`. | Risk 7 | lead |
| 11 | **May change D122 §3:** add "Restro's own reference on a line" (C21) and "a repeated add creates nothing" (C20). | D115 depends on them; the simulator declares them | lead |
| 12 | If `readsTableBar` stays off (Q16), how bars and payment queues are known is **unknown**. Don't design it now. Decide it when Mistral answers. It **may change D122 §7** ("read from the POS, never edited in Restro"). | No answer exists | lead, then Martin if Mistral says no |
| 13 | The conformance suites (connector and provider) live in the integration layer's test kit, partly un-parking CF-06. The D110 waiter-action guard is built there. | The same behaviour is checked for the simulator, barsy and Mistral | lead |
| 14 | The dev seed gets "Demo Bar" on a `sim` instance (§6). #26 is unchanged. | Ordering needs a POS that takes writes | lead |
| 15 | Writes to barsy (#47) go only to the test installation from Lukanet. The public demo stays read-only. | A shared demo; rule 7's spirit | lead |
| 16 | `sim-pos` runs on staging as its own service behind a token. Deploying it needs Martin's OK, as any deploy does. | The staging demo | lead (Martin's OK to deploy) |
| 17 | **May change D98:** its flag list gains `checkout` (redirect or embedded), embedded-hold, `refundNotice`, `disputeNotice`, `signature`, `restroKeyCanRefund` and `providerEmailsGuest`, each with its verified status. | Facts §11 and D122 §8 use them; D98 lists only three | lead |
| 18 | **For Martin: training mode on the pilot venue's own Mistral installation.** D122 allows "a POS test installation or training mode" for demo and staging, but rule 7 and D110 say tests never run on a live venue's POS (Н-18 Annex 29 т. 20). **Recommendation:** use only a separate Mistral test installation (Q27). Use training mode on the venue's live installation only if Mistral confirms in writing that it never reaches the fiscal device, fiscal memory or the day's reports, and Martin then approves it explicitly. | A real conflict between two texts; a legal reading | Martin |

## Unknowns

- Whether myPOS's sandbox supports holds and 3-D Secure (Q76). Staging may run `sim-pay` until it does.
- Whether Mistral has a test installation at all (Q27).
- Every Mistral behaviour behind a switch. None is claimed here.
- Where provider calls run (#53).
