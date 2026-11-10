---
name: template-design
description: Make one of Restro's premade Styles for the guest menu (a file of values over the design contract, in packages/shell/src/design/styles), from a brief, with an independent review. Use for a new Style, or a change to a Style's values. For the guest menu only (D128); the owner's admin screens (D107) use shadcn, never this skill.
---

# Style design

A Style is a preset of the design contract: one file with one value for every option, which the one
renderer draws (D128). You pick the values, write the file, and hand it to an independent reviewer;
Martin accepts the Style himself on a local preview before it is offered. The lead's `template.md`
flow starts this skill with the brief.

A Style is values only. It never carries CSS, a component, a renderer branch keyed on its id, or an
option of its own.

## 1. Inputs

Done when you hold all four, from the brief or from the lead:

- the Style's **id** (a value of the contract's Style option; it never changes) and the name Martin
  says it by;
- its **temper** in two or three lines: what a venue picks it for;
- its **starting values**, usually a column of the options spec's §4 table, or "Basic's" for a Style
  that starts from the base;
- the stage branch to cut from.

Material is Martin's to bring. When the brief has none, stop and ask the lead for three one-screen
directions from `prototype`, picked by Martin (D105).

## 2. Read, in this order

1. `docs/decisions/D128.md` and `D130.md`: what a Style is, and the option list in words with the
   never-list it is tested against.
2. `packages/core/src/design/contract.ts`: the binding list. Every page, option, allowed value and
   each one's English and Bulgarian label.
3. `docs/guides/shell-handoff/visualization-shell.md` §7.5 (the floors) and §5.4 (the colour pairs a
   band and a sheet may use). §7.5 is the quality floor and wins on every conflict.
4. `references/restro-overrides.md`, then `references/frontend-design/SKILL.md`: the visual
   direction (D106). The overrides and §7.5 win over the vendored skill.
5. `packages/shell/src/design/styles/`: `basic.ts` is the base every Style sits over; the others show
   the file's shape and what a `departures` line reads like.
6. **The renderer's stylesheet**, `packages/faces/editorial-market/src/css.ts` and
   `services/services-css.ts`: the rule keyed on each `data-<page>-<option>="<value>"` is what that
   value draws. This is how you see a value without a preview, and the only way to catch a
   combination that fights itself.

## 3. Pick the values

Write the temper in one paragraph first, in plain words Martin can say back. Everything below serves
it.

Then walk the contract page by page. For each option, read the renderer's rule for each allowed
value, and take the value that serves the temper. Done when every option of the contract has a value
and a reason, and no two values fight:

- **Judge the combination, not the value.** The sweeps prove each value alone over Basic; a Style is
  forty-five at once. The pairs that bite: a name size against the layout (in two columns the price
  keeps its size while the name drops a step, so a large name can read smaller than its price); a
  band against the screen (on a dark screen the ink band is the light one); a display font against
  capitals at a large size on a 320 px phone; a tight density against a compact bill line and the
  12 px floor.
- **One bold move.** Name the one place the Style is loud. Everything around it stays quiet.
- **Where the brief's value draws worse than another**, take the better one and write a `departures`
  line: what the brief asked, what you took, and the rule or the floor that decided it.
- **Where the look you want is not a value**, stop and ask the lead, in your report: the drawing, and
  the option you would add for every Style. D130's list is closed without Martin, and a new option
  comes with its own ticket and its own test that no existing venue's menu changes. A Style-only
  branch is never the answer.

## 4. Write the file

`packages/shell/src/design/styles/<id>.ts`, named for the id, exporting one Style: the `id`, the
`departures` list, and `values` with every option of every page. A header comment carries the temper,
the brief it came from, and any renderer rule a reader of the values would trip over. Add it to
`PREMADE_STYLES` in `styles/index.ts`.

That is the whole wiring. The Design page's tiles, the never-list sweep, the stored renderings and
the Playwright design sweeps all read `PREMADE_STYLES`, so the Style joins them with no other edit.

## 5. Run what you changed

In this order, and done when all are green:

1. `pnpm vitest run --project scripts scripts/design-contract.test.ts --reporter=dot`: the file
   against the contract.
2. `pnpm vitest run --project packages/shell --reporter=dot`.
3. `pnpm vitest run --project packages/faces/editorial-market --reporter=dot`: the never-list on every
   fixture at every Style, and the stored renderings. The new Style's renderings are written on the
   first run; read them, then commit them. A run that reports an existing row moved means the Style
   changed a look that was already there: `-u` only once you can say in one line which row moved and
   why, and put that line in the report.
4. `pnpm lint && pnpm typecheck && pnpm deps:check`.

Every other package's tests and the Playwright sweeps run in GitHub's CI on the pull request
(CLAUDE.md, Testing, Martin 10-28): the design sweeps measure the Style's targets, contrast, text
sizes and sideways scroll at 320, 390, 820 and 1280 px, light and dark. A red check there is yours to
fix on the branch.

## 6. Record the Style

Done when all three are written:

- **The brief**, in `docs/deliverables/<date>-<slug>.md` (D114): the temper paragraph, the value of
  every option with its reason, and every departure. A row in `docs/deliverables.md`.
- **Martin's checks**, in the stage's acceptance guide under `docs/deliverables/`: the Style's name,
  its temper in one paragraph, and what to look at on it, each check one thing to see.
- **`GLOSSARY.md`**, when the Style's name is new to it.

## 7. Review

Spawn the `template-review` subagent with the Agent tool: `subagent_type: general-purpose`, a `model`
different from your own (`sonnet` when you run Opus, `opus` when you run Sonnet). Its prompt starts
"Invoke the `template-review` skill and follow it", then the handoff packet:

- the brief (the lead's text, verbatim) and the path of the brief deliverable;
- the path of the Style file, and the branch;
- what you ran in step 5 and what it said;
- every stored-rendering row that moved, with its one line.

## 8. Fix, then review again

The reviewer returns one list, each item tagged `missing`, `inconsistent`, `wrong` or `extra` and
marked `code` or `device`, and a verdict. Fix every `code` item in the Style file and keep the
`device` lines for step 9, then spawn the reviewer again with what remains. After two rounds without
a clean verdict, stop: the brief was wrong. Report the list to the lead.

## 9. Ship

Run `ship.md` of the `restro-flow` skill: a pull request into the stage branch, with Martin's
acceptance on a local preview of the Design page before the lead merges (the lead's `template.md`
flow). The pull request lists the reviewer's `device` lines under "For Martin's phone"; his
acceptance settles them.

## 10. Report

CLAUDE.md's report format. Name the Style with its one-paragraph temper, so the lead can take it to
Martin without opening the file, and say what each Style costs CI. End with the section **Lessons for
the skills**: the review findings that point at `template-design`, `template-review`, the contract or
the flow rather than at the Style, each with a proposed change. Write "none" when there are none.
