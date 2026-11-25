# A10c decision reader: guests and operations (D119, D120, D121, D122 §7, D123, screen plans)

**Agent:** A10c, subagent of the lead session. **Plan:** `docs/deliverables/2026-10-29-repair-review-plan.md` §4 (A10a-c), §5, §6.
**Pinned commit:** `16b59a82` (`git rev-parse HEAD` in `E:\Restro\.claude\worktrees\rr-pinned`: `16b59a823d3a27c72bd2031bd7b44588df3ba366`, match). Read-only: nothing edited, no test run, no POS, Stripe, staging or production call. Tests were context only; every verdict below comes from the code or a string.

## Deviations from the brief (stated, not silently fixed)

- **The "## Screen plan" sections are not in issues #85, #86, #87 and #61.** Their bodies name the plan files instead. I read those files, which are the confirmed plans: `docs/deliverables/2026-10-21-tonight-screen-1-plan.md` (#85, with its §10-§12 answers and Martin's 10-26/10-27 confirmations), `2026-10-27-tonight-sent-orders-plan.md`, `-tonight-log-plan.md`, `-tonight-end-of-night-plan.md` (#86), `2026-10-27-settings-hours-ordering-plan.md`, `-settings-staff-roles-plan.md`, `-settings-alerts-export-plan.md`, `-owner-settings-grouping.md` (#87, #61). The two paying plans (`2026-10-29-settings-paying-plan.md`, `2026-10-29-tonight-paying-plan.md`) belong to A10b and were not read.
- **`docs/guides/copy-rules.md` does not exist.** The file is `.claude/skills/template-review/references/copy-rules.md` (read in full). Issue #85's "Read:" line and the brief both name the shorter path.
- Line numbers refer to the pinned tree. `apps/web/src/tonight/*` files were read whole except `money-rows.tsx`, `payment-sheet.tsx`, `night-payments.tsx`, `night-slots*.ts*`, `dispute-evidence.tsx` (part 2, A10b).

## Stop-and-ask items for the lead (two texts that pull apart)

1. **D120 vs D122 §7, money alerts outside service hours.**
   - D120 "How often": "Nothing alerts outside service hours except the pre-opening check and one "still paused" at opening time."
   - D122 §7, Telegram: "money alerts, repeated every 5 minutes until "Done", outside quiet hours too."
   - The code follows D120 for every kind and ignores D122 §7's money line (candidate RR-A10c-1). Recommendation: D122 §7 is the later decision and the money one; follow it for payment kinds (`outsideServiceHours: true`, a 5-minute Telegram repeat until Done), and say in one sentence in D122 which kinds it covers.
2. **D119/D121 vs `docs/guides/menu-template-functionality.md` ("Confirm being at the table").** The decisions put a Privacy link on the consent screen and a "Stop location check" control on the bill and in the "Why?" line (RR-A10c-2, -3). The guide the template agents built from says the consent shows "Allow" and "Not now", "never a promise of anything else", and lists no Privacy link and no stop control. The guide is where the gap started; fix it with the code.

---

## 1. Checkable statements and verdicts

Verdicts: **H** holds, **M** mismatch (a candidate row or observation names it), **P** partly, **U** cannot be judged by reading (named in §4).

