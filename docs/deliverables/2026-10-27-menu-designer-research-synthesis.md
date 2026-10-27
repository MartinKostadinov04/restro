# The menu designer upgrade: what the research says, and what is left to decide

Made by: lead session (Opus), 2026-10-27, from three research subagents (Sonnet). The agenda for the grilling that follows; it decides nothing.

Sources:
- [2026-10-27-passport-design-studio-map](2026-10-27-passport-design-studio-map.md): the Platform's passport Design studio, verified file by file (`D:\Platform Gitlab`, pinned in `docs/platform-reference.md`).
- [2026-10-27-current-menu-designer-map](2026-10-27-current-menu-designer-map.md): what Restro's Design subtab, theme and templates do today.
- [2026-10-27-menu-designer-market-scan](2026-10-27-menu-designer-market-scan.md): how menu builders and site builders let owners style a page, and the EU rules that limit it.

## Where we stand

| Studio idea | Passport studio | Restro today |
|---|---|---|
| Choices from a fixed list | 26 stored keys, 8 blocks, about 77 leaves; colours, rounding and shadow are still free values | Font (6), screen (3), menu layout (3), section layout (2) fixed; colours free hex; radius 0–32 and shadow 0–5 numbers; template options declared per template (none used today) |
| One renderer | One passport viewer draws everything | Several templates (Editorial Market listed, `qr-phone` hidden, a dark club template planned), each its own code (D105) |
| Layers, null = inherit, where each value came from | Composition → team → preset → base, per setting, with `sources` | One venue theme; menu layout per menu; layout per section; no item level; no "changed here", no per-setting reset (only colour-role reset and "use tints again") |
| Presets | Four presets writing five governed keys | Theme presets still in core but removed from the screen by D92 |
| Simple / Advanced | A mode that hides the Advanced settings and keeps their stored values | None; one Advanced fold for colour roles |
| Categories as panel pages and save units | 12 categories in one file both sides read | Four cards with three separate save paths; the look saves whole |
| Option tiles drawn by the real renderer | Specimens: real viewer parts, scaled down, inert | Segmented controls and sliders; the preview draws the real template |
| Click to edit | Same-origin iframe, `data-design-part`, a message protocol | Preview is a frame in the same page, no iframe; templates carry `data-slot` markers for tests, not design parts |
| Saving | Per-category units with a version check, realtime locks | Theme and template rewrite `venues.settings` under a row lock; last writer wins; no change set, no event (the section layout alone goes through `core.apply`) |
| Publishing | Live on save | Live on the next publish (D92) |

## What carries over well
- **Null means inherit, resolved per setting, with its source.** The basis of "changed here" and Reset. Webflow and Framer model reset the same way.
- **A category is one file's list of settings,** used by the panel, the save and the version check. Fold the passport's duplicated lists (more than eight places) into one TypeScript source with Zod.
- **Option tiles drawn by the template's own parts,** so a tile never lies.
- **A new option's default reproduces today's look,** proved by a test that compares the markup of "unset" with "explicit default".

## What not to copy
- The passport's debts: duplicated contract lists, mode inference with exceptions, two theme paths, PHP reading a frontend file, an unsandboxed preview frame with unchecked messages, every specimen mounting a full root.
- Unchecked colours in Advanced. Restro already guarantees contrast for derived roles and refuses unreadable overrides (D70, D93); keep that.
- Realtime locks, unless two people really edit one venue's design at once.

## What the market shows
- Menu builders keep design flat: brand colours and fonts once, a few named layouts (Toast five, Wix four), show/hide for descriptive parts. Section-level options at most.
- No menu builder documents per-item design overrides, click-to-edit on an item, "changed here" markers or more than two levels of inheritance. Those exist only in site builders (Shopify, Webflow, Framer, Squarespace).
- Shopify is the nearest model: typed settings, global settings plus section settings, presets that overwrite only presentational settings (at most five), click-to-select through a marker attribute per section and block.
- Sold-out display varies: greyed and blocked (Toast), hidden (Flipdish), owner-styled (Wix), owner choice of grey or hide (Olo/Thanx).

## Limits a design may never cross
- **Allergens** must be reachable before the order (EU 1169/2011 Art. 9, 14, 44): no option may remove them. Restro already has no allergen switch (D71) and requires the allergen slot in every template.
- **The price including VAT** must be shown before the guest is bound (2011/83/EU Art. 6(1)(e); 2005/29/EC Art. 7(4)(c)): no option may hide a price on an orderable item.
- **Rule 5:** a design never shows a hidden item, never makes a sold-out item look orderable, never changes a price.
- **Contrast** (WCAG 2.2 AA): 4.5:1 text, 3:1 controls; Restro's role checks already enforce it.
- **The face contract:** every placement drawn once, in the shell's order (R2, R7). An option like "sold-out items move to the end" changes the order, so it would belong to the shell's view model, never to a template.
- **The glossary:** "Sold out" means visible, greyed, no order button; "Tag", never "badge"; "Template", never "theme".

## Decisions to make (the grilling's agenda)
1. **One design list or one per template.** A shared list every template must draw, each template's own list, or a small shared core plus extras per template. Everything below depends on it.
2. **The preset layer.** Separate presets, or the template's own defaults as the preset layer.
3. **Layers.** Which of organisation, venue, menu, section and item may hold design settings.
4. **Simple and Advanced** against D92's deliberate simplification.
5. **Categories** for menus: which, and which belong to Simple.
6. **What the guest-feature screens get** (the bag, modifier groups, the bill, paying): in the design list now, or after the ordering template (D122).
7. **Sold-out and tag display options** within rule 5 and the glossary.
8. **Two editors at once:** a version check only, or locks too.
9. **When a change reaches guests:** on the next publish (D92), unchanged?
10. **Technical, for the lead to decide and report:** design writes through `core.apply` with events (rule 1, rule 2); one TypeScript contract with Zod; how specimens and click-to-edit work without an iframe or with a sandboxed one; how a template declares its design parts.
