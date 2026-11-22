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
| 1.3 | Do other guests see how much someone paid? | No amounts (one price makes them moot). The guest's **name is optional** — he chooses whether it shows. | firm | round 2; TouchTunes' "Anonymous" is the same idea |
| 1.4 | Do paid greetings come across from the MVP? | **Yes, in.** A greeting is a paid extra on a request, at its own venue-set price, with an approval step before it is read out. | firm | round 2, over the map's recommendation to drop |
| 1.5 | Can several guests put money on the same song? | **Yes, as popularity, not bidding.** A second guest asking the same song pays the same one price and moves that request up, with no visible auction. | firm | Martin proposed, lead agreed, round 2 |
| 1.6 | When is the money actually taken? | Held at the ask; captured by **a trigger as close to the song actually playing as can be managed**. Martin opened the trigger's design: it must not depend on the DJ remembering a tap after the fact. | open | round 2; trigger designed in §"The trigger" below |
| 1.7 | How many songs does the DJ lock, and does a guest see them? | Folded into 1.11 — with a window there is no lock count, only accepted or not. | out | folded into 1.11 |
| 1.8 | Does asking for a song need a table code? | **No table at all.** A song request is never attributed to a table. | firm | round 2; this is the declaration D100 asks a feature to make |
| 1.9 | The venue's settings and their defaults | — | open | compiled once 1.6 closes |
| 1.10 | A standard price for a request instead of a free-text bid? | Yes, and further: release 1 ships **one price**, a single setting. Several price steps, and even bidding, stay possible but are not built. | firm | asked by Martin; carried into the decision file at the next free number |
| 1.10a | Is "one price now, tiers or bidding later" actually reachable, or does it paint us into a corner? | — | open | answered in round 1b against D122 §9 |
| 1.11 | The DJ beat matches, so a paid place in a queue cannot mean "this is your next track" | Settled by Martin's own 1.14(b): Restro cannot see the DJ's software, so it never knows how many songs are ahead. A position would be invented. A paid request buys a **promise of time**, and the DJ picks the moment inside it. | firm | round 2; forced by 1.14(b), not a preference |
| 1.12 | The DJ can agree or disagree with a song that does not fit the theme or the mood | Agreed: a short fixed reason list, one tap, money released at once, the guest told in plain words. No appeal and no re-queue. | firm | round 2 |
| 1.13 | Does the venue screen requests before the DJ sees them at all? | Martin asked how it would work; answered in §"Screening" below. Blocked **artists and title words** are reliable; blocked **genres** are not, and "already played tonight" can only ever mean "played through Restro". | open | round 2, pending Martin's yes to the narrowed version |
| 1.14 | What does the guest see while he waits? | Yes to the promise and the clock, with two constraints from Martin: (a) he must be recognised across a refresh or a closed browser **without a profile and without a table**, and (b) **Restro has no access to the DJ's software**, so no count of songs ahead can be shown. | firm | round 2; (a) is D121's guest session, (b) settles 1.11 |
| 1.15 | Can a guest take his money back before the song plays? | Yes — while the request is still waiting, not once the DJ has accepted it. | firm | round 2, map Q7 |
| 1.16 | When does the venue stop taking requests for the night? | The venue setting is only the **automatic** stop. The **DJ opens and closes requests himself** during the night. | firm | round 2; same shape as the existing ordering pause |
| 1.17 | Can the same song be asked for again, and how soon? | Yes, a venue setting, 30 minutes as the default. | firm | round 2, map Q9 |
| 1.18 | Who answers a guest whose song never played? | A song that never plays is **refunded automatically**. Separately, a guest can file a **few-button report**, which notifies staff and lands in the Log as the dispute's record. No published response time. | firm | round 2, map Q12, decision 148 |

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

## The trigger: capturing the money without relying on memory (row 1.6)

Martin's worry is the right one, and it has no free answer — **someone has to absorb a forgotten tap**:

- Capture on the DJ's "played" tap: he forgets, the money is released, and the venue gave the song
  away.
- Capture when he accepts: he forgets to mark that he never played it, and the guest paid for
  silence — the complaint that the market leader is known for (the research, §1.1 and §6).

