# Lane 2 (Design + guest menu): findings

Round: `docs/reviews/2026-11-18-screen-round/round-brief.md` (D146). Branch `claude/sr-design-ab1457`, cut from `sr/foundation` at `3496366e`. Personas: owner (Studio › Design: Simple, Advanced, My styles), guest (menu and dish pages, `editorial-market`). Environment: database `restro_lane2`, web `http://lane2.localhost:3120`, worker health 8121, sim-pos 4720 (`club-biad`). Open issues already filed for the area: #448 (dish sheet with ordering off repeats name and price), #190 (flaky touch-targets e2e on the Design subtab).

Row ids: `S<n>` from the explorer, `R<n>` the reviewer's own, `C<n>` the code check, `X<n>` the security check.

## Code check (code-review high, Fable)

### C1. A dish the guest taps open is never reported as opened; only a deep link or a reload is
- Kind: bug
- Screen: `/m/<address>` with a table code (`apps/web/src/guest/guest-menu.tsx`), guest, n/a, n/a, n/a
- Steps: At a table, tap a dish. The face opens it with `history.pushState`, and the host listens only for `hashchange`, which `pushState` never fires.
- Expected: Every dish page opened at a table reports `item.opened` (the code's own comment at guest-menu.tsx:333-335 says the page "sees it open").
- Saw: `look()` runs once on mount and on `hashchange` only, so in-page opens are missed.
- Check: code (code-review high)
- Evidence: `apps/web/src/guest/guest-menu.tsx:356-358` (`look(); addEventListener('hashchange', look)`); `packages/faces/editorial-market/src/use-dish-route.ts:116` (`window.history[replace ? 'replaceState' : 'pushState']`), which itself listens on `popstate` (:71).
- Proposal: Have the renderer's dish route tell the host when it opens a dish (a callback), or have the host also listen to `popstate` and the open call; drop the duplicated address parsing.
- Status: candidate

### C2. One failed read of the table file makes the tab forget its table
- Kind: bug
- Screen: `/m/<address>` (`apps/web/src/guest/guest-menu.tsx`, `load.ts`), guest, n/a, n/a, n/a
- Steps: Scan a table QR, open a dish (the address loses `#t=`), then reload while `t/<hash>.json` fails once and the other files load.
- Expected: Only a code the files say is unknown is forgotten (`context.ts:189-191`: "an unknown one clears it"); a read that failed concludes nothing.
- Saw: `loadTableFile` returns null on any error, and the load then removes the remembered code, so later reloads have no table and no ordering until the QR is scanned again.
- Check: code (code-review high)
- Evidence: `apps/web/src/guest/load.ts:292-305` (`catch { return null }`); `apps/web/src/guest/load.ts:357-358`; `apps/web/src/guest/guest-menu.tsx:179` (`rememberTable(storage, menu.publicId, menu.table?.token ?? null)`).
- Proposal: Make `loadTableFile` tell "not found or other venue" from "could not be read", and leave the remembered code alone on the second.
- Status: candidate

### C3. An edit made while Done is saving is thrown away without a word
- Kind: bug
- Screen: `/venues/<id>/design` (`apps/web/src/design/design-page.tsx`), owner, n/a, n/a, n/a
- Steps: Press Done and pick another tile or type a colour before the action returns.
- Expected: Done saves the design as it stood and later edits stay as unsaved changes (D129: nothing is lost except by Cancel).
- Saw: On success the history and the baseline are reset to the `draft` captured when Done was pressed; the newer edit vanishes from the panel and from Undo, and nothing shows as unsaved. Only Undo, Cancel and Done are disabled while saving, not the controls.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/design-page.tsx:311-313` (`setBaseline(draft); setHistory(historyOf(draft))` inside the async transition); `:620`, `:636`, `:644` (only the three buttons carry `saving`).
- Proposal: On success set only the baseline and the revision to the saved draft and leave the history alone, or disable the panel while saving.
- Status: candidate

### C4. A logo upload that finishes after other edits reverts those edits
- Kind: bug
- Screen: `/venues/<id>/design`, logo field (`apps/web/src/design/logo-field.tsx`), owner, n/a, n/a, n/a
- Steps: Choose a logo file and change a font or colour while it uploads.
- Expected: The logo is added to the current draft.
- Saw: `onFile` awaits the upload and then calls the `onChange` from the render in which the file was chosen, which builds on that render's `draft`. The draft goes back to the pre-upload state plus the logo.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/logo-field.tsx:65-73`; `apps/web/src/design/design-page.tsx:452` (`onChange={(logo) => change(withLogo(draft, logo))}`).
- Proposal: Apply the logo to the current draft with a functional update, or keep `onChange` in a ref.
- Status: candidate

### C5. A newly uploaded logo's picture breaks when the owner switches Simple/Advanced, or after Undo
- Kind: bug
- Screen: `/venues/<id>/design`, logo field in Simple and in Advanced, owner, n/a, n/a, n/a
- Steps: Upload a logo in Simple and switch to Advanced. Or upload A, upload B, then Undo.
- Expected: The draft's logo picture stays visible until it is saved or replaced.
- Saw: The blob URL is revoked when `LogoField` unmounts and when a second file replaces it, while `draft.logo.url` and the undo history still hold it. `logoControl` is mounted in two different branches, so a mode switch unmounts it.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/logo-field.tsx:44-50` (revoke on unmount), `:71` (revoke on replace); `apps/web/src/design/design-page.tsx:548` and `:579`.
- Proposal: Have `DesignPage` own the blob URLs and revoke them on page unmount or after a save, not in the field.
- Status: candidate

### C6. A layout the owner once tapped in the preview overrides the Layout option in every Design frame
- Kind: bug
- Screen: `/venues/<id>/design` preview and Items → Layout tiles (`packages/faces/editorial-market/src/use-layout.ts`), owner, n/a, n/a, n/a
- Steps: Tap the layout switch in the live preview (or on the venue's guest menu in the same tab), then change Layout in Advanced → Items.
- Expected: The preview and each Layout tile draw the layout the draft sets (the preview shows what will publish, D129).
- Saw: `rm-layout` in `sessionStorage` is shared by every same-origin frame in the tab, and the stored choice wins whenever the guest switch is on.
- Check: code (code-review high)
- Evidence: `packages/faces/editorial-market/src/use-layout.ts:13-20`, `:32` (`switchShown && chosen !== null ? chosen : start`); `face.tsx:98`; `packages/shell/src/build.ts:471`.
- Proposal: Let the host say whether to remember the choice (the Design frames pass "no"), or scope the key to the venue and skip storage in the preview.
- Status: candidate

### C7. Picking the Style a venue is already on shows as an unsaved change
- Kind: bug
- Screen: `/venues/<id>/design`, Simple → Style tiles (`apps/web/src/design/design-draft.ts`), owner, n/a, n/a, n/a
- Steps: Open Design on a venue with untouched Basic and click the Basic tile.
- Expected: Nothing changed, so no undo step, no "Unsaved changes" and no leave warning. The server already compares with `canonicalJson` (`packages/core/src/design/record.ts:330`).
- Saw: `valuesOfStyle` appends `body_font` last in `general`, while stored values have it second; `JSON.stringify` then differs for identical values.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/design-draft.ts:140-143`, `:118` (`keyOfDesign = JSON.stringify`), `:217`; `packages/shell/src/design/styles/basic.ts:12-21`.
- Proposal: Compare with a key-order-independent form in `keyOfDesign` and `changed`.
- Status: candidate

### C8. Members who cannot edit see no option pictures in Advanced
- Kind: bug
- Screen: `/venues/<id>/design` → Advanced (`apps/web/src/design/option-tiles.tsx`), member (read-only), n/a, n/a, n/a
- Steps: Open Design → Advanced as a member whose role cannot edit.
- Expected: The pictures still draw, as the Style and My styles tiles do. Only an option that does not apply should draw none.
- Saw: The tile draws its picture only when `!disabled`, and `disabled` is passed as `!canEdit || state.disabled`.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/option-tiles.tsx:89`, `:226`.
- Proposal: Pass the "does not apply" state to `Tile` separately and base `drawn` on that alone.
- Status: candidate

### C9. A logo whose asset is gone cannot be removed, and every save writes its dead id back
- Kind: bug
- Screen: `/venues/<id>/design`, logo field (`apps/web/src/server/design/service.ts`, `design-draft.ts`), owner, n/a, n/a, n/a
- Steps: A venue's `logo_asset_id` points at an asset row that is missing or not `stored`. Open Design.
- Expected: The page either shows there is a logo to remove, or loads the design with no logo id.
- Saw: `logoOf` returns null, so the field shows only Upload with no Remove, while `look.logoAssetId` still carries the old id and every save writes it back.
- Check: code (code-review high)
- Evidence: `apps/web/src/server/design/service.ts:88`; `apps/web/src/design/design-draft.ts:66`, `:113`; `look-state.ts:163`; `logo-field.tsx:114`; `packages/core/src/apply/apply.ts:1689-1694`.
- Proposal: In `draftOf`, clear `look.logoAssetId` when the view has no logo.
- Status: candidate

### C10. Every option tile's frame is redrawn on every re-render of the Design page
- Kind: optimisation
- Screen: `/venues/<id>/design` → Advanced (`apps/web/src/design/option-tiles.tsx`, `my-styles.tsx`), owner, n/a, n/a, n/a
- Steps: In Advanced → General, type in a colour box. Each keystroke re-renders `OptionTiles`.
- Expected: A tile's frame redraws only when its own content changes, as `style-tiles.tsx:102` does with `useMemo`.
- Saw: `content` (a fresh `previewSnapshot(...)`) is built inline for each tile on each render and pushed to every frame, which clones and re-renders.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/option-tiles.tsx:202-217`; `scaled-frame.tsx:56-58`; `design-frame.tsx:43`; `my-styles.tsx:190`.
- Proposal: Memoize each tile's content in a small per-tile component, as `Specimen` in `style-tiles.tsx` does.
- Status: candidate

## Security check (security-review + audit-security.md, Fable)

No confirmed row. Tenancy, roles (member looks, owner/admin changes, shared device sent to Tonight), Zod at every Design action, hex/font/enum values into the guest stylesheet, rule 3 ids, and the preview frame's headers all held, each with its file and test (threat model in the lane report). Dropped as already recorded: guest pages send no `frame-ancestors` (O-2, B4-O10), `/design/frame` has no `requireTenant` of its own but reads no data (B4-O8). `pnpm audit --prod`: 11 advisories, none reachable from this lane; `next` 16.4.3 → 16.4.5 is upkeep for the lead.

## Explorer (screen-review step 2, Sonnet)

The explorer changed the venue's design three times (Classic with cards and capitals; Soft with the Dish page full page; brand colour #c2185b, Unbounded headings, two columns), published each, and saved a style "Розов тест".

### S1. Advanced: the page list pushes the options of the chosen page below the fold
- Kind: simplification
- Screen: `/venues/vn_…/design` (Advanced › Items), owner, 1280 px, dark, bg
- Steps: Advanced, tap "Артикули"; the 14-row page list fills the panel and the chosen page's options start below it.
- Expected: tapping a page shows that page's options without a scroll; question 3 "what is here" at a glance (`operational-screens.md`); design-critique 2.
- Saw: after tapping the page the panel still shows only the page list and the title "Артикули"; the options need about 6 scroll ticks. On a 390 px phone the list is longer still.
- Check: `operational-screens.md` wayfinding question 3, design-critique 2
- Evidence: S1-before.jpg
- Proposal: make the page list a compact row of tabs or a Select, so the options sit directly under it. "Страница" / "Page".
- Status: candidate

### S2. Advanced option pictures for name size, weight and case look identical
- Kind: bug
- Screen: `/venues/vn_…/design` (Advanced › Items), owner, 1280 px, dark, bg
- Steps: Advanced › Артикули, scroll to "Размер на името", "Тежест на името", "Регистър на името"; compare the tiles.
- Expected: each tile pictures what its value does (D130; D129 "the preview promises").
- Saw: every tile in those three groups shows the same crop of the menu, at the description and photo, not at the item name; only the radio label tells them apart.
- Check: design-critique 2, D129/D130
- Evidence: S2-before.jpg
- Proposal: crop the tile frame on the item name for name options, or draw a name sample in each value.
- Status: candidate

### S3. On a phone the live preview sits about 2300 px below the Style tiles
- Kind: bug
- Screen: `/venues/vn_…/design`, owner, 390 px, light, bg
- Steps: open Design at 390 px, tap a Style tile, look for the change.
- Expected: D129 "the preview updates at once"; screen-read question 1.
- Saw: single column; after tapping "Soft" the screen shows only tiles; the preview iframe starts at y=2290 of a 2891 px page, so Simple gives no visible feedback without a long scroll.
- Check: `operational-screens.md` feedback 1, D129
- Evidence: S3-before.jpg, S4-before.jpg; DOM `iframe[src*="slot=main"]` y=2290
- Proposal: on a phone a floating "Преглед" / "Preview" button opening the preview as a bottom drawer, or a docked half-height preview above the sticky Undo/Cancel/Done bar.
- Status: candidate

### S4. The Phone / Tablet / Desktop switcher is offered on a phone
- Kind: simplification
- Screen: `/venues/vn_…/design`, owner, 390 px, light, bg
- Steps: scroll to the preview at 390 px.
- Expected: Clean rule 2: remove what does no job.
- Saw: the preview is 357 px wide; "Таблет" and "Компютър" cannot be shown at that width, yet all three buttons stay.
- Check: `operational-screens.md` Clean rule 2
- Evidence: S4-before.jpg
- Proposal: hide the width switcher below 768 px.
- Status: candidate

### S5. The preview and the tile pictures stay blank grey for 10+ seconds with no word
- Kind: optimisation
- Screen: `/venues/vn_…/design`, owner, 1280 px, light, bg
- Steps: load Design and watch the first 10 seconds.
- Expected: a wait over a second says what is happening (overrides, ux-copy "Loading states").
- Saw: an empty grey panel and five empty grey tiles with no spinner or text (dev server). Retry text exists only after a failure.
- Check: ux-copy loading states, `operational-screens.md` feedback 1
- Evidence: S5-before.jpg (dev server)
- Proposal: a skeleton with "Зареждане на прегледа…" / "Loading the preview…".
- Status: candidate

### S6. Tapping a dish in the preview moves the options panel to another page
- Kind: bug
- Screen: `/venues/vn_…/design` (Advanced › Dish page), owner, 1280 px, light, bg
- Steps: Advanced › "Страница на артикула", pick "Цяла страница", then tap a dish in the preview.
- Expected: the dish opens in the preview and the Dish page options stay in view (D129).
- Saw: the dish opened, but the panel jumped to Advanced › Артикули.
- Check: design-critique 2, `operational-screens.md` question 3
- Evidence: S6-before.jpg
- Proposal: only jump when the tapped part belongs to no open page, or never jump from a dish tap.
- Status: candidate

### S7. "Две колони" has no visible effect when items have no photo
- Kind: bug
- Screen: `/m/club-biad/club-biad`, guest, 390 px, dark, en (published after Done)
- Steps: Simple › Layout "Две колони", Done, Publish, open the guest menu.
- Expected: D129/D130: the layout shows on the guest page as the option says.
- Saw: the guest's layout switch highlights "two columns", yet every item is one full-width card: `.rm-items` is a 2-column grid but `.rm-item.is-text` has `grid-column: 1 / -1` (`css.ts:1424`). The preview behaves the same, so the promise is kept but the control misleads.
- Check: D130 (Items › Layout), design-critique 2
- Evidence: S7-before.jpg, `getComputedStyle` of `.rm-items` and `.rm-item`
- Proposal: disable the option with "Две колони се виждат само при артикули със снимка" / "Two columns show only for items with a photo", or lay out text items in two columns.
- Status: candidate

### S8. The Publish dialog calls the design "шаблон" while Design calls it "Стил"
- Kind: bug
- Screen: `/venues/vn_…?tab=studio`, owner, 1280 px, dark, bg
- Steps: after Done, press "Публикувай".
- Expected: D128 and `GLOSSARY.md` use "Style"; copy-rules 8.
- Saw: "Външният вид на менюто (шаблон, цветове, лого)".
- Check: copy-rules.md rule 8, D128
- Evidence: S8-before.jpg
- Proposal: "Външният вид на менюто (стил, цветове, лого)" / "The menu's look (style, colours, logo)".
- Status: candidate

### S9. The brand colour swatch shows a colour while the field says none is chosen
- Kind: bug
- Screen: `/venues/vn_…/design` (Simple › Цветове), owner, 1280 px, light, bg
- Steps: scroll to "Цветът на вашата марка" before typing a colour.
- Expected: question 3, state readable at a glance.
- Saw: a grey-blue swatch next to the placeholder "Още не е избран"; Page and Panels already show "#f8f8f9" and "#ffffff".
- Check: `operational-screens.md` wayfinding question 3
- Evidence: S9-before.jpg
- Proposal: an empty striped swatch when no colour is chosen; derived fields show "—" until one is.
- Status: candidate

### S10. Editing the Dish page options leaves the preview on the menu list
- Kind: simplification
- Screen: `/venues/vn_…/design` (Advanced › Dish page), owner, 1280 px, light, bg
- Steps: open the Dish page options and pick "Цяла страница" or "Малка"; look at the preview.
- Expected: D129 "the preview updates at once" for the thing being edited.
- Saw: tile pictures show a dish, but the main preview keeps the section list.
- Check: D129, design-critique 2
- Evidence: S10-before.jpg
- Proposal: while a dish-related page is open, show a sample dish in the preview; back to the list on any other page.
- Status: candidate

### S11. Bulgarian guest menu: the "→" arrow wraps alone onto a second line
- Kind: bug
- Screen: `/m/club-biad/club-biad`, guest, 390 px, dark, bg (Classic, cards, capitals)
- Steps: scroll to "MOËT & CHANDON BRUT 0.75".
- Expected: template-review step 4; the arrow stays with the name.
- Saw: "→" drops to a second line under the name, alone (not in English).
- Check: `template-review` step 4
- Evidence: S11-before.jpg
- Proposal: tie the arrow to the last word of the name (nowrap on the final word and the arrow).
- Status: candidate

### S12. "Запази като стил…" does not look like a control
- Kind: simplification
- Screen: `/venues/vn_…/design` (Simple › Моите стилове), owner, 1280 px, light, bg
- Steps: scroll to "Моите стилове".
- Expected: an action is a visible control (`operational-screens.md` Patterns); design-critique 2.
- Saw: plain text with no border or fill, 32 px high at 1280 px; the dialog title keeps the trailing "…".
- Check: design-critique 2
- Evidence: S12-before.jpg
- Proposal: outline-button look, "Запази този вид като стил" / "Save this look as a style"; drop the "…" from the dialog title.
- Status: candidate

### S13. The page title does not change when a dish is open
- Kind: bug
- Screen: `/m/club-biad/club-biad#…`, guest, 390 px, light, en
- Steps: open any dish and read the tab title.
- Expected: WCAG 2.4.2; the dish is a page when the Dish page Kind is "Цяла страница".
- Saw: the tab title stays "Club Biad Sofia".
- Check: WCAG 2.4.2
- Evidence: tab title before and after the tap (no screenshot)
- Proposal: "<dish name> · <venue>" while a dish is open.
- Status: candidate

Not written as rows: the empty dish sheet and the repeated name and price in the bottom bar (#448); the Next.js dev overlay over "Отмени" (dev-only).

## Works
- **Design, Simple (owner, 1280 px):** the five Style tiles apply at once and the preview follows; the brand colour derives Page and Panels live; fonts listed in their own faces; Undo steps back; Done says "Дизайнът е запазен. Гостите ще го видят при следващото публикуване."; "Запази като стил" saves and the style appears in My styles.
- **Design at 390 px:** one column, no sideways scroll, no control under 44 px.
- **Guest menu (Classic cards capitals, Soft, brand colour with Unbounded):** each published look matched the preview; bg and en; light and dark; contrast NEW chip 5.08, dark-card descriptions 4.54; 44 px targets; no sideways scroll; allergen codes open a legend.
- **Dish page (Soft, full page):** matched its preview; back control 44 px "Обратно към менюто"; the sheet is a modal.
- **Publish:** "1 промяна чака", "Преглед", then "Версия 2 е на живо".

## Could not see
- device: one-handed reach on the phone Design page, glare in a dark room, a real slow connection, the keyboard over the style-name and colour fields.
- device: a screen reader on the Design page and the guest sheet.
- Advanced pages not opened by the explorer: Header, Navigation, Sections, Photos, Labels, Sheets and footer (photo and logo options cannot show: the demo has neither); service pages are lane 3.
- Cancel's throw-away, style update/delete, the guest layout switch in the preview (C6) and two editors at once were not exercised by the explorer.
- navigation → lane 6 (sidebar, "Към студиото", Studio tabs).

## What each vendored skill added (explorer)
- design-critique: S2, S3, S4, S6, S10, S12.
- accessibility-review: S13 (2.4.2).
- ux-copy: S5 (loading state); S8 is already copy-rules rule 8.
