# Song requests — what Martin has decided

Stage 4 of the port flow (`.claude/skills/restro-flow/port.md`), the grilling of the thirty-eight
product rows in [the port map](2026-11-19-song-requests-port-map.md). One row per decision, written
as it settles, in the order asked. Martin reviews this file before any decision file is written.

**Why this is not called `…-decision-log.md`.** The decisions guard (`scripts/decisions.test.ts`,
rule 6) fails a file named `*-decision-log.md` that no decision file names, and a firm row has to
point at a decision file in its last column. The decisions these rows become start at the next free
number, 154, and this branch carries only D1–D123 — the guard's rule 4 forbids writing 154 here,
because 124–153 live on `or/foundation` and `docs/pos-support-answers`. So the file keeps a plain
name and the five-column shape of a decision log, and becomes one by a rename once the decisions
are written on a branch that carries the numbers below it.

**Status vocabulary** (the guard's): `firm` · `later` · `on request` · `out` · `open`.

| Row | The question | What Martin decided | Status | Recorded |
| --- | --- | --- | --- | --- |
| 1.1 | Is D99 (the bidding direction) parked or superseded by this grilling? | Neither inherited nor thrown away: every point is re-decided here, and he will answer whatever is unclear, does not make sense, or can be done more simply. So D99's direction binds nothing in this grilling, and what comes out of it replaces D99 where the two differ. | firm | replaces D99; carried into the decision file at the next free number |
| 1.2 | Can a guest ask for a song without paying? | Yes. A venue setting. Free requests sit in the queue behind every paid one. | firm | to be written over D99 at the next free number |
| 1.3 | Do other guests see how much someone paid? | — | open | round 1, reshaped by 1.10 |
| 1.4 | Do paid greetings come across from the MVP? | — | open | round 1 |
| 1.5 | Can several guests put money on the same song? | — | open | round 1, reshaped by 1.10 |
| 1.6 | When is the money actually taken? | — | open | round 1 |
| 1.7 | How many songs does the DJ lock, and does a guest see them? | — | open | round 1 |
| 1.8 | Does asking for a song need a table code? | — | open | round 1, D100 |
| 1.9 | The venue's settings and their defaults | — | open | round 1 |
| 1.10 | A standard price for a request instead of a free-text bid? | — | open | asked by Martin, answered in round 1b |

## Where this leaves the map

The fourteen product questions in the map collapse further than round 1 assumed. Row 1.10 — Martin's
own question — decides whether the ranking machinery (order by total, chip-in, succession, partial
capture) is built at all, so the rows it reshapes wait for it rather than being asked again.
