# Soft, Classic and Club: the review note

> Filed 2026-10-31 by the agent building #178 (spec #168, closes T87). For: the lead's review of the
> three Styles before Martin's acceptance (D114). The briefs are
> [2026-10-31-soft-classic-club-briefs](2026-10-31-soft-classic-club-briefs.md)

**Who reviewed.** The lead reviews this change (#178, "Codes it: agent session … the lead reviews"),
so no `template-review` subagent on a second model was spawned; the checks below are the rewritten
`template-review` steps run as a second pass by the session that wrote the Styles. The rewritten skill
keeps the independent reviewer for every Style after these three.

## 1. The file against the contract

Clean. `scripts/design-contract.test.ts` validates all five Style files against
`packages/core/src/design/contract.ts`: every option of every page has a value, every value is one of
that option's allowed values, nothing of the venue's brand is set, each file is named for its id and
listed in `styles/index.ts`. The guard was tightened in the same change: it now requires a file for
every Style the contract lists, and at least one departure line on every Style made from a brief.

## 2. The file against its brief

Clean, with six departures across the three files, each naming what the brief asked, what the file
takes and the rule behind it. Four of the six are values the options review removed from the set
(bill rows `open` twice, call kinds `words`, and Club's method tiles, total place and receipt layout
as one line); one is Soft's layout, decided by the renderer's price rule; one is Club's note that the
pay scope, promo field and status panel went the same way as its ditched values.

Nothing in the three Styles wants CSS, a renderer branch or an option the contract lacks, so there is
no stop-and-ask on the option list. D130's forty-eight stand.

## 3. The never-list and the stored renderings

Green. `runDesignContract` now sweeps 87 cases — the five Styles and every value of every drawn option
over Basic — on 17 fixtures each, 1,479 renders, and reports no failure: a name never cut, the price in the ink and at
or above the description's size, the allergens on the item's row, every part the view has drawn and
marked, the 12 px text and 16 px input floors at each design's own sizes, and the stylesheet on the
theme's tokens inside the face's root. Of the 51 new stored renderings (three Styles × 17 fixtures),
the root's attributes were read on all three Styles and the markup on one hostile fixture each.

One existing row moved, and it was meant to: `general.corners=square` changed its stylesheet
fingerprint, not its markup, because of the finding below. Basic's and Editorial's stored renderings
are byte-identical.

**One thing a reader of those files will trip over.** Club's root reads `data-screen="dark"` beside
`data-scheme="auto"`. The design's Screen option reaches the renderer through the published theme, not
that attribute: `designThemeOf` writes `theme.scheme` from `general.screen`, the host passes it to the
face as the `scheme` prop, and `.rm[data-scheme="dark"]` is the rule that swaps the colour set. The
unit renderings pass no host props, so every Style's stays `auto` there; the Playwright sweeps publish
the snapshot, so Club is drawn dark in both emulated schemes.

## 4. The look

- **The combinations hold.** Soft's list layout keeps the 16 px name over its 15 px price; Classic's
  regular-weight serif name still stands a step over its 14 px description; Club's dark screen takes
  the `panel` header band, so no light bar lands on top, and its pills take the band's own pair rather
  than the accent. Each Style's long Bulgarian section title and the 60-character unbroken name wrap
  inside their box (`overflow-wrap: anywhere` on both the section and the item headings), including
  Club's Unbounded capitals.
- **One bold move each.** Soft: the carded row with its square thumbnail. Classic: the centred serif
  section head in capitals. Club: the full-width section band in Unbounded Heavy capitals.
- **What a stylesheet cannot settle** goes to Martin's phone: the four device lines in section F of
  the acceptance guide (Club's tight density in dim light, Classic's whole-description rows on a long
  menu, Soft's pill targets on a page band, Club's docked bar under the browser's own bar).

## 5. One finding, fixed in the same change

**The "Preview" marker lost its shape at Corners = Square.** D130's never-list fixes the "Preview"
marker, and `screen-options.test.tsx` holds its rules to Basic's. `.ro-preview` read its radius from
General's Corners (`var(--rm-full)`), which is 999 px at every value but `square`, where it is 0 px —
so the dashed pill went square. Classic is the first Style with square corners, so the breach
surfaced now, but any venue could already reach it by choosing Square on the Design page.

Fixed in the renderer, not in the Style and not in the guard (D67): the marker's radius is written out,
so no design reshapes it. Nothing moves at any other Corners value, which is why only the
`general.corners=square` row of `options.snap` moved.

**The open question for the lead.** Is the marker's shape fixed, as the guard reads it, or does it
follow General's Corners as every other box does? The fix takes the first reading, which is what D130
says in words ("may not … change … the 'Preview' marker") and what the rest of the rule already does
(its size, weight, tracking and uppercase are all written out). If Martin would rather the marker took
the venue's shape, the fix reverts to one line and the guard needs a clause naming Corners.

## 6. One tension left standing

The same guard compares `.ro-preview { font-size: calc(12px * var(--rm-type)) }`, which Text size
scales. No Style takes `large`, so it has never fired; the first Style that does will report the
marker's font size as a change. Scaling the marker's text with the venue's text size is right (the
12 px floor is a floor, not a ceiling), so the guard, not the renderer, is what would need a clause
then. Left as it is: nothing is broken today, and a guard is not loosened on a hypothetical.

## 7. Verdict

**Clean.** No `code` items; four `device` lines, which Martin's acceptance settles.
