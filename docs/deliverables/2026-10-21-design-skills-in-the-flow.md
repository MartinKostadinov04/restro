# Design skills in the Restro flow: review and proposal (2026-10-21)

Lead session (Fable), for Martin. Asked: review `restro-flow` in detail, map every place a UI/UX design skill is needed (planning and tickets, prototypes, feature design, review, audits), and propose the additions. The candidates are Anthropic's `frontend-design` skill and the seven skills of Anthropic's **Design** plugin (`design-critique`, `accessibility-review`, `ux-copy`, `design-system`, `design-handoff`, `user-research`, `research-synthesis`), both installed on this PC today at Martin's "run all". Rework and an independent review follow Martin's approval.

## 1. First, a correction

**The `frontend-design` plugin should not have been installed.** D106 adopted that exact skill on 10-17 as the visual-direction layer of `template-design`, vendored verbatim under its `references/`, and ruled that it is *never* a standalone skill: its trigger ("building new UI or reshaping an existing one") would fire on every admin screen, where distinctiveness is not wanted (D107). The due diligence behind it (`2026-10-17-frontend-design-and-vercel-due-diligence.md`, §5) says in so many words "do not install the upstream skill; if the official plugin is ever enabled it would fire everywhere", and `upkeep.md` keeps the rule: "Install nothing from a vendored repository as a skill or plugin." I recommended it and installed it without checking the decision first. The plugin's text is byte-for-byte the vendored copy (checked with `diff`), so nothing has drifted and nothing in the repo needs changing. **Recommendation: uninstall it today** (`claude plugin uninstall frontend-design@claude-plugins-official`); the vendored copy already does its job.

The **Design** plugin stays installed only for the trial D106 requires before adoption (one run on real screens, §6 below), then it goes too: once its useful parts are vendored, a second, un-overridden copy that can fire on its own is exactly what D106 and D109 keep out.

## 2. What the flow already has for design

The flow is not empty on design; it is uneven. In force today:

| Surface | While designing or building | At review | At audit |
|---|---|---|---|
| **Guest template** (D105) | `template-design`: the functionality file, the designer guide §7.5, vendored `frontend-design` under Restro overrides, the motion standards, `interaction-polish.md` | `template-review`: coverage, contract tests, screenshots against §7.5/§9.5, the **pinned Vercel guidelines** with overrides, motion audit (Emil Kowalski, D109), touch checks, `copy-rules.md`, Matt's code review against the brief | Guest persona in `audit-behaviour.md`; "the accessibility checks the faces specs already use" |
| **Operational screen** (D107) | nothing design-specific: the ticket, the Platform port map, shadcn; D107's rules are checked only after the fact | `ship.md` §3: the lead audits the diff against the pinned Vercel guidelines + `copy-rules.md` | `audit-behaviour.md` step 4: personas, taps per story, the four wayfinding questions and three feedback checks (`operational-screens.md`), the worst-case data pass (vendored `break-ui`), 320 px, 200 % zoom, hover-only actions, the 07:00 edge |

So the guest side is covered end to end. The operational side has a strong *audit* and a mechanical *code review*, and nothing in between: nobody looks at an operational screen as a screen (what the owner sees first, what the one primary action is, whether the states exist) before the behaviour audit, which runs only when Martin asks for it.

**"The Vercel skills"** are one thing: the pinned copy of Vercel's web interface guidelines (`template-review/references/web-interface-guidelines.pinned.md`), a line-by-line checklist over *code* (aria-labels, focus rings, `touch-action`, `dvh`, hydration, i18n). It is used in two places, the template reviewer's step 4 and the lead's review of an admin UI diff. Every proposal below says how it relates to it.

## 3. The gaps, flow by flow

Read from the flow files, not from the plugin's marketing. A "gap" is a place where an agent today has no instruction and improvises.

