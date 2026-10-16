# Open questions and tasks
For the lead: every open question and open task, one line each, grouped by owner. `docs/tracker.md` holds the full text (`Q<n>`, `T<n>.`) and wins on any difference; decisions are in `docs/decisions.md`.

## Open questions
Owner is the group heading. None blocks the current stages unless a brief says so.

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

**Pilot venues (T3)**
- Q43: time-based price lists (happy hour)? Q45: EN names in barsy? Q54: which stats do owners want (after T21)?
- Q68: how do staff mark items sold out today, and where?
- Q69: who on the venue side answers an alert at night?
- Q12: Wi-Fi and mobile signal on the floor.
- Q73: which pilot venue goes first, and who is its barsy admin?

**Product design (Martin)**
- Q22: barsy post retry window before voiding (only if Stripe holds).
- Q11: disputes ("drink never arrived", unauthorised use).
- Q15: effect of a fixed per-transaction fee on small tickets.

**Field (Martin)**
- Q1–Q4: why barsy clubs skip barsy's QR add-on; lost orders; owner and waiter appetite; table vs bar revenue share.

## Open tasks
Owner, then state. "Claude" is the lead agent and its subagents.
- T79 Claude: Adjustments 01 (`docs/adjustments/adjustments_01.md`, plan `adjustments_01-plan.md` approved 10-12); wave 0 done; ad/01 (schema, roles), ad/02 (menus, languages, barsy roots) ad/03a (areas, tables, menu routes) and ad/03b (guest addresses, venue states, Unpublish) built 10-12, ad/04 (purge, versions) and ad/05 (per-venue sync, colour roles) built 10-13, CI pending; next: merge ad/03–ad/05 into ad/foundation, then the screens in pairs, then screens in pairs A–D, then the purge rehearsal.
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
- T29 Claude: orders and payments spec; skeleton before Stage 4, details after T9 and T33.
- T31 Martin + lawyer: privacy notice, terms, data processing agreement; before the first guest.
- T17 Martin: remaining decisions P41–P43, P46, P48–P50, P52, P53, P10; veto window on D50.
- T20 Claude: read the 2021 food-information ordinance, or ask the lawyer (Q42).
- T21 Claude + Martin: research what data barsy gives for venue stats.
- T23 Claude: research writing translations into barsy (D26, Q46); with T21.
- T24: `Accounts_place` note fields found; what prints on bar tickets is open (P37, Q52).
- T3 Martin: pilot-club interviews.
- T34 Martin: visual design for the guest flow and admin (guest design: D63, D69).
- T27: monthly restore drill; once live.
- T4: test barsy's QR menu and one other BG QR app live.
- T6: accountant check; folded into T33.
- T10: group checkout and split flow, inside T29 after P42.
- T12 Martin: delete the 3 superseded v1 FigJam boards.
- T2 (marked `[~]`, partly done): Lukanet contact; next T39, then T9.
