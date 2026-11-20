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
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): C1-after.jpg (one item.opened per tap at a table; none on a sheet close or back)
- Verdict: confirmed — `use-dish-route.ts:116` opens with pushState; host listens only to hashchange (`guest-menu.tsx:357`)
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-HOST

### C2. One failed read of the table file makes the tab forget its table
- Kind: bug
- Screen: `/m/<address>` (`apps/web/src/guest/guest-menu.tsx`, `load.ts`), guest, n/a, n/a, n/a
- Steps: Scan a table QR, open a dish (the address loses `#t=`), then reload while `t/<hash>.json` fails once and the other files load.
- Expected: Only a code the files say is unknown is forgotten (`context.ts:189-191`: "an unknown one clears it"); a read that failed concludes nothing.
- Saw: `loadTableFile` returns null on any error, and the load then removes the remembered code, so later reloads have no table and no ordering until the QR is scanned again.
- Check: code (code-review high)
- Evidence: `apps/web/src/guest/load.ts:292-305` (`catch { return null }`); `apps/web/src/guest/load.ts:357-358`; `apps/web/src/guest/guest-menu.tsx:179` (`rememberTable(storage, menu.publicId, menu.table?.token ?? null)`).
- Proposal: Make `loadTableFile` tell "not found or other venue" from "could not be read", and leave the remembered code alone on the second.
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): test: load.test.ts, guest-menu.test.tsx (an unreadable file keeps only the code it checked)
- Verdict: confirmed — `load.ts:302` turns any error into null and `guest-menu.tsx:179` forgets the table
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-HOST

### C3. An edit made while Done is saving is thrown away without a word
- Kind: bug
- Screen: `/venues/<id>/design` (`apps/web/src/design/design-page.tsx`), owner, n/a, n/a, n/a
- Steps: Press Done and pick another tile or type a colour before the action returns.
- Expected: Done saves the design as it stood and later edits stay as unsaved changes (D129: nothing is lost except by Cancel).
- Saw: On success the history and the baseline are reset to the `draft` captured when Done was pressed; the newer edit vanishes from the panel and from Undo, and nothing shows as unsaved. Only Undo, Cancel and Done are disabled while saving, not the controls.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/design-page.tsx:311-313` (`setBaseline(draft); setHistory(historyOf(draft))` inside the async transition); `:620`, `:636`, `:644` (only the three buttons carry `saving`).
- Proposal: On success set only the baseline and the revision to the saved draft and leave the history alone, or disable the panel while saving.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): test: design-page.test.tsx "an edit made while Done is saving stays…"
- Verdict: confirmed — `onDone` resets baseline and history from the draft of the Done render; only three buttons disabled
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DSTATE

### C4. A logo upload that finishes after other edits reverts those edits
- Kind: bug
- Screen: `/venues/<id>/design`, logo field (`apps/web/src/design/logo-field.tsx`), owner, n/a, n/a, n/a
- Steps: Choose a logo file and change a font or colour while it uploads.
- Expected: The logo is added to the current draft.
- Saw: `onFile` awaits the upload and then calls the `onChange` from the render in which the file was chosen, which builds on that render's `draft`. The draft goes back to the pre-upload state plus the logo.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/logo-field.tsx:65-73`; `apps/web/src/design/design-page.tsx:452` (`onChange={(logo) => change(withLogo(draft, logo))}`).
- Proposal: Apply the logo to the current draft with a functional update, or keep `onChange` in a ref.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): test: design-page.test.tsx "a logo that finishes going up after other edits keeps those edits"
- Verdict: confirmed — `logo-field.tsx:72` calls a stale onChange; `design-page.tsx:452` builds on the old draft
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DSTATE

