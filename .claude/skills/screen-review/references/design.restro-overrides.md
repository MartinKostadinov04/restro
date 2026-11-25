# Restro overrides to the vendored design skills

Read before `anthropic-design/design-critique/SKILL.md`, `accessibility-review/SKILL.md` and `ux-copy/SKILL.md`. Where a line of the vendored files differs from a line here, from `docs/guides/operational-screens.md`, from `copy-rules.md` or from the designer guide's §7.5, **this file and those win** (D106, D146). The vendored files stay a diffable copy of upstream, so every Restro change is here.

Each vendored section is judged once: where a Restro file already holds the check, run the Restro check and use the vendored section only for what the right-hand column says it adds.

## The vendored dialogue and output

| # | The vendored skill says | Do this instead |
|---|---|---|
| R1 | "Usage", `$ARGUMENTS`, "What I Need From You", "ask the user to describe or share their design" | Skip. The input is the live screen in the built-in browser, at the scope `screen-review` step 1 sets; never ask Martin for a design. |
| R2 | "If Connectors Available": Figma, a user-feedback tool, a knowledge base, a project tracker; the `CONNECTORS.md` link | Off. Restro uses none of them; the tracker is GitHub, and only the lead files issues (`screen-review` step 5). |
| R3 | Each skill's Output template, its severity scale (Critical / Moderate / Minor, Critical / Major / Minor) and its "Priority Recommendations" | Write findings only as rows in `finding-format.md`. The explorer sets no severity and ranks nothing; the reviewer does. |
| R4 | ux-copy: three alternatives A, B, C with tones; "Tone: formal, friendly, playful"; "Success: celebratory"; "Human" | One proposed string per finding, in Bulgarian and English. The tone is calm and plain on every screen (D107); a success says what happened, never celebrates. |
| R5 | "Suggest alternatives", "Explain why" | Kept: a finding's *Proposal* says the fix and its *Check* names the rule it rests on. |
| R6 | "Acknowledge what works" | Kept: one *Works* line per screen in the ledger. |

## design-critique

| Section | Judged by | The vendored text adds only |
|---|---|---|
| 1. First impression | `operational-screens.md` → screen read, questions 1 and 2 (operational); `template-review` step 4 (a guest page) | "What's the emotional reaction?" on a guest page only, as one line, never a finding by itself. |
| 2. Usability | `audit-behaviour.md` step 4 (the persona's walk and taps per story against `docs/guides/admin-map.md`) | "Are interactive elements obvious?": a control the persona would not see as one is a finding (check: `design-critique 2`). |
| 3. Visual hierarchy | screen read, questions 3 and 4 | "Is whitespace used effectively?" and "Is typography creating the right hierarchy?", on a guest page against the Style's values; on an operational screen only where it breaks question 4. |
| 4. Consistency | `operational-screens.md` → Patterns (operational); the Style and the renderer (a guest page) | "Do similar elements behave similarly?" across screens: the same control doing different things on two screens is a finding. |
| 5. Accessibility | `operational-screens.md` → Accessibility (operational); §7.5 and the faces specs (a guest page) | Nothing; run the Restro list. |

Never on an operational screen: judging it by distinctiveness, mood or brand. That is D107's rule, and D123 keeps frontend-design's identity half off these screens.

## accessibility-review

| The vendored text | Restro rule | Do this instead |
|---|---|---|
| "WCAG 2.1 AA" and its quick reference | WCAG 2.2 AA (D123), the list in `operational-screens.md` → Accessibility, with 2.4.11 and 2.5.7 | Run Restro's list; a finding names its 2.2 criterion. |
| "2.5.5 Touch target ≥ 44 × 44" listed as AA | 2.5.5 is AAA; 44 px is Restro's own floor (D123, §7.5) | Report a small target under *Check: Restro 44 px floor*, not as a WCAG AA failure. |
| "Automated scan (catches ~30% of issues)" | No scanner is installed | Use the accessibility tree (`read_page`) and a keyboard walk; a scan is not run. |
| "Screen reader testing (VoiceOver, NVDA)" | A screen reader is Martin's device check | A `device` line, never a finding. |
| "Common issues" 5, 7, 8 (focus traps in modals, auto-playing media, time limits) | Not in Restro's list | Kept as three extra things to look for; a finding names its 2.2 criterion (2.1.2, 1.4.2, 2.2.1). |

## ux-copy

| The vendored text | Judged by | The vendored text adds only |
|---|---|---|
| CTAs | `copy-rules.md` rules 2 and 3 | nothing |
| Error messages | rule 4 | the middle part, *why*, when the owner cannot fix it without knowing it |
| Empty states | rule 5 | nothing |
| Confirmation dialogs | rule 11 | nothing |
| Tooltips | none: Restro has no hover on a phone (D109) | a tooltip that hides a needed word is a finding against D109 |
| Loading states | `operational-screens.md` → feedback 1 | "set expectations": a wait over a second with no word is a finding |
| Principle 3, "same terms for the same things" | rule 8 and `GLOSSARY.md` | nothing |
| "Localization notes" | rule 9 | Bulgarian is written for a Bulgarian reader; a string that runs longer than its box in Bulgarian is a finding. |
