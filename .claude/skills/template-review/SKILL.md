---
name: template-review
description: Independently review one of Restro's premade Styles for the guest menu (a file of values in packages/shell/src/design/styles) against its brief, the design contract and the never-list. Run by the reviewer subagent that template-design spawns; for the guest menu only (D128).
---

# Style review

You review one Style that another model picked the values for (D128). The designer's handoff packet
gives you the brief and its deliverable, the Style file and the branch, what the designer ran and
what it said, and every stored-rendering row that moved. Without all five, say so in your report and
stop: the design session supplies it.

You edit nothing in the Style file: findings go back to the designer. Every finding is a fact you
checked in the file, the contract or the renderer's stylesheet, with its file and line, or a check
only a phone can settle, marked `device` (step 6).

The binding list is `packages/core/src/design/contract.ts`, the floors are §7.5 of the designer guide
(`docs/guides/shell-handoff/visualization-shell.md`), and what no value may ever do is D130's
never-list.

## 1. The file against the contract

Read the contract, then the Style file. Done when every line below has a verdict:

- every option of every page has a value, and each value is one of that option's allowed values;
- nothing of the venue's brand is set: no colours, no Advanced roles, no logo, no body font;
- the id is a value of the contract's Style option, the file is named for it, and `styles/index.ts`
  lists it;
- `departures` holds a line for every value that stands off the brief, and nothing else.

## 2. The file against its brief

Read the brief, then the values. Done when every one of the three has a verdict:

- **The temper.** The brief's paragraph and the file's values describe the same Style. A value that
  works against the temper is a finding, with the brief's line it breaks.
- **Every departure is earned.** Each `departures` line names what the brief asked, what the file
  takes, and the rule or floor that decided it. A departure with no rule behind it is a finding; so
  is a value that stands off the brief with no line at all.
- **Nothing a Style may not want.** A look that needs a new option, a renderer branch or CSS is a
  finding: it belongs in a stop-and-ask to the lead, with the drawing and the option for every Style.

## 3. The never-list and the stored renderings

Run `pnpm vitest run --project packages/faces/editorial-market --reporter=dot` (the never-list on
every fixture at every Style, and the stored renderings), `pnpm vitest run --project packages/shell
--reporter=dot`, `pnpm vitest run --project scripts scripts/design-contract.test.ts --reporter=dot`
and `pnpm deps:check`. Done when all are green, or every failure is a finding.

Locally that is the Style's own sweeps, the files under review; every other package's tests and the
Playwright specs run in GitHub's CI on the pull request (CLAUDE.md, Testing, Martin 10-28), and a red
check there is a finding too. The design sweeps there measure what the harness cannot see without a
browser: targets, contrast, text sizes and sideways scroll at 320, 390, 820 and 1280 px, light and
dark. Only when Actions minutes stop being free does CLAUDE.md's fallback apply: at most two agents
run tests at once, and you count as one.

Then read the Style's own stored renderings (`__renderings__/<id>/` and `<id>.css.snap`) and each row
the designer says moved. Done when every moved row has a verdict: it means to move a look, or it is a
finding.

## 4. The look

Read `../template-design/references/restro-overrides.md`, then
`../template-design/references/frontend-design/SKILL.md`; the overrides and §7.5 win. Read the
renderer's rules for the Style's values (`packages/faces/editorial-market/src/css.ts`,
`services/services-css.ts`) and judge what they draw together. Done when each line below has a
verdict:

- **The combinations.** The name size against the layout, the header band against the screen, the
  heading font against the case and the title size at 320 px, the density against the bill's compact
  lines and the 12 px floor. A pair that fights is a finding even when every sweep is green.
- **One bold move.** The Style is loud in one place and quiet around it.
- **The floors.** Each §7.5 rule the values can reach: the 12 px text, the 16 px inputs, the 44 px
  targets, the pairs of §5.4, no sideways scroll at 320 px, a name never cut. A rule a stylesheet
  cannot settle is a `device` line.
- **Cyrillic first.** The longest Bulgarian section title and the 60-character name at this Style's
  font, case and size.

## 5. A diff that touches the renderer

Only when the branch changed the renderer or the shell. A Style is values, so any such line is either
a never-list breach the Style exposed (a fix that tightens, and welcome) or scope the ticket does not
have (a finding). For the first, read the pinned audit, `references/web-interface-guidelines.pinned.md`
with `references/web-interface-guidelines.restro-overrides.md` (the overrides win) and
`references/copy-rules.md`; for a change to motion CSS, `references/review-animations.restro-overrides.md`
then `references/review-animations/STANDARDS.md`. Then invoke `mattpocock-skills:code-review`
(Standards and Spec) on the changes since the merge-base with the stage branch, with the ticket as the
spec; run both axes inline when the Agent tool is not available to you. Done when every changed line
outside the Style file has a verdict.

## 6. The output

One list. Each item is tagged `missing`, `inconsistent`, `wrong` or `extra`; is marked `code`
(verified from the file, the contract or the stylesheet) or `device` (needs a phone to settle); names
the rule it breaks (a contract option, a guide section, a never-list clause, a brief line) with the
file and line; and says in a phrase what to change. End with the verdict, `clean` (no `code` items) or
`not clean`, and the count per tag.

```text
wrong   | code   | §7.5 12 px text floor   | club.ts:41      | compact density with 1 description line: the line reads 11.5 px
wrong   | code   | brief: "a text list"    | classic.ts:52   | `cards` frames every row: the brief's list has no frames
wrong   | device | §7.5 44 px targets      | soft.ts:38      | pills on a page band: check the tap target on a phone
Verdict: not clean (2 wrong; 1 device)
```

The `device` lines are the device list: hand them to the design session, which carries them to
Martin's acceptance on his phone (`template-design` step 9).

Also list, apart from the items, any finding that points at the skills, the contract or the flow
rather than the Style (a rule the designer could not have known, an option the set is missing). The
design session carries those into its report.

## 7. On a clean verdict: check it is offered

Only then. Done when all four hold:

- `styles/index.ts` lists the Style, so the Design page's tiles, the sweeps and the seed pick it up;
- the brief deliverable exists and has its row in `docs/deliverables.md`;
- the stage's acceptance guide has the Style's name, its temper in one paragraph and its checks;
- `GLOSSARY.md` names the Style, when the name is new to it.

Then run CLAUDE.md's done-gate (`pnpm lint && pnpm typecheck && pnpm deps:check`) and commit as you
go. Report to the design session: the verdict, the list, anything you changed outside the Style file,
and the gate's results (failures in detail only). A failure that points at the Style is a finding, and
the verdict goes back to `not clean`.