### C5. A newly uploaded logo's picture breaks when the owner switches Simple/Advanced, or after Undo
- Kind: bug
- Screen: `/venues/<id>/design`, logo field in Simple and in Advanced, owner, n/a, n/a, n/a
- Steps: Upload a logo in Simple and switch to Advanced. Or upload A, upload B, then Undo.
- Expected: The draft's logo picture stays visible until it is saved or replaced.
- Saw: The blob URL is revoked when `LogoField` unmounts and when a second file replaces it, while `draft.logo.url` and the undo history still hold it. `logoControl` is mounted in two different branches, so a mode switch unmounts it.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/logo-field.tsx:44-50` (revoke on unmount), `:71` (revoke on replace); `apps/web/src/design/design-page.tsx:548` and `:579`.
- Proposal: Have `DesignPage` own the blob URLs and revoke them on page unmount or after a save, not in the field.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): test: design-page.test.tsx, both C5 tests (the pane cannot pick a file)
- Verdict: confirmed — revoke on unmount and replace; `logoControl` mounts in two branches
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DSTATE

### C6. A layout the owner once tapped in the preview overrides the Layout option in every Design frame
- Kind: bug
- Screen: `/venues/<id>/design` preview and Items → Layout tiles (`packages/faces/editorial-market/src/use-layout.ts`), owner, n/a, n/a, n/a
- Steps: Tap the layout switch in the live preview (or on the venue's guest menu in the same tab), then change Layout in Advanced → Items.
- Expected: The preview and each Layout tile draw the layout the draft sets (the preview shows what will publish, D129).
- Saw: `rm-layout` in `sessionStorage` is shared by every same-origin frame in the tab, and the stored choice wins whenever the guest switch is on.
- Check: code (code-review high)
- Evidence: `packages/faces/editorial-market/src/use-layout.ts:13-20`, `:32` (`switchShown && chosen !== null ? chosen : start`); `face.tsx:98`; `packages/shell/src/build.ts:471`.
- Proposal: Let the host say whether to remember the choice (the Design frames pass "no"), or scope the key to the venue and skip storage in the preview.
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): C6-after.jpg
- Verdict: confirmed in the browser at 1280 px: panel 'Две колони' pressed, preview stayed `data-layout="one"`, `sessionStorage['rm-layout']` shared
- Severity: Before the pilot
- Effort: M
- Decision: none
- Needs Martin's yes: no
- Fix: F-FACE

### C7. Picking the Style a venue is already on shows as an unsaved change
- Kind: bug
- Screen: `/venues/<id>/design`, Simple → Style tiles (`apps/web/src/design/design-draft.ts`), owner, n/a, n/a, n/a
- Steps: Open Design on a venue with untouched Basic and click the Basic tile.
- Expected: Nothing changed, so no undo step, no "Unsaved changes" and no leave warning. The server already compares with `canonicalJson` (`packages/core/src/design/record.ts:330`).
- Saw: `valuesOfStyle` appends `body_font` last in `general`, while stored values have it second; `JSON.stringify` then differs for identical values.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/design-draft.ts:140-143`, `:118` (`keyOfDesign = JSON.stringify`), `:217`; `packages/shell/src/design/styles/basic.ts:12-21`.
- Proposal: Compare with a key-order-independent form in `keyOfDesign` and `changed`.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): C7-after.jpg
- Verdict: confirmed in the browser: tapping the current tile (Club) shows 'Незапазено' and enables Undo
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DSTATE

