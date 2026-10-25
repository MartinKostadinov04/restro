---
name: restro-flow
description: Start every new piece of Restro work here, before planning or coding. Classifies the request (explain, decide, build, change, bug, audit, upkeep, outside question, human-only step) and, for the flows that make work, lays out the plan with the skills each step runs for Martin's OK. Use for any new request from Martin, a question included.
---

# Restro flow

For the lead (`docs/agents/lead.md`). One request → one **category** → one **flow**: classify (§1), show the **plan card** where §2 says, then walk the flow step by step. A coding agent working from a ticket skips this skill: its ticket is its flow.

**Matt's skills govern how a step runs.** The flow files below never restate a skill; they name it and add only what is Restro's: who decides, the limits in `docs/agents/lead.md`, the testing tiers and the stop-and-ask list in CLAUDE.md, and the decisions (`docs/decisions/`). Where a skill's text and a Restro rule differ, the Restro rule wins only when the flow file says so explicitly.

## 1. Classify

| Category | Signals | Flow |
|---|---|---|
| **Quick** | one answer, one edit, a few tool calls | none: do it |
| **Explain** | Martin asks how something works or why it is the way it is | `decide.md` → Explain |
| **Decide** | a product or business decision with no code behind it; the output is a D-number | `decide.md` → Decide |
| **Build › Feature** | one new behaviour a user can see; grilling, ticket and build fit one session | `build.md` → Feature |
| **Build › Feature set** | several features toward one clear destination; more than one session to build | `build.md` → Feature set |
| **Build › Architecture** | the data model, a seam (a connector, a layer), a rule across packages; or the way there is foggy | `build.md` → Architecture |
| **Build › Template** | a new guest menu template, or a change to one (D69, D105) | `template.md` |
| **Change** | an existing feature should behave, read or look different; Martin's feedback or acceptance notes | `change.md` |
| **Bug** | broken, throwing, wrong, slow or flaky | `bug.md` |
| **Audit › Behaviour** | does it work as intended, judged as the people who use it | `audit-behaviour.md` |
| **Audit › Security** | attack it: tenancy, roles, inputs, tokens, secrets | `audit-security.md` |
| **Audit › Robustness** | things at once or failing halfway: races, retries, partial reads, time | `audit-robustness.md` |
| **Upkeep** | codebase health, agent docs, a retro, incoming reports, operations (rehearsals, fixtures, upgrades) | `upkeep.md` |
| **Release** | staging or production: deploy, migrate, incident (parked until the tracker opens it) | `upkeep.md` → Release |
| **Outside question** | the answer sits with Lukanet, a lawyer, a pilot owner, or in external docs | `upkeep.md` → Outside question |
| **Human-only step** | accounts, secrets, DNS, dashboards only Martin can operate | `upkeep.md` → Human-only step |

- **Size test, Feature vs Feature set:** can the grilling, the tickets and the build fit one session (~150k tokens) and land as at most three tickets? Yes → Feature.
- **Mixed requests:** classify by what Martin asked for; fold the rest in as a step (a bug found during a change becomes a step of the change).
- **Reclassify** when the grilling shows the size was wrong, and tell Martin in one line.

Read only the flow file the category names, plus `ship.md` when the flow changes code.

## 2. The plan card

Before a Build, Change, Bug, Audit or Upkeep flow starts (the flows that make sessions, tickets or code), show Martin the card, in plain language and `GLOSSARY.md` terms, and wait for his OK. Explain, Decide and Outside question are answered directly, with no card (Martin 10-17).

```
**Category:** Build › Feature set: <one line on why>
**Plan:**
1. <step>: <skill> — <what it produces> (<who: you / lead / agent session>)
2. …
**Your part:** the decisions and grilling rounds you will be asked
**Lead model:** Sonnet | Opus | Fable — the rung and why in one line (D108); the lead switches the session itself before step 1
**Sessions:** how many agent sessions, which models (D58), within `docs/agents/lead.md`'s limits
**Left out:** flow steps skipped, and why
```

