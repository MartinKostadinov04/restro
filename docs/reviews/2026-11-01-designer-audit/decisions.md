# Designer audit, B7: decisions against what landed

**Who:** B7 (Sonnet), read-only. **Pin:** `st/foundation` at `7dccd3a4` (worktree `E:/Restro/.claude/worktrees/da-pinned`, detached). **Plan step:** 7.
**Covered:** spec #168 and tickets #169-#178, #239, #258 (acceptance criteria and stated behaviours against a test or e2e spec); decisions 128, 129, 130, 131 and D22 (and the earlier decisions the wave touches: D69, D92, D105, D122) against the code; the design contract's options against Styles, renderer, Design page and snapshot (by script); words (messages, contract labels, GLOSSARY, the guides the wave changed); three layers and rule 3.
**Method:** I ran no test, build or server. "Proved by" means a test or spec exists on the pin that asserts it; I did not run it, CI 41255336162 is green on the pin. Scripts are in the scratchpad (`.../scratchpad/b7/`, listed at the end; the main one is in the appendix).
**Guardrails not re-proved:** rules 1 to 3 and the contract (`scripts/design-contract.test.ts`, `scripts/design-writers.test.ts`, the leak guard in `packages/core/src/snapshot/look.test.ts`, dependency-cruiser `faces-money-math-only-in-preview`, the vendor-words baseline).

**A number to settle first.** The brief says 60 options. The pin has **48**: decision 130's title, the contract's header (`packages/core/src/design/contract.ts:2`), the spec and `scripts/design-contract.test.ts:68` all say 14 pages and 48 options, and my script finds 48 (46 choice options with 128 values, plus `style` and `colours`). I cannot reproduce 60 from anything on the pin. I audited all 48.

## Findings

| id | severity | where (pin) | rule / decision / ticket text | scenario | evidence | conf. |
|---|---|---|---|---|---|---|
| DA-B7-1 | medium | `packages/core/src/service/alert-text.ts:134-135` (en), `:211` (bg); `apps/web/messages/en.json:1956` and `:2052`, bg the same lines; `en.json:250,251,654`; `apps/worker/src/jobs/stock.ts:3`; `packages/core/src/service/stock.ts:2`; pinned by `alert-text.test.ts:141,148` | Decision 131: "An item that cannot be had is not shown ... the guest page does not draw it at all." The wave's own check list: "nothing still follows the old rule" | If the POS reports Mojito out of stock, Tonight's notice tells staff "Out of stock in barsy: Mojito. Greyed out on the menu." (bg: "Посивено в менюто."), and the item sheet and the sold-out list tell a manager "Guests see it as sold out" / "Guests see these as sold out". Guests see nothing: the item is gone. Staff then look for a greyed card that does not exist, or tell a guest to "look for the sold-out one". Decision 131's reach (staff wording, the Tonight notice, decision 122's Stock paragraph) was never swept; only the guest page was | `rg "Greyed out" apps packages`: `alert-text.ts:135`, `en.json:1956,2052`, the two code comments, the two test lines; `en.json:250` "Guests see it as sold out within about 15 seconds"; the unit test `alert-text.test.ts:141` pins the old sentence, so it would have to change with the fix | 0.9 |
| DA-B7-2 | medium | `packages/core/src/snapshot/schema.ts:273` (`design: DesignValuesSchema.optional()`), `packages/core/src/design/schema.ts:17-33` (strict, every option required), read at `apps/web/src/guest/load.ts:202` | Spec #168, "The snapshot and the shell": "New fields are optional forever (readers change first)"; story 41: "a test proving that a new option never changes an existing look, so that adding to the designer is safe"; `snapshot/schema.ts:269-272`: "(strict: an unknown page or option, a missing one or a value off the list is refused)" | The record side is safe (`withNewOptions`, `record.ts:136` reads a missing option as Basic's), the snapshot side is not. If a later release adds option 49 (or removes or renames a value) while venue V's live snapshot on the CDN was published before it, `MenuSnapshotSchema` refuses V's snapshot at the guest loader, `getFile(..., 'failed')`, and every venue's guest page shows "could not load" until that venue republishes. The "new option never changes a look" test (`design.test.tsx:221-270`) renders views built in memory; nothing parses an older published snapshot against a newer contract | `look.test.ts:145` ("menu-snapshot/1 stays readable") covers a snapshot with no design block only; no test parses a snapshot with a design block missing one option. Reproduce: parse `buildSnapshot` output with one key deleted from `design.items` through `MenuSnapshotSchema` | 0.8 |
| DA-B7-3 | medium | `docs/guides/shell-handoff/visualization-shell.md:263,275,24,1420,1422`; `docs/guides/menu-template-functionality.md:81,104,138`; `docs/guides/operational-screens.md:75` | Decision 131 ("the `show` value goes"); decision 128 (a Style, not a gallery of templates); decision 129 (layout moves into the design; Done saves); ticket #171 "the functionality file ... the code and its tests follow it" | An agent making a Style or a face reads the designer guide first (template-design skill, CLAUDE.md folder rule): it still says `soldOutDisplay` is "Menu setting `show` or `hide`" (`:263`, `:275`), that a venue "chooses ... from a gallery of templates" and Editorial Market "is the default for every venue" (`:24`), that "the venue's colours, font ... template and guest features are venue settings written by their own writers" (`:1420`) and that the layout is "a menu setting in the composer" (`:1422`). The functionality file still says the platform runs ordering "on the hidden reference template" (`:81`, `:104`, `:138`) after that template was deleted. The operational guide still lists "a layout or look option" as "saves at once, no Save button" (`:75`) while the Design page uses Done and Cancel | quoted lines above; `git diff --stat origin/or/foundation...7dccd3a4 -- docs/guides` touched the designer guide and the functionality file, only in parts, and not the operational guide | 0.85 |
| DA-B7-4 | low | `docs/guides/admin-map.md:19`, `:70-78`; `docs/deliverables/2026-10-30-menu-designer-acceptance-guide.md:9` | Ticket #175 "the admin map is revised (the Studio row, the Design row, the taps table)"; #176 and #177 each carry a screen plan with target tap counts ("Bill zebra: 5", "save a style: 3", "update 2", "delete 2", "copy 3"); decision 123 (screens in the admin map before they are coded) | The Design row names Style tiles, colours, fonts, logo, layout and the preview, but not Advanced (General and 13 pages), click to edit or My styles; the taps table has no row for any of the eleven stories of #176 and #177. The next person who counts taps or looks for where "My styles" lives finds nothing. The acceptance guide tells Martin to open "Demo Bar › Composer › Publish", a name the interface no longer shows | `rg -i "my styles\|advanced\|zebra" docs/guides/admin-map.md` returns only the Design row's "Advanced roles" | 0.85 |
| DA-B7-5 | low | `packages/faces/editorial-market/src/css.ts:215-223` (name size `l`: `--rm-name-two` 14 px, `--rm-price-photo` 16 px), applied by `:1074-1076`; test pins it at `renderer-rules.test.tsx:153-154` (name 14, price 16) | Decision 130, renderer rules: "the price follows the name size one step down" | An owner on any Style or Basic who sets Items name size Large and layout Two columns gets a 16 px price above a 14 px name; the same combination is Editorial's own. The code and the test call it deliberate ("today's look, which Editorial must keep: reported on #172"), but decision 130 was never amended and Editorial's Style file header (`editorial.ts:18`) lists it only in a comment, not in `departures` | `renderer-rules.test.tsx:140-155`; css rules at `css.ts:215-223` and `:1074`; the s and m cases are fixed at `css.ts:1843-1857` | 0.85 |
| DA-B7-6 | low | `apps/web/src/guest/guest-menu.tsx:371-380` (no `look` passed to `MenuNotice` / `MenuSkeleton`); `apps/web/src/faces/chosen-face.tsx:82-100` (the only caller that passes one) | Spec story 38: "the loading, not-found and not-published pages ... drawn in the venue's look, so that I never land on a bare page in another font"; ticket #173: "The host's notices and the D122 sheets draw in the venue's General look" | While the snapshot loads, and when it fails or is not published, the guest page shows the default skeleton or notice in the default font and colours; only the skeleton shown while the renderer's code chunk loads (after the snapshot is in) carries the venue's look. For not-found there is no venue to inherit from; loading, not-published and load-failed know the venue only by its address, so the page has no look to hand them without a change in what it loads first | `notices.test.tsx:64-80` proves the components take a look; no test proves the guest page gives them one; `guest-menu.tsx:371,380` | 0.6 |
| DA-B7-7 | low | `docs/decisions/D122.md:98`, `docs/decisions.md` row D122 (status line cites D124, D126, D127 and decision 129, not 131) | Decision 131: "reverses D22 ... rule 5 allows it"; D122 "Stock": "the menu greys it out for every phone" | The D22 file and the index row for D22 say "superseded by" decision 131, but D122's Stock paragraph (which D124 §6 refines) still states the guest-visible rule that decision 131 replaced, and its status line does not say it was refined by 131. A later reader of D122 alone builds the greyed card again | `rg -i "greys it out" docs/decisions` | 0.8 |
| DA-B7-8 | low | the `design.advanced.simple` message (`apps/web/messages/bg.json`: "Просто"), the Receipt page label (`packages/core/src/design/contract.ts:625`, `bg: 'Бележка'`), `design.myStyles.errors.name_taken` | Ticket #175 strings: "Simple / Основно"; #176: "Receipt / Разписка"; #177: "„Вече има стил с това име. Избери друго име.“" | Three Bulgarian strings differ from the strings the screen plans fixed (and the plans said the option labels were to be "reviewed here on the screen"): the level switch says «Просто» not «Основно», the Receipt page «Бележка» not «Разписка», the name-taken message uses «Изберете» not «Избери». Style names stay «Basic», «Editorial» (the plan's long-text check named „Редакционен“). No wrong meaning; the register and the words are not the ones Martin approved in the tickets | `bg.json` `design.advanced.simple`; `contract.ts:625`; ticket bodies | 0.9 |