### C8. Members who cannot edit see no option pictures in Advanced
- Kind: bug
- Screen: `/venues/<id>/design` → Advanced (`apps/web/src/design/option-tiles.tsx`), member (read-only), n/a, n/a, n/a
- Steps: Open Design → Advanced as a member whose role cannot edit.
- Expected: The pictures still draw, as the Style and My styles tiles do. Only an option that does not apply should draw none.
- Saw: The tile draws its picture only when `!disabled`, and `disabled` is passed as `!canEdit || state.disabled`.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/option-tiles.tsx:89`, `:226`.
- Proposal: Pass the "does not apply" state to `Tile` separately and base `drawn` on that alone.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): test: advanced.test.tsx "a role that may not edit sees the pages and every tile off"
- Verdict: confirmed in code (`option-tiles.tsx:89`, `:226`); not walked, no member sign-in
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DSTATE

### C9. A logo whose asset is gone cannot be removed, and every save writes its dead id back
- Kind: bug
- Screen: `/venues/<id>/design`, logo field (`apps/web/src/server/design/service.ts`, `design-draft.ts`), owner, n/a, n/a, n/a
- Steps: A venue's `logo_asset_id` points at an asset row that is missing or not `stored`. Open Design.
- Expected: The page either shows there is a logo to remove, or loads the design with no logo id.
- Saw: `logoOf` returns null, so the field shows only Upload with no Remove, while `look.logoAssetId` still carries the old id and every save writes it back.
- Check: code (code-review high)
- Evidence: `apps/web/src/server/design/service.ts:88`; `apps/web/src/design/design-draft.ts:66`, `:113`; `look-state.ts:163`; `logo-field.tsx:114`; `packages/core/src/apply/apply.ts:1689-1694`.
- Proposal: In `draftOf`, clear `look.logoAssetId` when the view has no logo.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): test: design-draft.test.ts "a logo id whose picture is gone is not carried…"; no app path reaches it
- Verdict: confirmed in code; no app path reaches it today (assets leave `stored` only by purge)
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DSTATE

### C10. Every option tile's frame is redrawn on every re-render of the Design page
- Kind: optimisation
- Screen: `/venues/<id>/design` → Advanced (`apps/web/src/design/option-tiles.tsx`, `my-styles.tsx`), owner, n/a, n/a, n/a
- Steps: In Advanced → General, type in a colour box. Each keystroke re-renders `OptionTiles`.
- Expected: A tile's frame redraws only when its own content changes, as `style-tiles.tsx:102` does with `useMemo`.
- Saw: `content` (a fresh `previewSnapshot(...)`) is built inline for each tile on each render and pushed to every frame, which clones and re-renders.
- Check: code (code-review high)
- Evidence: `apps/web/src/design/option-tiles.tsx:202-217`; `scaled-frame.tsx:56-58`; `design-frame.tsx:43`; `my-styles.tsx:190`.
- Proposal: Memoize each tile's content in a small per-tile component, as `Specimen` in `style-tiles.tsx` does.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): test: advanced.test.tsx "builds it again only when something it draws changes… (C10)"; the walk could not time it
- Verdict: confirmed in code; not timed
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DSTATE

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
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S1-after.png
- Verdict: confirmed at 1280×800: the 14-row list stays, options start at the fold
- Severity: Before the pilot
- Effort: M
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S2. Advanced option pictures for name size, weight and case look identical
- Kind: bug
- Screen: `/venues/vn_…/design` (Advanced › Items), owner, 1280 px, dark, bg
- Steps: Advanced › Артикули, scroll to "Размер на името", "Тежест на името", "Регистър на името"; compare the tiles.
- Expected: each tile pictures what its value does (D130; D129 "the preview promises").
- Saw: every tile in those three groups shows the same crop of the menu, at the description and photo, not at the item name; only the radio label tells them apart.
- Check: design-critique 2, D129/D130
- Evidence: S2-before.jpg
- Proposal: crop the tile frame on the item name for name options, or draw a name sample in each value.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S2-after.png, S2-after-weight-case.png
- Verdict: confirmed; cause: each tile scrolls the focused item under the sticky section bar, which hides the name ('Рамка' tiles too)
- Severity: Before the pilot
- Effort: M
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S3. On a phone the live preview sits about 2300 px below the Style tiles
- Kind: bug
- Screen: `/venues/vn_…/design`, owner, 390 px, light, bg
- Steps: open Design at 390 px, tap a Style tile, look for the change.
- Expected: D129 "the preview updates at once"; screen-read question 1.
- Saw: single column; after tapping "Soft" the screen shows only tiles; the preview iframe starts at y=2290 of a 2891 px page, so Simple gives no visible feedback without a long scroll.
- Check: `operational-screens.md` feedback 1, D129
- Evidence: S3-before.jpg, S4-before.jpg; DOM `iframe[src*="slot=main"]` y=2290
- Proposal: on a phone a floating "Преглед" / "Preview" button opening the preview as a bottom drawer, or a docked half-height preview above the sticky Undo/Cancel/Done bar.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S3-after.jpg
- Verdict: confirmed at 390×844: main preview at y=2290 of 2891
- Severity: Before the pilot
- Effort: M
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S4. The Phone / Tablet / Desktop switcher is offered on a phone
- Kind: simplification
- Screen: `/venues/vn_…/design`, owner, 390 px, light, bg
- Steps: scroll to the preview at 390 px.
- Expected: Clean rule 2: remove what does no job.
- Saw: the preview is 357 px wide; "Таблет" and "Компютър" cannot be shown at that width, yet all three buttons stay.
- Check: `operational-screens.md` Clean rule 2
- Evidence: S4-before.jpg
- Proposal: hide the width switcher below 768 px.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S4-after.jpg
- Verdict: confirmed at 390; D129's switcher is a desktop tool, hiding it below 768 px contradicts nothing
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S5. The preview and the tile pictures stay blank grey for 10+ seconds with no word
- Kind: optimisation
- Screen: `/venues/vn_…/design`, owner, 1280 px, light, bg
- Steps: load Design and watch the first 10 seconds.
- Expected: a wait over a second says what is happening (overrides, ux-copy "Loading states").
- Saw: an empty grey panel and five empty grey tiles with no spinner or text (dev server). Retry text exists only after a failure.
- Check: ux-copy loading states, `operational-screens.md` feedback 1
- Evidence: S5-before.jpg (dev server)
- Proposal: a skeleton with "Зареждане на прегледа…" / "Loading the preview…".
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S5-after.jpg, S5-after-tiles.jpg (tiles got the placeholder too)
- Verdict: confirmed (dev server): empty grey box 3–9 s
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S6. Tapping a dish in the preview moves the options panel to another page
- Kind: bug
- Screen: `/venues/vn_…/design` (Advanced › Dish page), owner, 1280 px, light, bg
- Steps: Advanced › "Страница на артикула", pick "Цяла страница", then tap a dish in the preview.
- Expected: the dish opens in the preview and the Dish page options stay in view (D129).
- Saw: the dish opened, but the panel jumped to Advanced › Артикули.
- Check: design-critique 2, `operational-screens.md` question 3
- Evidence: S6-before.jpg
- Proposal: only jump when the tapped part belongs to no open page, or never jump from a dish tap.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S6-after.png, S6-after-panel.jpg (Panel and Full page)
- Verdict: confirmed and wider: with Kind Panel too, tapping a dish jumps the panel to 'Артикули'
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S7. "Две колони" has no visible effect when items have no photo
- Kind: bug
- Screen: `/m/club-biad/club-biad`, guest, 390 px, dark, en (published after Done)
- Steps: Simple › Layout "Две колони", Done, Publish, open the guest menu.
- Expected: D129/D130: the layout shows on the guest page as the option says.
- Saw: the guest's layout switch highlights "two columns", yet every item is one full-width card: `.rm-items` is a 2-column grid but `.rm-item.is-text` has `grid-column: 1 / -1` (`css.ts:1424`). The preview behaves the same, so the promise is kept but the control misleads.
- Check: D130 (Items › Layout), design-critique 2
- Evidence: S7-before.jpg, `getComputedStyle` of `.rm-items` and `.rm-item`
- Proposal: disable the option with "Две колони се виждат само при артикули със снимка" / "Two columns show only for items with a photo", or lay out text items in two columns.
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): S7-after.jpg, S7-after-320.jpg, S7-after-names-fixed.jpg (two columns; no mid-word breaks at 320 and 390)
- Verdict: confirmed, also found blind: Editorial sets two columns, text items span both (`css.ts:1424`); the pilot club's items have no photos
- Severity: Before the pilot
- Effort: M
- Decision: none
- Needs Martin's yes: no
- Fix: F-FACE

### S8. The Publish dialog calls the design "шаблон" while Design calls it "Стил"
- Kind: bug
- Screen: `/venues/vn_…?tab=studio`, owner, 1280 px, dark, bg
- Steps: after Done, press "Публикувай".
- Expected: D128 and `GLOSSARY.md` use "Style"; copy-rules 8.
- Saw: "Външният вид на менюто (шаблон, цветове, лого)".
- Check: copy-rules.md rule 8, D128
- Evidence: S8-before.jpg
- Proposal: "Външният вид на менюто (стил, цветове, лого)" / "The menu's look (style, colours, logo)".
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S8-after.png
- Verdict: confirmed — `messages/bg.json:1055` 'шаблон', en 'template'; copy rule 8, D128
- Severity: Before the pilot
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-COPY

### S9. The brand colour swatch shows a colour while the field says none is chosen
- Kind: bug
- Screen: `/venues/vn_…/design` (Simple › Цветове), owner, 1280 px, light, bg
- Steps: scroll to "Цветът на вашата марка" before typing a colour.
- Expected: question 3, state readable at a glance.
- Saw: a grey-blue swatch next to the placeholder "Още не е избран"; Page and Panels already show "#f8f8f9" and "#ffffff".
- Check: `operational-screens.md` wayfinding question 3
- Evidence: S9-before.jpg
- Proposal: an empty striped swatch when no colour is chosen; derived fields show "—" until one is.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S9-after.jpg
- Verdict: confirmed — colour input holds `#6b7280` while the box shows the placeholder
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S10. Editing the Dish page options leaves the preview on the menu list
- Kind: simplification
- Screen: `/venues/vn_…/design` (Advanced › Dish page), owner, 1280 px, light, bg
- Steps: open the Dish page options and pick "Цяла страница" or "Малка"; look at the preview.
- Expected: D129 "the preview updates at once" for the thing being edited.
- Saw: tile pictures show a dish, but the main preview keeps the section list.
- Check: D129, design-critique 2
- Evidence: S10-before.jpg
- Proposal: while a dish-related page is open, show a sample dish in the preview; back to the list on any other page.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S10-after.png, S10-after-leave.jpg (leaving the page closes the dish)
- Verdict: confirmed — with Dish page open the main preview stays on the list
- Severity: Before the pilot
- Effort: M
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S11. Bulgarian guest menu: the "→" arrow wraps alone onto a second line
- Kind: bug
- Screen: `/m/club-biad/club-biad`, guest, 390 px, dark, bg (Classic, cards, capitals)
- Steps: scroll to "MOËT & CHANDON BRUT 0.75".
- Expected: template-review step 4; the arrow stays with the name.
- Saw: "→" drops to a second line under the name, alone (not in English).
- Check: `template-review` step 4
- Evidence: S11-before.jpg
- Proposal: tie the arrow to the last word of the name (nowrap on the final word and the arrow).
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): S11-after.jpg, S11-after-320-fixed.jpg, S11-after-list-fixed.jpg
- Verdict: confirmed at 375 px on Club ('ABSOLUT VODKA 0.7'); also found blind
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-FACE

