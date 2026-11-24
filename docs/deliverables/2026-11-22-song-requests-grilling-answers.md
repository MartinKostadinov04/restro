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
| 1.13 | Does the venue screen requests before the DJ sees them at all? | **No genre control at all** — and, narrowed by 1.23 in round 4, no blocked artists or title words either in release 1. Martin was right that the demo restricts to music and excludes podcasts, and the lead's stated reason was wrong — there *is* a category and there *are* tags. But nothing in them names a genre, so the conclusion survives its own bad argument. | firm | closed by [the metadata research](2026-11-22-song-request-metadata.md), PR #509 |
| 1.14 | What does the guest see while he waits? | **His place in the queue**, which is a fact, and *"with the DJ now"* once the request reaches the awaiting-play set — **not a time**, unless it is measured from this venue's own history. Identity across a refresh or a closed browser, with no profile and no table, is D121's guest session. | firm | round 3; a time estimate only once measured, never invented |
| 1.15 | Can a guest take his money back before the song plays? | Yes — while the request is still waiting, not once the DJ has accepted it. | firm | round 2, map Q7 |
| 1.16 | When does the venue stop taking requests for the night? | The venue setting is only the **automatic** stop. The **DJ opens and closes requests himself** during the night. | firm | round 2; same shape as the existing ordering pause |
| 1.17 | Can the same song be asked for again, and how soon? | Yes, a venue setting, 30 minutes as the default. | firm | round 2, map Q9 |
| 1.18 | Who answers a guest whose song never played? | A song that never plays has its hold **released automatically** — a release, not a refund, because 1.6 captures nothing until the song plays (see 1.22 for when). Separately, a guest can file a **few-button report**, which notifies staff and lands in the Log as the dispute's record. No published response time. | firm | round 2, map Q12, decision 148 |
| 1.20 | Inside the DJ's working set, does he get a free choice of which of the three to play? | **Free choice kept.** No order inside the set, as 1.7 says. The cost is accepted openly: the system can no longer infer which song he just played, so **each card carries *played* and *didn't play*** and he taps one per song. The MVP's 60-second undo of a start comes across with it. The MVP earned its automatic marking only by forcing the order and letting him play the head alone; the choice is worth more than the tap. | firm | round 4; closes the cross-review's finding 3, PR #510 |
| 1.21 | On a night that takes 180 requests and plays 40, does intake stop by itself? | **No automatic cap.** The DJ opens and closes the door to new requests from his own screen, which extends 1.16 from a pause to the one control that governs intake. What keeps this honest is 1.22: nobody waits all night on a request that will not arrive, because the money goes back after ninety minutes whatever the DJ does. | firm | round 4; extends 1.16, closes the cross-review's finding 4, PR #510 |
| 1.22 | How long may a held request sit unplayed? | **Ninety minutes, then the hold is released by itself** — not only at the end of the night. And the rule is told to the guest, short and friendly, **all the way through the flow**: you do not pay until the DJ plays your song or reads your greeting; the money is frozen until then; if ninety minutes pass without it, we release it. The exact words and where they appear belong to the screen plan. | firm | round 4; supersedes 1.6's night-end-only release, cross-review finding 8, PR #510 |
| 1.23 | How much screening does release 1 do? | **Only what the MVP already does: the music-only search.** Anything inappropriate that gets through is declined by the DJ, who sees it. No blocked-word lists, no name or greeting checks beyond the MVP's own length cut and control-character strip — "in the first round I think it is overkill to do more." This narrows 1.13, which had added blocked artists and title words. The lead's one condition, accepted as part of the answer: **nothing a guest typed is read aloud or shown in the room until the DJ has seen it**, so his refusal is a real filter and not a formality. | firm | round 4; narrows 1.13, answers cross-review finding 7, PR #510 |
| 1.24 | With no table on a request, what does a guest open? | **The venue's own menu carries the link.** The table's QR opens the menu as it does today, and the menu's navigation holds that venue's song-request link. So the venue's identity arrives with the page the guest already has, nothing new is printed, and the table — which the session does know — is deliberately never written onto the request (1.8). A venue-level link for screens and posters costs nothing extra on top, for guests who are standing. | firm | round 4; answers the entry point D100 and D99 both deferred, on D121's session |
| 1.25 | Is a guest's card kept, so a second request is one tap? | **No. "I think it's a security risk to keep credit card details."** Apple Pay and Google Pay are the fast path for a repeat request; a raw card is entered again each time. The lead's note, recorded and not argued: a saved card lives at the provider and never on our servers, and a repeat may still be challenged by the bank — so the gain was smaller than it sounded, and the answer costs little. | firm | round 4; D127 keeps 3-D Secure on every card payment |

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

Point 5 is what makes row 1.5 (two guests, one song) cheap rather than optional. An earlier draft of
this section deferred 1.5 to a later release, which contradicted the row's own `firm` status; the row
wins. **Popularity ships in release 1**, and the MVP is why it is affordable: supporting someone else's
request is already built there, with its own idempotency key and an atomic check that either secures the
place or takes no money at all. What this release changes is only what support *does* to the order —
distinct guests instead of summed money — not the gesture or its plumbing.

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

