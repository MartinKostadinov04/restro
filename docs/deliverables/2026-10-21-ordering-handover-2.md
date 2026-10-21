Made by: lead session (Opus), end of 10-21. For: the fresh lead session that takes over map #29, and Martin. It revises `2026-10-21-ordering-handover.md`, which stays as the record of the state before the ticket review.

# Ordering: the handover after the ticket review (10-21)

## In one paragraph

Ordering and paying are planned, not built. D122 holds every rule for the pilot, which runs Mistral and includes paying in the app. On 10-21 an independent Opus review checked map #29's tickets (`2026-10-21-map-29-ticket-review.md`). Martin answered its questions, and the map was reworked. The design-skills session then landed D123: every operational screen gets a screen plan before its code. Every open ticket is now written and linked. The next work is the waves below, starting with #49 (payment provider) and the Tonight prototype (#50).

## Read first, in this order

1. **[Map #29](https://github.com/MartinKostadinov04/restro/issues/29)'s body:** the Notes (the end of the map in two parts, the template rule, design under D123), the decisions so far, and what is still fog.
2. **`docs/decisions/D122.md`**, especially "Martin's answers to the ticket review" near the top:
   - build now, and the Mistral connector gets its own spec when Mistral answers;
   - tips are in the pilot;
   - "call a waiter" is in the pilot;
   - the guest template is designed last, by its own agent.
3. **For a screen ticket:** `docs/decisions/D123.md`, `.claude/skills/restro-flow/ship.md` §1 (the screen plan), `docs/guides/operational-screens.md` (read it whole) and `docs/guides/admin-map.md`.
4. **The ticket you are working,** and only the files it names. The earlier handover's "Where to read" list still holds for the background (the glossary, the Mistral list, Martin's answers).

## What is settled; don't ask Martin again

- **The pilot runs the whole workflow,** paying included. Never design around a smaller pilot unless he says so.
- **The order of steps when paying:**
  1. the guest confirms from a fresh reading;
  2. the card is held;
  3. the lines are moved and read back (the last check);
  4. close and capture within seconds.
- **The payment form:** the provider's embedded form.
- **Refunds:** done in the provider's dashboard, never through Restro, never at night.
- **Tips:** yes.
- **"Call a waiter":** yes. Its calls land in the staff screen's actions (#50).
- **Mistral:** the platform is built without waiting for it. If Mistral refuses or stays silent, that is decided then (Martin: "not for you, now").
- **Technical tuning** (thresholds, timings, keys, flags) is the lead's to research, decide and report. It is never Martin's.

## To confirm with Martin in passing

- **"Action screen":** Martin's words for where "call a waiter" lives. The lead read it as Tonight's actions area (D122 §4). Confirm when #50 starts.

## Gates before any code

1. Adjustments 01's pull request (#46) is merged into `main` by Martin. Let #58 (44 px controls, running in its own session) land on `ad/foundation` first, so it needn't be moved.
2. Martin opens ordering in the tracker (D79).
3. The POS-neutral spec exists: `to-spec` and `to-tickets` after the planning tickets, as in #29's Notes.

## Branches

