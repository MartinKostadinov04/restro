# The admin's navigation and its feature bases: plan

Lane 6 of the 11-18 screen round. Planner's deliverable for Martin; nothing here is built. Mockups are beside this file (last section).

## Summary

1. Today a venue is one page with five tabs, up to nine sections under one of them, and views under two others: three levels, on a phone each behind a dropdown.
2. Proposal: **the sidebar becomes the venue's own menu**, grouped by feature base: Menu, Ordering, Reservations, Song requests, Venue. The venues move to a switcher at its top. Never more than two levels: the sidebar says where, one row on the page says which view.
3. **A feature base that is off is not drawn at all.** A venue with only the menu has four entries; each base adds its own group, its own screens and its own Settings.
4. On a phone: a bottom bar with the service screens first and "Още / More". Staff see only what their role works; the shared tablet keeps its one row and loses the sidebar.
5. Tonight's build is the move only (new addresses, old links redirect, no screen's inside changes, no migration). The per-venue switch and five more pieces are tickets.

## Today: what is cluttered, and why

Walked from `docs/guides/admin-map.md` and the code that draws it.

| Level | What is there today |
|---|---|
| Sidebar | Every venue by name, All venues, New venue, the organisation's Settings, organisation switcher, user menu |
| Venue tabs | Studio · Tables & QR · Tonight · Reservations · Settings |
| Under Studio | Structure, Design (Design is a page of its own, without the sidebar); the Guest features card under Structure |
| Under Tonight | Actions and tables · Sent orders · Log · End of night |
| Under Reservations | List · Plan · Guests |
| Under Settings | General · Hours · Ordering · Reservations · Paying · Staff and roles · Alerts · Publish · Versioning |
| Organisation Settings | General · Integrations · Deleted venues |

What is wrong, concretely:

- **Three levels in one page.** Venue → tab → section or view. Settings › Paying is 3 taps on a wide screen and 5 on a phone; opening a night for phones (Hours) is 8 on a phone.
- **On a phone every level is a dropdown** (below 1024 px): two taps per switch, and the choices are hidden until opened. The manager moving from Tonight to Reservations mid-service pays 2 taps each way.
- **One Settings holds three feature bases.** Hours, Ordering and Paying are ordering's; Reservations (with the whole plan editor inside it) is reservations'; the rest is the venue's or the menu's. Nine sections do not fit one row, so their icons are already dropped.
- **Two things called Settings** (the organisation's in the sidebar, the venue's as a tab).
- **Nothing says which feature base a screen belongs to.** Tonight and Reservations sit between Tables & QR and Settings as equal tabs; a venue that only wants the menu still gets all of it.
- From the security check (`docs/reviews/2026-11-18-screen-round/lane6-navigation/step0-security.md`): a shared device still draws the organisation switcher and every venue (S1, S3), and any member can read Settings at any venue (S4).

## What others do

Vendor help pages, read on 11-18. "(snippet)" means only the search result was readable. SevenRooms, TableCheck's navigation and any DJ-request tool with a venue dashboard could not be verified: unknown.