- **Genre blocking: closed, no genre control (round 3).** The lead first wrote here that the search
  metadata gives only titles, artists, durations and thumbnails. That was asserted without reading
  the API and it was **wrong**: there is a `Music` category (id `10`), there are uploader-set
  `tags`, and the demo stacks three music filters, exactly as Martin said. The
  [research](2026-11-22-song-request-metadata.md) settles the real reason, which is narrower and
  harder: **YouTube's entire music vocabulary is 15 coarse curated topics** — Electronic, Rock, Pop,
  Hip hop and so on, with **no sub-genre anywhere** — the two topic-id read fields have been
  deprecated since 2016, and `topicId` filters *to* a topic and cannot exclude one, which is the
  opposite shape to a venue's "no X". Approximating it by whitelisting the other 14 topics costs 14
  searches per search against a quota that is already the binding constraint. Discogs `styles` do
  carry the grain, and would stop most drum and bass that exists as a release, **near none** of the
  mixes, bootlegs and streaming-only tracks a club actually gets — and **cannot name chalga at all**,
  which for a Bulgarian club is the genre most likely to be blocked (Discogs answers `Vocal, Folk`
  for Preslava, which would block every ballad in the building). So: **no genre setting**, and the
  blocked-list screen says why in the venue's own words. §5 of the research has the wording.
- **One fact is still unresolved and worth settling cheaply:** what `topicCategories[]` actually
  returns for a music video today — Wikipedia URLs that reach a genre page, or stop at `/wiki/Music`.
  The docs give no examples. One `videos.list` call with `part=topicDetails` against twenty known
  tracks answers it. The research session had the prototype's API key available in a git-ignored file
  and deliberately did not spend it, which was the right call.
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
| Blocked artists and title words | empty | Screening (1.13). **No genre control** — the research shows it cannot be kept. |
| Show guests' names | on, and each guest may still ask not to be named | 1.3; TouchTunes' "Anonymous" is the same idea. |
| Who may open and close requests | the roles that already hold the ordering pause | Reuses what exists rather than inventing a role. |

## What the demo already settles (read 2026-11-22, after the cross-review)

Martin sent the lead back into the pinned prototype rather than answering review questions the code had
already answered. Read directly: `lib/dj-domain.mjs`, `lib/dj-api.mjs`, `lib/dj-youtube.mjs`,
`drizzle/0003_locked_window.sql`, `modules/demo/dj/commands.mjs`, `YOUTUBE-SETUP.md`, `STRIPE.md`. The
prototype has **two** implementations of the queue — a Cloudflare/D1 one in `lib/` and a richer state
machine in `modules/` — and the richer one answers more.

- **The working set fills itself.** `dj_locked` is topped back up to three by database triggers, on every
  payment and on every departure, and `fill(s)` runs after a start and after a refusal. No DJ action puts
  a request in it. This settles the review's finding 2 in favour of automatic: **drop "accept" as the gate
  into the set.** In the prototype `accept` is moderation only.
- **Inside the set the prototype is strictly ordered**, by an autoincrement `sequence`, and only
  `locked[0]` can be prepared or started. So row 1.7's "no order at all" is confirmed as a **new design**,
  not a keep — and it is exactly what leaves the play-mark with no card to attach to (finding 3).
- **The play-mark already works as a by-product**, as row 1.6 proposed: `start` on the head marks the
  previously playing request `played` and stamps `finishedAt`, with a 60-second `undoStart` that restores
  the heads, the locks and the cooldown. `finish` exists separately. The mechanism is a keep, with its
  undo; the obstacle to porting it is only the unordered set above.
- **Refusing a greeting without refusing the song already exists.** `approveGreeting` / `rejectGreeting`,
  and at `prepare` an unapproved greeting payment is **released** while the song's payment is captured.
  Review finding 6 is therefore a keep, not an addition — and `greetingRevision` is the revision loop
  Martin dropped in round 3.
- **Capture happens at `prepare`**, one step before the song starts, on the head of the set only.
  Row 1.6's capture at the play-mark is one step later and more generous; the direction is the same.
- **The night's end already releases everything.** `closeDJ` returns every active request's money, marks
  whatever is playing as played, and closes the session; `newNight` refuses to start until it has run.
  Row 1.6's sweep is a keep.
- **A same-song cooldown already exists** (`s.cooldowns[r.family] = now + COOLDOWN`), set when a song
  starts. Row 1.17 is a keep with a venue setting over it.
- **Opening and closing intake is a DJ action** (`intake`), and it refuses to re-open within 30 minutes of
  the planned end (`planEnd`). Row 1.16 is a keep, and the 30-minute guard is a detail worth porting.
- **A guest's report already has a staff side**: `issueReply` moves an issue to `reviewing` or `closed`
  and requires a written reply to close it. Row 1.18's "few buttons" report has a precedent.
