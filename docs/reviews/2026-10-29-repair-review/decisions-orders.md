# A10a: Decision reader for ORDERS (D110, D111, D112, D115, D116, D117, D118, D122 ordering sections, rules 5, 6, 7)

Pinned commit `16b59a82` (checked: `git rev-parse --short HEAD` in `rr-pinned` = `16b59a82`). Read-only; nothing run but `git`, `gh issue view 64` and `grep`/`sed`. All eight decision files exist. Rules 1 to 3 and the import boundaries are out of scope. Tests were read only for context, never as evidence. File paths are relative to `rr-pinned`.

**Stop-and-ask (in the report too):** two decisions in this cluster do not agree on whether Restro may resend. D112 line 18: "If no answer comes, it sends the identical stamped request again for about a minute; a POS that refuses duplicates throws the copy away." D116 (state table, "Checking"): "an order opening a new stamped POS bill is resent unchanged." D115: "so that request may be resent unchanged for about a minute (D112)". Against that, D122 §3 (last capability) speaks of "D115's 'did it land' and 'never resend'", and spec #64 §8 says Restro "sends once, and on `unknown` reads back". The code never resends in any case (`apps/worker/src/jobs/order-send.ts:398-431`). D122 refines D116, so the later text probably governs, but D122 never says the open-new-bill resend is withdrawn. Recommendation: the lead records one sentence (in D122 or a new decision) saying a stamped new-bill open is also read back, never resent. Not logged as a defect; see O-1.

Verdict legend: **holds** (code does what the statement says), **mismatch -> RR id**, **n/c** (not checkable by reading, or in paying/Tonight scope).

---

## 1. Checkable statements per decision

### D110 (rule 7 as rewritten: only as a waiter would)

| # | Statement | Verdict |
|---|---|---|
| 110.1 | No write touches items, prices, settings or users; sim's write module has only waiter acts | holds: `packages/connectors/sim-pos/src/write/index.ts:15-55` exports `postRows`, `moveRows`, `closeBill`; `waiter-actions.ts:7-10` declares them `add_round/open_bill`, `split_or_move_bill`, `take_payment`; a normal round's body carries `article, quantity, note/options, ref` and never a price (`connector.ts:379-390`) |
| 110.2 | Every exported write is declared as a waiter action (guardrail replaces the empty-export test) | holds for sim (above) and `packages/core/src/connectors/service/waiter-actions.ts:27-32` (`SERVICE_WRITE_STEPS`) |
| 110.3 | Menu sync stays read-only: barsy write module empty | holds: `packages/barsy/src/write/index.ts` is `export {}` |
| 110.4 | The probe and every read step never write | holds: `connector.ts:304-319` probe is `client.get('/api/ping')`; reads are GET only (`:233-298`) |
| 110.5 | No POS webhooks, no POS registration | holds: nothing in the cluster's files calls either |
| 110.6 | Development and tests never run against a live venue's POS | holds by construction for ordering: only kind `sim` is built (`apps/worker/src/service-connectors.ts:62-73`), refused in production (`:53-60`), host guard `hosts.ts:34-52`; not checkable beyond that |
| 110.7 | (D127 paying) a tip row with a Restro-chosen amount goes through `postRows` | n/c (paying scope; see section 4) |

### D111 (a bill is the table's view of POS bills; Restro keeps only its own orders)

| # | Statement | Verdict |
|---|---|---|
| 111.1 | Restro never keeps a bill of its own; the POS is the truth | holds: one `bill_readings` row per table, overwritten in place (`packages/core/src/service/readings.ts:268-287`) |
| 111.2 | A reading is shared by every phone and refreshed a few times a minute at most | holds: `TABLE_READ_MIN_GAP_MS = 15_000` (`apps/worker/src/jobs/readings.ts:70, 100-104`), one `exclusive` read per table (`:350`) |
| 111.3 | Restro keeps its own orders (items, quantities, price shown, time, table, POS bill it went onto) | holds: `sent_orders` has `lines`, `totalMinor`, `sentAt`, `posBillRef` (`send.ts:325-343`, `sent-order.ts:131-144`) |
| 111.4 | Orders kept 18 months; no phone/device/IP identifier on them past the service day | holds: `retainUntil` = +18 months (`log.ts:162-166`, `RECORD_RETENTION_MONTHS = 18` at `:27`); a sent order stores only `consentVersion` (`send.ts:340`); the per-phone key lives in web memory only (`guest-limits.ts:105-110`) |
| 111.5 | "When the POS does not answer ... ordering and paying pause" and (header, quoting D120) "a failed reading pauses that table until its next good reading" | **mismatch -> RR-A10a-6** |
| 111.6 | Before each guest action on the bill the platform "knocks"; "your bill changed" message | n/c (paying action; D122 §6 forbids saying it on a partial reading, and the partial path says nothing: `readings.ts:230-253`) |
| 111.7 | Rounds a waiter enters are not kept | holds: only the reading shows them |

### D112 (how an order reaches the POS; paying parts are n/c)

