# Behaviour walk of or/foundation (A8)

Pinned commit `604a316d`. Agent A8, 2026-10-30. Screenshots are in `behaviour/` (about 2.5 MB). Nothing committed; `findings.md` untouched.

## How it was walked

Demo Bar on the simulated POS (scenario `demo-bar`), `qr-phone` template (set by the dev seed), my own database `restro_rr_a8` on port 54329, the web app on `localhost:3200` (`next dev`), the real worker, the simulator on `localhost:4010`. Local test accounts only: the seeded owner, plus a waiter, a manager and a bar-tablet account made with a scratch script that writes the same rows `seed-tonight-e2e.ts` writes (the Add person screen makes PIN-only people, no sign-in). Guest at 375 px in English and Bulgarian, waiter and manager at 390 px, bar tablet at 1180 x 820, owner in Settings (390 px, 800 px, 1180 px, and 320 px / 200 % text for the overflow pass). The built-in browser pane went hidden half way, so the later screenshots come from headless Chromium (Playwright) against the same app; no Stripe, no real host, no third-party sign-in.

Fixtures I had to use, all named here so nobody reads them as product behaviour: waiter calls were inserted into `waiter_calls` (the `qr-phone` page has no "call a waiter" button outside the location-failed prompt; same insert as the project's own e2e seed); the simulated payment account was completed by an `update` of its `checks` row (the running worker's sim-pay engine has no control to finish onboarding); the location was a stubbed browser position; the owner's "venue spot" was set the same way.

## Findings

