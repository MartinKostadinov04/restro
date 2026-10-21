> Filed 2026-10-21. Made by: an independent read-only review agent (Fable), for the lead and Martin. For: the plan `2026-10-21-design-skills-in-the-flow.md` (§1 to §9). Status: see `docs/deliverables.md`.

# Review of the plan "Design skills in the Restro flow"

## Verdict: adopt with changes

The diagnosis is right: the guest side is covered end to end; the operational side has a code review and an after-the-fact audit and nothing in between; few taps come from deciding the screen before code, which no skill produces. Item L (a design step before code) is the one addition that serves what Martin asked for. For the rest the plan picks the wrong instrument: it vendors three generic texts (design-critique, accessibility-review, a second frontend-design) whose useful content, once the overrides strip the dialogue, the Figma offers and the identity half, is five to fifteen lines each, mostly already said by the wayfinding questions, the pinned Vercel rules and `copy-rules.md`. Lift those lines into `docs/guides/operational-screens.md`, the file that already holds the operational rules, and vendor nothing new. Two things the plan misses matter more than any skill: a one-page inventory of the admin's patterns (which component does which job), where "quick to learn" comes from, and a tap budget per user story written as an acceptance criterion, which is how this repo makes a rule stick.

## 1. Does it give Martin what he described?

- **Few taps:** only L delivers it, and L has no number to aim at; D107 sets no caps until the first audit, which has not run (`docs/reviews/` holds only the codebase scan). *Change:* each story on the design page gets a target tap count taken from how the POS front end or a comparable admin does the same job, and the count becomes an acceptance criterion; the story's Playwright spec, or the audit, counts it.
- **Quick to learn:** the plan defers "the same pattern for the same job" to a parked `design-system` audit, which finds inconsistency after it is built. *Change:* write the pattern list now, one page in `operational-screens.md`: edit an item → side sheet; reversible write → undo toast; venue taken down → typed-name dialog; pick from few → segmented control; empty → one invitation to act. L names the pattern each screen uses; the review checks the screen against the list.
- **Logical:** Martin's word is about where things live, which no per-screen check sees. *Change:* the first design page is an admin map: every screen, what it is for, how the owner reaches it in how many taps. The admin has about a dozen routes plus the venue page's tabs; it fits on a page and is the baseline every later page is placed on.
- **Clean, feels right:** the craft half of frontend-design and the copy rules, as the plan says; the form is wrong (§3).
- **Templates:** nothing to add; D105 and D106 already keep the venue's look and no platform look.
- **The missing loop:** Martin accepts on a local preview, and his taps are the cheapest signal there is. *Change:* the acceptance hand-off lists the design page's stories with their target taps, so he tries those and says which felt long.

## 2. The eight verdicts

- **frontend-design, uninstall the plugin:** right; today.
- **design-critique, vendor:** change to **lift**. After the overrides drop accessibility, Figma, "what I need from you", the output template and "what works well", about fifteen questions remain; its usability axis is wayfinding 2 and 4 plus the tap count, its consistency axis is D107's "same pattern" line. New are four lines: what the eye lands on first, whether the purpose is clear in two seconds, the reading order, whether the right thing is emphasised. The plan's own trial rule ("if the critique produces nothing the wayfinding questions did not, drop D") concedes the overlap. Add the four as a "Screen read" block beside the wayfinding questions; cite the source in the decision file.
- **accessibility-review, vendor:** change to **lift**. The text is twelve criterion numbers, a generic issues list and three tables; the checks (labels, focus, keyboard, contrast, name/role/value) are already in the pinned Vercel accessibility section. What Restro lacks is a standard to cite: one paragraph in the guide, "WCAG 2.1 AA; 44 px targets are Restro's floor (2.5.5 is AAA); a finding names its criterion", with the twelve numbers. The plan's catch on 2.5.5 is correct.
- **ux-copy, two lines:** the confirmation-dialog line, yes. The loading line is "set expectations, reduce anxiety", and the trial found every loading string already ends with "…". Lift one.
- **design-handoff, lift the states list:** right, and L supersedes E. Add the states the generic list lacks and agents get wrong: the member whose role forbids the action, the POS venue where the control is read-only (D87 to D92), Bulgarian text at its longest.
- **design-system, park:** right to park the skill, wrong to wait for the pattern list (§1).
- **user-research, research-synthesis, park:** right.

## 3. Items K and L

**L is the right instrument** and the most valuable line in the plan. It becomes paperwork as a separate page with a template; keep it a fifteen-line section of the ticket: stories with target taps, the pattern used, the one primary action, the states, the new strings in both languages. A wording or visual tweak writes none. **Who writes it:** the planning session during the grilling, where the stories exist; Martin confirms the story list and any behaviour choice (an unspecified UX choice is a stop-and-ask), the lead decides the rest. Never the implementer: the implementer inventing it is today's gap.

