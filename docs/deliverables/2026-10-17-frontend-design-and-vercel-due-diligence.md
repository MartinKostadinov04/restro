> Filed 2026-10-18 by the lead (session "UI/UX skills for workflows"). Made by: due-diligence session (Sonnet). For: D106. Source: `design-skills-trial/due-diligence-frontend-design-and-vercel.md`. Status: see `docs/deliverables.md`.

# Due diligence: Anthropic frontend-design and Vercel web-interface-guidelines (2026-10-17)

Read-only task. Nothing inside E:\Restro was changed (git status clean at the end). Clones live in the scratchpad: `anthropic-skills/repo`, `wig/repo`, `agent-skills/repo`.

## Part A. Anthropic frontend-design

### 1. Provenance
- Publisher: Anthropic, official repo `github.com/anthropics/skills`, folder `skills/frontend-design`.
- Repo HEAD read: `dbd4588f9e1033efb41dad4bef2f7947c8993d44` (2026-10-09, "Update claude-api skill ...", unrelated to the skill).
- Last commit touching the skill: `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`, 2026-09-03, "Update frontend-design skill to avoid generic design defaults (#1713)". Before it: `2235be7` 2026-06-09, `0075614` 2025-12-04. The text was rewritten twice in four months, so pin the commit.
- Licence: LICENSE.txt is the standard Apache License 2.0 text (10,351 chars), with no copyright line filled in. The repo README says "many skills" are Apache 2.0 and names docx, pdf, pptx, xlsx as the source-available exceptions; frontend-design is not one of them. If we copy it unmodified with LICENSE.txt, the obligations are met. If we edit the copy, Apache 4(b) needs a notice that the file was changed.

### 2. What it reads, writes, runs, fetches
- Folder holds two files only: `SKILL.md` (9,461 chars, 1,516 words) and `LICENSE.txt`. No scripts, no references folder, no `allowed-tools`, no URLs, no commands.
- Nothing executes and nothing reaches the network. It is prose only.
- Soft hooks into the agent's own tools: "taking screenshots to review if your environment supports it"; "If there's any information in your memory about the client's preferences ... use that as a hint"; "if you have a space to quickly jot down notes ... it can help you in future passes" (an invitation to write notes somewhere, location unspecified); "confirm with the client" (an invitation to ask the user questions).

### 3. Conflicts with Restro's template rules (and the one-line override for each)
Sources: visualization-shell.md 5.4, 7.5, 9.1, 9.5, 5.3; CLAUDE.md "Import boundaries", "Conventions".

| # | Skill line (short) | Restro rule | Override |
|---|---|---|---|
| C1 | "Choose your typefaces deliberately, not the default families"; "use one family or two" | 5.4 and 7.5: the venue picks one of six self-served fonts; the face reads the `font` token through `fontStacks`; "Do not load fonts" | No typeface choice: use the `font` token only; build hierarchy with size, weight, case and spacing. |
| C2 | "describe the core base palette as 4-6 named hex values" | 7.5 "Theme tokens only", no literal colour (`assertThemeOnlyCss`); 5.4: the venue's three colours become eight roles, light and dark | Palette = the eight roles; the plan names roles, never hex, and must hold for any three colours, the four presets, light and dark. |
| C3 | Calibration list of "tells" (cream + serif + terracotta, near-black + acid accent, near-black `#0B0B0B`) | 5.4: presets Botanical, Midnight, Nordic, Terracotta are delivered exactly; colour is the venue's, not the template's | The "tells" list applies to layout, type treatment and structure only, never to colour. |
| C4 | "one border-radius on everything", "same soft grey shadow (rgba(0,0,0,.1))" are tells | 5.4 and 7.5: `radius` (0 to 32 px) and `shadow` (0 to 5) are venue tokens | Radius and shadow come from the tokens only (derive with `calc`/`color-mix` of variables); vary hierarchy by size, spacing and border, not by inventing values. |
| C5 | "the hero is the first thing viewers will see. Open with ... a headline, an image, an animation, a live demo" | 7.1/7.3 and 9.5: four required slots, items in view-model order, all 300 in the markup, empty slots collapse; the page is a menu | No landing page and no hero: the first screen is header, jump bar, filters, first section; the one memorable touch goes into header, section headings or item anatomy. |
| C6 | "come up with copy and placeholder content"; "Build with the brief's real content" | 9.5 "no placeholder text"; 9.1: strings only from `GuestStrings` keys in `guest-strings.ts`; menu text only from the view model | No invented copy: use `GuestStrings` and view-model text; a new word goes in the notes with Bulgarian and English text. |
| C7 | "an animation, a live demo, an interactive moment"; "one page-load sequence or one reveal" | 7.5 reduced motion; 9.1 "no state beyond UI state", state survives a refreshed `view` | Motion only as an answer to a tap; any animation is off under `prefers-reduced-motion`; nothing replays on a refreshed `view`. |
| C8 | "Ground your designs ... confirm with the client" | Martin is the product owner and does not read code; the subject is fixed | Do not ask: the subject is a Bulgarian nightclub QR menu on a phone, in dim light, read standing and one-handed. |
| C9 | "responsive down to mobile" as the quality floor | 7.5 and 9.1: 320 to 430 px, 44 px targets, 3:1 focus, 3:1 boundary on controls, allergens always reachable, names never truncated, Cyrillic first | The skill's floor is replaced by 7.5; where they differ, 7.5 wins. |
| C10 | "taking screenshots to review" | 9.3 and 9.4: four sets (BG/EN x light/dark), 390 px plus 320 px stress, at least one other preset | Review screenshots follow 9.3, not ad hoc. |
| C11 | Skill is silent on dependencies, but "image, animation, live demo" invites libraries | 9.1 and CLAUDE.md import boundaries: face imports only its own package, `react`, `react-dom`, `@restro/shell`; plain CSS and inline SVG | No dependency, icon pack or animation library; plain CSS and inline SVG only. |
| C12 | "Use all caps for labels" is a tell; "Serif ... slightly more line-height" | Cyrillic first; the face does not know the venue's font class | Fine in spirit. Set line-height at 1.5 or more for Cyrillic whatever the font; do not branch on the font family. |