- After #46 merges, cut the ordering stage branch from `main`: `or/foundation`.
- Planning output (decisions, decision logs, deliverables, open items) is committed straight to the stage branch (`lead.md`, direct commits). Until `or/foundation` exists, it goes on `ad/foundation`, as today.
- Each build ticket gets `or/<slug>` in its own worktree and a pull request into `or/foundation`. The lead reviews and merges one at a time. The stage reaches `main` only through Martin.
- Build branches for screens (#50, #61) are cut after #58 merges.

## The waves

Martin is in one grilling or prototype at a time. Agent-only tickets run beside it, within the limits:
- at most two agents running tests;
- not several Opus agents at once (D58);
- one finished build waiting for acceptance.

| Wave | With Martin | In the background | Model and why |
|---|---|---|---|
| 1 | [#49](https://github.com/MartinKostadinov04/restro/issues/49) payment provider (grilling) | [#54](https://github.com/MartinKostadinov04/restro/issues/54) refunds and disputes in Restro (small task, the lead); [#55](https://github.com/MartinKostadinov04/restro/issues/55) service data, roles, retention (grilling, technical); [#51](https://github.com/MartinKostadinov04/restro/issues/51) simulated test POS (grilling, technical); [#52](https://github.com/MartinKostadinov04/restro/issues/52) the research agent's working answers. Martin sends [#48](https://github.com/MartinKostadinov04/restro/issues/48) to Mistral | Opus for #49, #55 and #51 (money, the write path, architecture), staggered, never all at once. #52's research is Opus, as on 10-20 |
| 2 | [#50](https://github.com/MartinKostadinov04/restro/issues/50) Tonight, one screen first; then [#61](https://github.com/MartinKostadinov04/restro/issues/61) the owner's setup screens | [#56](https://github.com/MartinKostadinov04/restro/issues/56) pilot readiness list (after #52) | Prototypes: the lead on Opus with a design subagent. #56 on Sonnet |
| 3 | [#45](https://github.com/MartinKostadinov04/restro/issues/45) the guest's bill and paying: behaviour and words only (after #49) | [#53](https://github.com/MartinKostadinov04/restro/issues/53) payment commands (after #49 and #45), plus an independent Opus second opinion | Opus: money and security |
| 4 | the ticket list in plain words | [#57](https://github.com/MartinKostadinov04/restro/issues/57) template assignment file (Sonnet), then the architecture doc update, `to-spec` and `to-tickets` | Build tickets by D58: Opus for payments, money, the write path, pauses, the location pass and RLS; Sonnet for screens, the test POS and Telegram; Haiku for strings. The lead codes migrations and guardrails |

[#47](https://github.com/MartinKostadinov04/restro/issues/47) (read-back on barsy) runs on Sonnet whenever test access exists.

**The first prototype:** Tonight. Martin has seen one version and knows what was wrong. #50 is formally blocked by #54, but only for the money alerts' contents. Start its first screen while #54 runs.

**Prototypes are throwaway** (`prototype`): Tonight (one screen first), the setup screens (the grouping first, then one screen), and the guest bill flow in neutral styling. The decision tickets get none.

## Agreed with the design-skills session (10-21)

- **Tonight adds a staff persona:** a bartender at the bar tablet and a waiter on a phone, mid-service.
  - It goes into the persona paragraph of `operational-screens.md`, with the same checks as the owner's persona.
  - A tablet difference gets one line each in that paragraph, never a second guide.
  - Send the line to that session before it lands. It lands with #50's build pull request.
- **#61 carries the Integrations fixes:**
  - #59's overflow, and the trial's stray scrollbar (finding 2.2), go in its Done-when;
  - it closes #59.
- **#60's divergences** on a redesigned screen are fixed by that screen's plan.
- **Target taps come from D115:** a POS front end, or a comparable staff or admin screen. Where a story has no comparable, ask that session rather than guess.

## Remind Martin, when it fits

- **The law points (#52):**
  - the lawyer's and accountant's questions;
  - L3;
  - Q63;
  - tips (Q10);
  - privacy (Q67, T31);
  - the guest's payment terms;
  - allergens;
  - the NRA list.
- **Sending the Mistral list** (#48): it is the longest wait before the pilot.
- **CLAUDE.md's "no webhooks" and connector-import lines,** if #53 finds they need new wording. Changing CLAUDE.md needs Martin's go-ahead.

## Loose ends

- The tracker change "T69 ahead of #47" was never approved. T69 now points to #48.
- Staging migrations need Martin's OK.
- `transaction-processing-rules.pdf` is untracked at the repo root. Never commit it.
- The repo is public, and must stay public so CI is free.