**K is the wrong form.** Once the persona, hero, palette, typefaces, the tells list and the two-pass token plan are dropped, the craft half is three paragraphs (structure encodes information; spend boldness in one place and remove one accessory; critique your own screenshots) plus a writing section the plan itself says `copy-rules.md` mirrors. Vendoring 1,500 words a second time, under a second overrides table that neutralises two thirds of them, to keep two hundred, is sprawl and duplication by `writing-for-agents`' tests, and it puts text D106 called "never on the admin" into the admin's folder. Lift three sentences into the guide under "Clean": a divider, a number or a label appears only when the content has that structure; the one memorable element is the primary action and everything else stays quiet; before handing over, take the screenshot and remove one thing. Keep K's subject line as the guide's persona (an owner or manager on a phone at 03:00, one-handed, who never read a manual), after Martin closes D109's open question on the manager's phone (recommendation yes, as D109 says).

## 4. The repo's own rules

- **D106's gate:** done for provenance, licence and fetching; weak on overlap (§2), silent on cost (the 10-17 due diligence gave token figures, this plan none). The trial is deferred to the rework, fine if it can still drop items; make it gate K and L too, not only D.
- **Vendoring form:** §6 says each copy "gains `disable-model-invocation: true` in the overrides' first row, as `upkeep.md` requires". `upkeep.md` says the copy *keeps* its upstream flag, and a flag in an overrides file is inert: Claude Code finds skills only at `.claude/skills/<name>/SKILL.md`, as the repo's own `break-ui` README states. Delete the sentence.
- **Guardrails only tighten:** nothing weakened.
- **One place per rule:** H's table in `restro-flow/SKILL.md` plus the step lines plus the decision file is three places, and SKILL.md is read on every request; put the table in the decision file and let the flow files name the check. Add L, not E. Wayfinding, critique and Vercel's accessibility rules overlap; lifting into one guide resolves it.
- **Unspoken contradictions:** the plan says "D107 stays as written" while §8 says its framing was wrong and L changes how every screen is made: record D123 as refining D107 and add "refined by D123" to D107's status line, as D106 carries D109. The plan assumes the admin on a phone while D109 leaves it open. `template-design`'s description says the admin "never" uses this skill; a second copy under `restro-flow` keeps the letter and blurs the point.
- **Layers, testing limits:** respected; the trial and the review agent are read-only.

## 5. "D107 assumed shadcn plus a port is a design": fair?

Half fair. D107 names the targets (plain words, undo, one primary action) and the measure (taps per story, counted by the audit); it did not assume shadcn is the design, it put the measurement after the fact and left the "how" to D109's guide, which is the repo's pattern. The Platform reference is a port map of mechanics with a "fix while porting" column and says nothing on aesthetics, as the due diligence noted. The fair sentence: D107 set the right goals and a check after the fact, and nothing in `build.md` or `ship.md` designs a screen before code. The gap is in the flow, where L puts the fix. Say it that way in D123, so D107 is refined, not reopened.

## 6. Risks and costs

- **Reading load.** As planned, an implementer reads the ticket, the design page, K with overrides, the guide, the Platform files and `copy-rules.md`; the lead at review reads the pinned Vercel rules, their overrides, `copy-rules.md`, two more skills and two more overrides: roughly 6 to 8 thousand tokens of rules before the diff (estimated from file sizes). With lifting: the implementer reads the ticket and one guide; the lead reads the pinned rules, their overrides and that guide.
- **Duplicated checks:** Vercel accessibility against accessibility-review; critique usability against wayfinding 2 and 4 and the tap count; critique consistency against D107; K's writing against `copy-rules.md`; "what works well" against the audit's "Works: one line". Lifting removes each.
- **G slows Martin without better screens:** prototypes exist so he can click, not read. Drop G now; `template.md`'s version is for the lead's brief and stays.
- **Wrong trial screen:** the Design tab was combed by the Vercel trial and T88 fixed its defects, so a trial there under-counts. Use the composer or settings → integrations.
- **The Design plugin left installed until the trial:** its triggers are Martin's own phrases ("what do you think of this screen?"). The trial needs only the text, readable from the plugin cache. Uninstall both plugins today.

## 7. What the plan missed

1. The admin pattern list and the admin map (§1): what "learnable" and "logical" rest on.
2. Taps as acceptance criteria, checkable by a spec (§1).
3. Martin's acceptance as the design loop (§1).
4. Closing D109's manager's-phone question before any phone-first rule is written (§3).
5. Restro-specific states on the ticket: role-forbidden, POS-read-only, longest Bulgarian (§2).
6. The admin has no established dark mode (`break-ui` overrides, B9): say contrast is checked in light mode until one exists.
7. Nobody checks the design page before build; the read-only check before a Sonnet-planned ticket set (`restro-flow` §4) should confirm its states cover the personas.

**Unknowns:** the token figures are estimates from file sizes, not measured runs; whether a lifted "Screen read" finds more than the wayfinding questions is what the trial should count, and I have not run one.