- **A DJ handover is already an audited event** (`handover`), so the review's "one sentence settles it" is
  a keep rather than a new rule.
- **There are no free requests.** The minimum is €5 (`MIN_REQUEST = 500`), the greeting a fixed €3
  add-on the server alone computes, and the queue filter drops anything under €3. Row 1.2's free requests
  are a Restro addition with no precedent in the prototype — which is the strongest argument for
  defaulting them off.
- **Supporting someone else's request is proven machinery**: `kind: "boost"`, a €3 minimum, idempotency
  keys, and a `requireFirst` option that either guarantees first place inside the write transaction or
  fails with `FIRST_PLACE_CHANGED` and takes no money. The prototype orders by money
  (`ORDER BY SUM(amount) DESC, created_at`), so what row 1.5 changes is the **ordering rule**, not the
  gesture or its plumbing. Release 1 can carry popularity cheaply.
- **The search ceiling is already rationed, and the prototype degrades instead of dying.**
  `limit(db, "youtube-global", 80, 86400000)` caps the whole venue at **80 uncached searches a day**,
  deliberately under the API's own ceiling; results are cached for 10 minutes; every song ever returned is
  kept in `dj_songs`; and when the quota does run out the guest is told to pick from the saved songs. So
  the review's finding 1 is real but overstated: the feature does not go dark, it narrows to what the
  venue has already seen. The honest fix is smaller than importing a catalogue — **keep the search for
  discovery and let our own song table accumulate permanently rather than for 24 hours**, so the ration is
  spent only on songs nobody has ever asked for.

**Two claims in our own documents did not survive the read, and the map's verdicts rest on them:**

1. **Name screening.** The inventory records a display-name rule with a hard-coded Bulgarian and English
   profanity list (SR-175), and the cross-review treats it as a control we dropped. No word list of any
   kind exists in the prototype's code. A name is `cleanText(value, 24, "Гост")` — control characters and
   angle brackets stripped, 24 characters — and a greeting is the same at 180. The gap is therefore
   **wider** than the review thought: there was never any screening to carry forward.
2. **Guest identity.** The inventory records a cookie the server never stores, so that any 64-character
   hex string is an identity (SR-142). `identify()` hashes the cookie with SHA-256 and looks the hash up
   in `dj_devices` with a 12-hour expiry, and every endpoint but `POST /api/session` answers 401 without a
   match. The rebuild verdict still holds for other reasons, but not for that one.

Both need a re-read of the rows they came from before the spec cites them.

## Settled by the lead after round 4, reported rather than asked

These follow from Martin's answers or are tuning the lead owns; none is a product choice left open.

- **Free requests default off wherever a price is set.** Row 1.2's venue setting stays. The default is
  the lead's because a free request queued behind every paid one can never reach the DJ on a busy night,
  so leaving it on by default would publish a place number that cannot move. The MVP has no free path at
  all — €5 is its minimum — so nothing is being thrown away.
- **The DJ may mark *played* on any request in the queue, not only the three in his working set.** He
  often plays a track off his own laptop that someone has already paid for; without this the venue gives
  away exactly what it sold, and the hold is released although the guest got his song. One control, and
  it follows directly from 1.20's per-card marking.
- **No catalogue import in release 1.** The MVP rations itself to 80 uncached searches a day, caches
  results briefly and keeps every song it has ever returned, telling a guest to pick from the saved ones
  when the daily limit is spent. The fix is therefore small: **keep the search for discovery and let our
  own song table accumulate permanently** instead of expiring after a day, so the ration is only ever
  spent on a song nobody has asked for before. The cross-review's proposal to import a whole metadata
  catalogue is dropped, and the probe behind that decision is
  [here](2026-11-22-song-request-catalogue-probe.md).
- **The DJ's screen shows him the arithmetic.** Since intake has no automatic cap (1.21), his screen says
  how many are waiting against how many he has played tonight, so closing the door is an informed act
  rather than a guess. A number on a screen, not a rule.

## Still to do before the spec

1. **The frontier is empty.** Every row is settled; rounds 1 to 4 and the cross-review are answered.
2. **Two claims in our own documents did not survive the read of the MVP** and must be re-read before the
   spec cites them: the display-name profanity list (no word list exists anywhere in that code) and the
   unrecorded identity cookie (the server does hash and record it, with a 12-hour expiry). Both are in
   §"What the demo already settles".
3. **The spec issue and its tickets**, which cite the rows of this file (1.1 to 1.25) rather than decision
   numbers, so nothing waits on the numbering.
4. **Then the decisions themselves**, which **cannot be written on this branch**: `sr/ingestion` carries
   decisions 1 to 123, the next free number is 154, and the guard forbids a gap at the top. They need a
   branch cut from something that already carries 1 to 153. Measured on 2026-11-22, `or/foundation` and
   `docs/pos-support-answers` each carry the full gapless set on their own, so either can serve as the
   base; `docs/pos-support-answers` is docs-only and therefore the cheaper one.