| # | Statement | Verdict |
|---|---|---|
| 112.1 | "Each guest order opens its own POS bill" | superseded by D115 (header says so); code joins the table's bill (`target-bill.ts:32-56`) |
| 112.2 | "Restro never sends a second order" | holds (`order-send.ts:366-370` retries only after a definite `bill_closed` refusal, where "nothing was written") |
| 112.3 | "If no answer comes, it sends the identical stamped request again for about a minute" | conflict between decisions, not code: see Stop-and-ask and O-1 |
| 112.4 | The phone shows "Sending...", then "Added to your bill", or "We couldn't send your order, please call a waiter" | holds in state terms: `SENT_ORDER_STATES` (`guest.ts:418-427`); wording is the shell's (n/c) |
| 112.5 | Hold, write, capture; the server finishes each payment; refunds; group payment | n/c (paying) |

### D115 (no table visit; a guest's order joins the table's POS bill like a waiter's)

| # | Statement | Verdict |
|---|---|---|
| 115.1 | The bill a code shows is every open POS bill on the table; a closed one drops off | holds: `connector.ts:266` lists `state=open` bills; each is read (`:269-296`) |
| 115.2 | An on-the-bill order is added as a round to the table's oldest open POS bill; a new one only where "first items open a bill" is declared | holds: `target-bill.ts:49-55` (oldest of the joinable; open only if `firstItemsOpenBill` and (no bill or several allowed)); sim lists oldest first (`engine/engine.ts:1002-1005`) |
| 115.3 | "If the POS answers that the chosen POS bill has just been closed or locked ... Restro reads the table again and uses the next open POS bill, or opens a new one" | partly: closed holds (`order-send.ts:367-370`, and `addLines` re-reads, `connector.ts:362-375`); **locked -> RR-A10a-7** |
| 115.4 | A round that times out is checked, never sent twice: read the table's bills for about a minute, look for rows entered by Restro's POS user after the order went out; found -> Added; not found after the minute -> "call a waiter" and staff alerted | holds: `readBackWindowMs = 60_000` (`packages/core/src/timings.ts:25`), loop `order-send.ts:406-431`, matcher `landing-match.ts:131-186`; alert in `sent-order.ts:235-318` |
| 115.5 | Restro sends one order at a time per table | holds: `order_slot` lease (`sent-order.ts:81, 398-406`) |
| 115.6 | "Nothing happens at 07:00" (the service day does not cut the bill) | holds: nothing in the reading path uses the service day (the D124 rule on joining is in 115.8) |
| 115.7 | (D118/D122) accepted only at a table open for phones | holds: engine refuses `table_not_open` when no sitting (`engine.ts:275-276`; `send.ts:109-110`; `order.ts:46-47`) |
| 115.8 | (D124 §2, via spec #64 §1 and D115's refinement) "a sent order never joins a POS bill opened before the current service day" | **mismatch -> RR-A10a-11** |
| 115.9 | No ordering at the bar; table codes on tables only | holds: codes are per table, payment tables get none (`engine.ts:189` `isPaymentTable = false` in the code check) |
| 115.10 | The location check: never stored, fails closed | holds: `location-check.ts:64-74`, `guest.ts:1010-1013`; the position never reaches the engine |

### D116 (the life of an order)

| # | Statement | Verdict |
|---|---|---|
| 116.1 | Seven states: Waiting, Sending, Checking, Awaiting approval, Added, Not sent, Unconfirmed | holds: `sent-order.ts:62-66` |
| 116.2 | Not sent = "Certainly not in the POS: a clear 'no', a decline at the bar, or it never went out" | **mismatch -> RR-A10a-1** (a write that never left is reported `unknown`) and the decline at the bar is not read back (**RR-A10a-2**) |
| 116.3 | Not sent returns its lines to the bag; Unconfirmed has no "Try again" | holds: `giveLinesBack` (`sent-order.ts:159, 210-232`); Unconfirmed's lines stay out until staff answer (`sent-order-answer.ts:35-38, 66-67`) |
| 116.4 | Checked before the POS: sold-out/not orderable, ordering paused, table code no longer in use, #38's guards -> Not sent with the reason, lines stay | holds: `send.ts:116-124, 146-154, 168-205`; `engine.ts:177-197`. A changed price does not refuse (no price is compared) |
| 116.5 | "After Added, the platform reads the table's POS bills again, so every phone sees the new round within seconds" | **mismatch -> RR-A10a-5** |
| 116.6 | No cancelling after Send | holds: no command cancels a sent order (`commands.ts` has none) |
| 116.7 | Approval at the bar: Awaiting approval once the POS has it; "Restro sets no time limit"; no longer holds the table's turn | partly: turn released holds (`sent-order.ts:69, 190`); no further move and a 15-minute display limit -> **RR-A10a-2** |
| 116.8 | After Unconfirmed Restro stops checking; late landings go to the Log, never a resend or a state change | holds: `late-landing.ts:1-30, 140-175` (writes `matched_lines`, a Log entry, keeps `unconfirmed`) |
| 116.9 | Unconfirmed alert carries reference, items by the POS's names, time, bill before | holds: `sent-order.ts:294-306` |
| 116.10 | The table pause after Unconfirmed lifts at a waiter's act in the POS (only where the connector says who entered a line), a staff resume, all POS bills closed, or 15 minutes | holds: `readings.ts:182-198`, `sent-order-answer.ts:82-87`, `pauses.ts:41, 534-570` (see O-6 for a narrow case) |

### D117 (one shared bag per table, locks)

| # | Statement | Verdict |
|---|---|---|
| 117.1 | One bag (the table's order) shared by every phone; identical lines merge | holds: `table-order.ts:163-181` |
| 117.2 | "Send moves the on-the-bill lines out of the bag into one order at once"; two Sends at once make one order | holds: `takeSentLines` (`table-order.ts:389-427`), the second finds `order_empty` |
| 117.3 | "A Send is refused with 'Your table's bag changed' only if a line it sends changed in the second before" | **mismatch -> RR-A10a-8** |
| 117.4 | One order in flight per table; a Send meanwhile is Waiting, not refused; if the first ends Unconfirmed the table pauses and the waiting order becomes Not sent, lines back | holds: `sent-order.ts:160-183`, `send.ts:225-238` |
| 117.5 | Duplicate warning: same items and quantities, same table, last 15 minutes; "Send again" is a new action | holds: `send-guards.ts:29, 90-117`, `send.ts:183-189`. Scope is the same sitting (D122 makes the memory end with the sitting) |
| 117.6 | Single edits take the bag briefly and are put in order; no lock held while editing | holds: order row `FOR UPDATE` inside one short transaction (`rows.ts`, `engine.ts:269-281`) |
| 117.7 | Send holds the table's turn while Sending or Checking (up to about a minute and a half) | holds: leases derived from timings, `send-timings.ts:311-325` (checking = 60 s window + 25 s read + 15 s margin = 100 s) |
| 117.8 | No phone ever holds a lock | holds: locks are server leases (`leases.ts`) |
| 117.9 | Bag lives: idle 30 minutes -> "Earlier order · Restore", one kept; restarted by every edit and by Send; Undo "a few seconds" | holds: `table-order.ts:38, 48, 264-284, 423`; "the venue sets" the idle time and how many earlier bags: not implemented (constant), see O-4 |
| 117.10 | Bag ends: when sent or emptied; at the table's POS bills closing; at end of service day; "when the venue makes a new table code" | D122 replaced the end events by the sitting's end (header of D117 and D122 §4). Re-issuing ends no sitting (`SITTING_END_REASONS` has `code_reissued`, `sittings.ts:58-59`, never used: O-5) |
| 117.11 | Pay-first lines stay in the bag; one payment for the ticked lines; paying locks | n/c (paying) |

### D118 (guards against fake orders on the bill)

| # | Statement | Verdict |
|---|---|---|
| 118.1 | Only at open tables | superseded by D122 "open for phones"; see RR-A10a-12 (the old switch is still there but does nothing) |
| 118.2 | Location check: circle-touch test; a circle wider than about 1 km is "can't check"; no spot yet fails closed; refusal/no answer fails closed | holds: `location-check.ts:24, 64-74`, `guest.ts:1010-1013`, default `spot: null` (`ordering-settings.ts:116`) |
| 118.3 | Radius 150 m default, settable 100 to 500 m | holds: `ordering-settings.ts:89, 117` |
| 118.4 | The position is checked on the server in memory and dropped | holds: used once in `guest.ts:1010`; never passed to `applyService` |
| 118.5 | Cap per on-the-bill round: EUR 150 default; venue sets or switches off | holds: `ordering-settings.ts:81, 113`, `send.ts:195-197` (strictly above the cap trips) |
| 118.6 | Pace: at most 6 rounds per table per 15 minutes, settable 3 to 20 or off; beyond that "Ask your waiter" | holds: `send.ts:198-201` (the 7th is refused), `ordering-settings.ts:83, 114`, `send-guards.ts:32, 123-141` |
| 118.7 | A tripped guard makes the order Not sent with the reason, lines stay in the bag; the trip pauses the table until staff resume (D122) | holds: `send.ts:191-194` + `tripGuard` (`send-guards.ts:170-229`; lifts only at resume or sitting end: `sittings.ts:246`). D118's "until the pace drops" is replaced by D122 §4 ("staff resume it") |
| 118.8 | A table that hits the pace limit alerts the Restro team; trips are counted per venue and table | holds: `send-guards.ts:230-265` (audience `restro`, one open per table); `guard.tripped` Log entry per table, guard and minute (`:182-198`) |
| 118.9 | Guards apply only to on-the-bill orders; pay-first never blocked, located or limited | partly: location holds (`guest.ts:890-898`); Turnstile and the phone's Send limits do apply to a pay-first-only Send (`guest.ts:920-922, 1032-1044`); D127 (paying) may have changed this: n/c |
| 118.10 | Consent text and consent versions | n/c here (shell strings); version check holds (`guest.ts:1005`) |

### D122 (ordering sections: words, capabilities, ordering on the bill, sitting, location pass, limits, sent order, did it land, stock, service hours, pauses)

| # | Statement | Verdict |
|---|---|---|
| 122.1 | A table takes phone orders only while open for phones (a sitting with no end) | holds (115.7) |
| 122.2 | "Ask your waiter to put your first item on" where "first items open a bill" is undeclared and the table has no POS bill | holds in form (`send.ts:179-181`) but trusts a stale reading: **RR-A10a-4** |
| 122.3 | Sitting ends when a complete reading shows the POS bill gone or empty after it held lines (not one opened before the first item, not lines on a payment table), staff close, "New guests" | holds: `bill.ts:377-380`, `readings.ts:291-304`, `sittings.ts:288-298, 424-441` |
| 122.4 | When it ends: passes, the unsent order, the duplicate memory stop counting; the server refuses old data | holds: `endSitting` (`sittings.ts:210-247`), pass names the sitting (`engine.ts:198-212`, `location-pass.ts:94-102`), duplicates are per sitting (`send-guards.ts:104`) |
| 122.5 | Seeing the bill and the order needs a pass from the current sitting; the menu only the code | holds: `guest.ts:466, 471, 495, 518` |
| 122.6 | Pass signed (HMAC) with venue, code generation, sitting, expiry (2 h default, 30 min to 6 h, never past the service day); re-issuing or ending the sitting kills it | holds: `location-pass.ts:27-35, 94-102`, `location-check.ts:89-107`, `ordering-settings.ts:91, 118` |
| 122.7 | Removing a line and Undo are never located | **mismatch -> RR-A10a-9** (a quantity change that removes is) |
| 122.8 | Limits per phone: 30 additions a minute, one Send per 15 s, 10 Sends in 10 minutes, 5 location tries in 10 minutes; per table code 20 requests a second; per table 60 order changes a minute | values hold: `guest-limits.ts:124-139`, `table-order.ts:54`, `engine.ts:289-300`; **scope of the Send limits: RR-A10a-3** |
| 122.9 | D118's cap and pace pause the table for "ask your waiter"; staff resume it | holds (118.7) |
| 122.10 | Send names the table and counts only on-the-bill lines | holds: `send.ts:162-205` (n/c for wording) |
| 122.11 | States Sending -> Added, Not sent or Unconfirmed; "Awaiting approval" only with that capability | holds: `order-send.ts:382, 421` |
| 122.12 | Lines' state shows on every phone; "Sending..." progress only on the sending phone; "Not confirmed: show K7Q" for 15 minutes | holds in the data: `guest.ts:471-491` (all phones get state and `ref`; 15 minutes: `:96, 477`); the "sending phone" distinction is the client's (`services-client.ts`, `mine.add`): n/c |
| 122.13 | A sold-out line is marked as soon as the overlay shows it, Send offers "Send the other 4" | holds: `send.ts:143-154`, `send-menu.ts:274-283` |
| 122.14 | Did it land: read the bill just before sending and again after a timeout; match new lines itself; alert only when it can't tell | holds: `order-send.ts:322-335, 397-431` |
| 122.15 | (spec #64 §8) Without Restro's reference on the line, a match counts only lines that appeared after the read before, and only if nothing else changed the bill; "a waiter's identical round in that window makes it Unconfirmed, never Added" | **mismatch -> RR-A10a-10** |
| 122.16 | Notes and options only where the connector declares them; otherwise no note field, fixed line, required-options items "from the waiter" | holds: `send.ts:168-178` (all options are refused, not only required ones: consistent with "options show only where declared") |
| 122.17 | Stock: two passes (menu reading where declared; check right before Send where `itemAvailability` is declared; else the POS refusal that names the item); the mark is POS-sourced through `apply()`; found at Send, nothing of that order is sent; the mark clears when a later reading shows the item available | holds: `order-send.ts:265-293, 384-393`, `apply/stock.ts:176-216`, `stock.ts:42-60`, tick `jobs/stock.ts:202-230`. Extra not in the text: marks lapse at the service day's end (O-3) |
| 122.18 | Service hours: each weekday open or closed; opening, last orders, closing (past midnight allowed); last orders at least 15 minutes before the day ends; "Last orders at ..." 10 minutes before; after last orders closed; closing closes every table | holds: `ordering-settings.ts:17-23, 146-158`, `service-hours.ts:111-151, 181-200`, `closing-hour.ts:17-25`. A venue with no weekday opened is not gated at all (O-2) |
| 122.19 | Pre-opening check: from 2 hours before opening, every 10 minutes, alert 30 minutes before; none on a closed night | holds: `ordering-settings.ts:45`, `service-hours.ts:166-180` |
| 122.20 | Pauses: one pure breaker with injected clock; 3 s probe through the same path as an order; backoff with jitter; lift after 3 good probes; 5-minute watch; third automatic pause in 30 minutes holds at least 10 minutes; after a write timeout the next order waits for a good probe | holds: `breaker.ts:33-58`, `order-send.ts:244-254` |
| 122.21 | "A partial reading is a failed reading. It never clears an order, lifts a table pause or refuses with 'Your bill changed'" | holds: `readings.ts:230-253` (no sitting end, no order change, no lift), `late-landing` and `liftUnconfirmed` run only on a complete reading |
| 122.22 | A table that vanishes from a complete floor reading is marked, never deleted; its open sitting pauses rather than ends | holds: `apply/floor.ts:314-335`, `service/floor-pause.ts` |
| 122.23 | Staff pauses (all bars or one), Restro pause has no button; "Closed" means bill gone or empty | holds in the parts read (`pause-scope.ts:47-62`); the staff-pause UI is Tonight (not covered) |
| 122.24 | Sent orders' retention: notes erased at 31 days; sent orders at 18 months | holds: `apps/worker/src/jobs/purge.ts:1037-1055` |

### Rules 5, 6, 7 in this cluster

| # | Statement | Verdict |
|---|---|---|
| R5.1 | Stock marks only make the menu more cautious (never `true`, never clear the POS's own flag) | holds: `stock.ts:42-60`, `apply/stock.ts:197-216` (`value: false` only; clear only a stock record's own mark) |
| R5.2 | The live overlay can only mark sold out | holds: `snapshot/overlay.ts:19-30` |
| R5.3 | Send never changes an item's price or sends what the guest could not order | holds: price from the snapshot (`send-menu.ts:290-326`); no price field in a normal row (`write/index.ts:11-17`, `connector.ts:379-390`) |
| R6.1 | A partial floor, table, availability or stock reading concludes nothing | holds: `apply/floor.ts:134-135`, `readings.ts:230-253`, `stock.ts:46`, `order-send.ts:275` (incomplete availability: go on) |
| R6.2 | A list with a failed or short page is incomplete | holds: `connector.ts:233-263` (page counts, `changed while it was read`, count check) |
| R6.3 | Absence ends a sitting only after a complete reading | holds (122.3) |
| R6.4 | "No POS bill" at Send needs a complete reading | partly: complete yes, from this sitting no: **RR-A10a-4** |
| R7.1 | Only waiter acts | holds (110.1 to 110.4) |

---

## 2. Candidate rows

Format: id | proposed severity | file:line | decision/rule text quoted | failure scenario | evidence | confidence. None is critical: no path found that doubles a write, loses money, crosses organisations or writes outside the waiter's acts.

**RR-A10a-1 | medium | `packages/connectors/sim-pos/src/connector.ts:362-369` and `apps/worker/src/jobs/order-send.ts:360-376`**
Text: D116 "**Not sent** | Certainly not in the POS: a clear 'no', a decline at the bar, or it never went out". D112 "A timeout tells Restro nothing about whether the order landed"; spec #64 §1 "a timeout is always `unknown`".
Scenario: if the connector's own table read inside `addLines` is incomplete (or throws, e.g. a 404 for a bill that closed between listing bills and reading its rows, `failureOf` throws on 404) while nothing has been written, then it answers `unknown`, the worker records a `write_timeout` on the breaker (next order waits for a good probe) and reads back for a minute, finds nothing, and the sent order ends Unconfirmed: the table pauses, staff get the "order not confirmed" alert, the guest sees "show K7Q to your waiter", although the round never left. The worker already read the table (three tries) just before, so this second read is a pure extra failure window.
Evidence: `return unknown(\`the table read incomplete before the round, which was not sent: ${before.reason}\`)` (`connector.ts:365-369`); the interface has only `done | refused | unknown` and no refusal code for "not sent, transient" (`packages/core/src/connectors/service/schemas.ts:52-81, 98-117`); `catch (error) { ... return { kind: 'unknown', reason: 'the add threw' } }` with the comment "A throw after the request left may mean it landed" (`order-send.ts:360-363`).
Confidence: high on the code path; the choice of word is the connector's seam, so this is a decision-versus-interface gap rather than a coding slip.

**RR-A10a-2 | medium | `packages/core/src/service/sent-order.ts:62-69`, `packages/core/src/service/guest.ts:96, 477`**
Text: D116 "Because the POS already has the rows, an order awaiting approval no longer holds the table's turn. Restro sets no time limit: the bar's decision lives in the POS." and "**Added** | The POS has it (and, with approval on, the bar approved it)"; "**Not sent** ... a decline at the bar".
Scenario: if a connector declares `approvalAtBar` (the sim switch exists), then a sent order goes `awaiting_approval`, which `MOVES` treats as settled with no outgoing move, and no job reads approvals back; it never becomes Added or Not sent. The guest's card ("Waiting for the bar to confirm...") also disappears 15 minutes after `settledAt` because `ENDED_SENT_ORDER_MS` applies to every settled state, so after 15 minutes the phone shows nothing for an order the bar may still decline, and the lines are not given back on a decline.
Evidence: `const MOVES = { waiting: [...], sending: [... 'awaiting_approval' ...], checking: [...] }` (no `awaiting_approval` key; `sent-order.ts:62-66`); `SETTLED_STATES = ['added', 'awaiting_approval', 'not_sent', 'unconfirmed']` (`:69`); `const ended = sent.settledAt !== null && now - sent.settledAt.getTime() > ENDED_SENT_ORDER_MS` (`guest.ts:477`); grep of `awaiting_approval` in non-test code shows only the two setters in `order-send.ts:382, 421`.
Confidence: medium-high. D116 says read-back is "worked out per connector" and spec #64 §8 says "Tonight shows it read-only", so the missing move may be intended for later; the 15-minute cut is not.

**RR-A10a-3 | medium | `packages/core/src/service/guest.ts:977-987` with `packages/core/src/service/guest-limits.ts:128-130`**
Text: D122 §4 "Request rates count per phone ... one Send per 15 s; 10 Sends in 10 minutes"; spec user story 11 "to send the rest with one more tap"; story 9 "Send another?".
Scenario: if a Send is refused for a reason after the limits were taken (`item_unavailable`, `duplicate_order`, `order_changed`, a first-time `location_needed`, a failed Turnstile), then the phone's `sendGap` allowance (1 per 15 s) and one of its 10 `sends` are already spent, so the very next tap ("Send the other 4", "Send another", the Send after the consent screen) within 15 s answers 429 `rate_limited` ("Too many changes at once. Wait a moment.", `strings.ts:560`) instead of going through. Ten refused attempts also exhaust the 10-in-10-minutes allowance with no Send made.
Evidence: `const phoneLimit = limiter.take(\`${target.hash}:${input.phone}\`, phoneLimits(input.command, position !== undefined), Date.now())` runs before `readGuard`, the location test, Turnstile and the engine (`guest.ts:977-987`); `phoneLimits` adds `'sendGap', 'sends'` for every `order.send` (`:920`); `services-client.ts:767` turns 429 into `rejected rate_limited`.
Confidence: high that the order is as described; medium that the decision means accepted Sends only ("Request rates" can read as every request).

**RR-A10a-4 | medium | `packages/core/src/service/send-guards.ts:147-163` and `packages/core/src/service/sittings.ts:234-237`**
Text: D122 §4 "the first sent order is refused with 'Ask your waiter to put your first item on'" only "where the table has no POS bill"; send-guards.ts's own header "No reading, an incomplete one or an older one concludes nothing (rule 6)"; read-side rule `reading.readAt < sitting.openedAt` = not this sitting's (`read.ts:586`).
Scenario: if staff tap "New guests" or "Close" while the old group's POS bill is still open, `endSitting` empties the table's reading (`bills: []`) but leaves `complete: true` and the old `readAt`; the new sitting starts at once, and for up to 2 minutes (`FIRST_ITEM_READING_MAX_AGE_MS`) `tableHasNoPosBill` reports "complete, fresh, no bill", so on a connector without `firstItemsOpenBill` (the pilot's expected case) the new group's first Send is refused `needs_first_item` although a POS bill exists. Same effect after a `bill_closed` end when a waiter opens a new bill within 2 minutes.
Evidence: `.set({ bills: [], ...stx.provenance })` with no change to `complete` or `readAt` (`sittings.ts:234-237`); `if (reading === undefined || !reading.complete) return false; if (now.getTime() - reading.readAt.getTime() > FIRST_ITEM_READING_MAX_AGE_MS) return false; return reading.bills.length === 0` with no comparison to the open sitting's `openedAt` (`send-guards.ts:160-162`); the read path does compare (`read.ts:586`).
Confidence: medium-high. Failure is on the cautious side (a wrong refusal for up to 2 minutes, then a reading overwrites it).

**RR-A10a-5 | low | `apps/worker/src/jobs/order-send.ts` (no queueing after `settle('added')`, lines 380-383, 420-425)**
Text: D116 "After Added, the platform reads the table's POS bills again, so every phone sees the new round within seconds instead of at the next refresh of D111's shared reading." D122 §4 "Every phone sees ... on the bill".
Scenario: if a round is Added, the bill shown to every phone stays the last reading until the next one: the tick (`TABLE_READ_INTERVAL_MS = 60_000`) or a phone on the bill view when the reading is over 15 s old (`FRESH_READING_MS`, queued only for `view === 'bill'`, `guest.ts:696-708`). A phone on the menu or order view sees the sent order as Added but the new lines missing from the bill for up to a minute.
Evidence: `JOB_NAMES.tableRead` is queued only from `guest-api.ts:333` and the tick (`readings.ts:397-402`); `sendOne` never queues it though `env.queue` is passed in (`order-send.ts:615`).
Confidence: medium (the read-back loop reads the table but does not record it through `reading.record`).

**RR-A10a-6 | medium | `packages/core/src/service/readings.ts:230-253`, `apps/worker/src/jobs/readings.ts:216-229`**
Text: D111 header (quoting D120 #39): "a failed reading pauses that table until its next good reading"; D111 body "When the POS does not answer, the phone shows the last reading with its age ... and ordering and paying pause (D102)"; D120 line 13 "A single failed reading of one bill only pauses that table until its next good reading (D111)". D122 §6 text only says a partial reading "never clears an order, lifts a table pause or refuses with 'Your bill changed'".
Scenario: if one table's reading fails (a read times out) while the connection as a whole is fine, then no table pause starts: phones show the last bill flagged not up to date and ordering stays `on`; a Send still goes (it reads the table itself). The decision text says that table pauses until the next good reading.
Evidence: the incomplete branch only updates `complete: false` and `readSeq` (`readings.ts:246-249`) and touches the version; the job records one failed call on the breaker (`jobs/readings.ts:225-229`) which pauses the connection only after 60 s of failures with at least 3 attempts (`breaker.ts:10-11`).
Confidence: medium. D122 §6 may be read as having superseded the single-table pause, but it does not say so.

**RR-A10a-7 | low | `apps/worker/src/jobs/order-send.ts:347, 367-370`; `packages/connectors/sim-pos/src/connector.ts:170-173`; `packages/core/src/connectors/service/target-bill.ts:38`**
Text: D115 "If the POS answers that the chosen POS bill has just been closed or locked, that is a definite 'no': Restro reads the table again and uses the next open POS bill, or opens a new one."
Scenario: if the chosen bill is locked by staff (`bill_locked`), then there is no second try: the sent order ends Not sent with reason `bill_locked`, lines back. Even if a second try existed, `excludeBills` is always `[]` (`:347`), so the locked bill, still open and oldest, would be chosen again.
Evidence: `if (outcome.kind === 'refused' && outcome.refusal.code === 'bill_closed') { outcome = await add() }` and `excludeBills: []`; a refusal otherwise reaches `settle('not_sent', refusal.code)` (`order-send.ts:394`).
Confidence: high; low impact on a one-bill POS (there is no next bill), real only with several bills per table.

**RR-A10a-8 | low | `packages/core/src/table-order.ts:401-415`**
Text: D117 "A Send is refused with 'Your table's bag changed' only if a line it sends changed in the second before; the phone refreshes and the guest taps again."
Scenario: if a friend adds a drink to the shared order a moment before the guest's Send arrives (inside the 2 s poll gap), the guest's Send names 5 lines but the order has 6 sendable lines, so it is refused `order_changed` although none of the 5 lines it sends changed.
Evidence: `if (requested.length !== sendable.length) return { ok: false, code: 'order_changed' }` (`table-order.ts:405`).
Confidence: high on the code; whether "only if a line it sends changed" excludes a newly added line is a reading of D117 ("Send moves the on-the-bill lines out of the bag"), so keep severity low.

**RR-A10a-9 | low | `packages/core/src/service/guest.ts:890-898`**
Text: D122 §4 "Removing a line and Undo are never located." Spec user story 27 "removing a line and Undo never ask for my location, so that undoing is always free."
Scenario: if a guest whose pass expired taps the minus on a line with quantity 1, the phone sends `order.change` with delta -1, which `applyOrderEdit` turns into a removal (`removedAt` set), but `isLocated` is true for every `order.change`, so the guest gets the consent/location flow instead of "Removed · Undo".
Evidence: `type === 'order.add' || type === 'order.change' || type === 'order.restore' || type === 'location.check'` with no look at `command.delta` (`guest.ts:892-897`), while `phoneLimits` does look at the sign (`:918`); removal by change: `qty <= 0 ? { ...line, removedAt: now }` (`table-order.ts:230`).
Confidence: medium-high.

**RR-A10a-10 | low | `packages/core/src/landing-match.ts:168-185`, `packages/core/src/connectors/service/landed.ts:57-62`**
Text: spec #64 §8 "a match counts only lines that appeared after the read before sending, and only if nothing else changed the bill; a waiter's identical round in that window makes it Unconfirmed, never Added." landed.ts header: "A waiter's identical round in that window makes it `ambiguous`, never `landed`."
Scenario: where the POS declares neither `ownLineReference` nor `whoEnteredLine` (the cautious sim profile, and the likely pilot case), if the write truly never landed and a waiter enters exactly the same items and quantities within the window, then the new lines equal the sent round and the verdict is `landed`: the sent order is Added on a waiter's round. If Restro's own write was only slow and lands after, it is then not matched to anything (Added orders keep no basis) and the table gets the round twice.
Evidence: `return sameMultiset(keys, sentKeys) ? landed(fresh) : { kind: 'ambiguous', reason: 'other new lines are on the bill' }` with `fresh` = every line not in the before-read (`:181-185`). The tests cover Restro's round plus a waiter's identical one (both present), not the waiter's alone.
Confidence: medium. Without a marker the two cases cannot be told apart by data, so the sentence in the spec cannot be fully met; the finding is that the header and spec promise it.

**RR-A10a-11 | medium | `packages/core/src/connectors/service/target-bill.ts:42-45`, `packages/connectors/sim-pos/src/switches.ts:197-198`, `connector.ts:274-277`**
Text: D115 (header, D124 §2) "a sent order never joins a POS bill opened before the current service day; it joins the oldest of this service day, else opens one where allowed, else 'Ask your waiter'"; capabilities.ts header "Undeclared means 'not claimed': the cautious answer, never 'unknown, so assume yes'".
Scenario: if the connector does not declare `billOpeningTime` (the sim never does: `billOpeningTime: false`, `openedAt: null` on every bill), then a bill a waiter left open from last night is the oldest open bill and the sent order joins it: the guest's round lands on yesterday's bill. The rule is only applied `if (capabilities.billOpeningTime)`.
Evidence: `if (capabilities.billOpeningTime) { if (bill.openedAt === null) return false; if (new Date(bill.openedAt).getTime() < dayStart) return false }` and the file's comment "Where the POS gives no opening time ... the rule can't be checked, and the connector has declared so" (`target-bill.ts:42-47, 8-9`).
Confidence: medium. The code says openly it cannot check; the disagreement is with "never" and with the capabilities header's cautious reading (the cautious answer would be to refuse). Report the disagreement, no verdict.

**RR-A10a-12 | low | `packages/core/src/ordering-settings.ts:79, 112`; `apps/web/src/settings/ordering-panel.tsx:126-134`**
Text: D122 §4 "Open for phones (replaces D118's open-table rule, which needed a POS bill a waiter had started)"; D118 "Only at tables a waiter has opened: on."
Scenario: if an owner switches "Only at tables a waiter has opened" off, nothing changes: no code reads `onlyOpenTables`, so tables still need staff to open them for phones. The switch is shown in the owner's ordering settings and saved, but dead.
Evidence: `grep onlyOpenTables` in non-test code finds the schema, the default and the panel only.
Confidence: high.

---

## 3. Observations (true, not candidates)

- **O-1. Resend of a stamped new-bill open.** See Stop-and-ask above (D112, D115, D116 against D122 §3 and spec #64 §8). Code: never resends (`order-send.ts:366-431`).
- **O-2. A venue with no weekday opened is not gated.** `guestNight` returns `open` when every weekday is null (`service-hours.ts:196-198`, `hoursConfigured`), and the closing-hour and pre-opening ticks skip such a venue (`jobs/service-hours.ts:63-77`), while `ordering-settings.ts:3-5` says "every weekday closed until the owner sets service hours". An owner who sets every day to closed gets the same as one who never set anything: phones may send and tables never close by themselves. Staff still must open a table for phones, which is the main gate.
- **O-3. Stock marks lapse at the service day's end** (`stock.ts:62-75`, `jobs/stock.ts:221`). D122 says the mark clears when a later reading shows the item available. On a connector that cannot be asked, an item the POS still lacks is sold again the next night until a guest's Send is refused. Not a rule 5 break (the mark was Restro's own inference).
- **O-4. Idle time and earlier-bag count are constants** (`table-order.ts:48`), D117 says "the venue sets" them; spec #64 §3's settings list does not include them.
- **O-5. `code_reissued` is a listed sitting end reason and a DB check value but nothing ends a sitting with it** (`sittings.ts:58-59`; grep). After re-issue the order and sitting stay; old passes die through `codeGeneration`. D117 says a new table code ends the bag; D122 §4 lists only three ends.
- **O-6. `liftUnconfirmed` and a staff line without a time.** Where the POS says who entered a line but not when, any staff line new since the last stored reading lifts the Unconfirmed pause (`readings.ts:188-195`), even one entered before the pause. D120's "waiter acts" would want after.
- **O-7. Send maximum age is 30 s**, spec #64 §5 says "Sends older than 60 s are refused" (`commands.ts:332` uses `ORDER_EDIT_MAX_AGE_MS`, `table-order.ts:51`). D121's text says only "much later". The age is client-supplied (`ageMs`), by design.
- **O-8. Turnstile and per-phone Send limits also apply to a pay-first-only Send** (`guest.ts:1032-1044`, `:920-922`); spec #64 §6 says Turnstile "at on-the-bill Send only"; D127 (paying) may govern.
- **O-9. Wrong-code counting covers `/t/<code>` only** (`apps/web/app/t/[token]/route.ts`); `/api/guest/*` answers an unknown code with 401 `code_retired` and no count (spec #64 §4 "After 20 wrong codes ... Turnstile"). With 128-bit codes this is a rate matter only.
- **O-10. Rows tied to a sitting's reading**: `readingTargets` ignores a reading older than the sitting (`jobs/readings.ts:333-334`), the guest read does too, only Send's guard (RR-A10a-4) does not.
- **O-11. The `sent_order.expire` sweep turns any `sending` or `checking` holder into Unconfirmed `check_timed_out`** (`sent-order.ts:491-500`), including a worker that died before the POS call; safe, but costs an alert and a pause for a round that never left.

---

## 4. What I could not cover

- Paying (D113, D125 to D127, D122 §8) and the tip row written with a Restro-chosen amount (`write/index.ts:11-17`, `connector.ts:515-531`): another reader's.
- Tonight, alerts delivery, Telegram, PINs, roles (D120/D123, D122 §7): another reader's. I read only the alert rows the ordering path raises.
- `packages/connectors/sim-pos/src/engine/*` (about 1,900 lines) and the wire: I read the connector, switches and write module, and only grepped the engine for list order. Whether the simulated POS answers 404, 409 or 200 for rows of a bill that closed mid-read decides how often RR-A10a-1's throw path happens.
- The guest page and shell strings (`packages/shell`, `apps/web/src/guest`): only the 429 handling and the sending-phone marker were read, so "progress only on the sending phone" and all wording are n/c.
- The barsy service capabilities (`packages/barsy/src/service`) and any real connector's mapping.
- Database-level checks (RLS, CHECK constraints) and the migrations; `purge.ts` beyond the service step; `service-day-close.ts`; `apply-service.ts` registry wiring; `leases.ts` internals (read headers only).
- Rule 6 for menu sync (barsy full read): outside the orders cluster; only floor, table, availability and stock readings were checked.
- Nothing was run, so no candidate has a reproduction yet; every scenario is from reading.