| Flow and step | What happens today | Gap |
|---|---|---|
| `build.md` Feature / Feature set, when a ticket adds or changes an **operational screen** | The implementer ports a Platform pattern in shadcn from the ticket's text | The ticket names no states (empty, loading, failed, long text, many items), no primary action, no strings. The implementer invents them; the audit finds them later. |
| `ship.md` §1, the ticket block | Model, who codes, branch, what to read, menu functionality | No line for a screen. |
| `ship.md` §3, review of an **admin UI diff** | Vercel pinned rules over the code, `copy-rules.md` over the strings | Nobody opens the screen. Hierarchy, the primary action, consistency with the neighbouring screens and D107's taps are not looked at per pull request. No accessibility standard is named, so a finding cannot cite one. |
| `change.md` step 3, **prototype** variations of an admin screen | `prototype` builds them; Martin clicks through and picks | Each variation comes with no structured one-paragraph read (what the eye lands on, what it costs), so Martin compares raw. (`template.md` step 1 already demands "when it wins and what it costs" per direction; `change.md` does not.) |
| `audit-behaviour.md` step 4, **operational screens** | Taps, wayfinding, feedback, worst-case data, zoom, hover, time | Accessibility is checked only for guest pages. An owner on a phone at 03:00 gets no contrast, label, focus-order or keyboard check, and no finding cites a criterion. |
| `upkeep.md` → Codebase health | Matt's `improve-codebase-architecture` over the code's shape | D107 says "the same pattern for the same job everywhere" and nothing ever scans the admin for it (hardcoded values, a dialog here and a sheet there for the same job). |
| `template.md`, `template-design`, `template-review` | Full pipeline (above) | None worth a new skill. The reviewer is already long; adding WCAG numbering to its findings would add labels, not checks. |
| `decide.md`, `bug.md`, the security and robustness audits | No design content | None. |
| Incoming reports, pilot feedback (`upkeep.md`, `change.md` step 4) | `triage` per report; a feedback list becomes tickets | No way to read *many* reports or an owner interview as one body of evidence. Not needed until the pilot produces them. |

## 4. The eight candidates, one verdict each

Judged by D106's gate: provenance and licence, what the skill reads or fetches, conflicts with the nine rules and the guides, overlap with what the repo already says, trigger, cost, and a trial on real screens. Both plugins are Anthropic's, Apache 2.0, read nothing and fetch nothing on their own (the Design skills *offer* to pull from Figma or a tracker when a connector exists; none is connected and none is needed).

| Skill | What it is, honestly | Verdict | Where it would run |
|---|---|---|---|
| **frontend-design** | The visual-direction persona for a distinctive look | **Already adopted (D106). Uninstall the plugin.** | `template-design` step 2, as today |
| **design-critique** | A five-part frame for looking at a screen: first impression, usability, hierarchy, consistency, accessibility; a severity table; "what works well"; three priorities | **Adopt, vendored with overrides.** It is the one skill that looks at the *screen* rather than the code. Its content is generic; its value is the fixed frame, which stops each lead or auditor inventing their own. | `ship.md` §3 on an admin UI diff; `audit-behaviour.md` step 4 per operational screen; one short read per variation in `change.md` step 3 |
| **accessibility-review** | WCAG 2.1 AA criteria by number (contrast, labels, keyboard, focus order, name/role/value), a keyboard table, a screen-reader table, "zoom to 200 %" | **Adopt for operational screens, vendored with overrides.** Restro names no accessibility standard today; this one gives findings a criterion to cite. Not for faces: §7.5, the Vercel rules and the contract suite already cover them and the reviewer is long enough. One correction goes into the overrides: the skill lists 2.5.5 (44×44 px targets) as AA; in WCAG 2.1 it is AAA. Restro keeps 44 px as its own floor (§7.5) and cites it correctly. | `ship.md` §3 on an admin UI diff, beside the Vercel rules; `audit-behaviour.md` step 4 on operational screens |
| **ux-copy** | Verb-first buttons, error = what + why + fix, empty states that invite, confirmation dialogs named by the action, a tone table, alternatives, localisation notes | **Do not adopt.** `copy-rules.md` already holds its rules in Restro's stricter form (sentence case in both languages, glossary words, `{source}`, next-intl, Bulgarian written for a Bulgarian). Two lines are worth lifting into `copy-rules.md`: the confirmation-dialog rule (buttons say the action and the consequence, never OK/Cancel; it applies to the one typed-name dialog D107 keeps) and the loading-state rule (say what is happening, in the shell's or next-intl's words). | n/a |
| **design-handoff** | A spec sheet from a design to engineering: tokens, states, responsive table, edge cases, motion table | **Do not adopt as a skill; lift its checklist.** Restro's handoffs are the ticket (`to-tickets`) and, for templates, the design-intent note, which is already richer. What is missing is its *states and edge cases* list on a ticket that touches an operational screen. That becomes a Restro-owned "Screen" line in `ship.md`'s ticket block (§5 E). | the ticket |
| **design-system** | Audit a component set for naming inconsistencies and hardcoded values; document or extend a component | **Park, with a trigger.** The audit mode fits the D107 consistency gap and nothing else covers it. But the admin's "system" is shadcn plus the Platform port map, and the first tap-count baseline of the operational screens (the behaviour audit after Adjustments 01 reaches `main`, D107) is not in yet. Adopt the audit mode as an Upkeep → Codebase health pass once that baseline exists. Document/extend modes: not needed. | later: `upkeep.md` → Codebase health |
| **user-research** | Methods table, interview-guide structure, analysis frameworks | **Park.** Restro's questions to a person go through Matt's `to-questionnaire` today, which fits the pilot owners. Revisit when the pilot starts and owners are interviewed, not before. | later |
| **research-synthesis** | Turn transcripts, tickets, survey answers into themes, segments and next steps | **Park, with a trigger.** Useful the first time there are many reports from a pilot venue or notes from owner calls to read as one body (`change.md` step 4, `upkeep.md` → Incoming reports). Nothing to synthesise yet. | later |

