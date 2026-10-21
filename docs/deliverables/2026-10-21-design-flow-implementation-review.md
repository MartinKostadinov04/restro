> Filed 2026-10-21. Made by: an independent read-only review agent (Opus), for the lead and Martin. For: the implementation of D123 (the uncommitted changes on `ad/foundation`). Status: see `docs/deliverables.md`.

# Review of the design-flow implementation (D123)

## Verdict: acceptable with fixes

The implementation does what Martin approved and very little else: lines lifted rather than skills copied in, the screen plan as a ticket section written by the planning session, the pattern list, the admin map, taps as acceptance criteria, Martin's taps as the design loop, the manager's phone closed as "yes", G dropped, the checks table kept in the decision file, and both plugins gone (neither is listed in `installed_plugins.json`). The WCAG numbers are right, and the admin map's routes and tap counts hold up against the code. The faults are in the details. One fact is false: the admin has had a dark theme since its first UI commit. Three rows of the Patterns table name divergences that are wrong. Two new rules contradict each other. The implementer is never pointed at the guide. And D123 skips D106's trial without saying so. Each fix is one line or a few words.

## Findings by file

**`docs/guides/operational-screens.md`**
1. **Must-fix.** Accessibility says "Contrast is checked on the admin's light theme until a dark one exists". The dark theme exists: `.dark` tokens in `app/globals.css` and Light / Dark / System in `user-menu.tsx`. Replace the sentence with "Contrast is checked in both the light and the dark theme." Change the same words in D123's `accessibility-review` row.
2. **Must-fix.** Three divergence cells in Patterns are wrong:
   - *Secondary actions of a row.* The `item-row.tsx` buttons also appear on focus and always on touch screens (`[@media(hover:none)]:opacity-100`), so they are fine. Write instead: "The help line of the name and conflict badges (`composer/badges.tsx`) sits in a HoverCard, which a tap does not open."
   - *Everything about one thing.* The cell says "none", but the item sheet and the Tags panel are full-width right sheets on a phone. Only `field-editor-sheet.tsx` switches to a bottom drawer. Write "Item sheet and Tags panel: a side sheet at every width."
   - *Remove for good, or take a venue down.* The cell says "none", but Unpublish takes a menu down with a one-click confirmation, no typed name. Also, every current dialog's dismiss button says "Cancel" (about 21 strings), which rule 11 now rules out. List both.

   Nice-to-have: add tables to Rename (the table name field saves when you click away) and to Reorder ("…" → Move up / Move down).
3. **Must-fix.** Clean rule 2 ("the only thing that stands out") contradicts screen-read questions 1 and 4, which say the eye may land on "the state the owner came for" and a problem state should be emphasised. Change rule 2 to: "The primary action is the one element that stands out, apart from a problem state the owner must see."
4. **Must-fix.** CLAUDE.md's Platform reference rule says "port the pattern". The Patterns table says one pattern per job. Neither says which wins. Add to the Patterns intro: "Where a Platform file does a job another way, this table wins: port the Platform's mechanics, not its pattern, and say so in the report."
5. **Must-fix.** "The inventory of 10-21 found up to five patterns for one job" points to a deliverable that was never filed, which D114 requires. File it with its row, or drop the clause.
6. Nice-to-have. "Restro's own floor (D107, D109)": D107 never mentions 44 px. Cite "(D123; templates: designer guide §7.5)". State 44 px once, in Accessibility, and drop it from the persona paragraph.
7. Nice-to-have. Today's admin controls are 28 to 32 px (`size-7`, `size="sm"`), so every screen fails the new 44 px floor. Record it as a known defect with an issue, the way Reduced motion records T88, so each ticket doesn't find it again.
8. Nice-to-have. The provenance notes in Clean and the screen-read intro repeat what D123 says. Delete them; D123 already says "each line cites its source here". This also drops the "identity half" mention, a negation that pulls the banned idea back in.
9. Nice-to-have. Screen read says "before reading any text", but question 2 reads the title. Write "at a glance, before reading the body".
10. Nice-to-have. The Divergences column is a list of tasks, and `lead.md` puts tasks in GitHub issues. Move it to one issue and leave a pointer. That cuts about 120 words from every read and keeps the rules from going stale.
11. Nice-to-have, Martin's call. Consider WCAG **2.2** AA, the W3C Recommendation since October 2023. It adds 2.5.7 (an alternative to dragging), 2.5.8 (24 px minimum targets) and 2.4.11 (focus not hidden: the sticky Save bar, T88). Under 2.5.7 a one-handed phone user needs more than a keyboard alternative for Reorder. Recommendation: make the pattern "drag handle plus '…' → Move up / Move down", so the areas row becomes the pattern rather than a divergence.

