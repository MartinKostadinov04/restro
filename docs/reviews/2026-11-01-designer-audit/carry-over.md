# B1: what the retired template took with it

Agent B1, 2026-11-01. Pin `7dccd3a4` (read in `E:/Restro/.claude/worktrees/da-pinned`, detached, nothing run, nothing edited). Old code read from `origin/or/foundation` (`60cf6430`; merge base with the pin `f1f37abb`). Decisions 128 to 131 have no file on this branch; they are written without the D.

**What I covered:** (1) every guest-facing row of the repair-review ledger (`findings.md`, `rewalk.md`, `behaviour.md`); (2) where each is enforced and tested on the pin for Editorial; (3) the seven deleted test files, case by case; (4) `docs/guides/menu-template-functionality.md` against Editorial's code and tests. The wave changed nothing in `packages/core/src/service`, `apps/worker/src/jobs` or `packages/core/src/table-order.ts` (empty `git diff --stat`), so the server half of every row below is as the repair-review left it and is cited by its existing test only.

**Short names used in the tables.** `E` = `packages/faces/editorial-market/src`; `S` = `E/services`; `H` = `apps/web/src/guest` (the host: `services-client.ts`, `use-table-services.ts`, `guest-menu.tsx`, `context.ts`). Tests named by file and line of the `it`.

**Verdicts.** guarded = code and a test. unguarded = code does it, no test. missing = Editorial does not do it (a finding). changed = done differently (says whether a decision allows it). n/a = server or staff side, untouched by the wave.

**Headline.** Most of the repair-review's guest fixes are on Editorial and have a jsdom test in CI (the consent, Stop, lost Send, offline greying, setScreen, sent-order words, paid-in-the-app, confirmation, receipt email). The holes are not in what was ported but in what was never drawn the same way: five guest paths that the old test template drew inline on the page are now behind sheets (location refusal, weak connection, payment in progress, Stop with the bill switched off), the Call a waiter sheet does not do what decision 127 says, the Paid number has no large type, and a POS discount line crashes the bill, Pay and Paid screens (shared with qr-phone, never tested).

---

## 1. The ledger rows that touch a guest