| Pattern | Who | Source |
|---|---|---|
| Left sidebar grouped by business area, with a location switcher in it | Lightspeed K-Series | https://k-series-support.lightspeedhq.com/hc/en-us/articles/36985562334363 , https://k-series-support.lightspeedhq.com/hc/en-us/articles/23973504428059 |
| Left navigation; rarely used setup nested under a Settings entry of its own area | Toast Web | https://support.toasttab.com/en/article/New-Team-Navigation-Coming-to-Toast-Web?lang=en_US |
| An add-on is a module in the same back office, with its own Settings ("Toast Web > Waitlist & Reservations > Settings") | Toast | https://support.toasttab.com/en/article/Getting-Started-Toast-Waitlist?lang=en_US |
| Add-ons are switched on from one page and "not visible in your Square Dashboard until activated" | Square | https://squareup.com/help/us/en/article/8486-add-advanced-capabilities |
| Staff use another surface than the owner: a PIN or passcode on a shared device; permissions belong to a job and are edited only in the back office | Toast, Square, me&u | https://support.toasttab.com/en/article/Assigning-User-Access-Permissions?lang=en_US , https://squareup.com/help/us/en/article/5822-employee-permissions , https://meandu.helpjuice.com/how-to-set-up-a-staff-pin- |
| A missing navigation entry means the role lacks the permission | OpenTable (snippet) | https://support.opentable.com/s/article/Custom-roles-and-user-permissions?language=en_US |
| Manager's phone: a bottom bar of up to four tools plus More; switch venue by tapping its name at the top | Square Dashboard app, Toast Now | https://squareup.com/help/us/en/article/5618-get-started-with-the-square-dashboard-app , https://support.toasttab.com/en/article/Get-Started-with-the-Toast-Now-App?lang=en_US |
| A phone's bottom bar holds three to five destinations | Android design guide | https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns |
| Hidden navigation is used about half as often as visible; show four or fewer links on a phone | NN/g | https://www.nngroup.com/articles/hamburger-menus/ |
| Never mix navigation tabs and in-page tabs in one control | NN/g | https://www.nngroup.com/articles/tabs-used-right/ |
| The sidebar's header is the place for a workspace switcher; groups can collapse; on a phone it is a sheet | shadcn/ui Sidebar | https://ui.shadcn.com/docs/components/sidebar |

The proposal below uses these and adds nothing of its own.

## The navigation