## Observations

| id | where | what is true | why it matters |
|---|---|---|---|
| O-B7-1 | `packages/faces/editorial-market/src/design.test.tsx:42`, `apps/web/e2e/visual-fixtures.ts:45,86` | The list of options the never-list sweep and the stored renderings run over (`DRAWN`, `DESIGN_VARIANTS`, `SCREEN_VARIANTS`) is written by hand in three places. Today it equals the contract's 46 choice options (script `drawn-cover.mts`). No test asserts that it does | Story 43 and decision 130: the never-list is tested "on every Style at every value". The next option added to the contract and to the renderer but not to those lists ships unswept |
| O-B7-2 | `apps/web/e2e/faces-design-screens.spec.ts:46` | The five guest-feature screens are swept at 320 and 390 px only. Ticket #173 asks for "the four widths". The spec's comment says the sheets' widest, 640 px, "is held by the stylesheet's own rules" | A criterion with no proof at 820 and 1280 px; the code does cap the sheets |
| O-B7-3 | `staged-options.test.tsx:100-180`, `faces-design.spec.ts:37` | Ticket #174: "Allergen names draw on the row in every layout at 320 px within the floors". The tests draw names with three allergens in Basic's list layout (and Classic, also a list). Names in a two-column card with five allergens, the case the options review asked to prototype first, is neither swept nor drawn anywhere I can find | Criterion with no proof; the CSS wraps (`overflow-wrap: anywhere`, 44 px target), so probably fine |
| O-B7-4 | `apps/web/e2e/design.spec.ts:488-520`, `advanced.test.tsx:173-196` | Ticket #176 asks "one Playwright check per page" for tap-a-part. The browser spec taps four parts (header, sections, items, dish); the other pages are covered by a jsdom unit test over the marker list. All 37 contract markers appear as literals in the renderer's source (script `markers.mts`) | Unit proof exists; the five service pages' parts are not tapped in a real frame |
| O-B7-5 | `packages/shell/testing/design-contract.ts:159-183` | The "every part is drawn" check lists the header, nav, sections, strip, items' parts, footer, switch and order bar. The menu intro, a section's description and a section's image have no marker and are not asserted. Decision 129: "No option hides the intro, a section's description or its image" (story 23). The stylesheet has no rule that hides them (checked: the only `display: none` rules are `[hidden]`, empty state, and the two-column open arrow) | Behaviour right, no test that would catch a future option that hides them |
| O-B7-6 | `packages/shell/src/design/styles/soft.ts:20` | Soft's first departure says in two columns "the renderer keeps the price at 15 px while the name drops to 13.5 px". Since #172's fix (`css.ts:1843-1857`) the price is 13 px under a 13.5 px name at medium. The stated reason for taking `list` instead of the brief's `two` no longer holds | Stale explanation in a Style header the lead reviews; Soft may be able to take `two` after all |
| O-B7-7 | `packages/core/src/snapshot/schema.ts:92` (`SNAPSHOT_MENU_LAYOUTS`), `apps/web/src/connectors/stripe/appearance.ts:20-26`, `card-form-types.ts:22-24`, `apps/web/src/faces/notices.tsx:80` | Ticket #169: "nothing else in the repo lists an option's values". The layout words, density, text size and sheet colours are restated as hand-written unions or tables. All are typed against or compared with the contract's types where it matters (`SPACE` is indexed by the contract's density type), so a changed contract fails typecheck for most | Low risk; the claim is not literally true |
| O-B7-8 | `apps/web/src/design/design-page.tsx:540-548` | Simple shows a fourth and fifth thing beside the Style, colours and fonts: the logo and "Layout for all menus" (admin map: "Change the layout for all menus, 3 taps"). Decision 129 says "Simple is three things" and story 15 puts the layout on the Items page | A UX choice nobody recorded; Advanced's Items page also has the two as tile rows |
| O-B7-9 | spec #168 ("The Studio page") vs `apps/web/src/design/design-frame.tsx:1-14` | The spec says the preview is "in-page ... no iframe, no message passing"; the pin uses an iframe (`design/frame`) that reads the Design page's store through `window.parent` (same origin). Ticket #175's stop-and-ask recommended exactly this ("an iframe without message passing") | Spec text and code differ; decided by the ticket |
| O-B7-10 | `packages/core/src/theme/derive.ts:126`, `design.roles.disabled_text.help` ("Sold-out and switched-off items") | The `disabled_text` role is shown (read-only) in Advanced roles and its help names sold-out items, which are never drawn now; nothing in the renderer reads any of the ten extended roles (only the eight base roles reach `--rm-*`; `model.ts:210-219`). Pre-existing (the roles panel says they "cannot be set by hand") | A label for a colour nothing paints |
| O-B7-11 | `packages/shell/src/build.test.ts:653` | A test is titled "defaults to qr, Europe/Sofia, ordering off and sold-out items shown"; sold-out items are never shown. The body does not assert the last part | Stale title |
| O-B7-12 | `docs/guides/menu-template-functionality.md:23-27` | The "See only what can be had" entry (written for decision 131) is accurate against `build.ts:139-155,274`: sold-out and unavailable items are dropped, their names kept in `hiddenItems` for an order, the filters and allergen legend are built from what is shown (`build.test.ts:389`), a section left empty goes (`:319`) | Confirms the decision where it was applied |

