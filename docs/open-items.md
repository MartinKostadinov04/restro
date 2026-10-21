# Open questions and tasks
For the lead: every open question and open task, one line each, grouped by owner. `docs/tracker.md` holds the full text (`Q<n>`, `T<n>.`) and wins on any difference; decisions are in `docs/decisions.md`.

## Open questions
Owner is the group heading. None blocks the current stages unless a brief says so.

**Payment provider and the lawyer, for song requests and deposits (T80)**
- Q74 lawyer: does an in-venue card payment through the app need the venue's fiscal device, or the Н-18 alternative regime; its conditions. Prepared in `docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md` (questions L1–L4, L7, L9, L11, L12).
- Q75 lawyer: deposits and paid song requests: document, VAT timing, who issues. Prepared in `docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md` (questions L4–L8, L10).
- Q76 Martin → myPOS (the pilot venue writes through myPOS's contact form; myPOS is the first provider, #49, 10-21): holds in the embedded form or only on myPOS's page, hold length, partial completion, how a platform connects and limits its key, notification retries, sandbox, payer receipts, the Zamboo link, venue onboarding.
- Q77 Martin: the charging model for song requests and deposits (fixed fee, percentage invoiced, both).
- Q82 Lukanet: seven open points from the signed-in API reading (part payment on an open bill, refusing a row, our id on a bill, approval in the status, offline docs); send with Q79.
- Q79 Lukanet: is barsy NRA-listed sales software; can it take Restro's orders as an Annex 42 import before acceptance (fiscal research 10-17, L11); with Q8 and Q24.
- Q80 Martin, after the lawyer: a paper fiscal receipt per song-request capture with no guest email (D99); weigh the options.
- Q81 Martin, after the lawyer: the bill screen as a "document" under Н-18 чл. 7а; until then no template screen resembles a receipt or says "фискален".

**Lukanet / pilot owners (T9, T13)**
- Q47: `Accounts_place` with payment and close: exactly one fiscal receipt, and bar printing of the rows?
- Q55: can an unpaid bill be kept from printing and "For confirmation" until paid, and auto-cancelled?
- Q58: payment link: provider, Apple/Google Pay, several payers, capture, refunds, webhook, tips, fees, one receipt.
- Q49 / Q38: popup or sound for "For confirmation" accounts; can confirmation be off or auto-accepted?
- Q48: does `Messages_create` reach the hall team's tablet?
- Q52: what prints on the bar ticket (`account_alias`, `description`)?
- Q56: look up an account by our `uuid`?
- Q57: barsy's price for a cart without creating an account?
- Q59: what `Poses_register` affects; can it disturb the venue's own POS?
- Q60: are `last_update` times venue-local without offset (DST ends 25 Oct 2026)?
- Q71: checksum parameter on `Categories_getalltree`?
- Q21: one barsy account per paid order, or rounds on one table account (P41)?
- Q40: order-level dedup for later rounds.
- Q26: test installation with a test fiscal printer (D33, T39).
- Q41 / Q28: is the "software resource" the registered POS; does read-only API access need it?
- Q25 (pilot owner, T13): monthly price of the "software resource".
- Q24: partial refund via API with a fiscal storno receipt?
- Q29: resource price vs barsy's own QR ordering add-on.
- Q46: write translations into barsy (`ml_data`); rights and cost (D26)?
- Q53: which sales/report data the API returns ("Справки"); cost (D31)?
- Q6-remainder / Q3-fallback: contract limits on integrators; plan if the price kills the pilot or Lukanet declines.

**Lawyer / accountant (T33)**
- Q8: fiscal receipt for online-paid orders via barsy; electronic delivery.
- Q62: who issues the fiscal receipt on each payment route, and when (Н-18)?
- Q63: does Restro count as sales software under Н-18?
- Q64: paper receipt required, or is an electronic one enough?
- Q65: does dual BGN/EUR display still apply (we read: ended 8 Aug 2026)?
- Q66: duty to check age for alcohol ordered in the app (D11)?
- Q67: GDPR roles (venue vs Restro), data processing agreement, retention, privacy notice and terms.
- Q42: allergen rules for food and drinks in catering and online menus; do pilots hold allergens in barsy?
- Q10: accounting treatment of online tips.
- Q70: may a Bulgarian fiscal receipt carry English item names (`lang_id`)? Default: always `bg_BG`.
- Q83: the location check before on-the-bill orders and Turnstile under ePrivacy (D118). Six questions, prepared in `docs/deliverables/2026-10-19-location-check-eprivacy.md` ("Narrowest questions for the lawyer"): the "strictly necessary" exemption (Directive Art. 5(3), Art. 4а ЗЕТ); whether Restro's line plus the phone's prompt is valid consent; whether a refusal may block on-the-bill orders (GDPR Art. 7(4)); Turnstile without pre-clearance; controller (venue, Restro or both) and whether a DPIA is needed; who enforces Art. 4а ЗЕТ (КЗП or КЗЛД). Until answered, the build follows D118's consent design. Martin 10-20: move on without a lawyer for now; an Opus deep-research agent gave the working answers on 10-20 (`docs/deliverables/2026-10-20-location-check-law-deep-research.md`): build on consent, КЗП enforces Art. 4а ЗЕТ. Five narrow questions stay for the lawyer, listed in that file under "For the lawyer later". Martin decided its proposed changes on 10-20 (D119).

**Pilot venues (T3)**
- Q43: time-based price lists (happy hour)? Q45: EN names in barsy? Q54: which stats do owners want (after T21)?
- Q68: how do staff mark items sold out today, and where?
- Q69: who on the venue side answers an alert at night?
- Q12: Wi-Fi and mobile signal on the floor.
- Q73: which pilot venue goes first, and who is its barsy admin?

**Product design (Martin)**
- #60 Martin: the admin's pattern divergences (D123's Patterns table): pick which become `change.md` tickets, in order; the rest wait for their screen's next redesign.
- Q78: the DJ request queue in templates: slot, contract, and whether every template draws it; when T82 reaches the face contract.
- Q22: barsy post retry window before voiding (only if Stripe holds).
- Q11: disputes ("drink never arrived", unauthorised use).
- Q15: effect of a fixed per-transaction fee on small tickets.

**Field (Martin)**
- Q1–Q4: why barsy clubs skip barsy's QR add-on; lost orders; owner and waiter appetite; table vs bar revenue share.

## Open tasks
Owner, then state. "Claude" is the lead agent and its subagents. Since 10-17 a new task is a GitHub issue (`#n`); the T-numbers stay until they close.
- #29 Claude + Martin: wayfinder map "Ordering from the menu" (Opus, Martin 10-18; D110). Grillings #35–#40 done (D111–D121); the ordered check and board review settled D122 (10-21). Redrawn 10-21: the pilot runs the whole workflow, paying included, on Mistral; barsy, a simulated test POS and the provider's sandbox are the test beds. Reworked 10-21 after the independent ticket review (`docs/deliverables/2026-10-21-map-29-ticket-review.md`): build now, the Mistral connector gets its own spec when Mistral answers; tips and "call a waiter" are in the pilot; the template is designed last by its own agent (D122). Open tickets: #48 Mistral's answers (Martin sends; replaces T69), #49 payment provider (grilling), #51 build and test before Mistral (grilling), #52 law and accounting (Martin), #53 guest payment commands (grilling, after #49, #45), #54 refunds and disputes in Restro (task), #55 service data, roles and retention (grilling), #56 pilot readiness list (task, after #52), #57 template assignment file (task, after #45, #53), #47 read-back on barsy (needs test access). Design, reworked under D123 once that work landed: #50 Tonight redesign and #61 the owner's setup screens (prototypes with screen plans), #45 the guest bill screen's behaviour and words (prototype, after #49). Start from `docs/deliverables/2026-10-21-ordering-handover-2.md` (the waves and the model per ticket). Planning only; no build before T79 is on main and Martin opens ordering.
- #38 field test, Martin: done 10-20 at the pilot club: location coverage with decent accuracy inside (Martin; no per-reading numbers filed). The check is workable; the default radius stays 150 m and the "can't check" width 1 km (D118). If guests are refused in practice, the venue's "How far from the spot counts as inside" setting (100–500 m) is the first lever.
- #40 follow-ups, Claude: (1) the next field visit checks whether Safari on iPhone asks for location again within one night, which would show D121's consent screen and the phone's prompt more than once; (2) the privacy list (T31, with Q83's lawyer questions) gets how long order notes ("no ice") are kept on Restro's order record, which D121 left open.
- #58 Claude: admin controls reach the 44 px target floor on a phone (D123); Sonnet session running on `44px-controls` (10-21); lands before the ordering phase's screens.
- #59 Claude: the Integrations screen is wider than the phone in Bulgarian (trial finding 2.1); folded into the owner's setup-screens ticket of map #29; closes with it.
- T92 Claude: motion audit (review-animations) and worst-case pass (break-ui) vendored with overrides, then trialled on Editorial Market and the composer (D106); awaits Martin's OK.
- T91 Claude, then Martin: guest page `viewport-fit=cover`, a status-bar colour from the venue's `background` roles and `interactive-widget=resizes-content` (D109); the templates' safe-area padding is inert without it; iPhone check by Martin; after T90.
- #21 Claude: operational-screens note, audit and template flow additions, stack-doc library table, T91 and T88 refinements (D109); Sonnet.
- #20 Claude: contract fixtures and matrix cases for the worst cases D109 lists; Sonnet; after #18's ruling.
- #19 Claude: template-design interaction-polish reference, override rows, template-review checks (D109); Sonnet; after PR 16 merges.
- #18 Claude: Emil Kowalski skills, three reviews joined and ruled in D109; closes when #19, #20 and #21 are merged.
- T90 Claude: contract markers for the audits (add to bag, open dish, pay controls, language switch); small; before T87.
- T89 Claude: screenshot matrix for any template (contract markers, `FACES_VISUAL_FACE`); blocks T87; Sonnet.
- T88 Claude: four admin defects from the design-skills trial, plus the admin's global reduced-motion rule and the Toaster defaults (D109) (Sonnet); six ordering-sheet findings wait for ordering (D79).
- T87 Claude: first template through the pipeline, a dark club-night face (D105); after T86; Martin accepts on a local preview.
- T86 Claude: template pipeline (D105–D107): functionality file and guardrail, template-design and template-review skills, pinned audit rules, template flow; ticket next.
- T85 Claude: portability groundwork (D103): containers, storage module, schema split with a no-join check, restore drill; before T82.
- T84 Martin + Claude: analytics questions and the guest event model (D103), before the prototypes are ported.
- T83 Martin, then Claude: port the reservations prototype (D101), after ordering from the menu.
- T82 Martin, then Claude: port the song-requests prototype (D99, D100); starts with a grilling round against D99.
- T81 Martin + Claude: grill table-less access to song requests (D100), when T82 starts.
- #8 Claude (research, Opus): Bulgarian fiscal rules for card payments through the app, deposits and paid song requests; prepares the lawyer's Q74 and Q75; waits for Martin's go.
- #9 = T80 Claude (research, Sonnet): payment-provider feasibility (D98): myPOS, Borica, ePay, Stripe, SumUp; done 10-17, findings in `docs/deliverables/2026-10-17-payment-providers-feasibility.md` (recommends Stripe first, myPOS second); next: Martin picks the first provider, now map #29's ticket #49 (Q77 closed by D122: a fixed subscription), then Q76 and the lawyer's Q74/Q75.
- #10 Claude (upkeep, Sonnet): one home per rule in the agent docs; CLAUDE.md under 1,500 words; CLAUDE.md diff shown to Martin before merge.
- #26 Claude: dev seed with a real till venue, so audits cover the till-venue rules; Sonnet.
- #25 Martin: eight small awkward points from the acceptance walk, pick which become change tickets.
- T45 Claude: deploy pipeline re-runs the freeze-window check; at the Stage 3 deploy.
- T44 Martin: review Bulgarian wording in `apps/web/messages/bg.json` (S3 namespaces listed in the tracker).
- T47 Claude: "dismissed link" marker so sync does not re-link or re-place after unlink or unplace; before the unlink UI.
- T48 Claude: record a demo article with allergen text; confirm `order_by` `cat_weight_deep`.
- T49 Claude: map `portion` and `cat_picture`; Stage 3.
- T51 Claude: "acknowledge" op for the D24 translation review; with the review queue.
- T52 Claude: refuse stale saves (expected revision); before two managers edit at once.
- T53 Claude: worker job to clean abandoned uploads.
- T54 Martin: decide on dragging a section into another (needs `@dnd-kit`) after trying the composer.
- T55 Claude: `next dev` evaluates packages more than once; font loading fails in worktrees; watch.
- T60 Claude: photo variants: EXIF width/height, `variants:backfill --force`, CORS on the real CDN.
- T62 Claude: catalogue-root safety (warn on root or venue change, hold above 30% missing); sync side partly in CF-02; before the pilot.
- T67 Claude: read `Places_getlist` once a barsy venue is mapped; with T66 (CF-10).
- T68 Claude: built 10-11 (CF-09a, CF-16, CF-09b merged into `sh/foundation`); left: Martin's acceptance.
- T78 Claude: D75 built (CF-17 merged 10-11); (a) answered by D91 (names typed for POS items go to the dictionary/override); open: sections can't be renamed in the composer, no warning for a public name in a language the installation lacks.
- T77 Claude: rename and delete venues (D76) built by CF-18, merged 10-11; open: re-withdraw guest files when the queue was down at the delete.
- T76 Claude: the rollback pause (`publish.auto_paused`) moves from the integration to the venue, like `after_sync`.
- T70 Claude: connector foundation; merged CF-01, 02, 03, 08a, 12, 14; remaining CF-04 to 07, rest of 08, 09, 10, 11, 13; staging migration 0014 needs Martin's OK.
- T74 Claude: Editorial Market template (D69–D72), plan approved 10-11; SH-01 to SH-08 all merged into `sh/foundation` on 10-11; left: acceptance with Martin, then the PRs; open points per step in the tracker.
- T73 Claude: one role rule for composer writes (recommend owner/admin); with CF-09.
- T71 Claude: barsy shares items by catalogue; follow it (sync unit = catalogue); decides CF-05/CF-07 (Opus).
- T69 Martin: ask Mistral (office@mistral.bg) for API docs, a test installation and terms; second till.
- T63 Claude: tag colour and order to the face; colour required at `menu-snapshot/2`.
- T65 Claude (Haiku): `/t/<token>` keeps `lang` on redirect.
- T66 Claude (CF-10): Tables tab by `salon_id`; per-venue place types; hide place 0; no code for non-public places.
- T50 Claude: one section per barsy category per integration; job key and absence check per venue; when a second venue joins.
- T57 Claude: photos on non-barsy hosts are refused; recommended `BARSY_PHOTO_HOSTS` allowlist, anonymous fetch; after checking real data.
- T58 Claude: worker housekeeping (README env table, start-up sweep, `places.state_changed_at`, AWS SDK, date-fns vs `Intl`).
- T59 Claude: verify on the demo `files_get` auth and multi-calls; photos done 10-10.
- T40 Claude: architecture doc updates (Core rules, scope, polling, Supabase, Stage plan tab).
- T39 Martin: send Lukanet the test-environment request (draft by Claude; Q41, Q60, Q71); before T9.
- T25 Martin: platform accounts by stage (Railway, domain, Cloudflare, Sentry, Resend, Telegram, Supabase prod); guide from Claude.
- T9 Martin: send Lukanet the consolidated questions, after T39.
- T13 Martin: ask a pilot owner for the "software resource" price (Q25, Q29, Q41).
- T33 Martin: send the lawyer/accountant questions.
- T29 Claude: orders and payments spec; the ordering half now runs as map #29; payments after it, details after T9 and T33.
- T31 Martin + lawyer: privacy notice, terms, data processing agreement; before the first guest. For the location check and Turnstile (D119): an agent drafts the notice items, a short DPIA, the records of processing and the venue-terms clause (Art. 26 / Art. 28), without a lawyer for now.
- T17 Martin: remaining decisions P41–P43, P46, P48–P50, P52, P53, P10; veto window on D50.
- T20 Claude: read the 2021 food-information ordinance, or ask the lawyer (Q42).
- T21 Claude + Martin: research what data barsy gives for venue stats.
- T23 Claude: research writing translations into barsy (D26, Q46); with T21.
- T24: `Accounts_place` note fields found; what prints on bar tickets is open (P37, Q52).
- T3 Martin: pilot-club interviews.
- T34 Martin: visual design for the guest flow and admin (guest templates: D105, D69; admin: D107).
- T27: monthly restore drill; once live.
- T4: test barsy's QR menu and one other BG QR app live.
- T6: accountant check; folded into T33.
- T10: group checkout and split flow, inside T29 after P42.
- T12 Martin: delete the 3 superseded v1 FigJam boards.
- T2 (marked `[~]`, partly done): Lukanet contact; next T39, then T9.
