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
| 1.4 | Do paid greetings come across from the MVP? | **Yes, in**, at their own venue-set price, in **two kinds**: tied to a song, and free-standing. The free-standing ones run on their own timestamped list beside the songs; a tied one shows on its song. **The revision loop is dropped** — approve or refuse, and a refused guest edits and sends again. | firm | rounds 2–3; design in §"Greetings" below |
| 1.5 | Can several guests put money on the same song? | **Yes, as popularity, not bidding.** A second guest asking the same song pays the same one price and moves that request up, with no visible auction. | firm | Martin proposed, lead agreed, round 2 |
| 1.6 | When is the money actually taken? | Held at the ask, captured **when the DJ marks the song played** — the closest trigger to the real event that is available to us. A request he never plays or rejects has its hold **released at the end of the night**: "worst case the club lost a few bucks; what matters is that our decisions are reasonable and robust." | firm | round 3; §"The trigger" below |
| 1.7 | How many songs does the DJ lock, and does a guest see them? | **Back in, and it is the heart of the model.** The top N of the queue sit in an "awaiting play" set — the DJ's working set — and **inside that set there is no order at all**, because #3 may beat-match better than #2. N is a venue setting, 3 by default. Guests see that a request is with the DJ. | firm | round 3; restores the MVP's lock window (SR-188, SR-189) as a keep |
| 1.8 | Does asking for a song need a table code? | **No table at all.** A song request is never attributed to a table. | firm | round 2; this is the declaration D100 asks a feature to make |
| 1.9 | The venue's settings and their defaults | Compiled in §"The venue's settings" below — eleven settings. Defaults are the lead's, from the club's own numbers and the research, not Martin's to supply. | firm | round 3 |
| 1.10 | A standard price for a request instead of a free-text bid? | Yes, and further: release 1 ships **one price**, a single setting. Several price steps, and even bidding, stay possible but are not built. | firm | asked by Martin; carried into the decision file at the next free number |
| 1.10a | Is "one price now, tiers or bidding later" actually reachable, or does it paint us into a corner? | Reachable. The service layer already keeps payments as their own rows with append-only steps, so one price, tiers, bidding and chip-ins are all the same structure. Five things to get right while building it. | firm | D122 §9; §"One price now, more later" below |
| 1.19 | Guest accounts | Not now. Plug them in later, "once we become a recognisable solution". | later | needs its own decision, since D9 says guests need no account |
| 1.11 | The DJ beat matches, so a paid place in a queue cannot mean "this is your next track" | **The lead had this backwards and Martin corrected it in round 3.** Restro's own queue is real and timestamped, so a request's place in it is a fact, not a guess. What cannot be stated is a *time*, since the DJ's own tracks run between ours. So: show the place, never invent a clock. Beat matching is absorbed by 1.7's unordered awaiting-play set, not by replacing the queue. | firm | round 3, correcting round 2 |
| 1.12 | The DJ can agree or disagree with a song that does not fit the theme or the mood | Agreed: a short fixed reason list, one tap, money released at once, the guest told in plain words. No appeal and no re-queue. | firm | round 2 |
| 1.13 | Does the venue screen requests before the DJ sees them at all? | Yes. Blocked **artists and title words** are certain. On **genre**, the lead asserted it was undeliverable without reading the API; Martin pushed back (the demo already restricts to music and excludes podcasts) and asked for research before the question is closed. | open | round 3, pending the metadata research |
| 1.14 | What does the guest see while he waits? | **His place in the queue**, which is a fact, and *"with the DJ now"* once the request reaches the awaiting-play set — **not a time**, unless it is measured from this venue's own history. Identity across a refresh or a closed browser, with no profile and no table, is D121's guest session. | firm | round 3; a time estimate only once measured, never invented |
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
3. **A nudge, never a prompt.** If something in the awaiting-play set has sat unmarked past a
   venue-set age, its card turns and says so. Nothing modal; nothing that blocks his next move.
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

- **Genre blocking: open, pending research (round 3).** The lead wrote here that the search metadata
  gives only titles, artists, durations and thumbnails, so a genre switch could not be honoured.
  That was asserted without reading the API. Martin pushed back — the MVP's demo already restricts
  results to music and excludes podcasts, which means *some* classification is in reach — and asked
  for the question researched before it is closed. Row 1.13 stays open until then.
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

- Only requests **below the awaiting-play set** reorder. Once one has reached the DJ's working set,
  nothing a later guest does may push it back out.
- Order by the **number of distinct guests**, earliest ask as the tiebreak — never by money, which
  is the same for everyone.
- Each supporter is **its own payment row** against the one request (the fifth structural point
  above, which is why this was kept open). A refusal releases every one of them.
- "Moved up" means exactly one thing: a shorter place number, so the request reaches the
  awaiting-play set sooner. No time promise is made or implied.
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

## The queue, as Martin corrected it in round 3 (rows 1.7, 1.11, 1.14)

The lead's round-2 answer replaced the queue with a time window. That was wrong, and the correction
is worth recording in full because the rest of the design hangs on it.