## 1. Acceptance criteria, ticket by ticket

"proof" is a test path:line or e2e spec on the pin. "none" = no proof; the code column says whether the code does it.

### Spec #168 (stories and implementation text)

| statement | proof | code does it |
|---|---|---|
| Studio tab with Structure and Design; Guest functions stay a card | `apps/web/e2e/composer.spec.ts:175` | yes |
| Design is a full page, preview with Phone / Tablet / PC, phone first | `design.spec.ts:164`, `:599` | yes (iframe, see O-B7-9) |
| Style tiles drawn in the owner's colours and fonts; picking one sets every option and keeps colours, logo, body font | `design.spec.ts:232`; `design-draft.test.ts:66-97`; `preview-snapshot.test.ts:71-81` | yes |
| Harmony suggestions, Advanced roles, never unreadable | `design.spec.ts:292`; `design-record.test.ts:319`; `actions.test.ts:201` | yes |
| Six Cyrillic fonts, body and heading | `design.spec.ts:271`; `staged-options.test.tsx:281-386` | yes |
| Logo beside the colours | `design.spec.ts` (Simple panel) / `logo-field.tsx` | yes (no dedicated test of position) |
| General holds screen, heading weight, corners, depth, density, text size, buttons as tiles | `advanced.test.tsx:162` | yes |
| One page per component (13) with decision 130's options, from the contract | `advanced.test.tsx:99,110,289`; `design.spec.ts:443` | yes |
| Tap a part opens its page; in Simple "Styled in Advanced" with a switch | `advanced.test.tsx:173,186,197`; `design.spec.ts:488` | yes (4 of 14 pages in a real frame, O-B7-4) |
| Layout and guest switch on the Items page, applying to every menu; section's own layout wins; strips never switch | `renderer-rules.test.tsx:426-468`; `design.spec.ts:416` | yes (also a Simple card, O-B7-8) |
| Cards/rows/open, name size/weight/case, price place, portion place, description lines | `design.test.tsx:344` (every value changes markup or stylesheet); `renderer-rules.test.tsx:126-170` | yes |
| Photo shape, fit, backdrop, frame, corners; bleed has no corners, disabled row with hint | `renderer-rules.test.tsx:326-380`; `advanced-model.test.ts:32`; `design.spec.ts:522` | yes |
| Allergens as numbers or names, never behind one button only | `staged-options.test.tsx:100-166` | yes |
| Dish page sheet or page; hero or small | `staged-options.test.tsx:182-280`; `renderer-rules.test.tsx:394-425` | yes |
| Five screens styled; take colours, fonts, corners, buttons from General | `screen-options.test.tsx:267-690` | yes |
| Preview draws the five screens with demo data under "Preview" | `preview/demo-services.test.tsx`; `frame-stage.test.tsx:58-120`; `design-parts.test.tsx` | yes |
| Intro, section description, section image never hidden by an option | none (O-B7-5) | yes |
| Undo takes back the last step; Cancel throws away everything; Done saves the whole design | `design-draft.test.ts:159-198`; `design-page.test.tsx:163`; `design.spec.ts:212,325,340` | yes |
| Start over by picking the Style again | `design-draft.test.ts:83` | yes |
| Stale save refused with message, page reloads the stored design | `design.spec.ts:366`; `design-page.test.tsx:195`; `design-record.test.ts:292,308`; `actions.test.ts:169,186` | yes |
| My styles: save, update, delete (Undo), copy between venues; values only | `my-styles.test.tsx:115-260`; `design-styles.test.ts:105-290`; `saved-style.test.ts:33-114`; `design.spec.ts:661,704` | yes |
| A saved design looks the same after a new option or a changed premade Style | `record.test.ts:72`; the design stores values, not a link | yes |
| Reaches guests on the next publish | `design.spec.ts:541`; `look.test.ts:201` | yes |
| Existing venues keep colours, font, logo, screen, layout on Basic | `design-migration.test.ts:202-328` | yes |
| Guest: 320 px, names uncut, 12 px text, 44 px targets, readable pairs, no sideways scroll | `shell/testing/design-contract.test.ts:98-199` (markup, text floors); `faces-design.spec.ts:26-67` (browser, four widths) | yes |
| Price in the ink, never struck, never under the description; allergens on the row | `design-contract.test.ts:118-152` | yes |
| Sold out / unavailable not in the menu | `build.test.ts:255,303,319,389`; `sold-out.spec.ts:205` | yes |
| Closed note, table label, language switch, every guest-feature control in every Style | base contract cases inside `runDesignContract` (`design.test.tsx:179`) | yes |
| Bill, Order, Pay quote, Receipt show every line and amount as the till gives them | `screen-options.test.tsx:267-300` (texts of every screen at every value) | yes |
| Loading, not-found, not-published pages in the venue's look | `notices.test.tsx:64` (components only) | partly (DA-B7-6) |
| Stripe card form carries colours, font, corners, density; wallets keep their own look | `appearance.test.ts:43-119`; `card-form.test.ts:193-310` | yes (venue font gap is #281, known) |
| One contract file; a test equal to the decision's table | `scripts/design-contract.test.ts:68-117` | yes |
| Never-list on every Style at every value | `design.test.tsx:179` | yes (list is hand-written, O-B7-1) |
| A new option never changes an existing look | `design.test.tsx:221-270` | yes for views; not for published snapshots (DA-B7-2) |
| Club first (T87) | `docs/deliverables/2026-10-31-soft-classic-club-*.md`; `clubStyle` in the Style files | yes |
| `presentation.face`, per-face options gone from new snapshots; `soldOutDisplay` default hide, `show` removed | `design-record.test.ts:373`; `look.test.ts:94`; `build.test.ts:303` | yes |
| `scheduled` leaves the supported list and the never-list | `design-contract.test.ts:199`; functionality file | yes |
| Stripe appearance as a pure function | `appearance.test.ts:43-119` | yes |
| Migration: no venue moved onto Editorial | `design-migration.test.ts:281` | yes |

### #169 contract file, guard, Basic and Editorial

| criterion | proof |
|---|---|
| 14 pages, 48 options, values, Basic first, markers, bilingual labels | `scripts/design-contract.test.ts:68,75,117,132,153` |
| Basic and Editorial exist, pass validation, Editorial's header lists its departures | `:213,:230,:236`; `shell/src/design/design.test.ts:82` |
| Guard fails on a planted difference, a value outside its list, a missing label | `:79,:93,:157,:173,:248,:256,:264,:276,:292` |
| Shell exports the contract and a schema; nothing else lists values | export proved by `shell/src/design/design.test.ts:37-70`; second half none (O-B7-7) |

### #170 design record, snapshot block, migration

| criterion | proof |
|---|---|
| A save appends one event with provenance, writes the record; stale refused with the stored record; three old writers gone, guardrail | `design-record.test.ts:218,252,292,308`; `actions.test.ts:135,186`; `scripts/design-writers.test.ts:130-163` |
| Snapshot carries the `design` block, `layout` from the design, no `presentation.face`; schema refuses off-contract values; leak guard | `design-record.test.ts:373`; `layout.test.ts:113`; `look.test.ts:103,275,292,298`; refusal of a value off the list `design.test.ts:49` |
| Migration yields Basic with carried values, mapped corners and depth; guest draws as before | `design-migration.test.ts:202-328` (the mapping in `0045_design_record.sql` agrees with `record.ts` `nearestWord`, ties to the larger: checked by hand) |
| RLS keeps the record to its organisation; property round trip | `design-record.test.ts:352,439` |

### #171 renderer, General, harness, qr-phone retired, sold out hidden

| criterion | proof |
|---|---|
| Every General option at every value, four widths, no breach; harness fails on a planted breach | `design.test.tsx:179`; browser `faces-design.spec.ts:26-67`; planted: `design-contract.test.ts:103-199` |
| Basic plain; Editorial equals today except its listed departures | `design.test.tsx:225,273,307,316` (against real "today" files in `__renderings__/today`) |
| Acceptance guide names Martin's check; ordering and paying specs run on both Styles | guide section B (`2026-10-30-menu-designer-acceptance-guide.md:23`); `guest-order.spec.ts:39`, `guest-send.spec.ts:86`, `guest-pay-card.spec.ts:61`, `guest-pay-return.spec.ts:34`, `guest-pay-first.spec.ts:240` over `ORDER_STYLES` |
| Stored-rendering test exists; a throwaway option leaves it green | `design.test.tsx:221-270` |
| `qr-phone` gone from repo and registry; contract cases on the renderer | one directory under `packages/faces`; `registry.test.ts`, `manifests.test.ts`, `contract.test.tsx` |
| Sold out absent from page and view model; `show` gone; sold-out spec updated | `build.test.ts:255,303,319`; `sold-out.spec.ts:205` |
| (body) fixtures stop writing `presentation`; page notices off `qr-phone`; `menus.settings` dropped | `rg presentation` in the three seed files is empty; `faces/notices.test.tsx`; migration `0046_drop_menu_settings.sql`, `rg "menus.settings"` empty |

### #172 browsing options

| criterion | proof |
|---|---|
| Every option at every value, four widths | `design.test.tsx:179`, `faces-design.spec.ts:26` |
| A test per renderer rule (price size, band pair, two-column parts, 16:7 image, backdrop, bleed) | `renderer-rules.test.tsx:126,140,157` / `:175,:193,:202` / `:228,:259` / `:272` / `:326-352` / `:354-374` |
| Layout and guest switch from the design; strips never switch | `renderer-rules.test.tsx:426-468` |
| Basic and Editorial equal stored renderings | `design.test.tsx:225-232` |
| Not listed in the ticket but a decision 130 rule: rail alignment follows the header, marks' place derived, one stepper | no named test (CSS at `css.ts:1577-1600`; one `Stepper` component in `services/parts.tsx`) |

### #173 five screens and the Stripe mapping

| criterion | proof |
|---|---|
| Every option at every value, services on, four widths; fixed words, states, amounts, 40 px reference unchanged | `screen-options.test.tsx:267-300`; browser only at 320 and 390 (O-B7-2) |
| Ink-on-ink inverts | `screen-options.test.tsx:591,619,643`; `design.test.tsx:198` |
| Host notices and D122 sheets draw in General's look | `notices.test.tsx:25-62` (look), sheets by CSS tokens (`services-css.test.ts`); the page itself does not hand the look to its loading and error states (DA-B7-6) |
| Appearance mapping tested for both screens; wallets keep their look | `appearance.test.ts:43,119`; `card-form.test.ts:240-310` |
| Basic and Editorial still equal stored renderings | `design.test.tsx:225-232` |

### #174 staged options

| criterion | proof |
|---|---|
| Names on the row in every layout at 320 px, sheet behind, footer lists names | `staged-options.test.tsx:100-180` (one layout, three allergens): partly, O-B7-3 |
| Dish page as sheet or page keeps route, Back, focus, dialog rules | `staged-options.test.tsx:182-280`; `use-dish-route.test.tsx` |
| Heading font loads and applies to headings and names only; weight fallback tested | `staged-options.test.tsx:281-386` |
| Stored renderings equal | `design.test.tsx:225` |

### #175 Studio and Design in Simple

| criterion | proof |
|---|---|
| Tabs read Studio > Structure / Design; old URLs redirect; admin map revised | `composer.spec.ts:175`; `workspace-tabs.test.tsx`; map revised in part (DA-B7-4) |
| Full page, panel, preview, switcher; at 390 px preview under the panel, Done and Cancel reachable | `design.spec.ts:164,599` |
| Tile fills every option and keeps brand; Undo; Done appends one event; Cancel leaves the design | `design.spec.ts:212,232,325,340`; `design-draft.test.ts` |
| Stale save refused, page reloads (two sessions) | `design.spec.ts:366` |
| Read-only for a role that may not manage | `design.spec.ts:571`; `design-page.test.tsx:256` |
| Target taps; both languages; 44 px | `touch-targets.spec.ts:239,255`; `design.spec.ts:741,776`; tap counts have no counting test |

### #176 Advanced

| criterion | proof |
|---|---|
| General and the 13 pages, tiles drawn in the draft's colours, one Undo step | `advanced.test.tsx:99,110,128`; `design.spec.ts:443` |
| A tap on each marked part opens its page (one Playwright check per page) | unit `advanced.test.tsx:173,186`; browser four pages only (`design.spec.ts:488`), O-B7-4 |
| Disabled rows with hint, announced | `advanced.test.tsx:218,241`; `design.spec.ts:522` |
| Simple and Advanced keep the draft | `advanced.test.tsx:149` |
| A planted contract option appears as a row | `advanced.test.tsx:289` |
| Target taps, both languages, 44 px tiles | `design.spec.ts:776`; `touch-targets.spec.ts` |

### #177 My styles

| criterion | proof |
|---|---|
| Save as a style (values only), appears in every venue of the organisation | `my-styles.test.tsx:164`; `saved-style.test.ts:33-64`; `design.spec.ts:661,704` |
| Update and Delete with undo; neither changes a venue's design | `design-styles.test.ts:140,206`; `my-styles.test.tsx:206,222` |
| Each venue's design in use listed with its name; picking keeps own brand | `my-styles.test.tsx:153,253`; `design.spec.ts:704` |
| Saves, updates, deletes, restores through apply with an event each; RLS | `design-styles.test.ts:105-290`; `packages/db/tests/design-styles-table.test.ts:58-132` |
| Taps, strings, 44 px | `design.spec.ts:741`; tap counts: none |

### #178 Soft, Classic, Club

| criterion | proof |
|---|---|
| Skills rewritten for Styles, name the contract, the file format, the never-list, Martin's acceptance; `template.md` matches | `.claude/skills/template-design/SKILL.md:34,72,87`, `template-review/SKILL.md:17,43`, `restro-flow/template.md:5,30-35` (read, no test) |
| Three Style files valid, pass the harness and the stored renderings; brief and review note | `scripts/design-contract.test.ts:213-236`; `design.test.tsx:179,221`; `docs/deliverables/2026-10-31-soft-classic-club-briefs.md`, `-review.md` |
| Tiles and preview in the venue's colours and font; Martin's acceptance | `design.spec.ts:232`; Martin's word is in a pull request, outside what I can see |
| `heavy` fallback listed | `staged-options.test.tsx:348,355` (Manrope 800, Lora 700 listed); no premade Style header needs it |

### #239 ordering on the renderer

| criterion | proof |
|---|---|
| Editorial in the shared-order set; table link shares the order | `guest/table-services-page.test.tsx:281` (`SHARED_ORDER_FACES` is `['editorial-market']`) |
| Default and only template; ordering off for an unbound template; both sides pinned | `faces/manifests.test.ts`; `guest/table-services-page.test.tsx`; `guest/guest-menu.test.tsx:475` |
| Bill, Pay, Call a waiter reach the server end to end | `guest-pay-return.spec.ts:34`, `guest-pay-card.spec.ts:61`, `guest-features.spec.ts` (Basic and Editorial) |
| Tenancy and guest attack checks against the renderer | `apps/web/src/guest/bound-template-attack.test.tsx` |
| Specs on Editorial as well | `ORDER_STYLES` in `e2e/guest-faces.ts:12` |
| Report with the parity list, the walk | outside the repo (pull request body) |
| Functionality file ordering entries drawn on Editorial | doc edited (stale "hidden reference template", DA-B7-3) |

### #258 pay first at Send

| criterion | proof |
|---|---|
| "Send and pay" once, bill part and pay-first part, card held first | `services/pay-first.test.tsx:66-90`; `guest-pay-first.spec.ts:240` |
| Only pay-first lines can Send; "Pay later" | `pay-first.test.tsx:189-215,335-365` |
| No tip row where the till cannot record a tip; no pay-first payment when `payFirst` is paused or off | `:155-170`, `:215-268` |
| Each ended screen drawn with its fixed words | `:280-312`, `:382-425` (`r_enter_refused`, `r_item_unavailable`, `r_pay_first_unpaid`) |
| Spec drives the screen on both Styles | `guest-pay-first.spec.ts:240-250` |
| Rule 8: faces do no money arithmetic | guardrail `faces-money-math-only-in-preview` (`.dependency-cruiser.cjs:288`); amounts from `planPayFirst` in the shell (`pay-first.ts`, `sumSignedMinor`) |

## 2. Decisions 128 to 131, and the ones they change

| statement | code | verdict |
|---|---|---|
| 128: one renderer, one option list; a Style is a preset; Basic is the base; Editorial reproduces Editorial Market; no venue moved onto Editorial | one face (`packages/faces/editorial-market`); `PREMADE_STYLES` (5 files); `basic.ts` header "Its value for each option is the first value"; migration `0045` sets `'style', 'basic'` and `design-migration.test.ts:281` | holds |
| 128: a Style gives a value to every option, heading font and screen included, never colours, roles, logo, body font | `design/schema.ts:36` `StyleValuesSchema` drops `brand` options; `scripts/design-contract.test.ts:276` | holds |
| 128: premade Styles are Basic, Editorial, Soft, Classic, Club | `contract.ts:102-114`, Style files | holds |
| 128: a new look is first an option for every Style, with a test that no existing look changes; Editorial's code becomes the renderer; `qr-phone` retires | `design.test.tsx:221-270`; `ls packages/faces` | holds for views; DA-B7-2 for published snapshots |
| 129: Studio tab, Structure and Design; Design is a full page, editing panel left, preview right, phone first | `design-page.tsx:584-586` (preview beside the panel, `DesignPreview`), `composer.spec.ts:175` | holds |
| 129: one design per venue; layout and guest switch move into it; a section's own layout wins; strips never switch | `designLayoutOf` (`build.ts:127`), `menu-bar.tsx:6`, `renderer-rules.test.tsx:426-468` | holds |
| 129: Simple is three things (Style, colours, fonts) | `design-page.tsx:540-548`: also the logo and a layout card | differs slightly (O-B7-8) |
| 129: Done saves the whole design, Cancel throws it away, Undo one step, no per-setting reset; a stale save is refused and the page reloads, no choice, no locks | `design-page.test.tsx:163,195`; `design-draft.test.ts:159`; `design-record.test.ts:292` | holds |
| 129: a later change to a premade Style or a new option never changes a saved design | `record.ts:136` (`withNewOptions`: a missing option reads as its first value); saved Style stores values | holds for the record; DA-B7-2 for the snapshot |
| 129: My styles named, updated, deleted; the design in use at each venue listed; one-time copy | `my-styles.test.tsx`, `design-styles.test.ts` | holds |
| 129: content is content (no option hides the intro, a section's description or image) | no `display: none` or clamp on them in `css.ts` (scanned); no test | holds, unproved (O-B7-5) |
| 129: saves go through `core.apply` with provenance (rules 1 and 2) | `apply.ts:1651-1677`, `design-writers.test.ts`, `record.ts:66-76` (layer manual, source manual, actor member or system, job) | holds |
| 130: the table of 48 options on 14 pages, Basic's values first | `scripts/design-contract.test.ts:68-117` (guard); my script reads 14 pages, 48 options, 46 choice options, 128 values | holds |
| 130: renderer rules: price one step under the name | `renderer-rules.test.tsx:126-170`; but `css.ts:215-223` with `:1074` at name size `l` in two columns: price 16 px, name 14 px | differs in one cell (DA-B7-5) |
| 130: an ink button on an ink surface inverts | `css.ts:277` (`.rm[data-buttons="ink"] .rm-overlay-panel:not(.is-detail)`), `design.test.tsx:198`, `screen-options.test.tsx:591-690` | holds |
| 130: two-column cards draw the choices summary and extra fields | `renderer-rules.test.tsx:228-270` | holds |
| 130: with allergen names the footer lists names | `staged-options.test.tsx:135` | holds |
| 130: pills on a band use the band's pair | `renderer-rules.test.tsx:174-227` | holds |
| 130: the host's notices and the consent and last-orders sheets inherit General | `faces/notices.tsx:87-116` (`noticeLook`), sheets use tokens (`screen-options.test.tsx:543`) | holds in the chunk-loading case; the page's own loading and error states take no look (DA-B7-6) |
| 130: compact bill lines keep the 12 px floor | `screen-options.test.tsx:345` | holds |
| 130: rail follows the header; marks' place derived; one stepper | `css.ts:1597-1600`; `services/parts.tsx` `Stepper` | holds, no named test |
| 130: never-list on every Style at every value | `shell/testing/design-contract.ts`; `design.test.tsx:179` (`report.cases >= 84`) | holds (hand-written option list, O-B7-1) |
| 130: Stripe takes General's colours, body font, corners and density; wallets keep their look | `appearance.ts:97-152` | holds (card form still lacks the venue font file: #281, known) |
| 130: values lost (header band accent, depth high, call kinds words, bill rows open) | contract has none of the four; Soft's and Classic's headers list the two they wanted | holds |
| 131: sold-out and unavailable items are not drawn; `soldOutDisplay` default `hide`, `show` removed | `build.ts:139-155,274`; `context.ts:19,88` (`SOLD_OUT_DISPLAYS = ['hide']`); `build.test.ts:303` | holds |
| 131: hidden everywhere on the guest side: sections, strips, filters, allergen legend, bag, bill | `viewItem` is the only way an item enters `view.sections`; `collect()` reads `view.sections`; `bag.ts:311` and `bag-sheet.tsx:36,219-257` show a line already on the order by its hidden name, marked, which decision 131 keeps ("Orders and bills are unchanged") | holds |
| 131: no search or featured block draws a hidden item | the guest page has no search; strips read `view.sections`; the filter chips are built from shown items (`build.ts` `collect`, test `build.test.ts:389`) | holds |
| 131: staff screens still see it ("Sold out tonight" stays) | `sold-out.spec.ts:205-278` | holds |
| 131: the closed-menu note stays; scheduled out of scope, state code stays | `build.ts:116-134` still sends `scheduled`; functionality file; `design-contract.test.ts:199` | holds |
| 131: "A line that goes sold out ... still makes the order 'Not sent' (D116), a sold-out line cannot be ticked at Pay (D117)" | `stock.ts:24-27`; `bag-sheet.tsx:219`; `provider.tsx:382-412` | holds |
| 131 supersedes D22: D22's file says so | `docs/decisions/D22.md:2` (its status line names decision 131 as superseding it, "sold-out items are hidden"); `decisions.md` D22 row the same; glossary "Sold out" rewritten | holds |
| 131 and nothing still follows the old rule | staff notice, item-sheet help text, D122 Stock paragraph, D93-era `disabled_text` help | **does not hold** (DA-B7-1, DA-B7-7, O-B7-10) |
| D69, D92, D105 carry "superseded / revised / refined by 128 or 129"; D122 "refined by 129" | the four status lines | holds (D122 lacks 131, DA-B7-7) |

## 3. The options, by script

Script: `scratchpad/b7/options-audit.mjs` (appendix). It imports the contract file itself, evaluates the five Style files, and greps the renderer's non-test source (`packages/faces/editorial-market/src`), the shell and `apps/web/src/{guest,connectors,faces}` for each option's data attribute (the renderer writes `data-<option>` for General and `data-<page>-<option>` for the other pages, `model.ts:237-247`), for `[attr="value"]` selectors per value, and for `design.<page>.<option>` reads. Companion scripts: `drawn-cover.mts` (are the sweeps' option lists equal to the contract's), `markers.mts` (does the renderer emit every contract marker), `labels.mts` (both languages for every label).

Result: **46 of 46 choice options are read; `style` and `colours` are record fields, not renderer reads; 0 options nothing reads.** Three options have no data attribute in the stylesheet and reach the page another way:
- `general.screen`: through `theme.scheme` (`designThemeOf`, `record.ts:238`; `face.tsx:203` `data-scheme`);
- `items.layout` and `items.guest_switch`: through `snapshot.layout` (`designLayoutOf`, `build.ts:127`), read by `use-layout.ts` and `layout-switch.tsx`.

Each of the 45 options a Style sets has a value in all five Styles (no "MISSING"); `body_font` is the venue's brand, no Style sets it, Basic's `inter` is the default. The snapshot schema holds one enum per option, built from the contract (`design/schema.ts:17-33`), so (d) is true for all by construction; `look.test.ts:292,298` and `scripts/design-contract.test.ts` pin it. The Design page draws a tile row for every choice option from the contract (`advanced-model.ts:131`, `advanced.test.tsx:110`), so (c) is true for all; Simple gives the Style, both fonts and the colours their own controls. Every non-first value makes the markup or the resolved stylesheet differ from Basic's (`design.test.tsx:344`).

Values that no premade Style uses, reachable only through Advanced (the e2e sweep draws each one anyway): `general.screen light`, `general.heading_font inter/manrope/montserrat/lora`, `general.corners extra`, `general.text_size large`, `header.title_size s`, `header.logo_size s`, `sections.title_size s`, `sections.strip_card_size s`, `items.name_size s`, `items.layout one`, `photos.shape wide/portrait`, `photos.fit contain`, `photos.backdrop tint/white/none`, `photos.corners square/round`, `dish.photo small`.

The per-option table (generated):

| option | values | five Styles | reaches the page by | design page | snapshot |
|---|---|---|---|---|---|
| general.screen | 3 | all 5 | theme/layout path | Advanced tile row | enum from contract |
| general.body_font | 6 | brand (venue font), Basic inter | attr read | Advanced tile row | enum from contract |
| general.heading_font | 7 | all 5 | attr read | Advanced tile row | enum from contract |
| general.heading_weight | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| general.corners | 4 | all 5 | attr read | Advanced tile row | enum from contract |
| general.depth | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| general.density | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| general.text_size | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| general.buttons | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| header.band | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| header.arrangement | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| header.title_size | 4 | all 5 | attr read | Advanced tile row | enum from contract |
| header.logo_size | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| navigation.marker | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| navigation.band | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| sections.header | 4 | all 5 | attr read | Advanced tile row | enum from contract |
| sections.title_size | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| sections.title_case | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| sections.strip_card_size | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| items.frame | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| items.name_size | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| items.name_weight | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| items.name_case | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| items.price_place | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| items.portion_place | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| items.description_lines | 4 | all 5 | attr read | Advanced tile row | enum from contract |
| items.layout | 3 | all 5 | theme/layout path | Advanced tile row | enum from contract |
| items.guest_switch | 2 | all 5 | theme/layout path | Advanced tile row | enum from contract |
| photos.shape | 4 | all 5 | attr read | Advanced tile row | enum from contract |
| photos.fit | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| photos.backdrop | 4 | all 5 | attr read | Advanced tile row | enum from contract |
| photos.frame | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| photos.corners | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| labels.labels | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| labels.allergens | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| dish.kind | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| dish.photo | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| sheets.sheets | 3 | all 5 | attr read | Advanced tile row | enum from contract |
| call.kinds | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| bill.rows | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| bill.lines | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| order.add_control | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| order.order_bar | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| order.line_photos | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| pay.tip | 2 | all 5 | attr read | Advanced tile row | enum from contract |
| receipt.venue_block | 2 | all 5 | attr read | Advanced tile row | enum from contract |

## 4. Words

Script `words-audit.mjs` (message trees, pin against `origin/or/foundation`) and `labels.mts` (contract labels).
- **Keys:** `bg.json` and `en.json` hold the same 2,139 keys (`apps/web/src/i18n/messages.test.ts` pins parity and placeholders). The wave added 58 keys and removed 63; 0 added keys have no Latin words left over in Bulgarian, 0 are identical to English. Added keys are all used (the one my static check could not see, `design.layout.layouts.two`, is reached through `layouts.${word}`, `design-page.tsx:199`). No removed key is still asked for by a static `t('...')` call in the files the wave touched (my static check has false positives from files with two translators; I resolved the design namespaces by hand).
- **Contract labels:** every page, option and value has `en` and `bg`; the only Bulgarian labels with no Cyrillic are the five Style names and the six font names (names, as `copy-rules.md` allows). `scripts/design-contract.test.ts:153-180` holds this.
- **Spec strings against the code:** three differ (DA-B7-8). Everything else in the #175, #176 and #177 string lists matches the messages (checked one by one).
- **Shell guest strings** added by the wave (`allergensHintNames`, `footerTextNames`, `add`, `notUntilPaid`, `sendAndPay`) exist in en and bg; no English in the Bulgarian ones.
- **Glossary:** Studio, Structure, Design, Style, Basic, Guest page are defined as the interface uses them; the interface no longer says "Composer" or "template" to an owner (only `devFields.description`, a dev page, and `user.theme`, the admin's own light/dark choice). "Item schema" still says _Avoid: template, style_, which is right for the item schema. The acceptance guide still says "Composer" once (DA-B7-4).
- **Guides the wave changed** (`git diff --stat origin/or/foundation...7dccd3a4 -- docs/guides`: admin-map, functionality file, designer guide): see DA-B7-3 and DA-B7-4. The functionality file's new text for sold out, allergens and the layout matches the code (O-B7-12); its three "hidden reference template" lines are stale.

## 5. Three layers and rule 3

`rg -i "barsy|mistral|lukanet|\bpos\b|\btill\b|article_name|cat_name|pos_id"` over `packages/core/src/design`, `packages/shell/src/design`, `shell/testing/design-contract.ts`, `apps/web/src/design`, `apps/web/src/server/design`, the studio route, `card-form-look.ts` and `appearance.ts` (non-test) finds three hits, all comments (`record.ts:62` "never a till's", `design-page.tsx:14` "A POS venue and a hand-made venue both get this page"). The design record carries colours, roles, logo asset id, the 46 values, Style id, revision and provenance (source `manual`); a Style file and a saved Style carry only values; a copy carries values, never the logo (`saved-style.test.ts:52`, `my-styles.test.tsx:153`). The snapshot's design block is the contract's enums only and the leak guard allows nothing else (`look.test.ts:275-313`). Guardrails: `scripts/vendor-words.test.ts` and the baseline, the leak guard, `design-writers.test.ts`. **No finding.**

## What I could not cover

- I did not run any test; every "proof" is that the assertion exists and CI is green on the pin. I did not mutate the guards to see them fail (that is step 8).
- Martin's acceptance of Soft, Classic and Club, the parity list of #239 and the walk reports live in pull-request bodies and his words; I did not read the pull requests.
- The values of Soft, Classic and Club against the briefs and the options spec's section 4 table: I read the headers and the departures, not each of the 45 values against the table. The review file `2026-10-31-soft-classic-club-review.md` is the lead's check.
- Whether a value looks good, a floor holds in a real browser, the renderings: other steps.
- Options spec section 3 of each ticket (`2026-10-27-menu-design-options-spec.md`) beyond what the tickets and decisions quote.
- The brief's "60 options": see the note under the header.

## Appendix: scripts

All in `C:/Users/Martin/AppData/Local/Temp/claude/E--Restro/431635f7-7037-4fc0-a8b3-62042a7942bc/scratchpad/b7/` (run with `node --experimental-strip-types <script> E:/Restro/.claude/worktrees/da-pinned`): `options-audit.mjs` (below), `words-audit.mjs`, `keys-used.mjs`, `labels.mts`, `markers.mts`, `drawn-cover.mts`, `count.mts`.

```js
// B7 option audit (read-only). Usage: node --experimental-strip-types options-audit.mjs <pin-worktree>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = process.argv[2]
const scratch = path.dirname(fileURLToPath(import.meta.url))
const slash = (p) => p.split(path.sep).join('/')

// 1. the contract (pure data; copied so Node can import it)
fs.copyFileSync(path.join(root, 'packages/core/src/design/contract.ts'), path.join(scratch, 'contract.mts'))
const { DESIGN_PAGES } = await import(pathToFileURL(path.join(scratch, 'contract.mts')).href)

// 2. the five Style files (strip imports and types, evaluate)
const styles = {}
for (const id of ['basic', 'editorial', 'soft', 'classic', 'club']) {
  let t = fs.readFileSync(path.join(root, 'packages/shell/src/design/styles', id + '.ts'), 'utf8')
  t = t
    .replace(/^import .*$/gm, '')
    .replace(/export const (\w+) =/, 'const S =')
    .replace(/as const satisfies StyleFile/, '')
  styles[id] = new Function(t + '; return S')()
}

// 3. sources (non-test)
function walk(d, out = []) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name === 'node_modules') continue
    const p = path.join(d, f.name)
    if (f.isDirectory()) walk(p, out)
    else if (/[.](ts|tsx|css)$/.test(f.name) && !/[.]test[.]/.test(f.name) && !/test-/.test(f.name) && !slash(p).includes('/preview/')) out.push(p)
  }
  return out
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const faceDir = path.join(root, 'packages/faces/editorial-market/src')
const faceRaw = walk(faceDir).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const face = stripComments(faceRaw)
const other = [
  ...walk(path.join(root, 'packages/shell/src')),
  ...walk(path.join(root, 'apps/web/src/guest')),
  ...walk(path.join(root, 'apps/web/src/connectors')),
  ...walk(path.join(root, 'apps/web/src/faces')),
]
  .filter((f) => !slash(f).includes('shell/src/design/'))
  .map((f) => [f, stripComments(fs.readFileSync(f, 'utf8'))])

const rows = []
for (const page of DESIGN_PAGES) {
  for (const o of page.options) {
    if (o.kind === 'colours') {
      rows.push({ page: page.id, id: o.id, note: 'colours: theme palette and roles, not a design value' })
      continue
    }
    if (o.kind === 'style') {
      rows.push({ page: page.id, id: o.id, note: 'style: a record field' })
      continue
    }
    const attr = 'data-' + (page.id === 'general' ? '' : page.id + '-') + o.id.replace(/_/g, '-')
    const ids = o.values.map((v) => v.id)
    const attrRead = face.includes(attr)
    const tsPath = new RegExp('design[?]?[.]' + page.id + '[?]?[.]' + o.id + '\\b')
    const tsRead = tsPath.test(face)
    const perValue = ids.map((v) => {
      const sel = face.includes(`[${attr}="${v}"]`) || face.includes(`[${attr}='${v}']`)
      return sel ? 'css' : '-'
    })
    const styleVals = {}
    for (const s of Object.keys(styles)) {
      const val = styles[s].values?.[page.id]?.[o.id]
      styleVals[s] = val === undefined ? (o.brand ? '(brand)' : 'MISSING') : val
    }
    const others = other
      .filter(([, t]) => t.includes(attr) || tsPath.test(t))
      .map(([f]) => slash(path.relative(root, f)))
    rows.push({ page: page.id, id: o.id, attr, ids, attrRead, tsRead, perValue, styleVals, others })
  }
}
let unread = 0
for (const r of rows) {
  if (r.note) {
    console.log(`${r.page}.${r.id}: ${r.note}`)
    continue
  }
  const sv = Object.entries(r.styleVals).map(([s, v]) => `${s.slice(0, 3)}=${v}`).join(' ')
  const verdict = r.attrRead || r.tsRead || r.others.length ? 'READ' : 'NOTHING-READS-IT'
  if (verdict !== 'READ') unread++
  console.log(
    `${r.page}.${r.id} ${verdict} attrInFace:${r.attrRead} tsInFace:${r.tsRead} vals[${r.ids.map((v, i) => v + ':' + r.perValue[i]).join(' ')}] styles[${sv}] other[${r.others.join(',')}]`,
  )
}
console.log('options with no reader:', unread)

// ---- markdown rows for the report ----
console.log('\n| option | values | five Styles | value reach (css/ts per value) | design page | snapshot |')
const unusedValues = []
for (const r of rows) {
  if (r.note) continue
  const used = new Set(Object.values(r.styleVals).filter((v) => v !== '(brand)' && v !== 'MISSING'))
  const unused = r.ids.filter((v) => !used.has(v) && !(r.styleVals.basic === '(brand)'))
  if (unused.length) unusedValues.push(`${r.page}.${r.id}: ${unused.join(', ')}`)
  const missing = Object.entries(r.styleVals).filter(([, v]) => v === 'MISSING').map(([s]) => s)
  console.log(`| ${r.page}.${r.id} | ${r.ids.length} | ${missing.length ? 'MISSING in ' + missing.join(',') : r.styleVals.basic === '(brand)' ? 'brand (venue font), Basic inter' : 'all 5'} | ${r.attrRead ? 'attr read' : r.others.length ? 'via ' + r.others.join(',') : 'theme/layout path'} | Advanced tile row | enum from contract |`)
}
console.log('\nvalues no premade Style uses (reachable only in Advanced):')
for (const u of unusedValues) console.log('  ' + u)

```