**`.claude/skills/restro-flow/ship.md`**
12. **Must-fix.** Nothing sends the implementer to the guide. The brief says "follow CLAUDE.md", and the ticket's Read line doesn't name it, so Clean rule 3 ("the implementer notes what it removed") never reaches the implementer. Add to the Screen line: "…and `docs/guides/operational-screens.md` goes on the ticket's Read line."
13. **Must-fix.** §3's screen read ends "Done when every line of the screen plan has a verdict". That leaves no finish line when there is no screen plan, and no environment to run in. Write: "on the pull request's branch, environment as `audit-behaviour.md` step 3. Done when each changed screen has its eleven answers and its Accessibility verdicts, and each screen-plan line has a verdict." Nice-to-have: for a `Screen: none` diff, read only the changed element.
14. Nice-to-have. §1 says the plan is written "during the grilling", but in a Feature set `build.md` step 4 writes it when the tickets are cut from the spec. Add "or, in a feature set, when the tickets are cut".
15. Nice-to-have. Targets "from the POS front end or a comparable admin (D115)": most admin jobs have no POS equivalent, and D115 is about ordering. Write: "a documented comparable when one exists; else today's count or fewer, with the reason". Allow "n/a: <reason>" for a state that does not apply. Drop "never a new pattern" and "the same change updates `admin-map.md`": the guide and the map already say both.

**`.claude/skills/template-review/references/copy-rules.md`**
16. **Must-fix.** Rule 11 says "the body says what cannot be undone", but the archive dialog that D107 keeps *can* be undone. Write "the body says the consequence and whether and where it can be undone". Nice-to-have: use an example the Patterns keep, such as "Delete this venue for good?", not "Delete 3 items?".

**`docs/decisions/D123.md`, `D109.md`**
17. **Must-fix.** D123 lists D106's gate as applied but leaves out "a trial on real screens", and the plan review asked for the trial to gate these lines too. Add: "The trial (D106) runs on one composer or integrations screen; a lifted line that finds nothing the existing checks did not is removed." Then cite the trial's deliverable once it is filed.
18. Nice-to-have. Under `domain.md`'s rule 3, D109's status line should name D123: "…; its open question on the manager's phone closed by D123".

**`docs/guides/admin-map.md`**
19. Nice-to-have. D123 makes the phone the persona's device, but every count is for a wide screen. Add a phone column. The rule is +1 per tab switch: tab bars become a Select below 1024 px (`lg:hidden`). Add +1 for the sidebar, which sits behind a trigger. Count "Rename an item (made by hand)" as 2 plus typing, to match the walk's section rename (same `RenameField`).

**`audit-behaviour.md`**
20. Nice-to-have. "Guest pages keep the faces specs' checks" repeats a sentence already in step 4. Delete it.

## Checked and found correct
- WCAG: each of the 13 criteria has the right number and wording. 1.4.3 is AA (4.5:1, 3:1 for large text); 1.4.4, 1.4.10 (320 px), 1.4.11 and 2.4.7 are AA; 1.1.1, 1.3.1, 2.1.1, 2.4.3, 3.2.1, 3.3.1, 3.3.2 and 4.1.2 are A. 2.5.5 is AAA in 2.1. Against the upstream text: 2.5.5 dropped, 1.4.4 and 1.4.10 added.
- Rule 11 matches upstream `ux-copy`. The loading line was rightly left out.
- Admin map, table 1: all 13 `page.tsx` routes match. Correct: `/settings` redirects to General; Publish appears only with a POS (`settingsSectionsOf`); `?sub=`; six codes per sheet; the sold-out chip is hidden at zero; the Tags button and the "Manage menus" link exist; `/guides/qr-links` is unlinked.
- Admin map, table 2: correct counts for back on sale (2), delete a hand-made item (3), move a table (2), turn a code off (3), switch the language (2), switch a guest feature (switch then Save, 2), hide a section (1). The baseline matches walk line 35.
- Patterns: correct for guest features plus Save, menus (arrows, inline form, plain empty line), areas (saves on blur, "…" Move up/down, plain empty line), tables' flat "Move to …", the red delete dialog for hand-made items, and inline red error text in about 20 files.
- Fidelity: G dropped; the checks table sits in D123, not SKILL.md; the `disable-model-invocation` sentence is gone; the Fable check covers states against personas; the hand-off lists target taps; status lines and index rows are in place.

## Reading load
Before, for an admin screen ticket, the implementer read no design rules. The lead read about 2,300 words: the pinned rules, their overrides and the copy rules. Now the implementer reads the screen plan, the guide (665 → 1,878 words) and the map (1,889 words, needed for the Place line): about 4,000 words. The lead reads about 4,400 to 6,300 words, roughly 6 to 8.5 thousand tokens. That is about what the plan review estimated for the vendoring plan it rejected. Moving the Divergences column out (finding 10) and the duplicates (6, 8, 15, 20) cut about 300 words without losing a check.

## Unknowns
- Tap counts and the badge HoverCard were checked in code, not on a phone. Radix HoverCard does not open on tap by design, but this was not tested.
- The trial being run alongside this review may change finding 17.
- Out of scope: break-ui overrides row B9 ("dark mode not established") is stale too.
