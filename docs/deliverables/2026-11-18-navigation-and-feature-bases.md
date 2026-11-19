# The admin's navigation and its feature bases: plan

Lane 6 of the 11-18 screen round. Planner's deliverable for Martin, revised on 11-19 against the independent critique (`2026-11-18-navigation-and-feature-bases/critique.md`) and the lane lead's constraint. Nothing here is built. Mockups are beside this file (last section).

## Summary

1. Today a venue is one page with five tabs, nine sections under one, views under two others: three levels, each a dropdown on a phone.
2. **Tonight's build:** the sidebar becomes the open venue's own menu, grouped by module: Меню (Studio, Tables & QR), Поръчки (Tonight, its settings), Резервации (Reservations, its settings), Заведение (the venue's settings). Venues move to a switcher at its top. The venue's tab bar goes away; the page's title names the screen. **Every address stays as today**: no link, worker message or provider changes, no screen's inside moves.
3. The bar tablet keeps today's screen (Тази вечер · Резервации) without the sidebar; its name in the top bar opens language, theme, sign-out.
4. At 390 px: no bottom bar tonight (it collides with the Studio's selection bar); the same menu opens from ☰.
5. **Later, as tickets:** modules switched per venue, the bottom bar, path addresses, staff seeing only their screens, opening inside the venue. Five decisions (154–158).

## Today: what is cluttered, and why

Walked from `docs/guides/admin-map.md` and the code that draws it.

| Level | What is there today |
|---|---|
| Sidebar | Every venue by name, All venues, New venue, the organisation's Settings, organisation switcher, user menu |
| Venue tabs | Studio · Tables & QR · Tonight · Reservations · Settings |
| Under Studio | Structure, Design (Design is a page of its own, without the sidebar) |
| Under Tonight | Actions and tables · Sent orders · Log · End of night |
| Under Reservations | List · Plan · Guests |
| Under Settings | General · Hours · Ordering · Reservations · Paying · Staff and roles · Alerts · Publish · Versioning |
| Organisation Settings | General · Integrations · Deleted venues |

- **Three levels on one page:** venue → tab → section or view. Hours is 3 taps on a wide screen, 5 on a phone.
- **On a phone every level is a dropdown** (below 1024 px): the choices are hidden until opened.
- **One Settings holds three modules.** Hours, Ordering, Paying and Alerts serve ordering; Reservations (with the plan editor) serves reservations; the rest is the venue's. Nine sections do not fit one row; at 1280 px it already clips (`before/owner-desktop-settings.jpg`).
- **Nothing says which module a screen belongs to.** Tonight and Reservations sit between Tables & QR and Settings as equal tabs.
- **Step 0 found defects in the frame:** a shared device still draws the organisation switcher and every venue (S1, S3, C2); a waiter's "All venues" sends him back where he was (C4); the phone sheet stays open after a tap (C5); parameters of one tab leak into another (C1); arrow keys on the tab bar load every tab passed (C6); old links keep a stale address (C9).

## What others do

Vendor help pages, read on 11-18. "(snippet)" means only the search result was readable. SevenRooms, TableCheck's navigation and any DJ-request tool with a venue dashboard could not be verified: unknown.

| Pattern | Who | Source |
|---|---|---|
| Left sidebar grouped by business area, with a location switcher in it | Lightspeed K-Series | https://k-series-support.lightspeedhq.com/hc/en-us/articles/36985562334363 , https://k-series-support.lightspeedhq.com/hc/en-us/articles/23973504428059 |
| Left navigation; rarely used setup nested under a Settings entry of its own area | Toast Web | https://support.toasttab.com/en/article/New-Team-Navigation-Coming-to-Toast-Web?lang=en_US |
| An add-on is a module in the same back office, with its own Settings ("Toast Web > Waitlist & Reservations > Settings") | Toast | https://support.toasttab.com/en/article/Getting-Started-Toast-Waitlist?lang=en_US |
| Add-ons are switched on from one page and "not visible in your Square Dashboard until activated" | Square | https://squareup.com/help/us/en/article/8486-add-advanced-capabilities |
| Staff use another surface than the owner; permissions belong to a job and are edited only in the back office | Toast, Square, me&u | https://support.toasttab.com/en/article/Assigning-User-Access-Permissions?lang=en_US , https://squareup.com/help/us/en/article/5822-employee-permissions , https://meandu.helpjuice.com/how-to-set-up-a-staff-pin- |
| A missing navigation entry means the role lacks the permission | OpenTable (snippet) | https://support.opentable.com/s/article/Custom-roles-and-user-permissions?language=en_US |
| Manager's phone: a bottom bar of up to four tools plus More; switch venue by tapping its name at the top | Square Dashboard app, Toast Now | https://squareup.com/help/us/en/article/5618-get-started-with-the-square-dashboard-app , https://support.toasttab.com/en/article/Get-Started-with-the-Toast-Now-App?lang=en_US |
| A phone's bottom bar holds three to five destinations | Android design guide | https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns |
| Hidden navigation is used about half as often as visible; show four or fewer links on a phone | NN/g | https://www.nngroup.com/articles/hamburger-menus/ |
| Never mix navigation tabs and in-page tabs in one control | NN/g | https://www.nngroup.com/articles/tabs-used-right/ |
| The sidebar's header is the place for a workspace switcher; groups can collapse; on a phone it is a sheet | shadcn/ui Sidebar | https://ui.shadcn.com/docs/components/sidebar |

## The navigation

**The rule: two levels.** The sidebar says where you are; at most one row at the top of a page switches views of that same thing, and no row has more than four choices.

**Words.** A *module* (in code too: `module`) is a part of Restro a venue can have or not: ordering, reservations, later song requests. The menu is not a module; every venue has it. The interface word is "Модули / Modules" (K14); the glossary's "Module" and "Screen" entries land with tonight's build (L4).

### The sidebar on a venue's page (tonight)

| Group (BG / EN) | Entry (BG / EN) | Opens (today's address) | Row of views on the page |
|---|---|---|---|
| top | Venue switcher: the venue's name; inside it the other venues, Всички заведения / All venues, Ново заведение / New venue | — | — |
| Меню / Menu | Студио / Studio | `?tab=studio` | Структура · Дизайн (as today; Дизайн opens its own page) |
| | Маси и QR / Tables & QR | `?tab=tables` | — |
| Поръчки / Ordering | Тази вечер / Tonight | `?tab=tonight` | Действия и маси · Поръчки · Дневник · Край на вечерта |
| | Настройки / Settings | `?tab=settings&section=hours` | Работно време · Поръчки · Плащане · Известия |
| Резервации / Reservations | Резервации / Reservations | `?tab=reservations` | Списък · План · Гости |
| | Настройки / Settings | `?tab=settings&section=reservations` | none (one section) |
| Заведение / Venue | Настройки / Settings | `?tab=settings&section=general` | Общи · Персонал и роли · Публикуване · Версии |
| Организация / Organisation | Настройки / Settings (as today) | `/settings` | General · Integrations · Deleted venues |
| foot | Organisation switcher, user menu (as today) | — | — |

Addresses are relative to `/venues/{v}`. Seven entries for the venue. Each "Настройки" sits under its group's label; its tooltip and accessible name carry the group ("Настройки на поръчките"), so collapsed to icons or read by a screen reader it is never just "Settings" (K6). Design is not a sidebar entry: it stays the Studio's second view, so it keeps the open menu and its leave warning, and nothing is shown twice (K7).

**Alerts move to Ordering's settings.** Everything they ring for (pauses, sent orders to check, money alerts, the end of the night) is ordering's. It also keeps every row at four or fewer (K8).

**Off a venue's page** (`/venues`, the organisation's Settings, the guides) the sidebar is what it is today: the list of venues, All venues, New venue, the organisation. You pick a venue there, and inside it the sidebar becomes that venue's menu.

### The page

- **Top bar:** ☰ (opens or collapses the sidebar) and the breadcrumb `Заведения › Club Biad`; the Publish bar where it shows today (every screen but Tonight, never on a device).
- **Title:** the screen's name ("Тази вечер", "Настройки на поръчките"), with the guest address under it as today. The venue is in the breadcrumb and the switcher: "Where am I?" is answered by both (`operational-screens.md`, wayfinding 1).
- **One row** of views or sections under the title, as today (a dropdown below 1024 px, unchanged tonight). No group line, no repeated name (K16).

### Per persona (tonight)

| Persona | Desktop | 390 px phone |
|---|---|---|
| **Owner, admin** | The whole sidebar; the switcher has the other venues, All venues, New venue. Opens on Studio, as today. | The same menu in the sheet behind ☰. |
| **Manager or any member on their own sign-in** | The same entries as today's tabs: Резервации only with `reservations.tonight`; settings read-only where their role lacks the right, as today. No New venue. | Same. |
| **Staff-only sign-in** (waiter, door host) | Lands as D141 says. Same entries as today; the switcher shows only the venue's name (no All venues, no Restro link, no "Заведения" crumb: C4). Hiding Studio and Settings from staff is D157, not tonight. | Same. |
| **Shared device** (D122 §7, D153) | **No sidebar, no venue list, no organisation switcher.** Today's row of two: Тази вечер · Резервации (the second only where the device's role holds it). The top bar shows the venue's name and, on the right, the device's name; tapping it opens Език / Language, Тема / Theme, Изход / Sign out (K2). | Same. |

### Taps, today and tonight

Counted from inside the venue (the Studio open), as the admin map counts: wide / phone.

| Reach… | Today | Tonight | |
|---|---|---|---|
| Tonight; Reservations | 1 / 2 | 1 / 2 | = |
| Tonight › Log | 2 / 4 | 2 / 4 | = |
| Hours (open a night for phones) | 2 / 4 | 1 / 2 | −1 / −2 |
| Reservation settings and the plan editor | 2 / 4 | 1 / 2 | −1 / −2 |
| Paying, Alerts, Staff and roles, Versioning | 2 / 4 | 2 / 4 | = |
| Venue › General (menus) | 1 / 2 | 1 / 2 | = |
| Move between Tonight and Reservations | 1 / 2 | 1 / 2 | = |
| Another venue | 1 / 2 | 2 / 3 | **+1** |
| Staff sign-in to its screen; the tablet to Reservations | 0; 1 | 0; 1 | = |

Tonight's gain is order, not taps: two levels, settings split by module, a title that names the screen, and two settings one tap closer. Switching venue gets one tap longer. The phone's real cut comes with the bottom bar ticket (Tonight and Reservations at 1 tap); D158 takes one more tap off for a one-venue owner.

## Modules, later

**The menu is what every venue has** (Studio, Tables & QR, Publish). **Ordering, reservations and song requests are modules:** each switched on per venue, each owning one sidebar group, its screens, its settings, its rights and its folder. Off means not drawn and refused: no entry, no settings, and the pages, actions and commands of an off module refuse (K12a). Switching off deletes nothing.

| Venue | Sidebar groups |
|---|---|
| Menu only | Меню · Заведение |
| + Ordering | + Поръчки |
| + Reservations | + Резервации |
| + Song requests | + Заявки за песни (Опашка, Настройки) |

**Today** `venues.settings.guest_features` (published) says what a guest is offered; it is no admin switch. Reservations have no venue switch at all.

**The switch (ticket 2):** `venues.settings.modules = { ordering, reservations, song_requests }` beside it; JSON, so no migration. One writer in `core/apply` (`setModules`, shaped like `setGuestFeatures`; rule 1), never published (rules 3, 4). No key reads as today; a new venue starts menu-only. Refused: ordering off while the live menu offers ordering, the bill, paying or a waiter call; reservations off while bookings are to come (K12b); ordering on where the integration layer says the source cannot take orders onto a bill, never read from a POS name (K12c). Switched in Venue › Settings › Модули.

**One list in code:** tonight's `venue-nav-defs.ts`. The switch adds one condition per group; a new module is one block plus its pages.

**Song requests (T82, D99, D100):** group Заявки за песни; screens in `src/requests/`; commands through `applyService` (rule 1); money from the worker only (D127); the guest's queue a published live file (rule 4); rights `requests.queue`, `settings.requests`. The DJ's role holds only `requests.queue`, and D141's landing sends him there.

## Tonight's build (one pull request into `sr/foundation`, no migration, no new page, no address changed)

**What it is:** chrome over today's addresses. The page keeps its guards (tenant 404, shared-device redirect, rights); the sidebar is never a guard. Model: Opus. Paths are under `apps/web/`.

**Files to change**

| # | File | Change |
|---|---|---|
| 1 | `src/components/admin/workspace-tab-defs.ts` | `SETTINGS_MODULE_OF`: `hours`, `ordering`, `paying`, `alerts` → `ordering`; `reservations` → `reservations`; `general`, `staff`, `publish`, `versioning` → `venue`. Section defs reordered general, staff, publish, versioning, hours, ordering, paying, alerts, reservations. `settingsSectionsOf(hasTill, rights, module?)`; `FIRST_SECTION_OF = { ordering: 'hours', reservations: 'reservations', venue: 'general' }`. `canonicalVenueQuery(query, rights, hasTill)`: `integration` → `settings&section=general`, `publishing` → `settings&section=publish` (general without a till), an unoffered tab or section → its default; keeps only what the target reads (studio `menu`, `item`; tonight `view`, `day`; reservations `view`, `day`, `guest`; settings `section`, `connection`). Unit table of every old link incl. `composer`, `sub=design`, `connection=return` (C1, C9). |
| 2 | new `src/components/admin/venue-nav-defs.ts` + test | The groups and entries above: label key, icon, `href(venueId)`, `isActive(tab, section)` from resolved values, `shows(viewer)`. Unit table: every entry × owner, member, staff-only, member without `reservations.tonight`. |
| 3 | `src/components/admin/venue-nav.tsx` | On `/venues/{v}`: the switcher and the groups, `aria-current="page"` on the open entry. Elsewhere: today's venue list. Switcher items link to `/venues/{id}` keeping only `tab` and `section` (C1), and keep `data-testid="venue-nav-item"`. |
| 4 | `src/components/admin/app-sidebar.tsx` | Header: the switcher on a venue page, today's Restro link elsewhere (no link for staff-only, C4). Every entry's click closes the phone sheet (C5). Organisation Settings tooltip "Настройки на организацията". |
| 5 | `app/(admin)/layout.tsx` | Shared device: no sidebar, no venue or organisation list (S1, S3, C2); the device's name and venue go to the top bar. Otherwise: each venue with `reservations` (`reservationsOffered`) and the staff-only landing venue (`staffLandingVenue`), in one `Promise.all`. Here, not a venue layout, because this layout draws the sidebar and a child cannot hand it data without moving the sidebar into three layouts (ticket 1 revisits). A rights change shows after a reload; the page still refuses. |
| 6 | `app/(admin)/venues/[venueId]/page.tsx` | Redirect to `canonicalVenueQuery` when `tab` or `section` is present and differs. Personal sign-in: only the open screen, no `WorkspaceTabs`, in a `Suspense` keyed by screen; title = the screen's name; breadcrumb `Заведения › {venue}` (`{venue}` alone for staff-only); Settings' row filtered to the open section's module. Shared device: unchanged (`WorkspaceTabs` device mode). |
| 7 | new `app/(admin)/venues/[venueId]/loading.tsx` | The frame's skeleton, so a sidebar tap answers at once (K18). |
| 8 | `src/components/admin/workspace-tabs.tsx` | `SettingsSections` takes `module`; `useUrlTab` takes parameters to drop (the section row drops `connection`); `activationMode="manual"` (C6, C7); `WorkspaceTabs` kept for the device only. |
| 9 | `src/components/admin/admin-header.tsx` | On a device: no ☰; the device's name on the right opens the user menu's items (K2). |
| 10 | `src/components/admin/user-menu.tsx` | Items (language, theme, sign out) become `UserMenuItems`, used by the sidebar foot and the device's top bar. |
| 11 | `src/server/staff/shared-device.ts` | `sharedDeviceOf({ tenantId, sessionId })` → `{ venueId, name } \| null`, in `cache()`. |
| 12 | `src/server/actions.ts` | `switchOrganization` refuses a device session (S1); attack row in `src/server/security/shared-device-admin.test.ts`. |
| 13 | `messages/bg.json`, `messages/en.json` | The strings below. |
| 14 | `docs/guides/admin-map.md` | Sidebar entries and taps (D123). |
| 15 | e2e specs `admin`, `composer`, `design`, `integration`, `navigation`, `owner-paying`, `owner-reservations`, `reservations`, `tonight`, `venue-phone`, `venue-lifecycle` | Clicks on the venue tab bar become sidebar links; tab counts and "venue name is the h1" move to the sidebar and breadcrumb; `venue-phone`'s device has no sheet. No URL changes. |

**Who sees each entry** (rights that exist today; the page decides again)

| Entry | Owner, admin | Member on own sign-in (incl. staff-only) | Shared device |
|---|---|---|---|
| Switcher with other venues, All venues | yes | yes; staff-only: the name alone | — |
| New venue | yes | — | — |
| Студио, Маси и QR | yes | yes (read-only where today) | — |
| Тази вечер | yes | yes | row |
| Резервации | with `reservations.tonight` | same | row, same right |
| Поръчки › Настройки | yes | yes; read-only without `settings.guards` | — |
| Резервации › Настройки | yes | yes; read-only without `settings.reservations` | — |
| Заведение › Настройки | yes | yes | — |
| Организация › Настройки | yes | yes (as today) | — |

**Each module's Settings row**

| Module | `?section=` values, in order | Shown when |
|---|---|---|
| Поръчки | `hours`, `ordering`, `paying`, `alerts` | `paying`: the POS can take cards; `alerts`: `settings.alerts` |
| Резервации | `reservations` | always (one section: no row) |
| Заведение | `general`, `staff`, `publish`, `versioning` | `staff`: `settings.roles`; `publish`: the venue has a till |

**Strings to add** (existing ones reused: `workspace.tabs.*`, `nav.allVenues`, `nav.newVenue`, `nav.venues`, `nav.organization`, `nav.settings`)

| Key | BG | EN |
|---|---|---|
| `nav.groups.menu` | Меню | Menu |
| `nav.groups.ordering` | Поръчки | Ordering |
| `nav.groups.reservations` | Резервации | Reservations |
| `nav.groups.venue` | Заведение | Venue |
| `nav.settingsOf.ordering` | Настройки на поръчките | Ordering settings |
| `nav.settingsOf.reservations` | Настройки на резервациите | Reservation settings |
| `nav.settingsOf.venue` | Настройки на заведението | Venue settings |
| `nav.settingsOf.organization` | Настройки на организацията | Organisation settings |
| `nav.switchVenue` | Смени заведението | Switch venue |
| `nav.venueNav` | Навигация в заведението | Venue navigation |
| `nav.deviceMenu` | Език, тема и изход | Language, theme and sign out |

**Stays:** every screen's inside, the Studio's Structure · Design row, the Design page, the Publish bar's rules, the Guest features card, the organisation's Settings, every right, every address, the worker's push link (`?tab=tonight&view=log`) and the provider's return address (`?tab=settings&section=paying&connection=return`).

**Checked at review:** both themes; `aria-current` on the open entry; the sheet's focus held with Esc; 44 px entries on a phone; the persona walk as owner, waiter, door host and tablet at 390 px and 1280 px.

## Tickets (everything else)

Each ends with the `ship.md` §1 block; branches from and pull requests into `sr/foundation`. Each "D15x" is the proposed decision file of that number.

**1. Path addresses.** `/venues/{v}/studio`, `/tables`, `/tonight`, `/reservations`, `/ordering/settings`, `/reservations/settings`, `/settings`, each rendering today's screen; old `?tab=` links redirect through `canonicalVenueQuery`. One `venuePageGuard()` every venue page calls (tenant 404, device, staff-only, module off) and one test table of every venue address × (other tenant, device, staff-only, no `reservations.tonight`), written before the pages (K1). One `venuePath()` every link calls, including the worker's push link (`apps/worker/src/alerts/deliver.ts:89`) and the provider's return (`apps/web/src/server/settings/paying-addresses.ts:8`). A `loading.tsx` per page; whether the sidebar moves into a venue layout.
- **Model:** Opus · **Codes it:** agent session · **Branch:** `sr/nav-paths` · **Read:** D97, D122 §7, D141, D154, step 0's S2 · **Stop and ask if:** a link outside `apps/web` names a venue address · **Menu functionality:** none · **Screen:** none (same screens).

**2. The module switch.** The section "Modules" above: writer, reader, defaults, three refusals; an off module's pages, actions and `applyService` commands refuse through ticket 1's guard (K12a); Venue › Settings › Модули; glossary "Module / Модул".
- **Model:** Opus (core write path) · **Codes it:** agent session · **Branch:** `sr/nav-modules` · **Read:** D64, D71, D100, D122 §7, D155, rules 1 and 5, `packages/core/src/apply/guest-features.ts` · **Stop and ask if:** a default would hide a screen a venue uses today · **Menu functionality:** none · **Screen:** plan below; `operational-screens.md`.
- *Screen plan.* **Story:** "As an owner I want to switch reservations on for my club, so that its screens appear": 2 wide / 3 phone. **Place:** the last card of Venue › Settings › Общи, so the Venue row stays at four (L6). **Pattern:** reversible write with Undo; a refusal is the error toast naming the fix. **Primary action:** none. **States:** all off; each refusal; no right (read-only line); hand-made venue (Ordering says why it is off); longest BG "Заявки за песни". **Strings:** Модули / Modules; Поръчки на масата и Тази вечер / Ordering at the table and Tonight; Резервации, планът и гостите / Reservations, the plan and the guests; Първо изключете функциите за гости и публикувайте. / Turn the guest features off and publish first.; Има резервации за идните вечери. / There are reservations for nights to come.; Това заведение не може да приема поръчки по сметка. / This venue cannot take orders onto a bill.

**3. Guest features go to their modules.** Filters stay in Studio; call a waiter, the bill, ordering and paying move into Ordering's settings, as a card "За гостите / For guests" inside the Поръчки section (no fifth section, L6), saving at once with Undo.
- **Model:** Sonnet · **Codes it:** agent session · **Branch:** `sr/nav-guest-features` · **Read:** D71, D72, D129, D155 · **Stop and ask if:** a switch would reach guests without Publish · **Menu functionality:** none · **Screen:** story "switch a guest feature" 2 → 1; place Ordering › Settings; pattern row 1; states as today's card; string За гостите / For guests.

**4. Who opens what (D157).** Staff-only sign-ins see and open only their service screens; the rest refuse through ticket 1's guard (K11). Settings and the Studio need a role at that venue (S4).
- **Model:** Opus (rights) · **Codes it:** agent session · **Branch:** `sr/nav-who-opens` · **Read:** D97, D141, D157, `step0-security.md` · **Stop and ask if:** an owner's or admin's reach changes · **Menu functionality:** none · **Screen:** none.

**5. The phone's bottom bar** (below 768 px). The on modules' service screens in D141's landing order (Резервации, Тази вечер, later Опашка), then Студио, then Още; four before Още. Design and every Settings under Още, which lists only what the bar lacks (K7, K17). Under two destinations, no bar (K10). Studio's slot moves as modules switch on (K19). The selection bar (`composer/selection-bar.tsx:56`) sits above the bar (K9). View rows scroll with a cut-off last label, a fade, the open view in sight, arrow keys (K8). In `e2e/touch-targets.spec.ts`; WCAG 2.4.11.
- **Model:** Sonnet · **Codes it:** agent session · **Branch:** `sr/nav-phone-bar` · **Read:** D123, D154, `operational-screens.md` · **Stop and ask if:** another floating control collides · **Menu functionality:** none · **Screen:** story "reach Tonight or Reservations mid-service" 2 → 1 (Square Dashboard, Toast Now); every venue page below 768 px; states: one, two, five destinations; string Още / More.

**6. Open inside the venue (D158).** One venue: `/` and sign-in open it; several: the last used (a cookie), never one the person lost.
- **Model:** Sonnet · **Codes it:** agent session · **Branch:** `sr/nav-last-venue` · **Read:** D141, D158 · **Stop and ask if:** a staff landing would change · **Menu functionality:** none · **Screen:** none.

**7. One folder per module.** First what reservations and Tonight share (`useWho`, the day picker, the live feed) moves to `src/service/` (K13); then `src/ordering/`, `src/reservations/`, `src/venue-settings/`; then a dependency-cruiser rule: no module imports another.
- **Model:** Sonnet · **Codes it:** agent session; the rule by the lead (D67) · **Branch:** `sr/nav-module-folders` · **Read:** CLAUDE.md import boundaries · **Stop and ask if:** two modules truly share a screen · **Menu functionality:** none · **Screen:** none.

**8. Step 0's rest.** C8 (`not-found.tsx`, `error.tsx` in the frame), C10, C11, S2 (organisation Settings pages check for a device through one helper), a device's `/venues` lists only its venue.
- **Model:** Sonnet · **Codes it:** agent session · **Branch:** `sr/nav-step0-rest` · **Read:** `step0-code.md`, `step0-security.md` · **Stop and ask if:** an owner would see less · **Menu functionality:** none · **Screen:** none.

**9. Song requests' place (docs).** Amend T82 and T81 in the tracker with this plan's contract.
- **Model:** Haiku · **Codes it:** agent session · **Branch:** `docs/nav-song-requests-place` · **Read:** D99, D100, D155 · **Menu functionality:** none · **Screen:** none.

## Decisions for Martin (154–158)

The lead assigned these numbers; their files are `docs/decisions/D154.md`–`D158.md`, indexed, status proposed. **The pull request builds 154 and 156 A before you answer: merging it is your yes to both, and a no closes it.** Ask those two first; 155, 157 and 158 wait with their tickets.

**154. The admin is organised around the open venue** (replaces D74; refines D97's tab list). The sidebar lists the open venue's screens grouped by module; the venue's name at its top switches venue; a page has at most one row of views, four at most. On a phone the same menu opens from ☰ now, and a bottom bar follows (ticket 5). *Recommend yes.* It undoes your 10-11 choice ("bring venues to the sidebar and keep the tabs"): then a venue had three tabs, now five tabs and twenty screens. Cost: switching venue is one tap longer.

**155. Ordering, reservations and song requests are modules, switched on per venue.** Off means not shown and refused; nothing is deleted; switching off is refused while guests can still use it or bookings are to come; existing venues keep what they have, a new venue starts with the menu. Who switches: *recommend the organisation's owner*, with Restro's team able to do it for him. The alternative is Restro's team only, as a paid add-on would be (Square).

**156. Each module has its own Settings.** Ordering: Hours, Ordering, Paying, Alerts. Reservations: rules, closed dates, the plan editor. Venue: General, Staff and roles, Publish, Versioning. *Recommend A, grouped* (built tonight; Toast does this): each group has its screen and its "Настройки". B, flat: one entry per module (Тази вечер, Резервации) with a "Настройки" button on that screen, and one "Настройки" for the venue: five entries instead of seven, no repeated word; its cost is one more tap and Tonight's live load before a module's settings. Both are on the mockups.

**157. A person opens only what their role at that venue works** (refines D141, D97). A staff-only sign-in sees and opens Tonight and/or Reservations and nothing else; the Studio, Tables & QR and every Settings refuse him. The venue's Settings are readable only by people with a role at that venue (step 0's S4: today any member reads any venue's settings). *Recommend yes,* refused rather than hidden: hidden only is cosmetic.

**158. Restro opens inside the venue** (extends D141's landing to owners). One venue: sign-in opens it; several: the one used last; All venues stays in the switcher. *Recommend yes:* one tap off every story for a one-club owner.

## Answers to the critique

| | Answer |
|---|---|
| K1 | Changed. Tonight adds no page, so the one page keeps its guards; tonight's tests are unit tables (entries × actor, every old link). The shared `venuePageGuard()` and the route × actor table are ticket 1, written before its pages. |
| K2 | Changed. On a device the top bar shows its name; it opens language, theme and sign-out. |
| K3 | Changed (lane lead): one small pull request of chrome over today's addresses; no new page, no worker or provider link. The sidebar's data come from the admin layout, with why; path addresses are ticket 1. |
| K4 | Changed. Tonight's mockups show only tonight's build: no badge, no Модули, the Publish bar where it is today. Everything later is on the "По-късно / Later" page. |
| K5 | Changed. The entry is "Резервации" everywhere. |
| K6 | Partly. Grouped is built (lane lead's shape); every Settings carries its group in tooltip and accessible name; the flat option is D156 B, drawn. |
| K7 | Changed. Design is no sidebar entry and never on the bar; it stays the Studio's view. |
| K8 | Changed. Alerts move to Ordering, so no row exceeds four; rows stay today's dropdown on a phone tonight; the scrolling row with cue is ticket 5. |
| K9 | Changed. No bottom bar tonight; ticket 5 lifts the selection bar. The Undo toast is top-right (`app/layout.tsx:37`), so it does not collide. |
| K10 | Changed, in ticket 5: fewer than two destinations, no bar; order as D141 lands. |
| K11 | Decided as a question: D157, recommending refused; tonight hides nothing a role sees today. |
| K12 | Changed: (a)–(c) are ticket 2's criteria. (d): the group keeps Martin's word "Поръчки"; its settings row now holds Alerts too. |
| K13 | Changed: ticket 7 moves the shared service parts first. |
| K14 | Changed: "Модули / Modules", glossary entry in ticket 2. |
| K15 | Changed: the old 157 split into the staff and Settings rights (D157), the bar (into D154); the device frame is fixed tonight as defects (S1, S3). "Who switches" is in D155. Numbers per the lead. |
| K16 | Changed: no group line; crumb names the venue, the title the screen. |
| K17 | Changed, in ticket 5. |
| K18 | Changed: a `loading.tsx` and a keyed `Suspense` per screen. |
| K19 | Accepted, said in ticket 5. |

**The second critique** (`critique-2.md`, Opus, saw only the plan):

| | Answer |
|---|---|
| L1 | Changed. The Studio keeps `menu`, `section`, `item` and `sub`; a Settings section is read only with `tab=settings`; the redirect runs only when `tab` is present. Unit row `tab=studio&menu=mn_1&section=nd_9&item=nd_4` stays as it is. The switcher carries `section` only with `tab=settings`. |
| L2 | Changed. The tapped entry is marked at once (`useOptimistic`); `loading.tsx` at the venue segment; each screen in a `key`ed wrapper so the old one never lingers. |
| L3 | Changed. The switcher's name is the venue's then ", Switch venue"; the device button's is its name then ", Language, theme and sign out"; staff-only gets the venue's name as plain text; `generateMetadata` titles the tab "Тази вечер · Club Biad". |
| L4 | Changed. Glossary "Module" and "Screen" in this pull request; code says `module`; D155 and ticket 2's key (`venues.settings.modules`) match. Ticket 2's (c) word is left to its own grilling. |
| L5 | Left to the copy pass, as Open question 2 says: the section and Tonight's view keep their names tonight. Recommend "Изпратени поръчки" for Tonight's view (the glossary's Sent order). |
| L6 | Changed. Модули is the last card of Общи (ticket 2); "За гостите" is a card inside Поръчки (ticket 3). |
| L7 | Changed. D154 and D156 say merging is the yes, each with a scene; D156 B is five entries; the index rows landed with the files. |
| L8 | Changed. No state under the venue's name. |
| L9 | Changed. Collapsed to icons, a rule separates the groups (the labels go), so each gear sits under its own module's icons; the tooltip and accessible name still say whose Settings. A different icon per module's Settings is ticket 5's to judge with the bottom bar. |
| L10 | Changed. The device frame is the layout's (`sharedDeviceOf`, a context), so `/venues` shows no ☰ either; the crumb names the page's venue (a device may open any venue of its organisation today; ticket 8 keeps it to its own). Изход on a paired tablet ends its session: the tablet is no longer the bar tablet, and making it one again takes "Make this the bar tablet" today, the owner's code under D153. |

**Step 0 findings fixed tonight:** C1, C2/S1, C4, C5, C6, C7, C9, S3. **Left to ticket 8:** C3/S2, C8, C10, C11; S4 is D157.

## Open questions

1. **The Publish bar** shows on every screen but Tonight, including Reservations and settings. Recommend a follow-up keeping it to the Menu group and Venue › Settings; not tonight, because D96 and D97 placed it.
2. **The group label "Поръчки"** covers Tonight, which also carries waiter calls and sold out. Recommend keep (Martin's own word for the module); the screen review's copy pass can judge it.

## Mockups

Throwaway static HTML (the `prototype` skill, UI branch); open in a browser. The bar at the bottom of each switches the persona.

- [Start page](2026-11-18-navigation-and-feature-bases/index.html)
- Tonight's build: [Owner, desktop](2026-11-18-navigation-and-feature-bases/owner-desktop.html) · [Owner, 390 px phone](2026-11-18-navigation-and-feature-bases/owner-phone.html) · [Shared phone or tablet](2026-11-18-navigation-and-feature-bases/shared-device.html)
- [По-късно / Later: modules, the bottom bar, staff-only, D156 B](2026-11-18-navigation-and-feature-bases/feature-bases.html)
