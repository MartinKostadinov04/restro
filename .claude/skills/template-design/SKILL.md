---
name: template-design
description: Design a Restro guest menu template (a face under packages/faces) from a brief, inside the repo, with an independent review. For guest menu templates only (D105); the owner's admin screens (D107) use shadcn, never this skill.
---

# Template design

An agent session designs one guest menu template (D69, D105) and hands it to an independent reviewer. The lead's `template.md` flow starts this skill with the brief. Facts about the contract live in the designer guide, `docs/guides/shell-handoff/visualization-shell.md` (the guide below); this file holds only the order of work.

## 1. Inputs

Done when you hold all five, from the brief or from the lead:

- the template id (kebab-case; it never changes), and its name and one-line description in Bulgarian and English;
- a three-line intent;
- two or three visual references;
- the stage branch to cut from, and the date for the design folder;
- any exempted entries of the functionality file, named explicitly.

Material is Martin's to bring. When the brief has none, stop and ask the lead for three one-screen directions from `prototype`, picked by Martin (D105).

## 2. Read, in this order

1. `docs/guides/menu-template-functionality.md`: what a guest must be able to do. Every entry with status `supported` or `drawn, platform parked` is required; the brief's exemptions are the only exceptions, and an unclear case is a question to the lead.
2. The guide: §5.5, §7, §9, §10 and §12. §7.5 is the quality floor.
3. `references/restro-overrides.md`. It and §7.5 win over the vendored skill on every conflict.
4. `references/frontend-design/SKILL.md`, the visual direction.
5. The two reference faces, `packages/faces/editorial-market` and `packages/faces/qr-phone`, as patterns for satisfying the contract. Your template looks different from both.

## 3. Design plan, before any code

Write it into the design-intent note (step 6) as you go. Done when each part is written and the check below passes:

- **Type roles.** Sizes, weights, case and spacing for name, price, description, section heading, chips and sheets, all from the `font` token.
- **Colour roles.** The eight roles, light and dark, and which surface and text use which. Name roles only; the plan holds for any three venue colours.
- **Layout concept.** The page top to bottom, the item anatomy, how the horizontal sections and the layout switch look.
- **The one bold move.** One place, named. Everything around it stays quiet.
- **Coverage check.** Walk the functionality file entry by entry and write where each one lives. Done when no required entry lacks a place.

Then apply the vendored skill's question to the plan: would any similar brief produce this? Revise the parts that say yes, and note what changed.

## 4. Write the package

Create `packages/faces/<id>` directly: guide §12.1 steps 4 and 5, following the patterns of the reference faces. Stop at the package: wiring into the web app (§12.1 steps 6 to 9) belongs to the reviewer. Contract changes (a new slot, token, feature, string or command) are a question to the lead, never an edit to the shell or core.

## 5. Run the face's tests

`pnpm vitest run --project packages/faces/<id> --reporter=dot`, then `pnpm lint && pnpm typecheck && pnpm deps:check`. CLAUDE.md's testing tiers apply. At most two sessions run tests at once, and a subagent running tests counts as one. Done when all are green.

## 6. Record the design

Under `docs/design/faces/<id>/<date>/`, write `design-intent.md` (the step 3 plan as built, plus every new interface string with its Bulgarian and English text) and the screenshot matrix from `FACES_VISUAL=1` (the guide's §9.3 sets and §7.7). Done when the note and the screenshots are committed.

## 7. Review

Spawn the `template-review` subagent with the Agent tool: `subagent_type: general-purpose`, a `model` different from your own (`sonnet` when you run Opus, `opus` when you run Sonnet). Its prompt starts "Invoke the `template-review` skill and follow it", followed by the handoff packet:

- the brief (the lead's text, verbatim);
- the path of `docs/guides/menu-template-functionality.md` and the exemptions;
- the package path `packages/faces/<id>`;
- the path of the design-intent note and the screenshot folder.

## 8. Fix, then review again

The reviewer returns one list, each item tagged `missing`, `inconsistent`, `wrong` or `extra`, and a verdict. Fix every item in the template, then spawn the reviewer again with the items that remain. After two rounds without a clean verdict, stop: the brief was wrong. Report the list to the lead.

## 9. Ship

On a clean verdict the reviewer has wired the template and run the gate. Run `ship.md` of the `restro-flow` skill: a pull request into the stage branch, with Martin's acceptance on a local preview before the lead merges (the lead's `template.md` flow).

## 10. Report

CLAUDE.md's report format, ending with the section **Lessons for the skills**: the review findings that point at `template-design`, `template-review`, the functionality file or the flow rather than at the template, each with a proposed change. Write "none" when there are none.