### S12. "Запази като стил…" does not look like a control
- Kind: simplification
- Screen: `/venues/vn_…/design` (Simple › Моите стилове), owner, 1280 px, light, bg
- Steps: scroll to "Моите стилове".
- Expected: an action is a visible control (`operational-screens.md` Patterns); design-critique 2.
- Saw: plain text with no border or fill, 32 px high at 1280 px; the dialog title keeps the trailing "…".
- Check: design-critique 2
- Evidence: S12-before.jpg
- Proposal: outline-button look, "Запази този вид като стил" / "Save this look as a style"; drop the "…" from the dialog title.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): S12-after.jpg, S12-after-dialog.jpg
- Verdict: confirmed — `my-styles.tsx:277` ghost sm; dialog title reuses `t('save')` with '…'
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-DPANEL

### S13. The page title does not change when a dish is open
- Kind: bug
- Screen: `/m/club-biad/club-biad#…`, guest, 390 px, light, en
- Steps: open any dish and read the tab title.
- Expected: WCAG 2.4.2; the dish is a page when the Dish page Kind is "Цяла страница".
- Saw: the tab title stays "Club Biad Sofia".
- Check: WCAG 2.4.2
- Evidence: tab title before and after the tap (no screenshot)
- Proposal: "<dish name> · <venue>" while a dish is open.
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): tab title read in the walk (bg and en), no screenshot
- Verdict: confirmed with the sheet open; host sets the title at `guest-menu.tsx:417`
- Severity: Polish
- Effort: S
- Decision: none
- Needs Martin's yes: no
- Fix: F-HOST

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