**The rule: two levels.** The sidebar (or the phone's bar) says where you are; one row at the top of a page switches views of that same thing. Where a third level would appear, the second level becomes a sidebar entry.

### Entries

| Group | Entry (BG / EN) | Address | Views on the page (as today) | Who sees it |
|---|---|---|---|---|
| top | Venue switcher: the venue's name; inside it the other venues, Всички заведения / All venues, Ново заведение / New venue | — | — | Personal sign-ins. Never a shared device (S1, S3) |
| Меню / Menu | Студио / Studio | `/venues/{v}/studio` | Structure (item sheet, Tags, Sold out) | Everyone but a staff-only sign-in and a shared device |
| | Дизайн / Design | `/venues/{v}/design` (exists) | its own full page, as today | same |
| | Маси и QR / Tables & QR | `/venues/{v}/tables` | — | same |
| Поръчки / Ordering | Тази вечер / Tonight | `/venues/{v}/tonight` | Действия и маси · Поръчки · Дневник · Край на вечерта | A role with `tables.open_close` or `alerts.answer`; the shared device |
| | Настройки / Settings | `/venues/{v}/ordering/settings` | Работно време · Поръчки · Плащане | Not staff-only; read-only without the right, as today |
| Резервации / Reservations | Вечерта / The night | `/venues/{v}/reservations` | Списък · План · Гости | `reservations.tonight`; the shared device when its role holds it |
| | Настройки / Settings | `/venues/{v}/reservations/settings` | one page (rules, closed dates, plan editor) | Not staff-only |
| Заявки за песни / Song requests (not built) | Опашка / Request queue | `/venues/{v}/requests` | — | the DJ's role |
| | Настройки / Settings | `/venues/{v}/requests/settings` | — | Not staff-only |
| Заведение / Venue | Настройки / Settings | `/venues/{v}/settings` | Общи · Персонал и роли · Известия · Публикуване · Версии | Not staff-only |
| foot | Организация / Organisation (its Settings), the user menu | `/settings/…` (unchanged) | General · Integrations · Deleted venues | Personal sign-ins |

A venue with everything has ten entries; a venue with only the menu has four. Each Settings entry sits under its group's label, so "Settings" always means "of this"; collapsed to icons, its tooltip reads "Резервации · Настройки".

### Per persona

| Persona | Desktop | 390 px phone |
|---|---|---|
| **Owner** (organisation owner or admin) | The whole sidebar. Opens on Studio, as today. | Bottom bar: Тази вечер · Вечерта · Студио · Дизайн · Още. "Още / More" opens the whole list as a sheet. The venue's name at the top opens the switcher. A menu-only venue: Студио · Дизайн · Маси и QR · Още. |
| **Manager** (a venue role above staff) | The same groups; an entry whose right he lacks is read-only or absent, as today. | The same bar. |
| **Waiter** (staff-only sign-in, own phone) | Only Тази вечер, and Вечерта if the role holds it. No Menu, no Settings. | The same one or two entries as the bar, plus his name (language, sign out). Lands as D141 says. |
| **Door host** (own phone) | Вечерта, and Тази вечер if held. Lands on Вечерта (D141). | The same. |
| **Shared tablet or phone** (D122 §7, D153) | **No sidebar, no venue list, no organisation switcher.** One row at the top: Тази вечер · Вечерта. Exactly today's screen. | The same row. |

The bar's rule: the service screens of the bases that are on, then the Menu's entries, four at most, then Още. Setup screens live under Още: they are desk work. The row of views on a page scrolls sideways on a phone instead of turning into a dropdown.

### Taps, today and new

Counted as the admin map counts: an owner, from the venues list, "Open" is tap 1. Wide / phone.

| Story: reach… | Today | New | |
|---|---|---|---|
| Studio › Structure | 1 / 1 | 1 / 1 | = |
| Design | 2 / 3 | 2 / 2 | phone −1 (3 once three bases are on) |
| Tables & QR | 2 / 3 | 2 / 3 | = (2 with one base or none) |
| Tonight | 2 / 3 | 2 / 2 | phone −1 |
| Tonight › Sent orders | 3 / 4 | 3 / 3 | phone −1 |
| Tonight › Log | 3 / 4 | 3 / 3 | phone −1 |
| Tonight › End of night | 3 / 4 | 3 / 3 | phone −1 |
| Reservations, the night | 2 / 3 | 2 / 2 | phone −1 |
| Reservations › Plan | 3 / 4 | 3 / 3 | phone −1 |
| Reservations › Guests | 3 / 4 ¹ | 3 / 3 | phone −1 |
| Hours (open a night for phones) | 3 / 5 | 2 / 3 | −1 / −2 |
| Ordering rules | 3 / 5 | 3 / 4 | phone −1 |
| Paying | 3 / 5 | 3 / 4 | phone −1 |
| Reservation settings and the plan editor | 3 / 5 | 2 / 3 | −1 / −2 |
| Staff and roles | 3 / 5 | 3 / 4 | phone −1 |
| Alerts | 3 / 5 | 3 / 4 | phone −1 |
| Venue › General (menus) | 2 / 3 | 2 / 3 | = |
| Versioning | 3 / 5 | 3 / 4 | phone −1 |
| Move between Tonight and Reservations mid-service | 1 / 2 | 1 / 1 | phone −1 |
| Publish (from a menu screen) | 2 / 2 | 2 / 2 | = |
| Organisation Settings | 1 / 2 | 1 / 2 | = |
| Switch to another venue | 1 / 2 | 2 / 2 | **wide +1** |
| Staff sign-in to its screen; shared tablet to Reservations | 0; 1 | 0; 1 | = |

¹ The map says 2 / 3 for Guests; it is a view like Plan, so I count 3 / 4.

On a wide screen little gets shorter; the gain is on the phone and in two levels instead of three. Switching venue on a wide screen gets one tap longer. Every story that starts on a screen (the map's §2: hide an item, take a waiter call, answer a money row) is unchanged, because no screen's inside moves. With decision 5 below, every owner row drops one more tap for a one-venue organisation.

## Feature bases

**The menu is the base every venue has** (Studio, Design, Tables & QR, Publish). **Ordering, reservations and song requests are feature bases:** each is switched on per venue, and each owns one sidebar group, its screens, its Settings, its rights and its folder. Off means not drawn: no entry, no settings, no dead link. Nothing is deleted by switching off.

| Venue | Sidebar | Phone bar |
|---|---|---|
| Menu only | Menu (3) · Venue Settings | Студио · Дизайн · Маси и QR · Още |
| + Ordering | + Ordering: Тази вечер, Настройки | Тази вечер · Студио · Дизайн · Маси и QR · Още |
| + Reservations | + Reservations: Вечерта, Настройки | Тази вечер · Вечерта · Студио · Дизайн · Още |
| + Song requests | + Song requests: Опашка, Настройки | Тази вечер · Вечерта · Опашка · Студио · Още |

### How it is implemented

**What exists today** (looked up before proposing anything):

- `venues.settings.guest_features` (a JSON value on the venue, written only by core's `setGuestFeatures`, published with the menu): `filters`, `call_waiter`, `bill`, `ordering`, `pay`. These say what a **guest** is offered. They are not a switch for the admin: Tonight shows at every venue.
- Reservations have no venue switch at all: the tab shows to anyone holding `reservations.tonight` (`reservationsOffered`).
- Paying shows where the POS can take cards (`payingOffered`); Publish settings where the venue has a POS.

**The switch:** a new key beside the existing one, `venues.settings.feature_bases = { ordering, reservations, song_requests }`. The column is already JSON, so **no migration**. It is the venue's data, so it gets one writer in `core/apply` (`setFeatureBases`, the shape of `setGuestFeatures`; rule 1) and a pure reader. It is admin-side only: it is not published, so the snapshot and the faces do not change (rules 3, 4). Guest features stay the guest's side and keep their Publish.

- **A venue with no key reads as today:** ordering on, reservations on, song requests off. Nobody loses a screen on the day this ships. A new venue starts with the menu only.
- **Switching off is refused while guests can still use it:** ordering cannot go off while the live menu offers ordering, the bill, paying or a waiter call ("Turn these off and publish first"). Our layers only make things more cautious (rule 5); the admin never hides a screen staff still need.
- **Where the owner switches:** Venue › Settings gets a section Функции / Features, one card per base with what it adds and one switch (Square's "Add more" page). Needs `settings.roles`' holder or the organisation's owner: Martin's call, decision 2.

**One list in code.** `apps/web/src/components/admin/venue-nav-defs.ts` declares the groups and entries once (the base, the address, the label, the icon, the right that shows it, whether a shared device may have it). The sidebar, the phone bar, the shared device's row, the landing and the old-link redirects all read it. A new base is one block there plus its pages.

**Rights.** No new right for the move. An entry shows by the rights that exist; the page checks again (a link is never the guard). Staff-only is `holdsStaffRightsOnly`, which exists.

**Three layers and nine rules.** All of this is the platform layer: no POS name, no POS field. No write path is added except the one `core/apply` writer. Nothing reads the database for a guest. No rule is touched.

**Song requests (plan only; T82, D99, D100).** They plug in as the fourth block of the list: group Заявки за песни, pages `/venues/{v}/requests` and `/requests/settings`, screens in `apps/web/src/requests/`, commands through `applyService` in `core/service/requests/` (rule 1), money through the payment provider from the worker only (D127), the guest's queue as a published live file (rule 4), a guest feature `song_requests` that declares it needs no table (D100), rights `requests.queue` and `settings.requests`. The DJ is a role holding only `requests.queue`: one entry, and D141's landing order sends him to it.

## Tonight's build (one pull request, no migration, no inside redesigned)

**New addresses** (each page renders the screen component that exists, unchanged):

| New | Renders | Old link that redirects to it |
|---|---|---|
| `/venues/{v}` | redirect: an old `?tab=` to its new address with every other parameter kept; else staff as D141, others to Studio | — |
| `/venues/{v}/studio` | `ComposerTab` | `?tab=studio`, `?tab=composer`, no tab |
| `/venues/{v}/tables` | `TablesTab` | `?tab=tables` |
| `/venues/{v}/tonight` | `TonightTab` (`?view`, `?day`) | `?tab=tonight…` |
| `/venues/{v}/reservations` | `ReservationsTab` (`?view`, `?day`, `?guest`) | `?tab=reservations…` |
| `/venues/{v}/ordering/settings` | `OrderingSection` hours / ordering, `PayingSection` (`?section`, `?connection`) | `?tab=settings&section=hours\|ordering\|paying` |
| `/venues/{v}/reservations/settings` | `ReservationsSection` | `…&section=reservations` |
| `/venues/{v}/settings` | General, Staff, Alerts, Publish, Versioning (`?section`) | `?tab=settings`, other sections, `?tab=integration\|publishing` |

`/venues/{v}/design`, the print sheet, `/venues`, `/settings/…` stay.

**Files.**
- `app/(admin)/venues/[venueId]/page.tsx` shrinks to the redirects; seven new `page.tsx` beside it, sharing a new `components/admin/venue-frame.tsx` (the breadcrumb, the venue's name, the Publish bar where it shows today).
- `workspace-tab-defs.ts` → `venue-nav-defs.ts` (entries, groups, the three section lists, `legacyTarget()`); `workspace-tabs.tsx` keeps `UrlTabs` and `useUrlTab` for views and sections, loses `WorkspaceTabs`, and its row scrolls at every width (no dropdown).
- `venue-nav.tsx` becomes the venue switcher plus the groups; `app-sidebar.tsx` draws them; new `venue-bottom-bar.tsx` (below 768 px). The open venue's rights reach the sidebar through a parallel route slot (`app/(admin)/@nav/`), or, simpler for a handful of venues, are read in the admin layout: the lead picks.
- `server/tonight/landing.ts` returns the new addresses; a new `server/venue-bases.ts` answers `{ordering: true, reservations: true, songRequests: false}` until ticket 1 gives it the stored value.
- Shared device: the admin layout draws no sidebar and passes no venue list or organisation list (S1's surface, S3).
- The 37 `tab=` links in 27 source files and about 50 test files move to the new addresses; `messages/bg.json` and `en.json` get the group labels, "Още / More", "Смени заведението / Switch venue"; `docs/guides/admin-map.md` is rewritten in the same change (D123).
- Landing: `/` and sign-in open the only venue when the organisation has one (decision 5); `/venues` itself never redirects an owner.

**Stays:** every screen's inside, the Guest features card under Structure, the Publish bar's rules, the Design page, the organisation's Settings, all rights, all data.

## Tickets (everything else)

Each ends with the `ship.md` §1 block. Stage branch `sr/foundation`.

**1. The feature-base switch.** `core/apply`: `setFeatureBases` and `readFeatureBases` over `venues.settings.feature_bases`, defaults and the refusal above; Venue › Settings › Функции / Features; `server/venue-bases.ts` reads it; a new venue starts menu-only.
- **Model:** Fable (core write path) · **Codes it:** lead · **Branch:** `sr/nav-feature-bases` from `sr/foundation`; pull request into `sr/foundation` · **Read:** D71, D100, D155, rule 1 and 5; `packages/core/src/apply/guest-features.ts` · **Stop and ask if:** a default would hide a screen a venue uses today · **Menu functionality:** none · **Screen:** the plan below; `operational-screens.md`.
- *Screen plan.* **Stories:** "As an owner I want to switch reservations on for my club, so that its screens appear": target 3 wide / 4 phone (Settings, Features, the switch; saves at once with Undo). **Place:** Venue › Settings, last section. **Pattern:** a single reversible write; a refusal is the error toast naming the fix. **Primary action:** none (switches). **States:** all off; a base refused; a member without the right (read-only line); a POS venue n/a; longest BG text "Заявки за песни". **Strings:** Функции / Features; Поръчки на масата и Тази вечер / Ordering at the table and Tonight; Резервации, планът и гостите / Reservations, the plan and the guests; Първо изключете функциите за гости и публикувайте. / Turn the guest features off and publish first.

**2. Guest features go to their bases.** Split the card: filters stay in Studio; call a waiter, the bill, ordering and paying move to Ordering › Settings as a section "За гостите / For guests", saving at once with Undo (closes the pattern list's divergence).
- **Model:** Sonnet · **Codes it:** agent · **Branch:** `sr/nav-guest-features` · **Read:** D71, D72, D129, D155 · **Stop and ask if:** a switch would reach guests without Publish · **Menu functionality:** none · **Screen:** plan: story "switch a guest feature" today 2, target 1; place Ordering › Settings; pattern row 1; states as the card has today; no new strings but the section's name.

**3. Settings are readable only where you work (S4).** The read side of every settings page takes the actor; a member with no role at the venue gets the 404; staff-only gets none of them.
- **Model:** Fable (rights) · **Codes it:** lead · **Branch:** `sr/nav-settings-read` · **Read:** D97, D141, D157, the security check · **Stop and ask if:** an owner's read changes · **Menu functionality:** none · **Screen:** none.

**4. One folder per feature base, and a rule that keeps them apart.** Move `src/settings/` files to `src/ordering/settings/`, `src/reservations/settings/`, `src/venue-settings/`; a dependency-cruiser rule: a base's folder never imports another base's.
- **Model:** Sonnet for the move · **Codes it:** agent, the guardrail by the lead (D67) · **Branch:** `sr/nav-base-folders` · **Read:** CLAUDE.md import boundaries · **Stop and ask if:** two bases truly share a screen · **Menu functionality:** none · **Screen:** none.

**5. Open in the venue you used last** (organisations with several venues): a cookie with the last venue; `/` opens it; "All venues" stays in the switcher.
- **Model:** Sonnet · **Codes it:** agent · **Branch:** `sr/nav-last-venue` · **Read:** D141, D158 · **Stop and ask if:** a venue the person lost access to is remembered · **Menu functionality:** none · **Screen:** none.

**6. Song requests' place (docs only).** Amend T82 and T81 in the tracker with the plug-in contract of this plan, so the port starts from it.
- **Model:** Haiku · **Codes it:** agent · **Branch:** `docs/nav-song-requests-place` · **Read:** D99, D100, D155 · **Menu functionality:** none · **Screen:** none.

## Decisions for Martin (proposed; they become D154–D158)

**D154. The sidebar is the venue's menu; the venues move to a switcher** (refines D74, D97). The sidebar lists the open venue's screens in groups; the venue's name at its top switches venue. A page has at most one row of views. *Recommend yes.* It undoes your 10-11 choice ("bring venues to the sidebar and keep the tabs"): then a venue had three tabs, now it has five and nineteen screens under them. Cost: switching venue is one tap longer on a wide screen.

**D155. Ordering, reservations and song requests are feature bases, switched on per venue.** The menu is the base every venue has. A base that is off is not drawn anywhere. Switching off deletes nothing and is refused while guests can still use it. Existing venues keep what they have; a new venue starts with the menu. *Recommend yes;* the open half is who may switch (I recommend the organisation's owner).

**D156. Each feature base has its own Settings** (refines D97). Ordering: Hours, Ordering, Paying. Reservations: rules, closed dates, the plan editor. Venue: General, Staff and roles, Alerts, Publish, Versioning, Features. *Recommend yes* (Toast does exactly this). The alternative, one Settings page with headings per base, keeps nine sections in one place.

**D157. A person sees only the entries their role works** (refines D141, D122 §7). A staff-only sign-in sees Tonight and/or The night and nothing else. A shared device has one row and no sidebar, venue list or organisation switcher. Settings are read only by people with a role at that venue (S4). On a phone the admin has a bottom bar: service screens first, then Studio, then More. *Recommend yes.* It takes away the read-only look a waiter has at the Studio and Settings today.

**D158. Restro opens inside the venue** (extends D141's landing to owners). With one venue, sign-in opens it; with several, the one used last; "All venues" stays one tap away in the switcher. The owner's first screen stays the Studio. *Recommend yes:* one tap off every story for a one-club owner.

## Open questions

1. **Words.** "Тази вечер" (ordering) and "Вечерта" (reservations) stand near each other. I kept today's labels. The alternative for the second is "Резервации" under the group label "Резервации". Recommend: keep, and let the screen review's copy pass judge it.
2. **The Publish bar** shows on every screen but Tonight today, including Reservations and settings. Recommend a follow-up that keeps it to the Menu group and Venue › Settings; not tonight, because D96 and D97 placed it.
3. **A manager and the Menu group.** I show it to everyone above staff-only, read-only where the organisation role is "member", as today. Whether a manager should see the Studio at all is unknown (D147 lets staff mark sold out, which lives on Structure and Tonight).

## Mockups

Throwaway static HTML (the `prototype` skill, UI branch); open in a browser. The bar at the bottom of each switches the persona and the feature bases.

- [Start page](2026-11-18-navigation-and-feature-bases/index.html)
- [Owner, desktop](2026-11-18-navigation-and-feature-bases/owner-desktop.html)
- [Owner, 390 px phone](2026-11-18-navigation-and-feature-bases/owner-phone.html)
- [Door host on a shared phone or tablet](2026-11-18-navigation-and-feature-bases/shared-device.html)
- [Venues with one, two and three feature bases](2026-11-18-navigation-and-feature-bases/feature-bases.html)