**What Restro knows:** every request it holds, in order, timestamped, and which of them the DJ has
taken into his working set. A request's **place in our queue is a fact.**

**What Restro does not know:** how long that place will take to arrive, because the DJ's own tracks
play between ours and we cannot see his software.

So the queue stays, and the clock goes:

1. **One timestamped queue**, ordered by ask time, adjusted only by popularity (1.5).
2. **The top N sit in an "awaiting play" set** — N a venue setting, 3 by default, as the MVP ran it.
   **Inside that set there is no order**, because #3 may mix better than #2 and "#2 before #3" is
   not a rule a DJ can keep. This is the single place beat matching needs, and it needs nothing else.
3. **A request in that set is either played or rejected**, sooner or later. If the night ends with it
   neither played nor rejected, **the hold is released**. Martin: "worst case scenario is due to DJ
   mistake the club lost a few bugs — what is important is that our decisions are reasonable and
   robust." That is the same floor the lead proposed from the market's complaints, reached
   independently, so it is firm from both directions.
4. **The guest sees his place**, and *"with the DJ now"* once it reaches the set. A **time** may be
   shown only if it is measured from this venue's own captured play-marks — a real average, after
   real nights — and never as an invented estimate. Before there is data, the place alone.

## Greetings: two kinds, one marker (row 1.4)

Martin asked for the simplest robust way to carry both a greeting tied to a song and one that stands
alone. The proposal, and the reasoning:

**A DJ does not read greetings continuously — he picks up a microphone occasionally.** Greetings are
batched by nature, so they want a place that *collects* them, not a queue he works down track by
track.

- **A tied greeting is never a separate item.** It rides on its song's card: when that song comes up
  he sees *read this first* with the text. One mark covers both. If he rejects the song, the greeting
  goes with it and both are released. A tied greeting can never be read before its song — that is
  the whole point of tying it.
- **Free-standing greetings are one list, oldest first**, with a count on the DJ's screen. When he
  takes the mic he opens it, reads one or several, and marks each done. This is Martin's parallel
  timestamped queue; the only refinement is that it is **drawn as a tray with a count, not as a
  ranked queue**, because places and times mean nothing for something read in batches.
- **The guest is told the truth for each kind:** a tied greeting shows his song's place; a
  free-standing one shows only *"waiting to be read"* and how many are ahead of it.
- **Both kinds use the same marker and the same night-end release** as songs (1.6). A greeting read
  into a microphone leaves no trace anywhere, which is why it must never have a settlement rule of
  its own.
- **The venue can switch the two kinds on and off separately.** A free-standing greeting is pure
  text with no song to anchor it, so a venue may well want songs and tied greetings only.

## The venue's settings (row 1.9)

Eleven. Defaults are the lead's, taken from the club's own numbers and the research — not Martin's
to supply (`technical-tuning-from-best-practice`).

| Setting | Default | Why that default |
| --- | --- | --- |
| Song requests | off | A venue turns the feature on deliberately. |
| Price of a request | the club's own figure, in the venue's currency | One price (1.10), integer minor units. |
| Free requests allowed | on, queued behind every paid one | D99's shape; a club that wants the club's model turns it off (1.2). |
| Awaiting-play set size | 3 | What the club runs, and the MVP's fixed window (1.7). |
| Automatic stop before the planned end | 30 minutes | The club's answer; the DJ can also close by hand (1.16). |
| Same song again, not within | 30 minutes | The club's answer as amended (1.17). |
| Tied greetings | off, with their own price | Greetings are a venue's choice, not a default (1.4). |
| Free-standing greetings | off, with their own price | Separately switchable; a venue may want tied ones only. |
| Blocked artists and title words | empty | Screening (1.13). Genre pending the metadata research. |
| Show guests' names | on, and each guest may still ask not to be named | 1.3; TouchTunes' "Anonymous" is the same idea. |
| Who may open and close requests | the roles that already hold the ordering pause | Reuses what exists rather than inventing a role. |

## Still to do before the spec

1. **Row 1.13**, genre blocking, waits on the metadata research (`sr/metadata` branch, PR into
   `sr/ingestion`). It is the only open row.
2. **A review of every decision above by a different model** — Martin's instruction on 2026-11-22,
   to run once the research lands: does the set as a whole fit the most robust and optimal picture,
   and where it does not, what is the proposal? Run with Fable (`claude-fable-5-2`), reading this
   file, the [map](2026-11-19-song-requests-port-map.md), the
   [inventory](2026-11-18-song-requests-port-inventory.md) and the
   [research](2026-11-18-song-requests-how-others-do-it.md). Its findings are answered here before
   any decision file is written.
3. **Then the decisions themselves**, which **cannot be written on this branch**: `sr/ingestion`
   carries D1–D123, the next free number is 154, and the guard forbids a gap at the top. They need a
   branch cut from something carrying decisions 1 to 153 — today that means `or/foundation` plus
   `docs/pos-support-answers`. Flagged early because it decides where the spec branch is cut, not
   just where the files land.