## Reviewer (screen-review step 4, Opus)

Walked blind first (found S7, S9, S11 and R1–R6), then reproduced every row on a fresh database. All 23 rows confirmed; none Blocking; none contradicts a decision, so nothing needs Martin's yes (round rule: Martin is not picking). The reviewer left the design as found.

### R1. Undo is called "Отмени", right next to Cancel "Отказ"
- Kind: simplification (reviewer)
- Screen: `/venues/vn_…/design`, owner, 1280 px, dark, bg
- Steps: change anything and read the bottom bar.
- Expected: one name per action (copy rule 3); Undo is "Върни" elsewhere (`bg.json:2100`).
- Saw: "Отмени · Незапазено · Отказ · Готово"; in Bulgarian "Отмени" commonly means Cancel, so the owner sees two Cancels. The My styles toast uses "Отмени" for Undo too (`bg.json:1972`).
- Check: copy-rules 3
- Evidence: `bg.json:1919`, `:1972`; `[data-testid=design-undo]` text
- Proposal: "Върни" / "Undo" for both keys.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): R1-after.jpg
- Verdict: confirmed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: F-COPY

### R2. On a dark Style, the Page and Panels colours barely change the preview, and nothing says why
- Kind: simplification (reviewer)
- Screen: `/venues/vn_…/design` Simple › Цветове, owner, 1280 px, dark preview (Club), bg
- Steps: on Club, type `#ffcc00` in "Страница".
- Expected: the preview shows the change at once, or the field says where it applies (D129; screen-read question 3).
- Saw: the dark page went from near-black to `rgb(23,17,3)`; the warning advises "Спокоен, светъл нюанс" on a dark Style; nothing says these are the light screen's colours and the dark screen is worked out from them.
- Check: operational-screens question 3, D129
- Evidence: `.rm` background before/after in `iframe[src*="slot=main"]`; the warning text
- Proposal: Page and Panels help adds "На тъмен екран от него се изчислява тъмен нюанс." / "On a dark screen a dark shade is worked out from it."; the saturation hint only on a light preview.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): R2-after.jpg
- Verdict: confirmed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: F-DPANEL

