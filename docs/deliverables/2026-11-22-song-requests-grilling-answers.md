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
| 1.10 | A standard price for a request instead of a free-text bid? | Yes, and further: release 1 ships **one price**, a single setting. Several price steps, and even bidding, stay possible but are not built. | firm | asked by Martin; carried into the decision file at the next free number |
| 1.10a | Is "one price now, tiers or bidding later" actually reachable, or does it paint us into a corner? | — | open | answered in round 1b against D122 §9 |
| 1.11 | The DJ beat matches, so a paid place in a queue cannot mean "this is your next track" | — | open | raised by Martin, round 1b |
| 1.12 | The DJ can agree or disagree with a song that does not fit the theme or the mood | — | open | raised by Martin, round 1b |
| 1.13 | Does the venue screen requests before the DJ sees them at all? | — | open | round 1b |
| 1.14 | What does the guest see while he waits? | — | open | round 2 |
| 1.15 | Can a guest take his money back before the song plays? | — | open | round 2, map Q7 |
| 1.16 | When does the venue stop taking requests for the night? | — | open | round 2, map Q8 |
| 1.17 | Can the same song be asked for again, and how soon? | — | open | round 2, map Q9 |
| 1.18 | Who answers a guest whose song never played? | — | open | round 2, map Q12, decision 148 |

**Rows the earlier answers killed outright.** Map Q6 (one backer's card fails while others succeed)
is gone with chip-ins — there is one payer in release 1. Map Q13 (whose account, who is the seller)
Martin answered on 2026-11-19: the venue's own, D98 unchanged. Map Q14 (Restro's charge) belongs to
the platform's charging model, not to this feature. Map Q2 is down to one word: names.

## Where this leaves the map

The fourteen product questions in the map collapse further than round 1 assumed. Row 1.10 — Martin's
own question — decides whether the ranking machinery (order by total, chip-in, succession, partial
capture) is built at all, so the rows it reshapes wait for it rather than being asked again.

Rows 1.11 and 1.12, also Martin's, move the whole model off "position in a queue". A DJ mixing a set
cannot be handed a next track by a price, so a paid step has to promise a **window** he works inside,
not a slot. That is a synthesis, not a found product rule: the one published neighbour is TipTunez's
refund if an approved song has not played within 45 minutes, and the DJ's veto, which almost every
product in [the research](2026-11-18-song-requests-how-others-do-it.md) gives a human. It also gives
row 1.6 (when the money is taken) its natural shape — captured when he starts the song, released
when the window runs out — and answers "what if it never plays" without a new rule.

## One price now, more later: what has to be true (row 1.10a)

Reachable, and most of it is already how the service layer is built. The
[service data design](2026-10-21-service-data-design.md) keeps `payments` as **their own rows** with
an append-only `payment_steps` beside them, separate from the thing being paid for, all written
through `applyService` (D122 §9). That one existing shape is what makes all three futures reachable
without a migration: one price is one payment row per request, bidding is the same row with a
varying amount, chip-ins are more than one row against the same request.

Five things have to be got right while building the single-price version. Each is cheap now and
expensive to retrofit:

1. **Store the amount on every request, always**, in integer minor units through the `money` module
   (rule 8) — never infer it from the venue's current setting. Bidding later is then a policy
   change, not a backfill.
2. **Order by (priority, asked-at), never by a stored position.** With one price every request's
   priority is equal, so the order is arrival order and nothing has to change later.
3. **A pricing policy that is a list with one row today, not a `price` column on the venue.** The
   single most important of the five, and it costs a table instead of a column.
4. **Record which policy priced each request** (rule 2's provenance). A venue that changes its
   prices mid-night must not re-price the requests already waiting.
5. **A request has payments, plural, from the start** — one today, no chip-in screen, no succession,
   no partial capture. This is the one that cannot be retrofitted cheaply, because it turns a
   request from having a payer into having backers.

Point 5 is why row 1.5 (two guests, one song) stops being urgent: the structure keeps it open either
way, so it becomes a product question for a later release rather than something this one must settle.

What stays a redesign rather than a migration: the guest screen. Bidding brings back amounts on
screen and row 1.3 with them. That is a screen plan under D123, not an architecture problem.

Worth saying plainly: bidding is something **no product in the research does**, and the market
leader deliberately prices in tiers it controls instead. Keeping the door open is right; walking
through it is not a plan.