End the turn with the card and one question: approve, or change the plan. Martin's approval of the card is the trigger for every user-invoked skill on it (Martin, 10-16). If anything on the card or in a later message does not land, Martin types `/mattpocock-skills:wait-what` and gets it re-pitched in plain words.

## 3. Running the skills

- **Model-invoked** (call the Skill tool): `grilling`, `domain-modeling`, `tdd`, `diagnosing-bugs`, `mattpocock-skills:code-review` (Standards + Spec), `codebase-design`, `research`, `prototype`, `pr`, `wizard`, `writing-for-agents`; built-in `code-review` (correctness), `security-review`, `run`.
- **User-invoked** (`grill-with-docs`, `to-spec`, `to-tickets`, `wayfinder`, `implement`, `implement-spec`, `improve-codebase-architecture`, `retro`, `to-questionnaire`, `triage`, `teach`): once the card is approved, read the skill's `SKILL.md` and follow it. It lives under `C:\Users\Martin\.claude\plugins\cache\claude-plugins-official\mattpocock-skills\1.3.1\skills\<group>\<name>\SKILL.md` (pinned at 1.3.1; `<group>` is `engineering` or `productivity`). `grill-with-docs` is `grilling` + `domain-modeling`.
- **Who confirms what:** where a skill asks "the user" to confirm a technical choice (test seams, ticket granularity, blocking edges), the lead decides and tells Martin in one line. Behaviour, wording, scope and anything a decision covers go to Martin.
- **The plugin is pinned at 1.3.1** (Martin 10-17, D106's policy for every adopted skill). An upgrade is an Upkeep ticket (`upkeep.md` → Agent environment) that re-checks every flow file against the new skill text; a flow file that then disagrees with the skill is fixed there.

## 4. Models for planning (D104, D108)

Read `docs/decisions/D104.md` (the **heavy zone**, the "I don't know" steps) and `D108.md` (the rungs) before the card.

- **Three rungs, one at a time.** Sonnet by default; Opus for a real trade-off or a question spanning more than one area; Fable for the heavy zone. Check at classification and on every grilling question. To climb, write the rung and the reason in one line ("Opus: trade-off between X and Y", "Fable: heavy zone, RLS") and switch the session model yourself; never Sonnet to Fable without considering Opus.
- **The rung is sticky.** The model that planned a ticket reviews its diff and sets each ticket's model by D58. Go back down only at a classification outside the heavy zone, when none of your tickets is still in review.
- **"I don't know"** from Martin runs D104's four steps: fetch a missing fact first, else a proposal from the lead, an Opus agent or a Fable agent (`effort: max`) by complexity, put back to Martin as the next question.
- **Before a Sonnet-planned feature set publishes tickets,** one read-only Fable agent checks the spec and tickets against the nine rules and the decisions in force, and that every screen plan's states cover the personas it serves (`ship.md` §1).

## 5. Every flow keeps

- **Inside the current phase:** check CLAUDE.md's "Scope right now" before the card. Work outside it (ordering, payments, POS writes, a parked connector, a deploy) goes on the card as "outside the current phase", for Martin to start or park.
- **Facts are the agent's job; decisions are Martin's.** A grilling round asks Martin only what he can decide, each question with a recommendation.
- **Decisions are files** `docs/decisions/D<n>.md` (`docs/agents/domain.md`); terms go to `GLOSSARY.md` as they settle. Every grilling keeps a decision log and wires it (`domain.md` → "Decision logs"); when a decision alone is unclear, `revisit-decision` reads the log behind it.
- **Specs and tickets are GitHub issues** (`docs/agents/issue-tracker.md`); every code change leaves through `ship.md`.
- **Phase boundaries:** one unbroken window from grilling to tickets; at a boundary follow `ask-matt`'s `PHASE-BOUNDARIES.md` (same folder as the `ask-matt` skill). An "agent session" here is the desktop app's session, Matt's "subagent". The app's fork and hand-off sessions do `handoff`'s job; `handoff` itself is only for work leaving this app (another tool, a person).
- **Limits:** `docs/agents/lead.md`.
- **Close the loop:** after work that went sideways, `retro` in that session.
