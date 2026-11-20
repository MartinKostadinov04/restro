# Critique: the navigation and feature bases plan

Independent read, 2026-11-19, of `../2026-11-18-navigation-and-feature-bases.md` and its mockups, against the rules it cites.

**What I could not do.** The lane's app answered HTTP 500 on every admin page (the session query on `auth_session` fails; Postgres is listening on 54329), so today's admin was read from `before/`, `admin-map.md` and the code, not walked. The pane shows the mockups without their CSS and JS, so they were read as source (`mock.js`, `mock.css`).

**Verdict.** The direction is right: bases apart, off means absent, the phone's dropdowns gone. On a phone it is a real cut (14 of 23 stories lose a tap). On a wide screen it is a reshuffle: two stories get shorter, one longer, and four pages still carry a row of tabs. Four points block the build as written.

## Blocking

**K1. One page's guards become seven, and the plan names no shared guard or test.** Today one file does the 404 for another tenant, the shared-device redirect and the rights (`app/(admin)/venues/[venueId]/page.tsx:59`, `:86-101`, `:111-130`). Seven new pages each repeat them; one missed check puts a bar tablet on Settings, and step 0's S2 already found this class of gap ("a layout is not a guard"). *Change:* one `venuePageGuard()` every new page calls, and one test table of every venue address × (other tenant, shared device, staff-only, no `reservations.tonight`), written before the pages.

**K2. The shared device loses language, theme and sign-out.** They live only in the sidebar's foot (`app-sidebar.tsx:108`); the plan and `shared-device.html` remove the sidebar and put nothing in its place (`mock.js`, `phoneHtml` shared branch: the venue's name and the device's name, no control). A dead end on a tablet nobody owns. *Change:* the device's name in the top row opens the same user menu.

**K3. One pull request is too much for a branch five other lanes are merging into.** 27 source files, 50 test files (35 of them Playwright specs that run only in CI), the sidebar, seven pages, the phone bar, the tab row's behaviour, the landing and the shared device's frame, on an unprotected stage branch. The plan also misses links made outside the 27: the worker's alert link (`apps/worker/src/alerts/deliver.ts:89`) and the provider's return address (`apps/web/src/server/settings/paying-addresses.ts:8`). And it leaves the hardest technical choice open ("a parallel route slot… or the admin layout: the lead picks"); `(admin)/layout.tsx` cannot see the venue. *Change:* two pull requests. A: the new addresses, `legacyTarget()` with a unit table of every old link (including `sub=design` and `connection=return`), K1's guard, and one `venuePath()` helper all links call; the tabs still drawn, nothing visible changes, no decision needed. B: sidebar, switcher, bar, device frame, after Martin's answers. For the sidebar's data use a `venues/[venueId]/layout.tsx`, not a parallel slot.