So the answer is not to pick which loss to take. It is to **take the tap off the normal path**:

1. **Accepting the next request marks the previous one played.** Through a set the DJ accepts
   continuously, so on a normal night the play-mark costs zero extra taps — it is a by-product of
   the action he was already taking.
2. **One card in flight at the top of the tray**, large, two controls: *played* and *didn't play*.
   Dark room, one hand, readable at a glance (D107).
3. **A nudge, never a prompt.** If something accepted sits past its window unmarked, its card turns
   and says so. Nothing modal; nothing that blocks his next move.
4. **An end-of-night sweep.** Whatever was accepted and never marked appears as one list when the
   night closes — a screen that already exists — as *played / not played*, cleared in seconds.
   Nothing stays ambiguous, and the money settles before the night's totals are read.
5. **A floor, deliberately generous.** Anything still unmarked when the night closes with nobody
   sweeping it is **released, not captured**. The venue loses a sale rather than a guest paying for
   silence. This is the one place to be generous on purpose: it is precisely the thing that damaged
   the leader's reputation, and it costs us a rare edge case.

**Greetings are the exception that proves the design.** A greeting read into a microphone leaves no
trace anywhere. So it rides on its song's marker — *played* covers both — and "the greeting was not
read" is one of the guest's report buttons (1.18).

## Screening: what it can and cannot do (row 1.13)

The venue keeps two lists in its settings: **artists** it never wants, and **title words** it never
wants. Both are matched against the metadata the song search already returns, and a blocked song is
simply **not offered** — the guest sees no result rather than a refusal.

Two limits, both worth saying in the venue's own words on the setting itself:

- **Genre blocking cannot be done honestly.** The metadata behind the search gives titles, artists,
  durations and thumbnails — not a genre anyone should rely on. A "no drum and bass" switch would be
  a promise we cannot keep. Artists and title words we can keep.
- **"Already played tonight" can only mean "played through Restro".** By 1.14(b) we cannot see the
  DJ's own software, so a song he played off his own laptop is invisible to us and can still be
  asked for.

## Identity without a profile and without a table (row 1.14a)

D121's guest session answers it: a cookie the server issues **and records**, scoped to the venue and
the service day. No profile, no e-mail address, no table. It survives a refresh and a closed browser
because it is a cookie, not page state. It does **not** survive cleared site data or a different
phone, and nothing short of an account would — which D9 forbids. The consequence is smaller than it
sounds: the request is already with the DJ and still plays. What the guest loses is his own list of
requests, and the lost-phone refund is decision 148's staff route.

## What popularity may and may not do (row 1.5)

- Only **unaccepted** requests reorder. Once the DJ has accepted one, its window is a promise and
  nothing a later guest does may push it back.
- Order by the **number of distinct guests**, earliest ask as the tiebreak — never by money, which
  is the same for everyone.
- Each supporter is **its own payment row** against the one request (the fifth structural point
  above, which is why this was kept open). A refusal releases every one of them.
- It does **not** shorten the window. "Moved up" means the DJ sees it higher in his tray, which is
  the only thing we can honestly promise.
- It rewards a group asking together — and since every supporter pays the full one price, the venue
  earns from exactly that. The repeat rule (1.17) is the cap.

## Where the lead pushed back

1. **The greeting's revision loop (1.4).** Recommend **approve or refuse only**. A refusal says
   "change the wording and send it again", and the guest resubmits. Same outcome, no revision state
   machine, and above all no DJ typing to a stranger in the middle of a set. A true revision flow is
   one more state rather than a disaster, but it spends the scarcest thing on the DJ's screen.
2. **Greetings in release 1 at all.** The cost stands and is recorded rather than re-argued: a
   second price, an approval step, a text a stranger reads aloud in a room, and the only outcome in
   the whole feature that nothing can observe. No product in the research sells them. Martin has
   decided twice that they are in, so they are in.
3. **Genre blocking** (above) — struck as undeliverable.
4. **"No table at all" (1.8) conflicts with nothing.** D100 asks each guest feature to declare
   whether it needs a table code; declaring "no" *is* the declaration. It also makes requests work
   for everyone standing up, which in a club is most of the room.
