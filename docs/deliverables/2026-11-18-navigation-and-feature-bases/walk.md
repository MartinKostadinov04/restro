# Lane 6 persona walk (PR #456), 2026-11-20

Walked by two fresh Opus agents through Playwright on the lane database: the owner first, then the waiter, the door host and the shared tablet. Each was walked at 390 × 844 and 1280 × 800, in Bulgarian, and the owner in English at 1280 too. The navigation only (sidebar, phone sheet, top bar, moving between screens) was critiqued with design-critique, accessibility-review and ux-copy under `screen-review`'s overrides, and checked against the plan's Tonight's build, D161 and D156. Screenshots: `after/`; the before shots are in `before/`.

Every persona reaches every screen it may open. There is no dead end on a personal sign-in, and nothing was found twice on the page after d4479361.

## Rows

| # | Kind | Finding | Where | State |
|---|---|---|---|---|
| S1 | bug | On a phone, the first Esc doesn't close the menu when an entry has focus: a hidden but open hint takes it (WCAG 2.1.1) | sidebar sheet, 390 | fixed in this PR |
| S2 | bug | Focus goes to the page body when the phone menu closes, by Esc or by a tap (2.4.3) | sidebar sheet, 390 | for Martin's pick |
| S3 | bug | Opening the phone menu puts focus on the user menu at its foot, not on the open entry (2.4.3) | sidebar sheet, 390 | for Martin's pick |
| S4 | bug | ☰ doesn't report whether the menu is open (4.1.2) | top bar | fixed: `aria-expanded` |
| S5 | bug | The tablet on `/settings*` gets a page with no way out | tablet | already in #467 |
| S6 | bug | A tap on Tonight was lost once while Tables & QR was loading (the worker answered 500); could not reproduce | owner, 1280 | for Martin's pick (reproduce first) |
| S7 | bug | Reservations' 5 s refresh is sometimes aborted after arriving through the sidebar; may be a dev-server effect | waiter | for Martin's pick (check CI build) |
| S8 | plan C4 | A staff-only sign-in off its venue still saw All venues | waiter, host | fixed in this PR |
| S9 | Clean rule 2 | The screen's name appears twice (the title, then the screen's own heading) | Reservations, Tonight, Venue › General | for Martin's pick |
| S10 | D161 | The phone's menu button was the panel icon, not ☰ | top bar, 390 | fixed in this PR |
| S11 | copy | Waiter and host: settings screens with nothing they can change say nothing about it | staff | for Martin's pick; or D157 first |
| S12 | D161 | The tablet shows the venue's name twice and three rows of choices on Tonight | tablet, 390 | for Martin's pick |
| S13 | copy rule 8 | "Поръчки" names the sidebar group, a settings section and a view of Tonight | all | for Martin's pick ("Правила за поръчки") |
| S14 | 1.4.11 | The open entry's background is 1.05:1 against the sidebar | sidebar | for Martin's pick |
| S15 | critique | Four identical "Настройки" entries; D156 A accepts this | sidebar, 390 | answered by D156 (A or B) |
| S16 | critique | The organisation block in the footer looks like a control but is text | sidebar footer | for Martin's pick |
| S17 | 44 px | The "Заведения" breadcrumb is 73 × 20 px on a phone | top bar, 390 | for Martin's pick |
| S18 | 1.4.4 | At 200 % zoom the footer takes a third of the sheet | sheet, 640 × 400 | Polish |
| S19 | critique | The organisation Settings tab title is just "Общи" | `/settings/general` | Polish |
| S20 | 2.4.1 | No skip link past the sidebar on a desktop | all, 1280 | Polish |

Out of the navigation's scope, seen in passing:
- Venue › General overflows by 4 px at 320 px.
- Reservations and Studio have focusable areas with no visible ring.
- Studio offers a waiter "Нова секция" and "Тагове" (untested whether the action refuses).
- A `pg` warning about overlapping `client.query()` calls.

## Could not see
- English for waiter, host and tablet.
- Switching venue: the demo organisation has one venue.
- A member without `reservations.tonight`.
- The desktop sidebar folded to icons, walked by a person.
- A tablet with a person's PIN entered.
- A screen reader, one-handed reach and swipe-to-close on a real phone.