**K4. The mockups show more than tonight builds, and the decisions are asked on the pictures.** The Publish bar only on Menu screens (`mock.js`, `menuScreen`; the plan's open question 2 defers it), a count badge on Tonight in the sidebar (in no ticket; needs live data in the frame), "Функции" under Venue Settings (ticket 1). *Change:* make the mockups match build B, or mark each extra "later" on the picture.

## Before the pilot

**K5. "Тази вечер · Вечерта" side by side on the bar.** The sidebar's group label tells them apart; the bar has none. The plan says it kept today's labels, but today's tab is "Резервации" (`messages/bg.json:896`). *Change:* the entry is "Резервации / Reservations" everywhere.

**K6. Up to four entries named "Настройки", plus the organisation's.** The plan lists "two things called Settings" as a fault and ends with more: four gear icons when collapsed, four identical link names. With K5 each base is a group label over exactly two rows. *Change:* offer Martin a flat option beside the grouped one: one entry per base (Тази вечер, Резервации, Опашка) with its settings behind a visible "Настройки" button on that page, and one "Настройки" for the venue. Seven entries instead of ten, no repeated word, and a base's settings are 2 taps on a phone instead of 3. At the least, each link's accessible name carries its group.

**K7. Design is on the phone bar, and it leaves the bar.** Design is in the `(studio)` group with no sidebar (`app/(studio)/venues/[venueId]/design/page.tsx`); it is a draft with Done and Cancel and a leave warning (`design-page.tsx:461-468`). A bar item that removes the bar. The plan's own D157 text says "service screens first, then Studio, then More". *Change:* the bar is the service screens, Studio, More; Design under More.

**K8. The row of views hides its last choices with no cue.** `mock.css` `.views` scrolls with `scrollbar-width: none`. Tonight's four views need about 490 px in a 358 px row, so "Край на вечерта" is off screen; Venue Settings has six. Today's wide Settings row already clips at 1280 (`before/owner-desktop-settings.jpg`). *Change:* a cut-off last label plus a fade, the open view scrolled into sight, arrow keys; and no page with more than four views (split Venue Settings: Versions under Publish).

**K9. The bottom bar collides with what floats.** The Studio's selection bar is `fixed bottom-4` (`composer/selection-bar.tsx:56`), the Undo toast sits at the bottom, and the Undo toast is the feedback for every write (D107). "No screen's inside changes" is not true at 390 px. *Change:* build B lifts both above the bar and adds the bar to `e2e/touch-targets.spec.ts`; check 2.4.11.

**K10. A waiter's bar is one entry plus "Още" holding only his name.** 58 px of a service screen for nothing. *Change:* with fewer than two destinations, no bar: the top row with his name's menu, as on the shared device. With two, order them as D141 lands (Резервации first).

**K11. D157 hides screens from staff; the plan does not say whether the pages refuse them.** Today a waiter opens the Studio read-only. Hidden only is cosmetic; refused is a rights change needing tests and Martin's yes before build B. *Change:* say which; I recommend refused, through K1's guard.

**K12. The switch is under-specified where it meets the rules.** (a) Off is "not drawn"; ticket 1 must also make the pages, their actions and `applyService` commands refuse, or a saved link works a base that is off. (b) Reservations have no refusal: switching off with bookings to come hides them. (c) A hand-made venue has no bill to order onto, yet could switch Ordering on; whether a base can be on is an integration-layer fact, so read it there, never from a POS name. (d) Tonight also carries waiter calls and sold out, so "Поръчки" is narrower than its group. *Change:* add (a)–(c) to ticket 1's criteria; the write through `core/apply` and keeping the key out of the snapshot are right.

**K13. Ticket 4's rule fails on day one.** `src/reservations` imports `@/tonight` 23 times (the PIN's `useWho`, the day picker, the live feed), `tonight/tables-grid.tsx:32` imports reservations, `settings/reservations-panel.tsx:16` the plan editor. *Change:* first move the shared service parts to their own folder, then add the rule.

**K14. The words.** "Feature base" is not in `GLOSSARY.md`; its interface word "Функции" sits beside "Функции за гостите" (`bg.json:795`). *Change:* "Модули / Modules" for the section, a glossary entry in the same change.

**K15. The decisions.** D154, D155, D156 and D158 are the right asks. D157 bundles four things: the staff's entries (K11), the device's frame (S1 and S3 are defects, no decision), Settings' read (S4, its own ask) and the phone bar (belongs to D154). D155 should also ask whether the owner or Restro's team switches a base on (D122 §7 has that role; Square's are paid). Open question 1 is K5 and is Martin's. The numbers D154–D158 have no files and five lanes are numbering at once; `scripts/decisions.test.ts` reads citations. *Change:* call them N1–N5 until the lead assigns numbers.

## Polish

**K16.** The page shows its name three times (crumb, title, "Меню › Студио" line). Remove the line (Clean, rule 2).
**K17.** "Още" repeats the bar's entries and the switcher: about 14 rows. List only what the bar lacks.
**K18.** Seven new pages need a `loading.tsx` each, or the instant skeleton a tab switch has today is lost.
**K19.** Studio moves from slot 1 to slot 4 of the bar as bases switch on; accept, and say so.

## What each vendored skill found

- **design-critique:** K6, K7 and K19 (section 4, the same control behaving differently), K8 and K10 (section 2, an unnecessary or hidden step), K16.- **accessibility-review:** K9 (2.4.11), K8 (2.1.1 for the scrolling row), K6 (2.4.6, 4.1.2). For build B: `aria-current` on the open entry, a text count for the bar's dot (1.1.1), focus held in the "Още" sheet with Esc (2.1.2), the phone's Publish button at 44 px (Restro's floor), both themes: the mockups are light only and the app in `before/` is dark.
- **ux-copy:** K5, K6 and K14 (principle 3, one term per thing); "Първо изключете функциите за гости и публикувайте." names the fix and passes.