## 5. The framework additions (what Martin approves)

Each is a change to a file Restro owns. A vendored skill follows D106's form: a verbatim copy with `README.md` (source, commit, licence, date), and a `<name>.restro-overrides.md` read first that wins on every conflict and neutralises the human-dialogue parts ("what I need from you", `$ARGUMENTS`, the Figma and tracker offers), the way `break-ui.restro-overrides.md` row B1 does.

- **A. Uninstall the `frontend-design` plugin** (today, Martin's account; one command). No repo change.
- **B. Vendor `design-critique` and `accessibility-review`** under `.claude/skills/restro-flow/references/` (where `break-ui` already lives, because the flow files are what use them), from `anthropics/knowledge-work-plugins` at commit `bc8f6922` (2026-10-20, Apache 2.0), each with its README and overrides file. The overrides, in brief:
  - *design-critique:* the context is the ticket or the audit's user story, never a question to the user; no Figma; the design system is shadcn, the Platform port map and D107; the severity table maps to the flow's own sorting (`ship.md`: a finding back to the session or a ticket; `audit-behaviour.md`: Works, Broken, Works but awkward with S/M/L); its accessibility part is dropped (the accessibility pass owns it); "what works well" is one line; findings name the screen and the element, and say what to change.
  - *accessibility-review:* operational screens only, never a face; WCAG 2.1 AA as the named standard, 44 px kept as Restro's floor and cited as such; the "automated scan" is the checks the faces specs already use, the "screen reader" table is read from the built-in browser's accessibility tree, VoiceOver and NVDA are `device` lines for Martin; no ticket creation (findings go through the flow); contrast is checked on the admin's own colours only (a face's colours are the venue's).
- **C. `ship.md` §3, the admin UI diff:** after the Vercel pinned audit, the lead opens the changed screens in the preview and runs the critique frame and the accessibility criteria on them (one short pass each, the overrides say what to skip). Today the Vercel rules read the code; these read the screen. One sentence states that split, so the three never duplicate.
- **D. `audit-behaviour.md` step 4, operational screens:** one new sub-bullet: the critique frame answers "what the owner sees first and what the one primary action is" per screen, alongside the seven wayfinding and feedback answers; the accessibility criteria run once per screen, each finding citing its criterion. Both sort into step 5 as today.
- **E. `ship.md` §1, the ticket block:** a new optional line, `- **Screen:** none | <states: empty, loading, failed, long text, many items>; the one primary action; new strings BG + EN`, required when the ticket adds or changes an operational screen. Lifted from `design-handoff`'s checklist; Restro-owned text, so no vendoring.
- **F. `copy-rules.md`:** the two lines from `ux-copy` (confirmation dialogs; loading states).
- **G. `change.md` step 3:** each prototype variation of an admin screen comes with the critique frame's first two lines (what the eye lands on first; what the variation costs), so Martin compares like with like. `template.md` step 1 already has its own version of this and does not change.
- **H. `restro-flow/SKILL.md` §3:** a short table, *Design checks: which, what it looks at, where it runs*, covering `frontend-design`, the Vercel pinned rules, `design-critique`, `accessibility-review`, `copy-rules.md`, `review-animations`, `break-ui`. One place for the "when what is used" question; the flow files name the check at the step and point here.
- **I. A decision file**, `D123` or the next free number, "What enters from Anthropic's Design plugin, where, and what stays out", in D109's form: adopted (critique, accessibility), lifted as Restro text (handoff checklist, two copy lines), parked with triggers (design-system, user-research, research-synthesis), and the rule that the plugin itself is not kept installed. Its index row, and this file's row in `docs/deliverables.md`.
- **J. Uninstall the Design plugin** after B lands and the trial (§6) is done.

Out of scope on purpose: no change to `template-design`, `template-review` or the designer guide; no new skill entry under `.claude/skills/` (nothing new can fire on its own); no change to CLAUDE.md.

## 6. How the checks are activated by agents, not by a person typing `/`

Martin asked for this explicitly. Two mechanisms exist:

1. **A plugin skill** can be called by an agent through the Skill tool (none of the seven sets `disable-model-invocation`), but it lives in one account's plugin folder on this PC: a cloud session, a session on another machine, or a reviewer subagent started elsewhere would not have it, and its text asks "the user" for context and offers Figma and tracker actions an agent must not take.
2. **A vendored reference** is a file in the repo that a flow file tells the agent to read at a named step. Every agent that reads the flow runs it, on any machine, with Restro's overrides first. This is how `break-ui`, `review-animations`, the Vercel rules and `frontend-design` already run, and it is D106's form.

The proposal uses only the second. The activation points are the flow steps in §5 C, D and G; no slash command is involved anywhere. Each vendored copy keeps the upstream frontmatter (for a diffable update) and gains `disable-model-invocation: true` in the overrides' first row, as `upkeep.md` requires, so a stray trigger cannot fire it outside its step.

## 7. The trial D106 requires, and the independent review (after approval)

- **Trial:** run the two vendored passes once on one real operational screen (the Design tab, which the 10-17 trial also used) during the rework, and report counts: findings, noise, and what the Vercel rules had already caught. If the critique produces nothing the wayfinding questions did not, D is dropped and C stays.
- **Review:** an independent read-only Opus agent reviews the implementation against `writing-for-agents` (one place per rule, prunes what does not change behaviour), D106's gate (conflicts with the nine rules and the guides, overlap, trigger, cost) and the overrides' completeness (every human-dialogue line of the upstream text neutralised). It reports a quality verdict and a list; a read-only agent does not count towards the two-test-agent limit (`lead.md`).

## 8. Revision after Martin's pushback (10-21, same day)

Martin: the admin is not meant to be *un*distinctive; it is meant to be clean, logical, quick to learn and short in taps, "something that feels right". The templates are client-facing and do not use the platform's look. He asked what the skills can produce against those goals.

Reading `frontend-design` in full, it is two halves. The first is visual identity: a persona told to take aesthetic risk, a hero, a hex palette, chosen typefaces, one bold move, the list of AI tells. It produces a look and says nothing about taps or learnability; keeping it off the admin was right. The second is craft: structure as information, restraint, self-critique with screenshots, and a writing section that `copy-rules.md` already mirrors. That half applies to any screen. D107's framing ("consistency and calm: shadcn, the Platform port") assumed shadcn plus a port *is* a design; nothing in the flow designs an operational screen, and clean, logical and few taps are three different things of which only "clean" comes with shadcn.

Against his goals: **few taps** come from deciding the flow before code (screens, what each does, taps per story counted on the plan), which none of the eight skills produces (`prototype` builds it, `audit-behaviour` and `design-critique` judge it afterwards); **easy to learn** comes from the same pattern for the same job and one primary action per screen (`design-critique`'s consistency axis after the fact, `design-system`'s audit across screens later); **clean, feels right** comes from `frontend-design`'s craft half and the copy rules; the **templates** already have what they need under D105.

Two additions to §5, replacing nothing:

- **K. Vendor `frontend-design` a second time, for operational screens,** under `restro-flow/references/` with an admin overrides file: drop the persona, the hero, the palette, the typeface choice and "aesthetic risk"; keep subject grounding (the subject is an owner or manager on a phone at 03:00, one-handed, who has never read a manual), structure as information, restraint, self-critique with screenshots, and the writing section (pointing to `copy-rules.md` as the ruling text). Read by the design step below and by the implementer of a screen ticket.
- **L. A design step before code for an operational screen** (Restro's own text in `build.md` and `change.md`, no vendoring): for a new or changed screen, the planning session writes one page before the ticket: the user stories it serves and the target taps for each, what is on the screen, the one primary action, the states (empty, loading, failed, long text, many items), the words in both languages. `prototype` when the layout is open; the page goes into the ticket (it replaces item E's "Screen" line); `design-critique` at review and the behaviour audit judge the built screen against that page, not against taste. Backend tickets write `none` and pay nothing.

D107 stays as written. D106's "never a standalone skill: its trigger would fire on admin screens" is refined, the way D109 refined D106: the identity half never on the admin; the craft half, under its own overrides, yes. The decision file of item I records both.

## 9. Open questions, each with a recommendation

1. **Keep the Design plugin installed for Martin's own use** (`/ux-copy` when he wants wording ideas)? Recommendation: no. `upkeep.md`'s rule exists because a second, un-overridden copy fires on its own; if he wants a copy helper, a Restro-owned one-paragraph note can be added later.
2. **Where should the accessibility pass stop on contrast?** The admin's colours are shadcn's defaults with no Restro theme yet; the guest side is the venue's colours. Recommendation: check the admin's fixed colours only, and leave guest contrast to the theme presets (a platform question for later, not a template one).
3. **Is G (the critique read per prototype variation) worth its lines?** Recommendation: yes, but it is the first thing to drop if the rework shows it adds more text than help.
