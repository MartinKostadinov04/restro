# Critique 2: the revised navigation plan

Independent cold read, 2026-11-19, of the revised plan, its mockups (as source), `critique.md` and the admin code. The app was off.

**Verdict.** K1–K4 are answered: no new page, so one page keeps its guards; the device's name opens its menu; one small PR with no worker or provider link touched; tonight and "По-късно" are separate mockups (one leftover, L8). Persona fit holds: the owner gets order, staff see what they see today (their cut is decision 157), the device frame is cleaner, and at 390 px the sheet fits. One point blocks the build as written.

## Blocking

**L1. `canonicalVenueQuery` erases the Studio's open section.** The Studio keeps its open menu section in `?section=<nd_ id|unsorted>` (`src/composer/item-param.ts:8`, read at `composer.tsx:173`, written by `history.replaceState` at `:241`); `structure-ui.test.tsx:125` uses `tab=studio&section=nd_s&item=nd_i`. Plan row 1 keeps only `menu` and `item` for the Studio, and row 6 redirects "when `tab` or `section` is present and differs". So every Studio reload or shared item link loses its section, and `?section=nd_x` without `tab` is ambiguous for the redirect and `isActive`. *Change:* `section` is a Settings section only with `tab=settings`; redirect only an old or unoffered `tab`, or an unoffered Settings section (to its module's first, not `general`). Unit rows: `?tab=studio&section=nd_x&item=nd_y` and `?section=nd_x` unchanged. The switcher carries `section` only with `tab=settings`.

## Before the pilot

**L2. A sidebar tap may show nothing until the server answers.** Today `useUrlTab` shows the new tab at once (`workspace-tabs.tsx:51`, `useOptimistic`, with skeletons already mounted). A sidebar `Link` is a query-only navigation on the same path; as far as I know `loading.tsx` does not show again for it (unverified for Next 16), and the keyed `Suspense` sits after the page's awaits (`page.tsx:55-130`). On a club's 4G that breaks feedback rule 1. *Change:* mark the entry active and pending at once (`useLinkStatus` or `useOptimistic`); put title, row and screen inside the keyed boundary, with the one-screen awaits below it.

**L3. Accessible names.** On the switcher, `aria-label="Смени заведението"` replaces the visible "Club Biad" (`mock.js:85`). On the device button, `aria-label="Език, тема и изход"` replaces "Таблет „Вход“" (`:161`). Both fail **2.5.3** Label in Name (strings `nav.switchVenue`, `nav.deviceMenu`). A staff-only person's switcher is a `<button>` that does nothing (**4.1.2**). Every screen keeps the document title "Club Biad" (`page.tsx:45-49`; **2.4.2**). *Change:* each name starts with the visible text ("Club Biad, смени заведението / Club Biad, switch venue"). The staff-only name is plain text. `generateMetadata` reads `searchParams`: "Тази вечер · Club Biad".

**L4. "Module" is not in the glossary, and the code would use two words.** Tonight's code adds `SETTINGS_MODULE_OF`; D155 says "feature bases in code" and ticket 2's key is `feature_bases`; CLAUDE.md already means a code unit by "module", and ticket 7's rule mixes the two. *Change:* "**Module / Модул**" in the glossary in this PR (_Avoid_: feature base, add-on, "feature", which clashes with Guest feature); one code word (`venues.settings.modules`); D155 to match; ticket 2's (c) says **Capability**; the glossary's Studio is a "screen", not a "tab".

**L5. "Поръчки" three times in one module:** the group, Tonight's view (`tonight.tab_sent`, EN "Sent orders") and the settings section (`st_ordering`; EN "Ordering settings › Ordering"). *Change:* Tonight's view "Изпратени поръчки" (the glossary's Sent order, as EN); the section named for what it holds, by the copy pass.

**L6. The tickets break the plan's own "four at most" rule.** Ticket 2's Модули makes the Venue row five (`mock.js:188`). Ticket 3's "За гостите" makes Ordering's settings five. *Change:* Модули becomes the last card of Общи, and "За гостите" goes inside the Поръчки section. Write both into tickets 2 and 3.

**L7. The decisions as asks.**
- The PR builds decisions 154 and 156 A before Martin answers. Say so: merging is his yes, and a no closes the PR. Ask those two first; 155, 157 and 158 wait with their tickets.
- Open each ask with a scene, for example: "Monday you switch reservations off; three bookings exist for Saturday: refused."
- Decision 156 B is misdescribed: five entries, not six (`mock.js:64`), and "a shared device cannot open" its settings holds under A too. B's real cost is one more tap and Tonight's live load first.
- `D154.md`–`D158.md` exist untracked with no index rows, so `scripts/decisions.test.ts` (rule 2) fails CI unless the rows land in the same commit; the plan's "without the D" line is stale.

## Polish

**L8.** The mockup's switcher shows "На живо · Live" (`mock.js:86`), which is in no file row or string: K4's leftover. Drop it or plan it.
**L9.** Collapsed to icons, four identical gears differ only by tooltip; D109 says nothing appears only on hover. Give each module's Settings its group's icon, or keep separators between groups.
**L10.** The device's top bar names the page's venue, not `sharedDeviceOf().venueId` (a device may open any venue, `shared-device.ts:4`). On `/venues` and `/settings`, `AdminHeader` cannot tell it is a device: pass that through a context from the layout, or those pages show a ☰ that opens nothing. Say what Изход does on a paired tablet (D153: re-pairing needs the owner's code).

## Vendored skills

- **design-critique:** L1 (a screen behaving differently after the change), L6, L9 (section 4), L2 (section 2, the response to a tap).
- **accessibility-review:** L3 (2.5.3, 4.1.2, 2.4.2); the mockups have no dark theme, which stays a review check.
- **ux-copy:** L4, L5 (principle 3, the same term for the same thing). The refusal strings in ticket 2 name the fix and pass.