Compatible lines worth noting: sentence case ("plain verbs, sentence case") matches Restro; "Default to line lengths of less than 80 characters" and "reduced motion respected" are consistent. The skill states "the brief's own words always win", so a brief that carries the override block will be honoured; still make C1, C2, C5, C6 explicit and first.

### 4. Overlap
Already said by the designer guide (7.5, 9.1, 9.5) and platform-reference: accessibility floor, responsive, focus, reduced motion, token-only colour, no dependencies, sentence-case copy. platform-reference.md is about admin porting and says nothing on aesthetics.
New in the skill: (a) a plan-then-review-then-build process with a "would I produce this for any similar brief?" test; (b) a list of five clusters of generic AI-design tells; (c) "structural devices must encode information" (numbering, eyebrows, dividers only when the content is a sequence or category); (d) "spend boldness in one place" and remove one accessory; (e) motion philosophy (sparse, answers an action); (f) type-scale and line-length habits; (g) UI-copy guidance (CTA verbs, errors, empty states).
Honest value: palette, typeface and hero advice (about a third of the text) is void under the token rules. What survives is layout, hierarchy, item anatomy, spacing, ornament and motion, plus the anti-generic process. That is still the thing the designer guide lacks.

### 5. Trigger check
- Description: "Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults."
- Fires unwanted on any "building new UI or reshaping an existing one": every shadcn admin screen, settings page, error state, dialog, even a ticket that says "UI". Its persona ("design studio ... take aesthetic risk") opposes the admin intent in memory (operational surface = grandma-simple, fewest clicks). Backend tickets are unlikely to trigger it unless they mention UI. Its copy section ("Save changes", errors) would also be applied to admin wrongly.
- Not in this session's skill list now, so it is not installed. If the official plugin is ever enabled it would fire everywhere.
- Proposal: do not install the upstream skill. Keep the upstream `SKILL.md` verbatim plus `LICENSE.txt` under the template-design skill's `references/upstream-frontend-design/` (a pinned commit noted), and put Restro's overrides in a separate file, `references/visual-direction-overrides.md`, read first. The template-design skill reads both at its "visual direction" step only, explicitly. No standalone skill entry means nothing to fire elsewhere. If it must be a skill, name it `template-visual-direction`, set `disable-model-invocation: true` in the frontmatter (Claude Code field; confirm against the current docs), and narrow the description to "Visual direction for Restro guest templates only; never for admin screens".

### 6. Cost
- Loaded when run: `SKILL.md` 9,461 chars, 1,516 words, about 2.3k tokens (estimate, 4 chars per token). LICENSE.txt (10,351 chars) is not loaded. Always-resident description alone: about 240 chars, about 60 tokens. Overrides add about 500 tokens. Total about 3k tokens per template-design run.
- Model: it is judgement prose with no tool procedure, so Sonnet follows it. Opus could give better taste, but the plan-and-critique loop works on Sonnet; the real quality check is the screenshots, which Martin can judge by eye.

### Recommendation
1. Adopt as the visual-direction layer, vendored (verbatim, commit-pinned) under the template-design skill, never as a standalone skill.
2. Put the C1 to C12 overrides first; the skill itself says the brief wins.
3. Value is real but partial: about two thirds of it applies once colour, font, radius and shadow are tokens; judge it with a two-template trial that Martin reviews as screenshots.
4. Update only through an Upkeep ticket (the text changed twice in four months).
5. Apache 2.0: ship LICENSE.txt with the copy; do not edit the upstream file (put changes in the overrides file).

## Part B. Pinned Vercel rules

