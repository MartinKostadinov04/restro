# Editorial Market: the designer's delivery of 2026-10-11

This folder holds Martin's Lovable delivery of the first gallery template, kept as it arrived (D69). It is reference material, not product code: nothing builds or imports it, and Biome skips `source/`.

The product version is the port in `packages/faces/editorial-market` (briefs SH-02 and SH-06).

| Path | What |
|---|---|
| `handover.md` | The designer's handover: what the face draws, what the platform must supply, the two-way contract, the formatting and capability panels, and acceptance scenarios |
| `roadmap.md`, `LOVABLE-NOTES.md` | The Lovable project's own roadmap and agent notes |
| `plans/` | The Lovable plans that shaped the design, oldest first by date in the name |
| `source/` | `src/features/restro-face/**` as delivered: the face, its CSS, the copied view-model types, the face strings, the ordering screens (`ordering/`) and the review fixtures (`fixtures/`: our demo view models and the four theme presets) |
| `source/_tests/` | The designer's tests (`src/test/restro-*`) |
| `source/_preview/menu.tsx` | The review page that stood in for the platform: demo data, theme switcher. Never production |

The images the delivery used are our own demo assets (`/a/<as_ id>/w320|w640|w1280.webp`), so they are not copied here. Unrelated earlier work in the same Lovable project (product passports) is left out.

**When a new delivery arrives:**
1. Store it next to this one in its own dated folder.
2. Diff its `source/` against this folder's `source/`.
3. Port only the differences into the package, following the designer guide (`docs/guides/shell-handoff/visualization-shell.md`).