### D119: the consent screen, its proof and paperwork, Turnstile (11 statements: 5 H, 3 P, 2 M, 1 U)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Consent names who checks and why, "never stored", the alternative, "stop anytime" (four things the law needs); D122 refinement: names seeing the bill, drops "call a waiter", drops "pay" | H | `packages/shell/src/strings.ts:515-516` (EN), `:855-856` (BG) |
| 2 | Buttons [Allow] / [Not now] | H | `packages/faces/qr-phone/src/table-order.tsx:471-490` |
| 3 | Consent text carries a [Privacy] link ("details sit behind the privacy link"; D121's text ends "[Privacy]") | **M** | `table-order.tsx:471-490`: a `<p>` and two buttons, no link; `legalPrivacyLink` exists only for the pay screen (`pay-panel.tsx:281`). RR-A10c-2 |
| 4 | "Stop location check": a small control in the "Why?" line and on the bill; after it, orders take the refused path | **M** | Not built. `LocationControls` has `allow/decline/reopen/dismiss` only (`packages/shell/src/services.ts:625-632`); `decline()` is wired once, to "Not now" (`table-order.tsx:483`). RR-A10c-3 |
| 5 | Once per phone per service day; shows even when the browser already allows location | P | Kept in the tab's `sessionStorage` (`apps/web/src/guest/use-table-services.ts:42-60`, `services-client.ts:155,434-445`): per tab, not per phone. RR-A10c-17 |
| 6 | A browser that blocks location counts as a refusal; the phone isn't asked again that day | P | A block after "Allow" gives the failed screen and leaves consent `allowed` (`services-client.ts:816-840`), so the next attempt asks the browser again. RR-A10c-17 |
| 7 | Proof: each on-the-bill order records the consent version, no coordinates, no phone identifier | H | `packages/core/src/service/guest.ts:1087-1136` (version in the pass's claims, position used for the circle test only), `send.ts:340` |
| 8 | Turnstile only at Send (and Pay, D127), never on the menu pages | H | `apps/web/src/guest/turnstile.ts:105-137` (script loads at the first token request), `guest.ts:1121-1131` (`order.send` only) |
| 9 | Turnstile "invisible only: guests never see a bot check" (Martin 10-29); managed mode, feedback off, pre-clearance off | P | `feedback-enabled: false` is set (`turnstile.ts:63`). The widget uses `appearance: 'interaction-only'` (`:62`), which shows a challenge when Cloudflare asks; "invisible" and pre-clearance are dashboard settings. Observation O-9; A8 |
| 10 | Paperwork before the first guest (privacy notice items, DPIA, records, venue clause) | U | T31 is open in `docs/open-items.md:133`; not code |
| 11 | The law paragraph: refusing may block on-the-bill orders, but pay-first and "call a waiter" stay | H | `guest.ts:966-971` (pay and waiter call never located), `table-order.tsx:490-518` (failed screen offers a waiter call or the still card) |

### D120: pauses, alerts, the Log (26 statements: 15 H, 6 P, 4 M, 1 U)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Venue pause: no call succeeded for 60 s with 3+ attempts | H | `packages/core/src/service/breaker.ts:46-47,230-236` |
| 2 | The POS refuses outright: pause at once | H | `breaker.ts:251-252`, `apps/worker/src/jobs/service-hours.ts:193-201` |
| 3 | 3 orders at different tables Unconfirmed within 10 minutes | H | `breaker.ts:51-52,256-262` |
| 4 | Owner's "Pause ordering": one tap, no dialog, undo | P | One tap, no dialog (`tonight-panel.tsx:114-129`); the Undo toast is missing on the tablet (RR-A10c-12) |
| 5 | Pre-opening check 2 h before opening, owner and team alerted with the reason, venue opens paused until a check passes | H | `service-hours.ts:155-228` (the alert from 30 minutes before, per D122 §4) |
| 6 | Probes 15, 30, 60 and 120 s apart | **M** | `breaker.ts:52`: `[15, 30, 60]` s, no 120 s step. RR-A10c-18 |
| 7 | After a refusal gaps run 60 s up to 5 min; each randomised | H | `breaker.ts:53,168-172` |
| 8 | Lasts at least 60 s; 3 good probes in a row lift it | H | `breaker.ts:44,63,228-247` |
| 9 | 5-minute watch: one Unconfirmed or 2 failed calls pause again | H | `breaker.ts:46-47,262-266,296-300` |
| 10 | Third automatic pause in 30 minutes holds 10 minutes and tells the team | H | `breaker.ts:41-42,208-212` |
| 11 | The count of Unconfirmed orders restarts when a pause lifts | H | `breaker.ts:236-241` (`closedBreaker()` on lift) |
| 12 | The owner can't lift a pause Restro started; a Restro admin account can lift any pause | P | Core refuses non-operators (`pauses.ts:279`) and grants the operator `ordering.lift` (`permissions.ts:71-75`); Tonight draws no button for a Restro pause for anyone (`pause-banners.tsx:112-121`). RR-A10c-19 |
| 13 | Table pause lifts at a waiter's act, a staff resume, all bills closed, 15 minutes | P | 15 minutes (`pauses.ts:41`) and resume (`:331-340`) read; waiter-act and bills-closed belong to A10a |
| 14 | Guest: one calm line on every venue pause, no cause, no countdown, bill keeps last reading with its age | H | `table-order.tsx:317`, `services-client.ts:195-216` |
| 15 | Send and Pay greyed, pay-first too; bag stays editable | P | Pay is greyed with `cards_paused` (`pay-panel.tsx:599-612`); Send is not drawn at all (`table-order.tsx:429`), not greyed; the bag stays editable. RR-A10c-21 |
| 16 | Restro silent about 10 s: phone pauses itself, keeps the bag, retries quietly | P | Retries yes (`POLL_BACKOFF_MS`), bag kept; the notice appears only when a request finishes, and Send is not blocked. RR-A10c-5 |
| 17 | After Send with no answer: "We can't reach Restro right now. If your order isn't on your bill in a few minutes, please call a waiter" with the reference, never "Try again" | **M** | No such string; a lost answer settles `pending` and the face shows nothing (`services-client.ts:758-762`, `table-order.tsx:278-300`). RR-A10c-4 |
| 18 | "Show this to your waiter" panel: items, time, short reference | H | `table-order.tsx:136-190` (time on the phone's clock: RR-A10c-20) |
| 19 | Push texts "Ordering is paused at [venue]", "Ordering is back", per Unconfirmed order with items, ref, "Check the bill in {source}" | H | `packages/core/src/service/alert-text.ts:121-133,334-345` |
| 20 | A push tap opens the Log | **M** | `apps/worker/src/alerts/deliver.ts:85-87,526`: the venue page; default tab is Composer (`workspace-tab-defs.ts:52`). RR-A10c-8 |
| 21 | Alert pace: first Unconfirmed push after 10 s then one a minute, one reminder after 10 min; pause: one start, one end, owners one reminder at 60 min, team hourly max 3; team Unconfirmed every 10 min | H | `alert-rules.ts:155-179`, `alert-delivery.ts:224-232,260-278` |
| 22 | "Nothing alerts outside service hours except the pre-opening check and one "still paused"" | H | `alert-delivery.ts:182,199-209,220-223`, `alert-rules.ts:180-186`. Holds as D120 reads; conflicts with D122 §7 for money (stop item 1; RR-A10c-1) |
| 23 | The Restro team gets every alert by Telegram | P | Not stock notices, refunds, disputes (`alert-rules.ts:194,282-283`). Observation O-16 |
| 24 | Outside watchdog: Healthchecks.io every minute | U | No file in my list |
| 25 | The Log: one entry per step; venue owners and managers see all of their venue's Log | H | `night-read.ts:602-690` |
| 26 | Only the Restro team sees the POS calls and the team's own alerts | **M** | POS calls and `lease.taken_over` are hidden (`log-view.ts:44`); the team's own alerts are not. RR-A10c-9 |

### D121: how the guest page talks to the platform (20 statements: 14 H, 4 P, 1 M, 1 U)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | Two endpoints (`GET /api/guest/state`, `POST /api/guest/actions`); D127 adds `/api/guest/payment` | H | `apps/web/app/api/guest/*/route.ts`, `server/guest-api.ts:197-303` |
| 2 | No cookie, unknown fields refused, never cached | H | `guest-api.ts:93-101` (`no-store`, no `Set-Cookie`), strict schemas `:240` |
| 3 | The table code travels in a header, never in the address or a log | H | `guest-api.ts:107-114`, `:142-145,242` (paths only, never values) |
| 4 | The web app never calls the POS | H | `guest-api.ts:9-12`; only `enqueueJob` |
| 5 | A retired code: the phone says "This table code is no longer in use" | P | Command refusal reads "This table code has changed. Scan the code on your table again." (`strings.ts:562`); a poll's 401 stops polling and the page shows the "closed" note (`services-client.ts:659-663,573`). RR-A10c-16 |
| 6 | Progress of a sent order: sending phone only; refined by D122: every phone, Unconfirmed for 15 minutes | H | `table-order.tsx:107-124`, `guest.ts:96,477` |
| 7 | Poll every 2 s on the bag and bill, every 10 s on the menu | P | Cadence is the server's (`guest.ts:93,436`); the client only ever sends `view=menu` or `view=order` (`services-client.ts:617-619`), never `bill`. RR-A10c-6 |
| 8 | Every phone every 2 s while an order is on its way or a payment countdown runs | P | In-flight is `sending` or `awaiting_approval` only (`guest.ts:499-501`); a payment countdown on another phone does not count |
| 9 | Never while the page is hidden; asks at once when it shows | H | `use-table-services.ts:153-167`, `services-client.ts:894-910` |
| 10 | Retries after 4, 8, 16, then every 30 s; a 429 waits its `Retry-After` | H | `services-client.ts:96-97,666-684` |
| 11 | After about 10 s without an answer the phone shows the paused screen; Send and Pay blocked, never queued | **M** | No request timeout, so `offline` is computed only when a request ends (`services-client.ts:647,687,438-446`); Send is not blocked. RR-A10c-5 |
| 12 | Bag edits show at once; a refusal says why and puts the number back; Send and Pay never show success before the server answers | H | `services-client.ts:250-258,725-790` |
| 13 | Retries safe: same action id, same answer; a stale tap refused | H | `commands.ts:166-181` (`maxAgeMs`, ring) |
| 14 | Location rides on the request, checked in memory and dropped, never written, logged or sent to error reporting | H | `guest.ts:1087-1111`, `guest-api.ts:142-145` |
| 15 | Pass: 2 h default, 30 min to 6 h, per table, never past the service day, phone holds it | H | `settings/hours.ts:77-83` (`passMinutes`), `guest.ts:1110-1118`, `location-pass.ts` |
| 16 | Paying and pay-first items are never located | H | `guest.ts:966-971`, `services-client.ts:247` (client asks only when the server says `location_needed`) |
| 17 | Turnstile fails open only when Cloudflare itself can't answer, and each case is counted | H | `server/turnstile.ts:39-65`, `guest.ts:1139-1141` |
| 18 | 60 bag changes a minute; above it "Slow down a moment"; every trip in the Log and alerting the team | P | The count and the Log/team alert hold (`order-rate.ts:60-85`); the words are "Too many changes at once. Wait a moment." (`strings.ts:560`). RR-A10c-16 |
| 19 | Per-phone limits (30 additions a minute, one Send per 15 s, 10 in 10 min, 5 location tries), 20 requests a second per table code | H | `core/src/service/guest-limits.ts:24-40` |
| 20 | D111's knock, cap and pace at Send | U | A10a |

### D122 §7: Tonight, roles, PINs, Telegram, end of night (17 statements: 13 H, 2 M, 2 U)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | One staff screen "Tonight": alerts pane, tables, sent orders, out-of-stock notices, Log | H | `tonight/tonight-tab.tsx:241-332`, `tonight-tabs.tsx` |
| 2 | Default roles: staff open/close/pause/answer/resume; manager lifts a pause, sees Log and night; owner sets guards, codes, payment tables, recipients, roles | H | `core/src/service/permissions.ts:95-121` |
| 3 | "Receipt printed" / "No receipt" is a manager's or owner's answer | H | `money.follow_up`; `server/tonight/actions.ts:359-385` |
| 4 | Restro's admin team is its own role and manages PINs; the venue's owner too; a manager cannot | H | `permissions.ts:71-75`, `staff.ts:717-731`, `mayManage` |
| 5 | On a shared device answers ask the person's own PIN; two quick answers ask none | H | `grants.ts:120-150`; quick set also holds open/close one table, New guests, pause (`commands.ts:217,371`, `pauses.ts:187`), which the screen plan's matrix (§5) approves |
| 6 | A PIN never opens settings | H | `grants.ts:135-138`, `page.tsx` `OwnSignInNotice` |
| 7 | A manager's phone stays signed in 30 days; the password again after 15 minutes before a settings change | H | `server/auth.ts:54-57`, `engine.ts:157-158`, `use-settings-run.tsx:94-126` |
| 8 | Telegram: one group; pauses and "back"; Unconfirmed sent orders | H | `alert-rules.ts:155-179` |
| 9 | Telegram money alerts repeated every 5 minutes until Done, outside quiet hours too | **M** | RR-A10c-1 |
| 10 | Messages carry no notes and no guest data | H | `alert-text.ts`, `night-export.ts:203-223` |
| 11 | "Done" works from a Telegram user linked to an active account whose role may press it; the message becomes "Done by Maria, 02:14"; the Log says "via Telegram" | H | `worker/src/alerts/telegram-poller.ts:107-168` |
| 12 | An Unconfirmed sent order is closed by its answer | **M** | The Telegram Done button is also drawn on this alert and closes it without settling the order. RR-A10c-7 |
| 13 | Staff pauses: all bars or one; Restro's pause shown apart; nobody at the venue lifts it | H | `view.ts:370-399`, `pause-banners.tsx` |
| 14 | Guard and permission changes are Log entries kept 18 months | U | Purge classes not read |
| 15 | End of night: one page per service day, CSV; totals and mismatches to the group | H | `night-page.tsx`, `night-report.ts`, `night-export.ts` |
| 16 | The day's close clears the night's alerts except `closesByAnswer`, `closesItself` and the team's | H | `service-day-close.ts:140-169` |
| 17 | Table bar read from the POS, payment tables get no code | U | A10b |

### D123 and `operational-screens.md` (13 statements: 8 H, 3 P, 1 M, 1 U)

| # | Statement | Verdict | Where |
|---|---|---|---|
| 1 | The admin map lists every new screen and story | H | `docs/guides/admin-map.md:21-32,91-99` |
| 2 | Toasts last 8 s, set once | H | `components/ui/sonner.tsx:23` |
| 3 | An error toast stays until closed and shows a close button | P | Tonight yes (`tonight/run.tsx:128-132`); the Settings runner passes `duration: Infinity` and no `closeButton`, and the Toaster has none by default (`use-settings-run.tsx:106`). RR-A10c-22 |
| 4 | Undo is a server write through `apply()` with a token; Tonight's has a 30 s window | H | `run.tsx:19-30`, `commands.ts:205-232` |
| 5 | Reduced motion: one global rule | **M** | No `prefers-reduced-motion` in `apps/web/app` or `src`; the guide itself calls it T88's defect. Tonight's skeletons use `motion-reduce:animate-none` on their own (`tonight-skeleton.tsx:18-19`) |
| 6 | Patterns: pause scope is a button that opens a menu; table sheet is a side sheet or bottom drawer; empty-state block; banner for a page state | H | `tonight-panel.tsx:130-149`, `table-sheet.tsx:301-323`, `tonight-panel.tsx:303-309`, `pause-banners.tsx` |
| 7 | Patterns: Rename = pencil, Enter saves, Escape cancels | P | Cap field: Escape cancels, but blur also cancels and discards (`ordering-panel.tsx:156`). RR-A10c-13 |
| 8 | A role that may not act is sent to a higher PIN or sees no control, never a disabled one | P | Holds for every Tonight row except the dispute row on the tablet (`action-rows.tsx:273`). RR-A10c-14 |
| 9 | 44 px floor; answer buttons 48 px; PIN keys 56-60 px; text 14 px minimum | H | `h-12` `action-rows.tsx:110`, `h-14` `pin-sheet.tsx:192`, tile `min-h-20`; tile state word is `text-[13px]` (`tables-grid.tsx:58`) as the plan itself says; O-7 |
| 10 | The tablet persona: nothing moves, new alert announced and one sound, mutable | H | `tonight-panel.tsx:166-222`; the iPad audio start is O-4 |
| 11 | Sheets and dialogs close with a visible control and Esc and lose nothing | H | `table-sheet.tsx`, `sent-sheet.tsx:172-176`, `pin-sheet.tsx:253-257` |
| 12 | Who did it: a signed-in phone names the person; a shared device asks a PIN | H | `actions.ts:53-93` |
| 13 | Wayfinding, screen-read questions, contrast in both themes, keyboard walk | U | A8 |

### Screen plan #85: Tonight, screen 1 (`2026-10-21-tonight-screen-1-plan.md`) (32 lines: 24 H, 7 P, 1 U)

Stories and target taps (§1):

| Story | Target | Verdict | Where / note |
|---|---|---|---|
| S1 money alert, 1 + manager PIN | | U | `money-rows.tsx` (A10b) |
| S2 waiter call, 1 tap, no PIN, Undo toast | | P | One tap, no PIN (`action-rows.tsx:123-141`); no Undo. RR-A10c-12 |
| S3 open a table, 1 tap, Undo | | H | `tables-grid.tsx:94-100` |
| S3b Open all, 1 + PIN, Undo toast | | P | PIN yes; no Undo on the shared device (`tonight-panel.tsx:250-258`). RR-A10c-12 |
| S4 Approve: read-only | | H | `action-rows.tsx:323-326` |
| S5 lift a pause, 1 + manager PIN | | H | `pause-banners.tsx:22-47` |
| S5b resume a table, 1 + own PIN | | H | `action-rows.tsx:291-322` |
| S6 Storno done, 1 + manager PIN | | H | `action-rows.tsx:190-251` |
| S7 receipt Brought, 1 tap, no PIN, Undo | | H | `action-rows.tsx:143-189` |
| S8 answer Unconfirmed, 1 + own PIN | | H | `sent-order-answers.tsx` |
| S9 close one table, 2 taps, Undo | | H | `table-sheet.tsx:267-286` |
| S10 pause ordering, 2 taps, no PIN, Undo | | P | 2 taps, no PIN; Undo only when `can.lift && !device` (`tonight-panel.tsx:96-110`), so none on the tablet or for staff. RR-A10c-12 |
| S11 Close all 3 + PIN (dialog); New guests 3 | | H | `tonight-panel.tsx:261-277,465-485`, `table-sheet.tsx:324-362` |
| S12 dispute evidence, 1 tap, manager | | P | Manager's phone only; none on the tablet (matrix §5: "Seen; manager's PIN"). RR-A10c-14 |

Other plan lines: place (tab after "Tables & QR", staff land on Tonight, admin-map rows) H (`workspace-tab-defs.ts:34-41`, `venues/page.tsx:31-37`, `landing.ts`); patterns for each job H (11 rows); one primary action (top row filled, money rows outline) P: top-row logic H (`tonight-panel.tsx:318-325`), money rows U (A10b); states: empty night H, empty open H, loading H (`tonight-skeleton.tsx`), write fails H (`run.tsx:128-132`, copy `errors.failed`), POS unreachable H (`view.ts:370-399`, `pause-banners.tsx:112-122`, button hidden `view.ts:633-635`), longest Bulgarian H by reading (`[overflow-wrap:anywhere]`, `whitespace-normal`; U for the render), many H (`lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto`), role that may not act P (dispute), shared device PIN H, POS venue read-only H (nothing editable); §12 A (out-of-stock row, not counted, no sound, +k more sheet) H (`action-rows.tsx:405-460`, `tonight-panel.tsx:175-182`); §12 B (one banner per pause, hides covered bar banners, bar heading "Paused") H (`view.ts:370-399`, `tables-grid.tsx:122-131`); strings: 92 keys match, 20 keys differ or missing (all deliberate except the toast `{who}`, RR-A10c-15; `pin_*`, `err`, `bar1` etc. moved under `pin.*`, `errors.*`).

### Screen plan #86: sent orders, Log, end of night (3 plans, 19 rows: 15 H, 3 P, 1 M)

| Plan line | Verdict | Where / note |
|---|---|---|
| Sent orders O1 search by reference or table, as you type, takes focus on a tablet only | H | `search-field.tsx:11-36`, `night-read.ts:269-279` |
| O2 newest first, nothing to open; O3 "All · Not added" with counts | H | `sent-orders-tab.tsx:122-145`, `night-read.ts:246-377` |
| O4 sheet: items, options, notes, totals, times, reason, who, steps | P | All there but the POS bill number "Bill 1042 in {source}" (`sh_bill` is not in en.json). RR-A10c-10 |
| O5 find one table's orders; O6 answer from the sheet with the PIN rule | H | `sent-sheet.tsx:123-130` |
| New rows join at the top only while scrolled to the top, else "{k} new · show" | H | `live-feed.ts:369-405` |
| Newest 100, "Show earlier"; search covers the whole day | H | `pages.ts`, `sent-orders-tab.tsx:149-151` |
| Failed to load, empty block with "Go to Actions and tables" | H | `sent-orders-tab.tsx:68-95` |
| Reason words: every code has a word or is reported, never shown raw | H | `night-view.ts:60-118`, `night-load.ts:91-93` |
| Log: newest first, kind menu, day button, search, "31 days / 18 months" line, entries for sent orders and payments open sheets | H | `log-tab.tsx` |
| Log: "A code with no sentence" never shown | H | `log-view.ts:1-60` (`satisfies Record<LogKind, ...>`) |
| Log: `{alert}` is the alert's own title from screen 1's strings | **M** | Built from the push text with an empty venue name: "Alert: Ordering is paused at ". RR-A10c-11 |
| Log: entries the venue never sees (`lease.taken_over`, POS call log) | P | Plus the team's own alerts are shown. RR-A10c-9 |
| End of night: heading "So far tonight · the night ends at {time}" / "Closed at {time}", live counts, day picker, CSV for `night.view_full` | H | `night-page.tsx:140-166`; the day uses `serviceDate` (`night-read.ts:134`) and `dayEndsAt` (07:00 default) |
| Sections in the settled order, jump links on a phone, "Nothing to fix." | H | `night-page.tsx:118-224` |
| Totals before/after close; no amounts or tips to Telegram, counts only | H | `night-page.tsx:125-135`, `night-export.ts:203-223` |
| Roles: staff sections 1-3 without tips, never a CSV; hidden, not greyed | H | `night-slots.ts`, `night-page.tsx:112,153` |
| CSV: BOM, apostrophe against formulas, our ids only | H | `night-export.ts:57`, `export-csv.ts`, `app/api/venues/[venueId]/export/route.ts` |
| Telegram message "when the service day closes" | P | It goes at the next `service-day-tick` (minute 5 of each hour, `jobs/service-day.ts` schedule `'5 * * * *'`). O-13 |
| Strings: 31 of 32 sent-orders keys, 35 of 39 Log keys, 23 of 27 night keys match; differences are `{kinds}` for waiter calls (#180), the refund sentence, `nt_fix_so` unused | H | `ownerSettings`/`tonight` namespaces |

### Screen plan #87 and #61: settings (grouping, Hours, Ordering, Staff and roles, Alerts, export, Integrations) (17 rows: 13 H, 1 P, 1 M, 2 U)

| Plan line | Verdict | Where / note |
|---|---|---|
| Section order General, Hours, Ordering, Paying, Staff and roles, Alerts, Publish, Versioning; each only for its permission, read-only line for Hours/Ordering | H | `workspace-tab-defs.ts:68-110`, `venues/[venueId]/page.tsx:133-262` |
| Settings never open with a PIN: "Settings need your own sign-in." | H | `page.tsx:176-178`, `access.ts` |
| Every write through `core.apply`/service commands, own sign-in within 15 minutes, `settings.changed` Log entry | H | `commands.ts:504-531`, `use-settings-run.tsx` |
| Hours: seven rows Monday first, switch off saves at once with Undo, dialog with three times and "Same hours on", problems under the field, last orders 15 min before the day ends | H | `hours-panel.tsx:52-128,160-250`, `ordering-settings.ts:146-158` |
| Hours: the switch turned off keeps the day's times, so turning it on restores them | **M** | `hours-panel.tsx:74` saves `[day]: null`; the dialog then prefills from the nearest open day (`:171-175`). RR-A10c-13 |
| Hours: "(next morning)" for a time after midnight; service day end shown (07:00) | H | `hours.ts:20-23,48-51` |
| Before opening: only for a POS venue; three selects | H | `hours-panel.tsx:130-132,290-420` |
| Ordering: switch, cap pencil, spot only by "I'm at the venue", More (check, radius, pass, pace, waiter call) | H | `ordering-panel.tsx`; the cap field cancels on blur (RR-A10c-13) |
| Spot: reading above 100 m is too rough | H | `hours.ts:88`, `ordering-panel.tsx:105-110` |
| Staff and roles: PIN behind an eye for 30 s, New PIN without confirmation, remove from venue = one tap + undo, remove for good = dialog, search above 12 people | H | `staff-people.tsx:54-76,120-160,184` |
| Roles: defaults read-only with Copy, ticks save at once, "You can't give what you don't hold" | H | `staff-roles.tsx`, `staff.ts:386-410` |
| Alerts: a switch per person with an account, "Link a Telegram group", per-person QR, test message, unlink, 15-minute code | H | `alerts-panel.tsx`, `telegram-link.ts`, `telegram-linking.ts` |
| Payment alerts ring only for switched-on holders, else every holder; the line `al_money_line` | H | `push-targets.ts:25-38`, `alerts-panel.tsx` |
| Log export: two CSVs, default last 7 nights, `log.view` + `night.view_full` | H | `log-export.tsx`, `export/route.ts` |
| Integrations #59 / strip scrollbar | U | A8 (layout at 390 px in Bulgarian) |
| Strings: 42/42 (Hours, Ordering), 62/62 (Staff), 22/29 (Alerts; the 7 missing are the export keys, which live in `tonight`, and `al_tg_test_text` in core) match | H | `ownerSettings` namespace |
| Paying section | U | A10b |

**Totals over everything above:** 155 statements: 107 hold, 27 partly, 12 mismatch (each in a candidate row or an observation), 9 cannot be judged by reading.

---

## 2. Candidate rows

Severity is my proposal; the lead sets it after confirmation. Each row: scenario, quoted text, evidence.

| ID | Sev | File:line | Decision / plan text | Failure scenario | Evidence | Conf. |
|---|---|---|---|---|---|---|
| RR-A10c-1 | high | `packages/core/src/service/alert-delivery.ts:182,220-223`; `alert-rules.ts:199-238`; `alerts.ts:100,331` | D122 §7: "money alerts, repeated every 5 minutes until "Done", outside quiet hours too." (D120: "Nothing alerts outside service hours except...") | If a card capture fails or a payment question arises after the venue's closing time (bar closes 05:00, a payment ends `unconfirmed` or a capture fails at 05:10), then the planner finds the alert "fresh" with `speaking` false, adds it to `suppress`, and `alert.suppressed` marks it never to be sent: no push, no Telegram. Also no money alert ever repeats every 5 minutes: payment kinds have `reminder` null or once after 10 minutes, and `alerts.next_repeat_at` is only ever set to null. The owner learns of the failed capture only by opening Tonight. | `const speaking = rule.outsideServiceHours \|\| window.inService` and `for (const alert of fresh) suppress.add(alert.id)`; `PAYMENT_CAPTURE_FAILED_KIND` has no `outsideServiceHours`; `grep next_repeat_at` finds only `nextRepeatAt: null` | high on the code, medium on which text wins (stop item 1) |
| RR-A10c-2 | high | `packages/faces/qr-phone/src/table-order.tsx:471-490`; `packages/shell/src/strings.ts:515` | D119: "The details sit behind the privacy link"; D121: "...pay first or call a waiter. [Privacy]" | If a guest at a club taps Add at a table that checks location, then the consent screen shows the text and Allow / Not now only: there is no link to the privacy notice that D119 says carries "the details" (parties, joint control, complaints to КЗЛД). The guest consents without a notice, which D119's own law paragraph treats as needed. | The `consent` case renders `<p>{strings.locationConsent(...)}</p>` and two buttons; `legalPrivacyLink` exists only in `pay-panel.tsx:281` | high |
| RR-A10c-3 | high | `packages/shell/src/services.ts:625-632`; `table-order.tsx:483`; `strings.ts:515` | D119: ""Stop location check" is a small control in the "Why?" line and on the bill. After it, on-the-bill orders from that phone take D118's refused path"; consent text: "You can stop anytime" | If a guest taps Allow and later wants the check off, then no control exists anywhere (no string, no `LocationControls` member, `decline()` only on the first screen): the consent text promises "stop anytime" and the product cannot do it. | `LocationControls` = `allow`, `decline`, `reopen`, `dismiss`; `grep -i "stop"` in shell strings, faces and guest finds only the consent sentence | high |
| RR-A10c-4 | high | `apps/web/src/guest/services-client.ts:758-762,827-833`; `table-order.tsx:278-300`; `strings.ts` | D120: "After Send it says "We can't reach Restro right now. If your order isn't on your bill in a few minutes, please call a waiter" with the reference, and never "Try again"" | If the signal drops while a guest taps Send (the request fails or the answer is lost), then `send()` settles `pending`, the face's `useOrderCommands` shows a notice only for `rejected`, and the screen shows nothing while the order may already be in the POS: the guest does not know to call a waiter and may tap Send again. | `catch { schedule(0); return settle(answer('pending', null)) }` and `if (result.status === 'rejected' && ...) setNotice(...)`; no such sentence in `strings.ts` | high |
| RR-A10c-5 | medium | `services-client.ts:647,687-760,438-446` (no `signal`/timeout); `use-table-services.ts:120` | D121: "After about 10 seconds without an answer, the phone shows D120's paused screen. Send and Pay are blocked, never queued." | If the club's Wi-Fi stalls (a request neither answers nor fails), then the poll never returns, `polling` stays true so no next poll starts, `recompute()` (the only place `offline` is evaluated) never runs, and the guest sees the last state with no weak-signal note and a live Send button for as long as the browser waits (a minute or more). | `deps.fetch(\`${base}/api/guest/state...\`, { method, headers, cache, referrerPolicy })`: no `AbortSignal`; `const offline = () => running && deps.now() - lastAnswerAt > OFFLINE_AFTER_MS` read only in `recompute()` | medium (a stalled socket needs a device to confirm) |
| RR-A10c-6 | medium | `services-client.ts:617-619`; `packages/core/src/service/guest.ts:697-707` | D121: "Every 2 seconds on the bag and bill screens, and every 10 seconds on the menu"; D111 via `guest.ts:31`: a fresh reading when a guest opens a bill read more than 15 s ago | If a guest opens the bill with an empty bag (to see or pay), then the client asks `view=menu` (10 s cadence) and the server never queues a fresh reading (it only does so for `view === 'bill'`); the bill's age can reach the worker's one-minute tick before the guest pays. Only an e2e spec ever sends `view=bill`. | `view()` returns `'order'` or `'menu'` only; `if (input.view === 'bill' && open && ... wantsFreshReading(...))` | high on the code |
| RR-A10c-7 | medium | `apps/worker/src/alerts/deliver.ts:580`; `packages/core/src/service/alerts.ts:80-101`; `server/tonight/view.ts` (rows built from open alerts) | D122 §7 / D116: an Unconfirmed sent order is settled by "Found on the bill" / "Not on the bill" ("one command settles the order, lifts the table's pause and closes the alert") | If a linked staff member presses the Done button on the group's Telegram message for an Unconfirmed order, then `alert.done` marks the alert done, the message says "Done by Maria", and the "Needs you" row disappears, but the sent order stays Unconfirmed and the table stays paused (up to 15 minutes); only the end-of-night page lists it. | `answerable = step.step === 'new' && !rule.closesItself && !rule.closesByAnswer` and `ORDER_UNCONFIRMED_KIND` sets neither; `alertDone` refuses only those two | medium (may be intended as "seen") |
| RR-A10c-8 | medium | `apps/worker/src/alerts/deliver.ts:85-87,526`; `apps/web/src/components/admin/workspace-tab-defs.ts:52` | D120: "a tap opens it in the Log" | If an owner taps a "Ordering is paused" push at night, then the page opens `/venues/{id}`, which opens the Composer (default tab), not Tonight or the Log. The code comment still says "Tonight (#85) will have its own page; until then, the venue". | `url: pushUrlOf(venue.id)`; `DEFAULT_WORKSPACE_TAB = 'composer'` | high |
| RR-A10c-9 | medium | `packages/core/src/service/night-read.ts:649-660`; `order-rate.ts:79`; `send-guards.ts:260`; `paying-pause.ts:183` | D120: "only the Restro team sees the POS calls and the team's own alerts" | If a table trips the order-rate guard, then an `alert.raised` Log entry for an alert whose audience is `restro` is written, and the venue's manager reads it in the Log ("Alert: ...: Table 5 changed its order too fast"). The Log query filters by kind and day only, not by the alert's audience. | `inArray(logEntries.kind, [...logKindsOf(group)])` with `'alert.raised': 'pauses'`; `audience: 'restro'` | medium |
| RR-A10c-10 | medium | `apps/web/src/tonight/sent-sheet.tsx:56-132`; en.json `tonight` (no `sh_bill`) | Sent-orders plan §5: "Added: ... The sheet shows the POS bill as staff know it ("Bill 1042")"; §8 `sh_bill` "Bill {bill} in {source}" | If a waiter opens an Added sent order to find which POS bill it went on, then the sheet shows no bill number: the guest's question "which bill" needs the till. | `grep sh_bill` finds no key and no use; the sheet renders state, answer, lines, total, steps | high |
| RR-A10c-11 | medium | `apps/web/src/server/tonight/night-view.ts:`(`alertTitle: alerting ? alertMessage({ kind: line.reason ?? '', details: {} }, { locale, venueName: '', tableLabel: null, source }, 'new').title`), `alert-text.ts:126,129-133,203` | Log plan §8: "`{alert}` is the alert's own title from screen 1's strings" | If a venue pauses, the Log shows "Alert: Ordering is paused at " (BG «Поръчките в  са спрени»); a pre-opening failure reads " can't open: Restro can't work with {source}"; the guard and unstable alerts start with ": ". The venue name is passed empty into the push texts. | `paused: (where) => \`Ordering is paused at ${where}\`` called with `where = venueName = ''` | high on the code |
| RR-A10c-12 | medium | `tonight-panel.tsx:96-110,250-258`; `action-rows.tsx:131-137` | Plan §1: S3b "Undo toast"; S10 "Undo toast, no PIN"; S2 "1 tap, Undo toast"; §3 "8 s toast with "Undo"" for a single reversible write | If a bartender on the shared tablet taps "Open all" or pauses ordering by mistake, then no Undo toast is offered (Open all: "its Undo would have to name the same person"; pause: Undo needs `ordering.lift`); a staff phone pausing by mistake needs a manager to lift. A "Handled" tap on a waiter call has no Undo on any device. | `...(view.can.lift && !view.device ? { undo } : {})`; `...(view.device ? {} : { undo: ... })`; `run({ id: call:..., act, done })` | high |
| RR-A10c-13 | low | `hours-panel.tsx:74`; `ordering-panel.tsx:156` | Hours plan §3: "The day switch turned off keeps the day's times, so turning it on again restores them"; guide Wayfinding 4: a way out "that loses nothing the owner typed" | (a) If an owner closes Friday for an event and later switches it on, then Friday's own hours are gone and the dialog is prefilled from another day's. (b) If an owner types a new cap and taps elsewhere (a phone's keyboard "done" off the field), then the edit is discarded silently. | `saveHours({ ...hours, [day]: null })`; `onBlur={() => setEditingCap(false)}` | high |
| RR-A10c-14 | low | `action-rows.tsx:273-284` | Plan §5 matrix: card dispute "Staff on the bar tablet: Seen; manager's PIN"; §5 "A role that may not act is sent to a higher PIN, never shown a disabled control" | If a manager wants "See the evidence" on the bar tablet, then the row has no control and no PIN path (the button needs `can.followUp`, which the device account lacks); the evidence is only on a manager's own phone. | `if (view.can.followUp) { answer = <Button ...> }` with no `view.device` branch, unlike storno | medium |
| RR-A10c-15 | low | en.json `tonight.m_ok_toast`, `m_no_toast`, `s_ok_toast`, `s_no_toast`, `g_toast`, `st_toast`, `ca_toast`, `lift_toast` | Plan §9: toasts end "· {who}" ("Card charged {amt} · {who}", "Ordering resumed · {who}") | If staff share a tablet, the toast after a PIN answer does not name the person; only the Log does. | node diff of plan strings vs en/bg (10 keys) | high |
| RR-A10c-16 | low | `packages/shell/src/strings.ts:560,562`; `services-client.ts:573,659-663` | D121: phones see "Slow down a moment"; "This table code is no longer in use" | Different words from the quoted ones; and a guest who only reads the page gets the "closed" note after a retired code (polling stops for good, no reload hint). | strings quoted | high |
| RR-A10c-17 | low | `use-table-services.ts:42-60`; `services-client.ts:434-445,816-840` | D119: "Once per phone per service day"; "A browser that blocks location counts as a refusal. After a refusal the phone isn't asked again" | If a guest reopens the QR link in a new tab, consent is asked again; if the browser blocks location after Allow, every later add asks the browser again instead of remembering a refusal. | `sessionStorage`; `locateAndSend` sets `prompt = 'failed'`, never `remember('declined')` | medium |
| RR-A10c-18 | low | `packages/core/src/service/breaker.ts:52` | D120: "The first probe comes after 15 s, then 30, 60 and 120 s apart" | A failing POS is probed every 60 s at the longest, not every 120 s: more load on a sick POS than D120 describes. | `failingGapsMs: [15 * SECOND, 30 * SECOND, 60 * SECOND]` | high (D120 allows tuning: "starting values") |
| RR-A10c-19 | low | `apps/web/src/tonight/pause-banners.tsx:112-121`; `pauses.ts:279` | D120: "A Restro admin account can lift any pause (Martin)" | If Restro's admin team needs to lift a stuck Restro pause, then core allows it but Tonight draws no button for a Restro pause for any role; there is no UI path in `apps/web`. | `banner.kind === 'restro'` renders text only | medium |
| RR-A10c-20 | low | `table-order.tsx:131-134` | CLAUDE.md: "Time: the venue's time zone"; D120 panel "the time" | If a guest's phone is set to another zone, the time on "Show this to your waiter" is not the venue's, and the waiter looks for bill rows at the wrong time. | `date.getHours()` | medium |
| RR-A10c-21 | low | `table-order.tsx:429-440` | D120: "Send and Pay are greyed" | While ordering is paused or closed the Send button is not drawn (the guest sees a line but no greyed Send); Pay is greyed. | `count > 0 && ordering === 'on' && phonesMayOrder ? <button> : null` | high |

| RR-A10c-22 | low | `apps/web/src/settings/use-settings-run.tsx:106` | Guide, Undo: "An error toast stays until closed, shows a close button, and names the fix" | If a Settings write fails (a refused hours or staff change), the error toast has `duration: Infinity` and no close button, and the shared Toaster sets none by default, so the toast cannot be dismissed except by swiping. Tonight's toasts do set `closeButton: true` (`tonight/run.tsx:93,131`). | `toast.error(sentence(error, options.words), { duration: Number.POSITIVE_INFINITY })` | high |

---

## 3. Observations (not contract rows)

**Process and references**
- O-1. The `## Screen plan` sections the brief names are not in the four issues; they are in the `docs/deliverables` plan files (see Deviations).
- O-2. `docs/guides/copy-rules.md` is not a path in the repo; `.claude/skills/template-review/references/copy-rules.md` is. Issue #85's Read line and the brief use the short name.

**RR-O5 (glossary, the `failed` and `unknown` strings)**
- O-3. **RR-O5 is a false positive.** The five `failed` and three `unknown` keys are `itemSheet.errors.failed`, `itemSheet.media.errors.server_error`, `auth.error.unknown`, `integration.history.status.failed`, `integration.history.refusedCodes.unknown_*`, none about a sent order. The sent-order state words on Tonight are `st_waiting`, `st_sending`, `st_checking`, `st_added`, `st_notsent` (Not sent), `st_check` ("Check the bill" for Unconfirmed) and `st_approval` ("Approve it in {source}" for Awaiting approval) (`night-view.ts:44-62`, plan §8). They match D116's names except the two the plan renamed for staff. The guest words match D116 and D122 ("Not confirmed: show K7Q to your waiter"). A1's heuristic treats any sync-status word as a sent-order state.

**Behaviour to test on a device (A8)**
- O-4. The alert sound creates a new `AudioContext` inside an effect (`tonight-panel.tsx:63-79`), not inside a tap. On an iPad Safari bar tablet that context may stay suspended and never play, though the plan promises a sound. Needs the real tablet.
- O-9. Turnstile: `appearance: 'interaction-only'` (`guest/turnstile.ts:62`) lets Cloudflare show a challenge in an unstyled `<div>` appended to `body` (`:48`); Martin 10-29 wants guests never to see one. Whether the dashboard widget is Invisible, and pre-clearance off, cannot be read.

**Wording and glossary (grouped)**
- O-5. `en.json` has 14 admin strings that say "Something went wrong" (e.g. `composer.errors.failed`, `venues.new.errors.failed`, `settings.general.errors.failed`, `tables.errors.failed`, `design.errors.failed`, `integration.errors.failed`): `copy-rules.md` rule 4 forbids it ("no apology, no "Something went wrong""). Outside Tonight and Settings, but the same rule.
- O-6. Staff-facing words with no GLOSSARY entry: "Not added" (the sent-orders filter), "Check the bill" (Unconfirmed), "Approve it in {source}" (Awaiting approval), "Needs you", "Handled", "Brought", "Storno done". The plan chose them (Martin 10-26 accepted the BG terms); GLOSSARY.md still lists only D116's state names for a sent order. Add them.
- O-7. Tile state words are 13 px (`tables-grid.tsx:58`, as plan §5 says); the guide's persona line says text 14 px at the least. The two texts disagree; the plan was confirmed after the guide's paragraph.
- O-8. Dead or missing keys from the plans: `tonight.nt_fix_so` (the end-of-night row reuses screen 1's `s_t`), `nt_tg_pay`, `ownerSettings.sf_e_pins` (A1 found them unused), and plan key `sh_bill` missing from en.json (RR-A10c-10).

**Smaller code notes**
- O-10. `hoursProblemOf` maps core's English messages by prefix (`settings/hours.ts:35-41`); a wording change in `serviceHoursProblem` would silently show "Last orders must be at least 15 minutes...".
- O-11. Undo of an Hours or Alerts change writes back the whole previous object (`hours-panel.tsx:58-62`, `alerts-panel.tsx` `setTicked`), overwriting another day or person changed in between.
- O-12. With zero tables the empty block says "Open them for phones to start ordering" and has no button (`tonight-panel.tsx:302-309`).
- O-13. The end-of-night Telegram message goes at the next `service-day-tick` (`'5 * * * *'`), up to an hour after the day closes; the plan says "when the day ends".
- O-14. A planned alert step that cannot be sent (no device, e.g. an owners-only reminder with no owner switched on) returns false and is retried every 30 s forever, never recorded (`deliver.ts:62` `RETRY_AFTER_MS`, `sendStep` push).
- O-15. `staffLandingVenue` lands a staff-only sign-in on Tonight only from the `/venues` list (`venues/page.tsx:31-37`); the other three venue tabs (Composer, Tables & QR) stay visible to a bartender's session; what they allow was not read (§4).
- O-16. Stock notices (`item_out_of_stock`), refunds and disputes alert no one at the Restro team (`alert-rules.ts:194,282-283`) although D120 says the team gets every alert; plans #80 and #222 chose this.

---

## 4. What I could not cover by reading (A8 walks these)

- **Every screen as drawn:** layout at 1180 x 820 and 390 px, light and dark, contrast, the longest Bulgarian text rendering (the code wraps with `overflow-wrap:anywhere` and `whitespace-normal`; whether a 36-letter bar name still fits is a render question), 44 px of every control, the keyboard walk, screen-reader announcements, the PIN sheet on a real tablet, the iPad alert sound (O-4).
- **The guest page in a real browser:** whether Turnstile shows (O-9), a stalled connection (RR-A10c-5), Safari's repeated location prompts (the open item in `open-items.md:74`), the consent screen in both languages on a phone, and the "Show this to your waiter" panel at 40 px and 7:1 contrast.
- **Outside services:** Cloudflare's single rate-limit rule and pre-clearance (D119, D121), the Healthchecks.io watchdog (D120), push delivery to a real phone, Telegram deep links and the bot's removal, Better Auth's 30-day session in practice.
- **Not in my file list:** `money-rows.tsx`, `payment-sheet.tsx`, `night-payments.tsx`, `dispute-evidence.tsx`, `paying-*.tsx` (A10b); `guest-menu.tsx`, `load.ts`, `context.ts` (read for what they cite only); retention classes and the purge job (Log 31 days, records 18 months); table-pause lifts by a waiter's act or closed bills (A10a); `staff-roles.tsx` and `staff-view.ts` beyond a skim (permission words and the three-group layout were checked by string diff, not walked); what a staff-only session may do in the Composer and Tables & QR tabs (O-15).