| source | what it enforced | now enforced at | now tested at | verdict |
|---|---|---|---|---|
| RR-2 open phone keeps old paying state | a poll with a higher version moves the phone to the new paying state and legal details | `H/services-client.ts` (unchanged by the wave) | `H/services-client.test.ts:879` | guarded (host, template-neutral) |
| RR-5 provider values in the address bar | values leave the address before any request; `#pay` not carried | `H/guest-menu.tsx:133` `cleanAddressBar`; `apps/web/src/connectors/return-address.ts:19-59` | `connectors/return-address.test.ts`; `apps/web/e2e/guest-pay-return.spec.ts:36` (both Styles). The return URL drops the fragment (`return-address.ts:cardReturnUrl`), so after a redirect the guest lands on the menu with no sheet open: see DA-B1-7 | guarded; accepted risk unchanged |
| RR-6 / RR-8 / RR-74 guards (Turnstile, per-phone limits, wrong codes) | server refusals | server, unchanged | `core/src/service/security-pay-phones.test.ts` etc. (not re-read) | n/a |
| RR-13 "Not on the till" returns pay-first lines to the bag | server frees the lines; the screen says nothing was charged and goes back to the order | server `pay-first-route.test.ts` (RR-13); face `S/pay-sheet.tsx:782-808` (ended screen), `S/bag-sheet.tsx:179-186` (pay-first payment shown in the bag) | `S/pay-first.test.tsx:382` (enter_refused, item_unavailable), `:406` (no_receipt), `:205` (Pay again after leaving the form), `:355` | guarded |
| RR-14 lines locked while unconfirmed | `unconfirmed` is not settled: the lines stay `beingPaid`; no second payment on them | server: migration 0032, `payment-route.test.ts`. Face: a `beingPaid` line is plain text "Being paid", no tick: `S/pay-sheet.tsx:436-445`, `S/bill-sheet.tsx:77-83`; a held bag line has no controls `S/bag-sheet.tsx:262-289`; "checking" screen never asks to pay twice `S/pay-sheet.tsx:773-781`; ticks of lines now in a payment are dropped `pay-sheet.tsx:316-318` + shell `paying.ts:94` | `S/pay.test.tsx:96` (greys, no tick), `:399` (unconfirmed/stranded/capture_failed: calm screen, no Pay again), `:289` (reconcile); `S/bill.test.tsx:249`; `S/bag.test.tsx:405` | guarded (the second-payment refusal itself is server only) |
| RR-24 Not sent wording | a round that never left says "We couldn't send your order, please call a waiter" | shell `table-order.ts:27-42` `sentWords`; drawn `S/bag-sheet.tsx:107-160` | `S/bag.test.tsx:939` (all states incl. paused / first item / plain), `:442`, `:456` (ran out) | guarded |
| RR-25 card for an order awaiting approval keeps showing | no 15-minute disappearance | server `pay-first.test.ts:239`; face lists every `sentOrders` row | `S/bag.test.tsx:939` (`so_5`) | guarded |
| RR-26 refused Send does not use the 15 s allowance | limits reserved and given back | server, `guest-send-limits.test.ts`; the face has no local limiter and lets a second Send go | face: `S/bag.test.tsx:547`, `:560` (a refused Send keeps the order and says why) | guarded (server) |
| RR-27 no-POS-bill check | `needs_first_item` | server `send-guards.test.ts`; words shell `strings.ts:600`; sent-order words | `S/bag.test.tsx:939` (`so_7`) | n/a / guarded |
| RR-31 "bag changed" only for a sent line | server | `core/src/table-order.test.ts:93,163,235` | n/a | n/a |
| RR-32 removing a line is never located | server; the face sends `order.remove` with no location step | `core guest-location.test.ts` | `S/bag.test.tsx:350` (remove goes) | guarded |
| RR-48 Privacy link ends the consent text | link in the consent sheet, wherever the venue checks, whatever paying is | `S/location-sheet.tsx:74-86` (link only when `privacyUrl` is set); host sends it `H/services-client.ts:761` | `S/connection.test.tsx:52` (text, href, `_blank`, `noopener`, Allow, Not now), `:67` (Bulgarian), `:76` (no link without a notice), `:82` (close is not an answer); visible link in every Style `S/screen-options.test.tsx:546`; the sheet over another sheet `connection.test.tsx:132-170`; e2e `apps/web/e2e/guest-order.spec.ts:138` | guarded |
| RR-49 Stop location check | one control on the bill (pass held), in the failed check, and in the bag when no bill is drawn | `S/location-sheet.tsx:23-32`, `S/bill-sheet.tsx:142`, `S/bag-sheet.tsx:84-104`; host `H/services-client.ts:1088,1161` | `S/connection.test.tsx:173` (bill, one tap), `:95` (failed check), `:182` (not before allowing), `:193` (Bulgarian); `S/bag.test.tsx:999` (bag, no bill); host `services-client.test.ts:1662,1698`. Not tested: host without `stop` | **missing in one case**: venue with the Bill switch off and a bill reading present: DA-B1-2 |
| RR-50 lost Send answer | D120 line, never "Try again", no re-send for ~3 min, reference when known | `S/provider.tsx:458-476,522-525`; `S/bag-sheet.tsx:195-199`; host `services-client.ts` `sendLost` | `S/connection.test.tsx:206-268`; `S/bag.test.tsx:576` (thrown), `:590` (no answer in time), `:615` (answer_lost), `:679` (hold over), `:718`; host `services-client.test.ts:1544-1660` | guarded |
| RR-51 request timeout / weak connection | ~10 s without an answer: `offline`; Send and Pay greyed, never queued; bag editable | host `services-client.ts:101-104,542-590,1031-1034`; face `S/bag-sheet.tsx:200-204,376`, `S/pay-sheet.tsx:380-398`, `S/provider.tsx:586` | host `services-client.test.ts:1417-1545`; face `S/bag.test.tsx:706`, `S/connection.test.tsx:270,287`, `S/pay-first.test.tsx:255-278` | guarded; the line is drawn only inside the bag and pay sheets: DA-B1-6 |
| RR-52 bill view / screen the face has open | `setScreen('menu'\|'bag'\|'bill')`; bag and bill poll at 2 s, bill read fresh | `S/provider.tsx:352-356` | `S/connection.test.tsx:302`; host `services-client.test.ts:1723,1741` | guarded |
| RR-58 guest items | "Slow down a moment", "no longer in use", waiter time on the venue's clock, Send greyed not hidden while paused, consent kept per phone/day, browser refusal not remembered | shell `strings.ts:588,590`; `S/bag-sheet.tsx:55-59,161-405`; `S/bag-sheet.tsx:122` (`sentClock`); host consent code | shell `strings.test.ts:7`; `S/bag.test.tsx:792` (retired), `:804` (clock), `:738,766` (paused); host `services-client.test.ts:625-795` | guarded |
| RR-60 which template takes orders | the page binds the table's services for Editorial; `buildContext` turns services off for an unbound one | `H/use-table-services.ts:SHARED_ORDER_FACES`; `H/context.ts:buildContext,hasTableService`; `H/guest-menu.tsx:303-318` | `H/table-services-page.test.tsx:149,180,196,212,225,237,264,274,280`; `H/bound-template-attack.test.tsx` | guarded |
| RR-67 / RR-28 / RR-29 / RR-30 / RR-33 / RR-34 | Send under a POS limit, read after Added, table pause, locked bill | worker / connector, untouched | existing worker tests | n/a |
| RR-68 polling cadence on qr-phone | 2 s only while the bag or bill is open | `S/provider.tsx:352-356` (menu otherwise) | `S/connection.test.tsx:302` | guarded (now true) |
| RR-78 "a write while offline says what to do next" | **staff side** (Tonight). The ledger's RR-78 is Tonight's Handled/Open/Pause; qr-phone never drew it. The guest analogue is an edit whose answer is lost | guest: `S/provider.tsx:514-519` shows "That did not work" only when the host throws; a lost edit comes back `pending` and is silent (host `services-client.ts` takes the edit back) | host `services-client.test.ts:320`; no face test | n/a for staff; guest analogue unguarded: DA-B1-6 |
| RR-82 closed table: location asked first | observation | `S/location-sheet.tsx` asks only when the host prompts | none | observation, unchanged |
| RR-89 consent per tab | answer kept per phone and day; the tab's pass starts empty; the tap finds the position with no second consent | host `use-table-services.ts` / `services-client.ts` `reopen()` | host `services-client.test.ts:625-713` | guarded |
| RR-O22 guest details | no sign near Add; no Call a waiter outside the failed prompt; failed Pay line survives reload | bar button `S/bag-bar.tsx:33-48`, counter `S/quick-add.tsx:169-181`, count on the bag button `bag-bar.tsx:57-69`, waiter button `bag-bar.tsx:33` | `S/bag.test.tsx:189,200`; `S/call.test.tsx:49`; failed-Pay line: unchanged | changed for the better; the reload line unchanged |
| RR-O41 / N2 Call a waiter never shows | host sets `callWaiter` from the manifest | `H/context.ts:buildContext` (`draws('call_waiter')`) | `H/table-services-page.test.tsx:149,274` | guarded |
| RR-O42 / N3 Send hidden while paused | greyed, not hidden | `S/bag-sheet.tsx:171-172,376` | `S/bag.test.tsx:738,766,779` | guarded |
| RR-O43 / N6 two opposite lines | the lost-Send line goes when the order lands | `S/provider.tsx:484-492`, `S/bag-sheet.tsx:195` | `S/bag.test.tsx:625,649,667` | guarded |
| RR-O44 / N10 Privacy link looks like plain text | visible, underlined, 44 px | `S/services-css.ts` (consent link) | `S/screen-options.test.tsx:546` | guarded; the "no link when no notice" part stays open (RR-O15) |
| RR-O45 / N12 no paying after the closing hour | follows D122 | server | none | observation, unchanged |
| RR-O46 tips offered | tip only where `ordering.tips` | `S/provider.tsx:443`, `S/pay-sheet.tsx:292,470` | `S/pay.test.tsx:90,247`, `S/pay-first.test.tsx:92,155`; Paid shows tip and total `pay.test.tsx:381` | guarded |
| A8R "Pay greyed while paused, lines editable" | `payBlock` returns `ordering_paused` with the pause's own line | shell `paying.ts:214-221`; `S/pay-sheet.tsx:380-398` | `S/pay.test.tsx:131,149` | guarded |
| A8R "tip through close and capture" (Paid screen) | Paid shows lines, tip, total, number, table, receipt line | `S/pay-sheet.tsx:731-771` | `S/pay.test.tsx:381,613` | guarded (number's size: DA-B1-4) |
| A8R "Call a waiter, then its answer" | request, then the host's word | `S/call-sheet.tsx` | `S/call.test.tsx:118-262` | changed, contradicts decision 127: DA-B1-3 |
| RR-36..RR-47 staff, RR-54..57, RR-70..77, RR-79..81, RR-83..93 | staff, Tonight, settings, tablet | not guest | not B1 | n/a |

---

## 2. The seven deleted test files

`git diff --name-status --diff-filter=D origin/or/foundation...7dccd3a4 | grep -E '\.test\.|\.spec\.'` gives seven (no `.spec.ts` was deleted): `packages/faces/qr-phone/src/connection.test.tsx`, `.../face.test.tsx`, `.../pay-panel.test.tsx`, `apps/web/src/guest/face.test.tsx`, `apps/web/src/design/design-panel.test.tsx`, `apps/web/src/design/template-options.test.ts`, `packages/core/src/apply/venue-theme.test.ts`.

### 2.1 `qr-phone/src/connection.test.tsx` (25 cases)

| deleted case | what it asserted | now tested at | verdict |
|---|---|---|---|
| consent: ends D122's text with the Privacy link (href, `_blank`, `noopener`, text, Allow, Not now) | RR-48 | `S/connection.test.tsx:52` | guarded |
| consent in Bulgarian | | `connection.test.tsx:67` | guarded |
| consent: no link where the venue has no notice | | `connection.test.tsx:76` | guarded |
| Stop: on the bill while a pass is held, one tap, one control only | RR-49 | `connection.test.tsx:173` (one tap); "one control, not two" not asserted | guarded in part |
| Stop: in the location panel while no bill | | `S/bag.test.tsx:999` | guarded |
| Stop: in the failed check beside Call a waiter and Cancel | | `connection.test.tsx:95` | guarded |
| Stop: not drawn before the guest allowed anything, or where the host cannot stop | | not before allowing: `connection.test.tsx:182`; **host without `stop`: none** (the fake host always gives `stop`, `S/test-kit.tsx:~340`; code `S/location-sheet.tsx:25-26`, `bag-sheet.tsx:87`) | unguarded (low) |
| Stop in Bulgarian | | `connection.test.tsx:193` | guarded |
| lost Send: D120 line, no "Try again", no "Nothing new was sent", no re-send | RR-50 | `connection.test.tsx:215`; `bag.test.tsx:576` | guarded |
| lost Send names the reference | | `connection.test.tsx:240` | guarded |
| lost Send in Bulgarian | | `connection.test.tsx:262` | guarded |
| the line from the command's own answer before the host's state has it, and drops with the host | the face's bridge (`answerLost`) and its release when the host lets go | `bag.test.tsx:615` (own answer), `:625` (lands); **release when the host clears `sendLost`: none** (`S/provider.tsx:462-469`; both clocks are 3 minutes, so harmless) | unguarded (observation) |
| general weak signal keeps the weak-connection line, not the lost line | | `bag.test.tsx:706` (shows offline line); the negative "not sendLost" not asserted | guarded in part |
| Send greyed offline, bag editable | RR-51 | `connection.test.tsx:271`; `bag.test.tsx:706` | guarded |
| Send live while online | | every Send test in `bag.test.tsx` | guarded |
| Pay greyed offline with the weak line as reason | | `connection.test.tsx:287`; `pay.test.tsx` payBlock | guarded |
| screen: bag with no bill, bill with a bill | RR-52 | `connection.test.tsx:303` (bag, bill, menu in turn) | guarded |
| screen: menu where the venue takes no orders from phones | | not as such; by construction `provider.tsx:355` | unguarded (low) |
| screen: bill when the bill panel is drawn, ordering on or off | | `connection.test.tsx:303` (bill via `#tab`); ordering off not asserted | guarded in part |
| waiter panel time = host's clock | RR-58 | `bag.test.tsx:804` | guarded |
| code no longer in use, in both languages | RR-58 | `bag.test.tsx:792` (English; Bulgarian words in `shell strings.test.ts:7`) | guarded |
| code still says closed when it only is | | `bag.test.tsx:726`; shell `strings.test.ts:21` | guarded |

### 2.2 `qr-phone/src/face.test.tsx` (about 45 cases)

| deleted case | now at | verdict |
|---|---|---|
| manifest passes `validateManifest` | `E/manifest.test.ts:7`; `shell/testing/suite.ts:38` via `contract.test.tsx:528` | guarded |
| manifest declares what the brief asks (face, channels, paging, allergen mode, no-image layout, `ordering`, image slot, description slot) | `E/manifest.test.ts:11,47,68,78` | guarded |
| contract on every fixture; dense screen | `E/contract.test.tsx:71,78` (also `:83,:88`) | guarded |
| title, intro, sections in snapshot order | `contract.test.tsx:71` (slots in order); `face.test.tsx:595,658` | guarded |
| table banner only with a table; "VIP 3" as it is | `face.test.tsx:600,611` | guarded |
| language switch only with two languages, current pressed; `menu.language` marker | `face.test.tsx:619,632`; `contract.test.tsx:443` | guarded |
| jump link per section; filter chips from the view model | `face.test.tsx:658,333` | guarded |
| filters as one `menu.filters` slot when on; none when the venue switched off; none for a menu without chips | `face.test.tsx:341,348,359,333` | guarded |
| photo box reserved, lazy, srcset | `face.test.tsx:198` (lazy), `:792` (sizes); width/height/srcset of cards by the contract (R10) | guarded in part |
| text-only collapse; asset base from host | `contract.test.tsx:52` (CDN base), `model.test.ts:38`; collapse by contract | guarded |
| paints from theme variables only, light and dark; host font stack | `E/model.test.ts:118,129,137`; `css.test.ts:72` | guarded |
| manifest guest features and no options | `manifest.test.ts:68,78` | guarded |
| stylesheet holds no colour of its own | `css.test.ts:45` (stricter: no system colour either), `services-css.test.ts:105` | guarded, tightened |
| every control 44 px | `css.test.ts:137`; `services-css.test.ts:247,289,295` | guarded |
| reduced motion and colour scheme | `css.test.ts:95,175`; `services-css.test.ts:176` | guarded |
| cuts only the description, three lines | `css.test.ts:101,114`; `contract.test.tsx:480` | guarded |
| skeleton and notice without a view model (`aria-busy`, no button) | `apps/web/src/faces/notices.test.tsx:63,75` (look only); text in `H/guest-menu.test.tsx:254,281,418`; `aria-busy` not asserted | guarded in part |
| model helpers: asset URLs, bcp47, language label | `E/model.test.ts:25,38` | guarded |
| filter semantics (tags OR, dietary AND, order kept, empty section goes) | `model.test.ts:72-107`; `face.test.tsx:388,416,428,441` | guarded |
| shared order: panel and Add on each orderable item | `contract.test.tsx:321,337`; `bag.test.tsx:88-168` | guarded |
| each line with quantity, no controls on a held line | `bag.test.tsx:311,405` | guarded |
| pay-first line says "order from your waiter" | `bag.test.tsx:417`; `pay-first.test.tsx:216` | guarded |
| Undo on a removed line, Restore on the earlier order | `bag.test.tsx:366,378` | guarded |
| no order where the shell left ordering off | `contract.test.tsx:269`; `bag.test.tsx:98,110` | guarded |
| Send guards: sold-out line stays, "Send the other N"; "Send N items" | `bag.test.tsx:428,442,503` | guarded |
| duplicate check: "Same as N minutes ago. Send another?", Send another, Cancel, "a moment ago", null minutes | `bag.test.tsx:844,871,909`; words `shell strings.test.ts:63-70` | guarded |
| "Tell the staff" where notes and options do not reach the ticket | `bag.test.tsx:476,268` | guarded |
| item needing a choice is "ordered from the waiter" where options do not reach the ticket | `bag.test.tsx:252`; `contract.test.tsx:421` | guarded |
| minutes since the sent order (floored: 4 m 59 s is 4; unknown order is null) | shell `table-order.ts:44-52` has **no unit test**; `bag.test.tsx:844` (4 minutes), `:909` (unknown) | guarded in part (the floor is untested) |
| out of stock at Send: run-out line greyed, "Send the other 2", "Nothing was sent: something ran out" | `bag.test.tsx:442,456` | guarded |
| location: consent in D122's words, naming the venue, Allow and Not now; **no word "pay" in the text** | `connection.test.tsx:52`; the negative is not asserted | guarded in part |
| location failed: Call a waiter and Cancel where calls are taken; still card otherwise | `connection.test.tsx:95` | guarded |
| location none: why hidden, Allow location, no empty order | `bag.test.tsx:977` | guarded |
| the night: open (no notice), last orders, closed, opens later; Send away | `bag.test.tsx:821` (all three; "open" by default) | guarded |

### 2.3 `qr-phone/src/pay-panel.test.tsx` (about 35 cases)

| deleted case | now at | verdict |
|---|---|---|
| bill and choosing: POS lines, nothing ticked, no tip, Pay greyed with its reason | `S/pay.test.tsx:60` | guarded |
| no tip where the POS cannot record one; no Pay where paying is off | `pay.test.tsx:90,119` | guarded |
| a line being paid greyed, no tick | `pay.test.tsx:96`; `bill.test.tsx:249` | guarded |
| every state of this phone's payment (contract): screen, slot mounted once, Paid only when captured, no step of the till worded | `pay.test.tsx:638-660` (screen, slot count, number, no internal words). **Not asserted now:** the "Paid" title is absent for a non-paid state, the slot's label and the slot target (the label is `pay.test.tsx:332`; "Paid only for captured" `:381`) | guarded in part |
| mounts the form once, keeps it across a new state, takes it away at the hold | `pay.test.tsx:332,345` | guarded |
| goes back to the bill from a last screen | `pay.test.tsx:381` (`dismissed()`) | guarded |
| "Pay again" keeps the ticks; Pay takes the guarded path; the pick carries each line as seen | `pay.test.tsx:527` (pick lines and quantities); amounts "as seen" `:222` | guarded |
| never sends a tip where none is offered | `pay.test.tsx:561` | guarded |
| refusal worded by the shell helper with the venue's minimum and "Too many tries" | `pay.test.tsx:574,257` | guarded |
| venue's legal name on the processor line | `pay.test.tsx:594,159` | guarded |
| legal details and privacy link in English and Bulgarian | `pay.test.tsx:174` | guarded |
| neither line nor links without legal details | `pay.test.tsx:194` | guarded |
| processor line and links on the card screen too | `pay.test.tsx:200` | guarded |
| bill hidden without a pass: why, Allow location, Call a waiter | `pay.test.tsx:601`; `connection.test.tsx:182` | guarded |
| table on the Paid screen; Call a waiter on the card screen | `pay.test.tsx:613,621` | guarded |
| card form gets the guest's language and the failure words | `pay.test.tsx:628` | guarded |
| pay-first round ended "No receipt": ordered, unpaid, on the screen and in sent orders | `pay.test.tsx:479`; `bag.test.tsx:939` (`so_4`); `pay-first.test.tsx:406` | guarded |
| paid in the app: greyed lines, no payer; names in the guest's language, "Other item"; everything paid; choosing as usual; nothing when none | `pay.test.tsx:662,684,696,715,729,737,750` | guarded |
| Payment confirmation: offered on Paid only; contents; does not look like a receipt; Bulgarian with no "бон"/"фискал"; saves through a blob, sends nothing; one line when Save fails; focus, `aria-controls`, "Back" | `pay.test.tsx:770,782,801,811,827,852,872` | guarded |
| electronic receipt: field only where offered; sends the address; never one where not offered; Paid line (sent, requested, paper); confirmation line | `pay.test.tsx:898,910,936,958,975` | guarded |

### 2.4 `apps/web/src/guest/face.test.tsx` (14 cases)

| deleted case | now at | verdict |
|---|---|---|
| jump bar: link per section, scrolls and highlights | `E/face.test.tsx:658,671`; e2e `apps/web/e2e/guest.spec.ts:~144` (jump and `aria-current`) | guarded |
| jump bar highlights the section being read while the page scrolls | `E/category-rail.tsx:20-51` (IntersectionObserver). **No test** (jsdom has none) | unguarded (low) |
| jump bar not drawn for one section | `face.test.tsx:683` | guarded |
| filter by tag (any of), order kept, "All" | `face.test.tsx:416,428`; e2e `guest.spec.ts:129` | guarded |
| filter by dietary (all of) | `face.test.tsx:388` | guarded |
| nothing matches, clearing | `face.test.tsx:448` | guarded |
| no chips when no tags or labels | `face.test.tsx:333` | guarded |
| allergen sheet: opens from the code, full legend, own marked, Escape, focus back | `face.test.tsx:497-525,779` | guarded |
| allergen sheet closes from the button and **from a tap outside** | button `face.test.tsx:543`; veil tap `E/overlay.tsx:84-86` (`onMouseDown`) **no test** | unguarded (low) |
| footer lists every allergen | `face.test.tsx:716`; `contract.test.tsx:458` | guarded |
| language switch calls the host | `face.test.tsx:619` | guarded |
| page in English when the view model is | `contract.test.tsx:149-258`; `face.test.tsx:727` | guarded |
| sold out from the overlay: marked, other item unchanged | **changed by decision 131**: a sold-out item leaves the menu: `face.test.tsx:710`, `css.test.ts:166`, `apps/web/src/composer/sold-out-rule5.test.ts`, e2e `sold-out.spec.ts` | changed (allowed) |
| scheduled item shows its time ("от 18:00") | `E/item.tsx:100-101` draws `state.label`; shell `build.test.ts:40` makes it; the contract checks the slot and its `data-state` (`shell/testing/contract.ts:253-257`), not the label | unguarded (low; decision 131 puts scheduled out of scope) |

### 2.5 `design-panel.test.tsx` (about 58 cases, owner side)

| deleted group | now at | verdict |
|---|---|---|
| template chooser, Bulgarian names, hidden-reference switch, no options for Editorial, Preview pop-up, pop-up shows the look being edited, "Use this template" (7) | retired by decision 128 (one renderer): `apps/web/src/faces/registry.test.ts:22`, `manifests.test.ts:30` | changed (allowed) |
| cards in order; guest features a card of their own (2) | `apps/web/src/design/design-page.test.tsx:98`; guest features `apps/web/src/composer/guest-features-ui.test.tsx`; e2e `design.spec.ts:144,164` | guarded |
| logo and header name: name shown, hint, saves with the menu rename, emptied name, server refusal, add a menu first, read-only (7) | `header-name-field.tsx` is deleted; menu rename is in the menus screens (`menus-card.test.tsx`), not traced | none found on the Design page: for step 7 |
| font, corners, shadow, screen (4) | e2e `design.spec.ts:271` (fonts); `design-draft.test.ts:124`; `preview-snapshot.test.ts:36` | guarded |
| colours brand-first (7: three pickers, tints, stops filling, saturation warning, 3:1 line, half colour, colour theory) | logic: `look-state.test.ts:191-345`, `hex.test.ts:6`; Done off for half a colour `design-page.test.tsx:185`. The colour card's own rendering: no component test | guarded (logic); card unguarded |
| Advanced computed colours (5: collapsed, ten roles with contrast, hand-set blocks Save naming the pair, named without opening, Reset all) | `look-state.test.ts:356-426`; e2e `design.spec.ts:292` (blocks Done, names the pair) | guarded (logic and one e2e); the list's rendering unguarded |
| live preview (5: draft once, names menu, sticky/below, light-dark, nothing to show + retry) | `design-page.test.tsx:98,268`; e2e `design.spec.ts:164,599`; `frame-stage.test.tsx` | guarded |
| saving the look (9: nothing to save, whole look, page and panels set, brand-only venue, brand shown as three colours, presets, keeps what it had, server refusal naming pairs, unusable logo) | `design-draft.test.ts:106,133`; `look-state.test.ts:153`; `design-page.test.tsx:133,195,220`; `server/design/actions.test.ts:120-264`; unusable logo: none | guarded; unusable-logo line unguarded |
| the logo (3: goes up with the photo checks, refuses a non-image before sending, removed / shown from its link) | `design/logo-field.tsx`: **no component test**; server `actions.test.ts:264` (not a stored image of this organisation); `preview-snapshot.test.ts:50` (removed logo goes at once) | unguarded (UI) |
| someone who may not change the design (1) | `design-page.test.tsx:256`; `advanced.test.tsx:262`; e2e `design.spec.ts:571` | guarded |

### 2.6 `template-options.test.ts` (14 cases, owner side)

The group (look options vs feature option, `mergeOptions`, template switch dropping keys, visible template and refused hidden/unknown name, "Editorial declares no option") belongs to the retired presentation record. Now: `E/manifest.test.ts:78` (no options), `apps/web/src/faces/registry.test.ts:34`, `manifests.test.ts:30,37,44` (the default for a missing or unknown name, none for a request's name), `packages/core/src/design/record.test.ts:116` (refuses an unknown option and page), `packages/core/src/theme/settings.test.ts:145` (an old snapshot's presentation still reads). Verdict: changed (decisions 128, 129 allow), guarded.

### 2.7 `venue-theme.test.ts` (about 25 cases, core)

| deleted case | now at | verdict |
|---|---|---|
| pure: eleven snapshot colours from the brand colour; reads a stored theme lower-cased; missing or malformed is none, never an error; refuses a non-`#rrggbb` colour and a non-asset id | `core/src/theme/settings.test.ts:48,107-133`; `core/src/design/record.test.ts:81,116,135` | guarded |
| input checks before the database (8 `it.each`: bad venue id, colour name, unknown field, unknown font, radius, shadow, scheme, preset) | `core/src/design/record.test.ts:116-146`; `server/design/actions.test.ts:223` | guarded |
| refuses colours that do not read, naming every failing pair, before touching the database | `design-record.test.ts:319` (writes nothing), `actions.test.ts:201` (names the pairs) | guarded |
| a venue starts with no theme and publishes the default; saves the brand colour and keeps other settings; v2 theme publishes roles, font, corners, policy; preset published | `design-record.test.ts:218,265,373`; `record.test.ts:53`; `snapshot/look.test.ts:84,101` | guarded |
| puts the logo in the snapshot only once its variant files exist; nothing of the original's storage in the snapshot | code `core/src/apply/publish.ts:419-421`; `publish.test.ts:483-503` tests this for an **item** photo only | unguarded (logo) |
| refuses a logo that is not a stored image of this tenant | `design-record.test.ts:338` | guarded |
| never writes another tenant's venue | `design-record.test.ts:352` | guarded |
| goes back to the default theme with `null`, leaving other settings alone | the operation is gone (`setDesign` replaces the record); "Basic with no colours is the default look" `record.test.ts:177`; other settings kept `design-record.test.ts:265` | changed (allowed by decision 129) |
| refuses an unreadable override and keeps the saved theme | `design-record.test.ts:319` (stale and unreadable write nothing) | guarded |

---

## 3. `docs/guides/menu-template-functionality.md` against Editorial

| guide entry and requirement | code | test | verdict |
|---|---|---|---|
| Browse sections, sub-sections, jump | `E/section.tsx`, `category-rail.tsx` | `face.test.tsx:658,671,761`; e2e `guest.spec.ts` | guarded; the scroll highlight is untested |
| Read an item (slots, dish page `#item-<id>`, `item.open`) | `E/item.tsx`, `detail.tsx` | `face.test.tsx:233-330`; `contract.test.tsx:431` | guarded |
| See only what can be had (sold out and unavailable leave the menu; closed menu says so; state labels legible; never orderable) | `shell build.ts:138-157`, `E/item.tsx:100` | `face.test.tsx:640,710`; `shell build.test.ts:40`; label text unasserted | guarded; label unguarded |
| Find allergens (codes or names, footer, sheet, no hover) | `E/allergen-sheet.tsx` | `face.test.tsx:497-565`; `staged-options.test.tsx:100` | guarded |
| Horizontal section; menu layout and guest switch | `E/section.tsx`, `layout-switch.tsx` | `face.test.tsx:82-218`; `contract.test.tsx:97-125` | guarded |
| Filter the menu | `E/filters.tsx` | `face.test.tsx:332-495` | guarded |
| Switch language; table code | `E/header.tsx` | `face.test.tsx:600-640` | guarded |
| Call a waiter: kinds in venue order, single step, "What do you need?", one open call, "Waiter called: Ice, Water", "Something else", no withdraw; words; way on from every failure screen | `S/call-sheet.tsx` | `S/call.test.tsx` | **changed / missing**: DA-B1-3, DA-B1-9, DA-B1-10; way on from failures present, silent: DA-B1-8 |
| Location check: consent with Privacy link, checking, failed, Stop, hidden-until-pass with Allow location, consent wherever the guest is | `S/location-sheet.tsx`, `bag-sheet.tsx:84-104`, `bill-sheet.tsx:44-62`, `pay-sheet.tsx:358-376` | `connection.test.tsx`, `bag.test.tsx:976`, `pay.test.tsx:601` | guarded, with DA-B1-2 and DA-B1-5 |
| See the bill: POS lines, signed amounts, decimal quantity, total/paid/owed, being-paid grey, reading age, stale mark, paid in the app, location hidden | `S/bill-sheet.tsx` | `bill.test.tsx:223-290`; `pay.test.tsx:662-756` | guarded except **signed amounts and decimal quantities: no test and the negative one throws** (DA-B1-1); title reads "Table order", not "Your table's bill" (DA-B1-9) |
| Order from the phone: bag, `item.add`, notes only where the ticket takes them, held, pay-first, Undo and Restore, paused, night, closed (retired), weak signal, lost Send, setScreen, Send, duplicate, out of stock, sent orders, Show this to your waiter (40 px, 7:1, `sentClock`), consent answer | `S/provider.tsx`, `bag-sheet.tsx`, `quick-add.tsx`, `dish-order.tsx`, `bag-bar.tsx` | `bag.test.tsx` (whole), `connection.test.tsx`, `pay-first.test.tsx` | guarded; reference size and contrast in code only (`services-css.ts:773-777`, 48 px x type scale >= 1); weak line only in sheets (DA-B1-6) |
| Pay: choosing, tip, law lines, "Same amount again", "While paying", Paid with **the number in large type**, ends, Pay again only where safe, Call a waiter on every failure screen | `S/pay-sheet.tsx` | `pay.test.tsx` | guarded except the number's type (DA-B1-4); a greyed line has no "Someone is already paying for this line" on tap (plain text, unchanged from qr-phone; low) |
| Get the receipt: confirmation, Save by blob or share sheet, not a receipt, e-mail variant, Back | `S/pay-sheet.tsx:164-283` | `pay.test.tsx:757-988` | guarded |
| Guest words table (`bill_title`, `call_btn`, `call_sheet`, `call_sent`, `call_more`, `call_done`, `call_rejected`, `no_calls`, `cancel`) | shell `strings.ts` | `shell strings.test.ts` (parts) | changed: DA-B1-9 |

---

## Findings

| id | severity | file:line on the pin | rule / decision / ticket quoted | failure scenario | evidence | confidence |
|---|---|---|---|---|---|---|
| DA-B1-1 | high | `E/services/bill-sheet.tsx:82`, `pay-sheet.tsx:437,662`, shell `confirmation.ts:85`; throw at `packages/core/src/money.ts:103` | guide "See the bill": "the POS's own signed amount, so a discount shows negative and a free line at 0"; core `bill.test.ts:138` carries a `-400` line | If a waiter puts a discount line on the table's POS bill while a guest opens Bill or Pay, then `payMoney(-400)` throws `MoneyError` in render (`viewMinor` refuses negatives, `money.test.ts:55`; the client schema allows them, `shell/src/guest-api.ts:79` `z.int()`), the face's `LoadBoundary` (`apps/web/src/faces/chosen-face.tsx:62`) replaces the whole menu with the "failed to load" notice, and Retry reopens the same `#tab`/`#pay` sheet and throws again. A payment whose lines include a discount (`core/src/service/pay.ts:491` sums signed amounts) would also break the Paid screen and the Payment confirmation after the card is charged. Same code was on qr-phone, so not a loss, but nothing ever tested it | code path quoted; no test passes a negative amount through `payMoney` on the pin | 0.75 |
| DA-B1-2 | high | `E/services/bag-sheet.tsx:84-104` (`LocationNotes`), `bill-sheet.tsx:142`, `header-tools.tsx:102`; shell `features.ts:78` | decision D119 / RR-49: "Stop location check" on the bill and in the failed check; the consent text promises "You can stop anytime" | If the venue has ordering on and the Bill switch off and the phone holds a pass, then once a bill reading exists (core sends it whatever the venue's bill switch says, `core/src/service/guest.ts:533`) the bag drops its Stop (`billShown` is true, `bag-sheet.tsx:32,89`), the bill pill and sheet do not exist (`sheetAllowed`, `provider.tsx:85-96`), and Stop appears only in a failed check: the guest cannot withdraw consent from the page | `bag.test.tsx:999` covers "no bill drawn" only; `connection.test.tsx:173` only the bill sheet | 0.6 |
| DA-B1-3 | high | `E/services/call-sheet.tsx:77-84,174-192`; `packages/core/src/service/guest.ts:1058` | decision D127 (`docs/decisions/D127.md`, Call a waiter): "One open call per table: a later option is added to it ... the guest sees 'Waiter called: Ice, Water'"; guide: "No note and no withdraw", "Withdrawing a call (`service.cancel`) is not built" | A guest with an open call sees one kind (the last open request), cannot add a second (the only button on an open call is "Cancel request"; "Send another request" appears only after done or rejected), and "Cancel request" sends `service.cancel`, which the host rejects `not_built`, so it always fails ("did not go through" or "This is not available yet") | `call.test.tsx:149,172` pin the cancel path against a fake host; `services-client.test.ts:304` shows the host gives one request per kind | 0.7 |
| DA-B1-4 | high | `E/services/pay-sheet.tsx:746`, `services-css.ts:903-907` (`.ro-state p`; no `.ro-pay-number` rule anywhere in the package) | decision D127: "Paid: 'Paid', the payment number in large type"; guide Paid: "the number in large type (at least 40 px, 7:1 contrast)" | The Paid screen draws the payment number as an ordinary paragraph at 75 % opacity; a waiter across a table in a dark club cannot read it. Absent on qr-phone too, so not a loss, but a decision is contradicted on the pin | `pay.test.tsx:381` asserts the text only | 0.85 |
| DA-B1-5 | medium | `E/services/provider.tsx:530-536`, `bag-sheet.tsx:84-104`, `bag-bar.tsx:20,52`; `H/services-client.ts:1046-1052` | RR-49 / D119: after "Not now" or Stop "no more asking until the guest's own Allow location"; guide: the page says why the order is hidden | If a guest taps Not now (or Stop location check) and later taps "+", then the host answers `location_needed` and, with consent `declined`, draws no prompt; the face swallows the code on purpose, so the tap does nothing and says nothing. The reason and the Allow location button live only inside the bag sheet behind a "View bag" button with no count. qr-phone drew them on the page | `bag.test.tsx:298` pins the silence (with no `location.state: needed` in the host) | 0.55 |
| DA-B1-6 | medium | `E/services/bag-sheet.tsx:200-204`, `pay-sheet.tsx:392`, `bag-bar.tsx` (no `offline`), `provider.tsx:514-519`; `H/services-client.ts` (lost edit returns `pending`) | RR-51 / D121: "after ~10 s without an answer the phone shows the paused screen"; guide: "the template says 'Weak connection...'" | If the phone loses its signal while a guest browses and taps "+" on the menu, the optimistic counter appears, about 10 s later the host takes the edit back (`services-client.test.ts:320,1532`) and the face says nothing: the weak-connection line exists only inside the open bag or pay sheet. A lost edit (host answers `pending`, not rejected) gets no notice either | no Editorial test of the menu with `offline: true` | 0.55 |
| DA-B1-7 | medium | `E/services/provider.tsx:348-349`, `header-tools.tsx:120-131`; `apps/web/src/connectors/return-address.ts:cardReturnUrl` | guide Paid: "A closed or reloaded page comes back here"; D127: "a closed or reloaded page comes back to where the payment stands" | If a guest closes the browser (or a redirect brings them back, the return URL carries no fragment) while a payment is held, processing, unconfirmed or just Paid, then the host keeps the handle but the page opens on the menu: nothing on the page, no badge on the Pay icon, shows the payment until the guest finds Pay again. A reload with `#pay` still open is fine. qr-phone drew the payment inline (`pay-panel.test.tsx` draws `[data-pay-screen]` with no tap). Money is safe (lines stay greyed, "same amount" check, server refusals); the guest is left not knowing | no Editorial test opens the page with a stored payment and the sheet closed | 0.5 |
| DA-B1-8 | low | `E/services/pay-sheet.tsx:598-618` (`CallWaiter`), `location-sheet.tsx:109-124` | D72: show pending, then accepted or rejected; D127: Call a waiter "is also the way on from every failure screen of paying" | A guest on a failure or checking screen taps Call a waiter: the outcome is dropped (`void o.run(...)`), the sheet shows nothing, and on the failed-location card the sheet closes at once; if the call was refused or lost, they believe a waiter is coming. Same as qr-phone | `pay.test.tsx:508,621` assert only that the command was sent | 0.5 |
| DA-B1-9 | low | shell `strings.ts:474,488-491,619` (en), `E/services/call-sheet.tsx:259-274` | guide "Guest words" table (Martin read them, 10-28): `call_btn` "Call a waiter", `call_sheet` "What do you need?", `k_waiter` "Call the waiter", `bill_title` "Your table's bill", `call_sent` "Waiter called", `call_done`, `call_rejected` | English reads "Call a server" (button and sheet), kind "Call waiter", no "What do you need?", the bill sheet is titled "Table order" with "Everything ordered at this table", and the call states read "Request sent / Done / The team could not take this request". Bulgarian is closer. | `call.test.tsx:44` uses the "Call a server" name | 0.7 |
| DA-B1-10 | low | `E/services/call-sheet.tsx:81-84` | guide: "`rejected` when nobody answered in the venue's time ... the template words as 'Ask your waiter'" | If a call lapses and the guest reopens the sheet (a new mount, `asked` is null), then only open statuses count as current, the lapsed request is not shown, and the sheet offers a fresh picker as if nothing happened. Only a guest who kept the sheet open sees "Ask your waiter" | `call.test.tsx:202` pins that a finished request is not current, for `done` only | 0.5 |

## Observations

| id | what | proposal |
|---|---|---|
| OB-B1-1 | A sent order's state (Not sent, Not confirmed, Added) is shown only inside the bag sheet; the bag button shows a count and no sign of a problem order. qr-phone showed sent orders on the page. | a badge or line on the bag button for a Not sent or Not confirmed round |
| OB-B1-2 | The seven jsdom guards for the location Stop and the sent-order states use a fake host that always supplies `location.stop`; the host without it (code `location-sheet.tsx:25`) is untested. | one test with `stop` absent |
| OB-B1-3 | The category rail's scroll-driven highlight (`category-rail.tsx:20-51`) and the veil-tap close (`overlay.tsx:84-86`) have no test; the e2e covers the tap-to-jump only. | an e2e step or a jsdom IntersectionObserver stub |
| OB-B1-4 | `minutesSinceSent` (shell `table-order.ts:44`) has no unit test; the "floor, not round" rule of D117's "4 minutes ago" is unasserted. | a unit test with 4 m 59 s |
| OB-B1-5 | The "Show this to your waiter" reference (>= 40 px, 7:1, D120) is guarded only by "Basic's lines are untouched" (`screen-options.test.tsx:292`); no test measures size or contrast. | one CSS assertion |
| OB-B1-6 | The logo is left out of a snapshot until its variant files exist (`publish.ts:419-421`); only item photos are tested for this (`publish.test.ts:483`). The logo field (`design/logo-field.tsx`) and the colour card's rendering have no component test. | tests; owner side, for step 7 |
| OB-B1-7 | Decimal quantities (`"0.5"`) and free lines in the bill are never rendered in an Editorial test. | add to `bill.test.tsx` with DA-B1-1's negative line |
| OB-B1-8 | The ticket #239 asked for a parity list of every state of qr-phone's `table-order.tsx`, `notices.tsx` and `pay-panel.tsx`; neither the ticket's comments nor PR #252 holds one. Section 2 above is that list as far as tests go. | none |
| OB-B1-9 | A greyed (being paid) bill line is plain text; the guide's "Someone is already paying for this line" on tap is never shown. Server refusal `being_paid` is worded in shell `strings.ts:610` but no face path reaches it. Unchanged from qr-phone. | accept, or drop the line from the guide |
| OB-B1-10 | The `accepted` and `on_the_way` request states, "Waiter is on the way" words and `service.cancel` are in the face (`call-sheet.tsx:35-44`) but the host never produces the first two (it emits `sent`, `done`, `rejected`, guide line 75). | remove with DA-B1-3's fix |
| OB-B1-11 | Out of scope, one line each: `pay-first` states, the tip row and Stripe's form (step 2); the preview frame, saved Styles and the design record (steps 3 to 5); RR-O15 (a venue with location on and no privacy notice) is still open as the ledger says. | none |

## What I could not cover

- Nothing was run (read-only brief): every "guarded" is by reading the test, not by watching it pass or by mutating the code; DA-B1-1 to 7 are code-path arguments, not red tests.
- CI skips (env-gated) some e2e specs; I cited e2e only as extra evidence and relied on jsdom tests wherever they exist. `guest-pay-card.spec.ts` (real card form) is skipped without the sandbox and was not read in full.
- Whether the host really sends a bill reading with the Bill switch off (DA-B1-2) rests on `guest.ts:533`; I did not trace the worker's readings for an ordering-only venue.
- The server half of RR-24 to RR-32 was not re-read; the wave did not touch it, and I cite the existing tests by name only.
- Owner-side deleted tests (section 2.5 to 2.7) are mapped by test names and a few reads; the Design page's own behaviour is steps 3 to 5 and 7.
- Bulgarian wording of the call and bill screens (DA-B1-9) was compared with the guide table only for English.