### R3. In dark mode the dish and sheet overlay is a near-white wash over the menu
- Kind: bug (reviewer)
- Screen: `/m/club-biad/club-biad`, guest, 375 px, dark, bg
- Steps: open any dish (Panel sheet).
- Expected: a scrim darkens what is behind it; pilot venues are dark rooms (§7.5; template-review step 4).
- Saw: `.rm-overlay` is `color-mix(var(--rm-text) 72%)` (`css.ts:696-704`), `rgb(248 248 249 / .72)` in dark; the menu behind turns light grey (Design preview too).
- Check: template-review step 4 (design-critique 3)
- Evidence: `getComputedStyle('.rm-overlay').backgroundColor`, `data-scheme=dark`
- Proposal: the scrim takes a dark ink in both schemes.
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): R3-after.jpg, R3-after-light.jpg
- Verdict: confirmed · Severity: Before the pilot · Effort: S · Decision: none · Needs Martin's yes: no · Fix: F-FACE

### R4. The guest tab is titled "Menu", in English, until the menu loads, and stays so if it fails
- Kind: bug (reviewer)
- Screen: `/m/club-biad-dj3z4gypdbsb`, guest, 375 px, dark, bg
- Steps: open the QR address and read the tab title before the menu draws.
- Expected: Bulgarian first (copy rule 9).
- Saw: "Menu" (`app/m/[...address]/page.tsx:16`).
- Check: copy-rules 9, WCAG 2.4.2
- Evidence: the tab title right after `navigate`
- Proposal: "Меню" / "Menu" by the page's language.
- Status: re-verified (PR #477 at 825355eb, re-check walk 11-20 by an Opus walker that wrote no fix): tab title read in the walk: Меню, and Menu with ?lang=en, before the load and on failure
- Verdict: confirmed · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: F-HOST

### R5. Size options are listed Medium, Small, Large
- Kind: simplification (reviewer)
- Screen: `/venues/vn_…/design` Advanced › Артикули › Размер на името (and title, logo, strip-card sizes), owner, 1280 px, bg
- Steps: look at the tiles.
- Expected: a scale reads in order.
- Saw: "Среден, Малък / Голям": the contract order (Basic's value first, D130).
- Check: design-critique 4
- Evidence: `contract.ts:224,231,283,297,330`
- Proposal: show size values S, M, L, XL for display only; the contract and D130 order stay.
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): R5-after.png, R5-after-lines.jpg (description lines 1, 2, 3, All too)
- Verdict: confirmed · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: F-DPANEL

### R6. Colour help uses words a club owner does not use
- Kind: simplification (reviewer)
- Screen: `/venues/vn_…/design` Simple › Цветове, owner, 1280 px, bg
- Steps: read the brand-colour help and the suggest button.
- Expected: plain words (copy rules 2 and 8).
- Saw: "Около 10% от видяното от гостите" and "Предложи по теория на цветовете".
- Check: copy-rules 2
- Evidence: `bg.json:1748`, `:1765`
- Proposal: help "Цветът на марката ви: бутони, значки и акценти." / "Your brand colour: buttons, badges and accents."; button "Предложи цветове от марката" / "Suggest colours from my brand".
- Status: re-verified (PR #470 at 2422a859, re-check walk 11-20 by an Opus walker that wrote no fix): R6-after.jpg
- Verdict: confirmed · Severity: Polish · Effort: S · Decision: none · Needs Martin's yes: no · Fix: F-COPY

## Fix plan

| Bundle | Rows | Where | Flow |
|---|---|---|---|
| F-DSTATE: the Design page keeps exactly what the owner did | C3, C4, C5, C7, C8, C9, C10 | `apps/web/src/design/*`, `server/design/service.ts` | bug.md |
| F-DPANEL: the Design panel and preview | S1, S2, S3, S4, S5, S6, S9, S10, S12, R2, R5 | `apps/web/src/design/*` | change.md, screen plan: an owner on a phone picks a Style and sees it (1 tap, 0 scrolls); an Advanced page shows its options (1 tap, 0 scrolls at 1280×800) |
| F-FACE: the renderer | C6, S7, S11, R3 | `packages/faces/editorial-market/src/*`, shell env flag | template flow + template-review |
| F-HOST: the guest host page | C1, C2, S13, R4 | `apps/web/src/guest/*`, `app/m/[...address]/page.tsx` | bug.md |
| F-COPY: strings | S8, R1, R6 | `apps/web/messages/{bg,en}.json` | change.md |

Tests named by the reviewer: `design-page.test.tsx`, `design-draft.test.ts`, `advanced.test.tsx`, `frame-stage.test.tsx`, `my-styles.test.tsx`; `face.test.tsx`, `renderer-rules.test.tsx`, `css.test.ts`; `guest-menu.test.tsx`, `load.test.ts`; a messages test (no owner string says "шаблон"/"template"; undo differs from cancel).

### Polish table (all bundled above; Martin is not picking this round)

| Row | What | Bundle |
|---|---|---|
| C7 | Current Style tap shows unsaved | F-DSTATE |
| C8 | Read-only members see no option pictures | F-DSTATE |
| C9 | Dead logo id written back (unreachable today) | F-DSTATE |
| C10 | Every tile frame redrawn per keystroke | F-DSTATE |
| S4 | Width switcher on a phone | F-DPANEL |
| S5 | Blank preview with no loading word | F-DPANEL |
| S9 | Grey swatch while "not chosen" | F-DPANEL |
| S11 | Arrow wraps alone | F-FACE |
| S12 | "Save as style" not seen as a control | F-DPANEL |
| S13 | Dish open keeps the venue title | F-HOST |
| R4 | "Menu" English pre-load title | F-HOST |
| R5 | Sizes listed M, S, L | F-DPANEL |
| R6 | Colour jargon | F-COPY |

Reviewer could not see: C8 as a real member; C1 and C2 at a table (code only); S3's docked preview on a real device.

## Re-check (11-20)

All 29 rows are `re-verified`. Two PRs into `sr/foundation`:
- **#470** (Design page): F-DSTATE, F-DPANEL, F-COPY; head 2422a859.
- **#477** (guest page and renderer): F-FACE, F-HOST; head 825355eb.

The walkers were Opus subagents that wrote no fix. They re-walked each row's Steps on the row's viewport. Rows a browser cannot settle (C2, C3, C4, C5, C8, C9, C10) name the test that pins them. The after screenshots sit beside the before ones.

Defects the fixes introduced, caught by the reviews or the walks and fixed in the same PR:
- a preview tap kept the page whenever any surrounding part matched;
- leaving the Dish page left the dish open (history went back in another frame);
- the X on the dish panel jumped the editor to Panels;
- an unreadable new table code brought back the old table;
- `item.opened` fired again after a sheet closed;
- the English pre-load title was overwritten by the metadata;
- two-column names broke mid-word with no hyphen;
- the arrow pulled the last letter down with it;
- a two-column card grew past 320 px (caught by the e2e guards).

Also fixed alongside: the option tiles' loading word, and "Description lines" listed 1, 2, 3, All.

Filed: #499 (`walkthrough`): with the cards frame on Club or Editorial, a long name can still break mid-word at 320 px. This is a look call for the Style.

Lane setup note: a walk at a table needs `REVEAL_SERVICE_TOKEN` in the lane's `.env.local`, or the QR sheet shows no codes. `.env.example` lists it; the round brief's setup steps don't.