| Id | Severity | Where | Rule or decision | Failure scenario | Evidence | Confidence |
|---|---|---|---|---|---|---|
| RR-A8-1 | medium | `apps/web/src/settings/use-settings-run.tsx:87` (`const answer = await action()` inside `startTransition`, no catch) | #87 plan §6 "A save fails: the error toast that stays and names the fix; the control returns to its saved value"; guide, Undo: "An error toast stays until closed" | If the owner's phone loses the connection while a Settings switch or field is saved, then the whole venue page is replaced by the framework error page (real offline mode, not a patch), so any other unsaved edit on the page is lost and no sentence says what to do | `behaviour/a8-1b-settings-switch-offline-playwright.jpg`, `behaviour/a8-1-settings-save-offline-page-crash.jpg` | high (the dev overlay is dev-only; the error page behind it is the root boundary) |
| RR-A8-2 | high | `packages/connectors/sim-pos/src/connector.ts:157-183` (a 429 is `unknown`), `apps/worker/src/jobs/order-send.ts:356-395` (unknown -> checking -> unconfirmed); no per-login call budget in the worker | D115 "unknown: read back, never send again"; D120 an unconfirmed Send pauses; test-POS design: the `rateLimit` switch (1 call at a time, 5 per second, Q28) is there so "queues and backoff hold under a strict limit" | If a guest taps Send while a phone is open on the table, then the Send's own two read pairs plus one background table read put six POS calls inside one second, `addRows` is answered 429 busy, the round never reaches the POS, the order ends Unconfirmed after 56 s, ordering pauses (table or venue) and an alert is raised. Reproduced on two of the three Sends that reached the POS (12:06:20 and 12:39:20; the first, 12:05:03, landed): the sim call log shows 5 reads then `addRows` 429 within 600 ms both times | `behaviour/a8-2-guest-unconfirmed-paused.jpg`, `behaviour/t-owner-390-tonight-needs-you.jpg` (the alert row it raised) | medium-high: the limit is a simulator switch, the real POS limit is open (Q28); the reads-per-Send count is code, the 429 is observed |
| RR-A8-3 | low | `apps/web/src/tonight/pause-banners.tsx:32` (`banner.who ?? t('who_t')`) | D122 §7 "who did it" | If the owner (no staff row) pauses ordering from a personal phone, then the banner says "paused by the bar tablet" while the Log says "by Demo Owner" | `behaviour/a8-3-pause-banner-owner-bar-tablet.jpg`, `behaviour/t-owner-390-log.jpg` | high |
| RR-A8-4 | medium | `apps/web/src/tonight/run.tsx:~125-137` (`void execute(spec).then(...)`; `execute` has `try/finally`, no catch) | guide "Three checks at every write", 2: "What failed: a failure says what to do next" | If a waiter taps Handled, Open or Pause while the club's Wi-Fi is down, then nothing on the screen changes: no toast, the row stays, and the only trace is an uncaught "Failed to fetch" in the console; the waiter cannot tell the answer did not go | `behaviour/a8-4-tonight-handled-offline.jpg` | high (real offline mode, manager at 390 px) |
| RR-A8-5 | low | the venue header block above every venue screen (title, "Open the guest page", Publish, the two selects) | WCAG 1.4.4 and 1.4.10; guide worst-case pass | If text is at 200 % on a 390 px phone, then "Open the guest page" and the second select run off the right edge, and Settings > Staff and roles is 563 px wide: sideways scroll on every venue screen | `behaviour/o-zoom200-tonight.jpg`, `behaviour/o-zoom200-set-ordering.jpg` | medium (emulated with root font-size 200 %, not the browser's own zoom) |
| RR-A8-6 | low | `apps/web/src/tonight` header plus the shared Publish control | guide Patterns: "A role that may not act ... never shown a disabled control" | If a waiter or manager opens Tonight, then a greyed "Publish" with "Only an owner or admin can publish." sits above their work; for an owner the filled "Publish 1" is the first thing the eye lands on, ahead of an alert | `behaviour/t-waiter-390-bg-landing.jpg`, `behaviour/t-owner-390-tonight-needs-you.jpg` | high |
| RR-A8-7 | low | two links in the shared admin screens | D123 44 px floor | If a manager taps the breadcrumb "Venues" (49 x 20 px at 390 px) or the Ordering "See on a map" link (90 x 17 px) one-handed, then the target is under 44 px (every other control measured 44 px or more at 390 and 320 px; the PIN pad keys are 56 px) | `behaviour/o-390-set-ordering.jpg` (measurement in the walk log: all 9 Settings and Tonight screens, 3 widths) | high |
| RR-A8-8 | low | `qr-phone` order block when the table is closed | D119 order of asking; guest persona | If a guest scans the code of a table that is closed for phones, then the page first offers "Allow location", then asks consent, and only below says "This table is not taking orders from phones right now" | `behaviour/rr35-guest-closed-table-switch-off.jpg` | high |

Observations (no evidence row, or a template that is not the product's face): the `qr-phone` guest page puts the table order under the whole menu and shows nothing near an "Add" tap, so a guest cannot tell the add worked (`behaviour/g-en-menu-top.jpg`, `behaviour/g-en-order-at-page-bottom.jpg`); it also has no "call a waiter" button outside the location-failed prompt; a failed Pay leaves "Card payments are paused right now. Nothing was charged. [Back to the bill]" on the page after a reload; the PIN pad ignores digits typed on a keyboard and the sheet's close X is 16 px (the "Leave it" button is 44 px); a React warning "Cannot update RunProvider while rendering PinSheet" is logged when the PIN sheet opens; the spot warning "Set the venue's spot, or nobody can order ... while the location check is on" stays red after the check is switched off (`behaviour/o-ordering-check-off.jpg`); the hide switch in the Composer changes only the draft (the guest still ordered the "hidden" Mojito until publish), which is by design but a manager who hides on a busy night must also publish (owner only); Maria's PIN dialog and password-again dialog behave as planned.

## The listed rows

| Row | Verdict on the running screen | Evidence |
|---|---|---|
| RR-2 | Holds. A guest page open when the owner switched paying on still said "Ask your waiter to pay." about 60 s later; a fresh load showed the pay panel. Later the owner changed the legal name: the open page kept "Demo Bar EOOD" after 45 s, a fresh load showed "Changed Bar EOOD X" | `rr2-stale-open-page-old-legal-name.jpg`, `rr2-fresh-page-new-legal-name.jpg`, `o-paying-card-on.jpg` |
| RR-26 | Not settled on a screen. The Sends I could refuse either paused the table (over the cap: `guard.tripped order_cap`, the plan's own design) or hit RR-A8-2 before any refusal; I could not produce an inline refusal followed by a retry inside 15 s. Left to the code reading (A10a) and a test | `t-owner-800-guard-table-paused-row.jpg` shows the cap pause row, which reads well |
| RR-35 | Holds. The "Only at tables a waiter has opened" switch is on screen; switched off, a table closed for phones still refuses orders ("not taking orders from phones right now"); nothing else changed | `o-ordering-initial.jpg`, `rr35-guest-closed-table-switch-off.jpg` |
| RR-54 | Holds. A manager opening `/venues/<id>` (what a push tap carries) lands on the Composer, not Tonight or the Log (an owner too) | `rr54-venue-url-opens-composer-manager.jpg` |
| RR-56 | Holds. The sent-order sheet for an Added order shows state, lines, total and steps; no POS bill number (the order is on bill "acc 1 #2") | `rr56-sent-order-sheet-no-bill.jpg` |
| RR-57 | Partly. The Log reads "Alert done: A table: an order couldn't be confirmed" for an alert on Table 1 (table label empty, same builder as the venue name). The "Ordering is paused at " variant was not produced: pause alerts are raised only by the worker's alert job, which needs a push or Telegram setting I did not configure | `t-owner-390-log.jpg` |
| RR-58 | Visible ones hold: no Undo and no "· who" on "Handled" (manager phone), on "Open all" (manager phone) and on a pause from the tablet; the cap field discards a typed value on blur with no message; turning a day off then on empties its times (dialog opens blank); consent is asked again in a second tab; Send is absent, not greyed, while ordering is paused. Not walked: the "Slow down a moment" and "no longer in use" wording, the probe gaps, the dispute row, the waiter-panel clock, and the Settings error toast's close button (no server-side refusal could be produced; offline gives no toast at all, see RR-A8-1 and -4) | `rr58-handled-toast-no-undo-no-who.jpg`, `rra10c12-open-all-manager-phone.jpg`, `t-tablet-1180-paused-no-undo.jpg`, `o-ordering-cap-typed.jpg`, `o-ordering-cap-after-blur.jpg`, `rra10c13-hours-friday-off.jpg`, `rra10c13-hours-friday-on-dialog.jpg`, `rra10c17-second-tab-asks-again.jpg`, `g-bg-paused-unsent.jpg` |
| RR-O1 | Holds. With the Paying checks incomplete, Tonight (owner, 1180 px) shows no banner and no word about paying; Settings > Paying lists the missing checks. A banner exists only for a lost, restricted or paused account | `rro1-tonight-owner-paying-setup-incomplete.jpg`, `o-paying-incomplete.jpg` |

## Stories, sources and taps

Taps counted from the screen the person lands on; "target" is the plan's.

| Story (source) | Taps found | Target | Result |
|---|---|---|---|
| Answer a waiter call, manager phone (#85 S2) | 1 (Handled) | 1, Undo toast | taps hold; no Undo (RR-58) |
| Pause ordering (#85 S10; D122 §7) | 2 (button, scope), owner gets Undo, tablet does not | 2 | holds; Undo only for owner |
| Resume ordering on the tablet (#85) | Resume + 4 PIN digits; a staff PIN is refused with "This PIN belongs to staff. A manager's PIN is needed." | manager PIN | holds, the message names the fix |
| Open all / open one table (#85 S3) | 1 / 1 (closed tile opens at once, Undo for owner) | 1 | holds |
| Answer an unconfirmed order (#85, D116) | 1 ("Found on the bill" / "Not on the bill") | 1 | holds; no Undo toast |
| Set open nights (#87 H1) | section, switch, 3 time fields, Save = 6 on desktop | 6 | holds |
| Close one night (#87 H2) | 2 + Undo toast | 3 | holds, but the day's times are lost (RR-58) |
| Switch the location check off (#87 O4) | section, More, switch = 3, consequence line at once, Undo | 4 | holds |
| Change the cap (#87 O2) | pencil, type, Enter | 4 | holds; blur discards |
| Add a person (#87 staff) | section, Add person, name, Add; PIN shown once | about 3 | holds |
| Set the spot (#87 O1) | section, one button | 3 | holds |
| Guest: add, Send (#77, D115) | Add, Send (2 taps), plus Allow location and Allow once per tab | 2 | holds |
| Guest: pay two lines or one (#110) | tick, Pay (2) | 2 | the tap count holds; the payment itself paused (no finishable provider account on the running worker) |
| Staff-only sign-in lands on Tonight (#85) | manager did, via the venues list | Tonight | holds (waiter without a role assignment saw "no access" until the fixture was fixed) |
| Integrations: no sideways scroll at 390 px in Bulgarian, no stray scrollbar (#87 §C, #59) | none at 390 or 320 px; tab strip 62/62 | none | holds |
| Password again after 15 minutes (#87, D122 §7) | dialog appeared on the first change after 15 min; the change then went through | dialog | holds |

## Wayfinding, screen read and feedback (operational screens)

Four wayfinding (where am I, where can I go, what is here, how do I get out), four screen-read (eye lands on, purpose in 2 s, one reading order, right thing emphasised), three feedback (what happened, what failed, leave without losing work). Y holds, N does not, - not applicable. "Phone" is 390 px, "tablet" 1180 px.

| Screen | W1 | W2 | W3 | W4 | S1 | S2 | S3 | S4 | F1 | F2 | F3 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Tonight, Actions and tables (phone, tablet) | Y | Y | Y | Y (Esc and "Leave it"; X is 16 px) | N (filled Publish) | Y | Y | N (Publish over the alert) | Y | N (RR-A8-4) | - |
| Tonight, Sent orders + sheet | Y | Y | Y | Y (Close) | Y | Y | Y | Y | Y | N (same runner) | - |
| Tonight, Log | Y | Y | Y | Y | Y | Y | Y | Y | - | - | - |
| Tonight, End of night | Y | Y | Y | Y | N (Publish first) | Y | Y | Y | - | - | - |
| Settings > Hours | Y | Y | Y | Y | N (Publish) | Y | Y | Y | Y (toast + Undo) | N (RR-A8-1) | Y |
| Settings > Ordering | Y | Y | Y | Y | N | Y | Y | Y | Y | N (RR-A8-1; cap blur discards silently) | N (blur) |
| Settings > Paying | Y | Y | Y | Y | N | Y | Y | Y | Y ("Unsaved", Save) | N | Y |
| Settings > Staff and roles | Y | Y | Y | Y | N | Y | Y | Y | Y (PIN dialog) | N | Y |
| Settings > Alerts | Y | Y | Y | Y | N | Y | Y | Y | - | - | - |
| Tables & QR | Y | Y | Y | Y | N | Y | Y | Y | Y | - | - |

Every "N" in S1/S4 is the same cause: the filled Publish button in the shared header (a Works-but-awkward proposal: on Tonight and the phone's first screen keep it outline or move it below the content; S, no decision changes). Each "N" in F2 is RR-A8-1 or -4.

Accessibility (WCAG 2.2 AA) on what was walked: keyboard order on Tonight follows the reading order and every control shows a focus ring (2.4.3, 2.4.7: only the two tablist containers show none); the table tiles carry "Table 1 is open for phones" names (4.1.2); the pad keys are 56 px, answer buttons 44 px; no horizontal scroll at 390 or 320 px on nine screens (1.4.10) but at 200 % text the header overflows (RR-A8-5, 1.4.4). Contrast was not measured; both themes were seen only in passing (dark in the built-in browser, light in Playwright). A screen reader proper is a `device` line for Martin.

## Works (one line each)

Staff-only sign-in lands on Tonight; Needs you updates by itself within about 10 s of a new call; the guard pause row ("Table 1 is paused. The order limit was reached ... Resume table") and the unconfirmed row name the next step in plain words; the Restro pause banner says "You don't need to do anything" and lifts by itself ("probes_good", 3 min); the wrong-level PIN names the fix; the location consent text and buttons read well in Bulgarian and English (`g-bg-consent-sheet.jpg`); a closed table says so; the Hours "(next morning)" line and the first-visit line; the password-again dialog; inline cap validation names the range; every string on the walked Bulgarian screens (Tonight as waiter, the guest page, org Integrations) was Bulgarian.

## Not covered, and why

The card form and a finished sim-pay payment: the running worker's simulated provider cannot be completed from outside, and the project's pay harness did not publish its page on my setup (no menu file written), so the guest got as far as tick, Pay and the provider pause. The Stripe sandbox was not tried. The 06:59 / 07:00 boundary, a schedule across midnight and the clock-change night (no clock control). Hover-only actions were not enumerated. A hand-made venue (Demo Club Sofia), the organisation admin and member personas, push and Telegram delivery (not configured, so no paused-alert Log line), the Settings error toast's close button, the retired-code wording, "Slow down a moment", the dispute row, a screen reader, contrast numbers.

## Environment left behind

Servers stopped; database `restro_rr_a8` kept (Demo Club, Demo Bar and a harness "Pay Club" organisation). Scratch scripts and the env file are in the session scratchpad, not the repo. The worktree `rr-a8` is clean.
