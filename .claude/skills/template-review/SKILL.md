---
name: template-review
description: Independently review a Restro guest menu template (a package under packages/faces) against its brief, and wire it into the web app when clean. Run by the reviewer subagent that template-design spawns; for guest menu templates only (D105).
---

# Template review

You review one template that another model designed, and you wire it in when it is clean (D105). The designer's handoff packet gives you the brief, the path of `docs/guides/menu-template-functionality.md` (the functionality file) with any exemptions, the package `packages/faces/<id>`, and the design-intent note with its screenshots. Without all four, say so in your report and stop: the design session supplies it.

The designer guide is `docs/guides/shell-handoff/visualization-shell.md` (the guide below). You edit nothing inside the template: findings go back to the designer. Every finding is a fact you checked in the code or the screenshots, with its file and line, or a check only a phone can settle, marked `device` (step 7).

## 1. Functionality coverage

Walk the functionality file entry by entry. Done when each entry with status `supported` or `drawn, platform parked` has a verdict: drawn (say where, as file and line), exempted by the brief (quote the brief), or missing. An entry the brief neither exempts nor settles, and a case the file leaves open, becomes a question to the designer, never a guess.

## 2. Contract and rules in code

Run `pnpm vitest run --project packages/faces/<id> --reporter=dot` (it holds `faceContractSuite`, the manifest test and the CSS tests) and `pnpm deps:check`. Done when both are green, or every failure is a finding. Locally that is the face's own package, the files under review; every other package's tests and the Playwright specs run in GitHub's CI on the pull request (CLAUDE.md, Testing, Martin 10-28), and a red check there is a finding too. Only when Actions minutes stop being free does CLAUDE.md's fallback apply: at most two agents run tests at once, and you count as one.

## 3. Screenshots against §7.5 and §9.5

Open the screenshots in the design folder: the four sets (BG and EN, light and dark), the 320 px stress case and the second preset. Check each rule of the guide's §7.5 and each line of §9.5 against what you see and what the CSS says. Done when every line of §9.5 has a verdict. A missing screenshot is a finding; return it as a question to the designer.

## 4. The pinned audit

Read `references/web-interface-guidelines.pinned.md` and `references/web-interface-guidelines.restro-overrides.md`; where they differ, the overrides win. Apply the rules to the package's source, dropping every rule the overrides exclude for faces. Read `references/copy-rules.md` for the strings the package ships. Done when each pinned section has been applied to every source file.

## 4b. Motion

1. **The Motion roles table, both ways.** Diff the design-intent note's Motion roles table against every stylesheet string of the face (`css.ts` and `services/services-css.ts`): each selector with a `transition` or `animation` has a row, each row has its selector, and the row's tap, curve token and duration token are the ones in the CSS. A missing table is a finding; "no motion" with no motion in the CSS passes. Done when every row and every animated selector is matched or is a finding.
2. **The standards.** Only when the CSS contains `transition`, `animation`, `@keyframes` or `scroll-behavior`. Read `references/review-animations.restro-overrides.md`, then `references/review-animations/SKILL.md` and `STANDARDS.md`; the overrides win, and their rows A13 and A14 are greps you run in full. Apply them to the package's CSS only. Done when each standard the overrides keep has a verdict.

The findings go into the step 7 list.

## 4c. Touch and input checks

Grep the package's source for each check below and read every hit; each breach is a finding with its file and line. Done when all five have been run.

- **Hover gating.** Every `:hover` rule sits inside `@media (hover: hover) and (pointer: fine)`.
- **Pressed state.** Every tappable (`button`, `a`, `[role="button"]`, a card that opens) has an `:active` rule (`template-design/references/interaction-polish.md`, Press).
- **Inputs at 16 px.** Every `input`, `textarea` and `select` the face draws has a `font-size` of 16 px or more, and the package contains no `maximum-scale` (§7.5). A size the CSS leaves to inheritance or `em` is a `device` line.
- **No `vh` on a full height.** A full-height surface (the root, a sheet, the dish page) uses `dvh` or `svh`, never `vh`.
- **Scroll handlers.** A `scroll`, `pointer…` or `resize` listener (`addEventListener`, `onScroll`) that sets React state on every event: read through a ref and an `IntersectionObserver` or `requestAnimationFrame` instead. A `pointermove` or `touchmove` handler at all breaks override row 14.

## 5. Code review against the brief

Invoke `mattpocock-skills:code-review` (Standards and Spec) on the changes since the merge-base with the stage branch, with the brief as the spec. When the Agent tool is not available to you (you are a subagent yourself), run the Standards and Spec axes inline, one after the other, instead of as sub-agents. Done when both axes have reported and each item is either a finding or a stated reason it is not one.

## 6. Extra fat

Look for what nobody asked for: unused code, options or props the brief does not name, a word typed into a component instead of the shell's `GuestStrings` or `ServiceStrings`, a dependency beyond `react`, `react-dom` and `@restro/shell`. Done when each source file has been read for it.

## 7. The output

One list. Each item is tagged `missing`, `inconsistent`, `wrong` or `extra`; is marked `code` (verified from code or the screenshots) or `device` (needs a phone to settle); names the entry or rule it violates (a functionality entry, a guide section, a pinned rule, a brief line) and the file and line; and says in a phrase what to change. End with the verdict, `clean` (no `code` items) or `not clean`, and the count per tag.

```text
wrong   | code   | §7.5 never truncate a name | src/item.tsx:42 | `text-overflow: ellipsis` on the name: let it wrap
missing | code   | Filter the menu            | (no file)       | no `menu.filters` control: draw it and list `filters` in the manifest
wrong   | device | §7.5 inputs at 16 px       | src/css.ts:610  | the note field inherits its size: check that focus does not zoom
Verdict: not clean (1 wrong, 1 missing; 1 device)
```

The `device` lines are the device list: hand them to the design session, which carries them to Martin's acceptance on his phone (`template-design` step 9).

Also list, apart from the items, any finding that points at the skills or the flow rather than the template (a rule the designer could not have known, a gap in the functionality file). The design session carries those into its report.

## 8. On a clean verdict: wire it

Only then. Follow the guide's §12.1 steps 6 to 9 exactly. The design session has done the whole of step 6 (the dependency, `transpilePackages`, a hidden `MANIFESTS` entry and the loader): check it, do steps 7 to 9 and set `hidden: false`. Then run CLAUDE.md's done-gate with the tests of every package you touched (`pnpm vitest run --project apps/web src/faces --reporter=dot` among them) and the Playwright specs of the Design tab and the guest page. Commit as you go.

Report to the design session: the verdict, the list, the files you changed while wiring, and the gate's results (failures in detail only). A wiring failure that points at the template is a finding, and the verdict goes back to `not clean`.