- File: `scratchpad/out/web-interface-guidelines.pinned.md` (LF line endings; upstream is CRLF).
- Source: `vercel-labs/web-interface-guidelines` `command.md`. Repo HEAD `434b7f91364665f2f733b310ec54809bf8f37937` (2026-10-05, merge of PR #29); file last changed in `4ecfb9fb8d1d3b7009674869b3aaee2f904042e1` (2026-10-05). Licence MIT, Copyright (c) 2025 Vercel Labs. Pinned 2026-10-17.
- Change: the "Content & Copy" section (7 rules) replaced by a one-line "removed" note; a header comment block added after the frontmatter. `diff` against upstream (ignoring line endings) shows only those two changes.
- The web-design-guidelines skill in `vercel-labs/agent-skills` (commit `063bee94c3f4df8453406c830b0a7df0f2860278`, 2026-08-28) tells the agent to fetch `.../main/command.md` live on every run. Do not install it; run the audit from the pinned copy so a Vercel edit cannot change our gate unannounced.
- `command.md` is a shorter checklist; the repo README is a longer, differently worded "living list" (it has rules command.md lacks, such as tooltip timing and optimistic updates). Only command.md is pinned.

### Doubtful rules (kept in the file; lead decides)
For a phone menu template (face):
1. Locale: "Dates/times: use `Intl.DateTimeFormat`", "Numbers/currency: use `Intl.NumberFormat`". Conflicts with 5.3/9.1 (a face writes no `Intl`, `toFixed`, `new Date`; price printed from `price.text`) and CLAUDE.md rule 8 (money only through the `money` module, also in admin). The same applies to the hydration rule about date rendering (venue time zone via date-fns).
2. Content Handling: "`truncate`, `line-clamp-*`": 7.5 says never truncate a name; descriptions only with a visible way to read the rest.
3. Performance: "Large lists (>50 items): virtualize (`virtua`, `content-visibility: auto`)" and the anti-pattern "Large arrays `.map()` without virtualization": 9.5 requires all 300 items in the markup, and `virtua` is a dependency a face may not add.
4. Navigation: "URL reflects state", "Deep-link all stateful UI (nuqs)": a face has no URLs of its own and only UI state; the host owns the URL. Applies to the admin (platform-reference mirrors `?tab=`), not to faces.
5. Page-level rules a face must not touch (7.5: never select `html`, `body`, `:root`): `color-scheme: dark` on `<html>`, `<meta name="theme-color">`, `overscroll-behavior: none` on `<html>`, preload/preconnect fonts and CDN, `translate="no"` on brand names. Host-only.
6. Fonts: "Critical fonts: preload ... font-display: swap" conflicts with "Do not load fonts" (fonts are the host's).
7. Images: "`priority` or `fetchpriority`": `priority` is a Next.js `Image` prop, not available to a face. Use plain `img` with srcset; `width`/`height` come from `sourceWidth`/`sourceHeight`.
8. Locale: "Detect language via `Accept-Language` / `navigator.languages`": the language is set by the venue's policy and the host's `languages` prop, not by the face.
9. Accessibility: "include skip link for main content": host-level; inside the admin's phone frame it would duplicate. "Interactive elements need keyboard handlers (`onKeyDown`)" can push agents to add redundant handlers on native `button`s.
10. Typography: "Curly quotes `“` `”`": Bulgarian uses „ “; applies as written only to English strings.
11. Hover: "Buttons/links need `hover:` state": no hover on a phone; it must never carry meaning (allergens are never hover-dependent). Fine for the admin.
12. Media: autoplay/video/caption/MP4 rules: a menu face has no video; not applicable.
13. Tailwind class names in examples (`focus-visible:ring-*`, `min-w-0`, `line-clamp`, `overflow-x-hidden`): read as CSS concepts; faces use plain CSS (9.1).
For the shadcn admin:
14. "Warn before navigation with unsaved changes": applies, but check against composer autosave/draft behaviour before turning it into a defect.
15. "Native `<select>`: explicit `background-color` and `color`": shadcn uses a Radix select; applies only if a native select is used.
16. "Prefer uncontrolled inputs": shadcn forms with react-hook-form already work either way; low value.
17. "`autoFocus` ... desktop only": fine, but shadcn dialogs focus themselves; low value.
Also: "Content & Copy" has useful rules that do not conflict (active voice, error messages with a fix, specific button labels, numerals for counts). Recommendation: the lead writes Restro's own short copy rules (sentence case, BG and EN) next to the pinned file rather than reviving the section.

### Open questions (each with a recommendation)
1. Do the doubtful rules above stay in the pinned file with a sibling `web-interface-guidelines.restro-overrides.md` (rule, "does not apply to faces / admin / both", reason)? Recommendation: yes. The pinned file stays diffable against upstream; the audit agent reads both and the overrides win. Items 1 to 3 are real conflicts with rule 8 and 9.5 and should be first in that file.
2. Pin the README list as well? Recommendation: no for now; pin only command.md, which is what the Vercel skill itself uses.
3. Which trial before adoption? Recommendation: one template through template-design with the overrides, judged by Martin from the four screenshot sets, before the Upkeep ticket is filed.
