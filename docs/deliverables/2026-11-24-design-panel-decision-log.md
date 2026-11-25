# Decision log: the Design panel's list of parts and part-only option pictures

Martin's answers of 2026-11-24 to the six questions in `docs/deliverables/2026-11-24-design-panel-categories-and-specimens.md` §8. He gave them in the lane 2 session of the 11-18 screen round, after asking for the change the same day with the example designer in `D:\platform` as the model.

Martin's words are quoted exactly. He answered all six at once ("Yes, all six"), so each row takes the spec's recommendation as his decision.

## The request

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1 | The Design panel opens on a list of parts, each row with a one-line summary and ›; a part opens in place with ‹ back. This replaces the page chips | "Your first sztep is to choose a part of the design (Style >, Brand >, Type> , etc), not with pills/tabs" | firm | [D159](../decisions/D159.md) |
| 2 | An option's tile draws only the part the option changes, never the whole menu | "dont render it like it was the menu, render only the component … this brings simplicity of the decision through isolation form the rest" | firm | [D159](../decisions/D159.md) |

## The six questions

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3 | Q1: Colours and the logo share one row, "Colours and logo" | The logo and the brand colour are chosen together; the example's "Brand" row. "Yes, all six" | firm | [D159](../decisions/D159.md) |
| 4 | Q2: in Advanced, the Style, the colours and the fonts are rows of their own above the parts; General holds the other seven options (Screen, Heading weight, Corners, Depth, Density, Text size, Buttons) | Nothing is shown twice, and General is not an eleven-option scroll. Refines D129's General. "Yes, all six" | firm | [D159](../decisions/D159.md) |
| 5 | Q3: the Style tiles keep drawing the top of the whole menu | A Style changes every part at once. "Yes, all six" | firm | [D159](../decisions/D159.md) |
| 6 | Q4: on a phone, the preview stays docked at the foot of the screen | Each change is seen at once with no extra tap. "Yes, all six" | firm | [D159](../decisions/D159.md) |
| 7 | Q5: picking a Style takes one tap more (4 instead of 3) | The first screen is four rows with their values instead of a long scroll. "Yes, all six" | firm | [D159](../decisions/D159.md) |
| 8 | Q6: the list of parts becomes the admin's pattern for "many groups of settings" | The next screen with many groups looks the same (D107, D123). "Yes, all six" | firm | `docs/guides/operational-screens.md` → Patterns |
