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
