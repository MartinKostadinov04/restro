# Song requests: a cross-review of the whole decision set

Asked for by Martin on 2026-11-22 ("a fable on all decisions so far and do they fit the most robust and
optimal picture and if not whats the proposal"), run by a different model from the one that held the
grilling. Read: [the grilling answers](2026-11-22-song-requests-grilling-answers.md) (rows 1.1–1.19 and
every design section), [the map](2026-11-19-song-requests-port-map.md),
[the market research](2026-11-18-song-requests-how-others-do-it.md),
[the metadata research](2026-11-22-song-request-metadata.md), and the
[inventory](2026-11-18-song-requests-port-inventory.md) and
[stories](2026-11-18-song-requests-port-stories.md) for the claims the rows rest on. Nothing here is a
decision; it is a review, and the rows it disputes are named.

Decisions above D123 do not exist on this branch and are written without the D, as the grilling file does.

---

## The verdict

**Not yet. The shape is right and most of the set is sound, but three things have to be settled before a
spec, and one of them is load-bearing enough to change what gets built.** The product shape — one price,
the DJ's veto, held money captured only when the song is real, generous on a forgotten tap — matches what
the market does and is better reasoned than most of it; the reversals in rounds 2 and 3 improved it each
time. What is not finished is the middle of the model: **two rows give opposite answers to "who puts a
request in front of the DJ"** (finding 2), the **play-mark names no request** once the working set is
unordered (finding 3), and **nothing caps intake**, so a busy night sells places that cannot arrive
(finding 4).

**The single most important thing to change: decide what a guest searches, and do not assume it is
YouTube.** The metadata research that closed row 1.13 also found, and filed as an out-of-scope note, that
the search is capped at about **100 queries a day for the whole platform**. One pilot night needs several
hundred. This is the feature's front door, it has no row anywhere in the set, and the answer to it
collapses four other problems at once (finding 1). Everything else in this review is a fix inside the
design; that one may change its shape.

---

## Findings, most important first

### 1. The search has a hard daily ceiling and no row owns it — confident

**Where:** nowhere. §"Screening" and row 1.13 treat the prototype's search as portable; the ceiling is in
the [metadata research](2026-11-22-song-request-metadata.md) §2 and in its own out-of-scope note, which
says plainly that it "is a bigger risk to this feature than genre ever was".

`search.list` has its own quota bucket with a default of **100 calls per day per project**. A night of 200
requests, with guests typing, retyping and paging, needs several hundred queries; the prototype survives
only by caching for six hours and serving stale results for seven days, which helps the popular songs and
nothing else. Per-venue keys do not help — the ceiling is per project, so each venue would get its own
100. A quota extension exists as a form with no published criteria or timing.

**If it ships as written:** the search dies somewhere around 01:00 on the first real night, with guests
mid-payment, and recovers at Pacific midnight. There is no graceful version of this: the only way into the
feature is the search box.

**Proposal — a new firm row before the spec, "what does a guest search", with three options:**

- **(a) A metadata source with room to breathe.** MusicBrainz allows 1 request/second with no key; pilot
  volume is about 0.03/s, and its core data (artist, recording and release titles — exactly what a search
  returns) is CC0 and commercially usable. YouTube then gets called never, or once per *accepted* request
  if the DJ wants a link — a 20× cut. Two cheap checks first: a 20-query probe for Bulgarian pop-folk
  coverage, the same shape as the Discogs probe the research already ran, and one read of which licence
  bucket the fields we use fall in.
- **(b) The DJ's own library as the catalogue.** Every DJ program exports its collection as a file; the
  prototype's own documentation already says "a truly independent venue catalogue requires a licensed
  metadata source or an imported DJ-library track list". This is also what the whole subscription half of
  the market converged on — Rockbot, Splash and Moodby all have guests "request from the venue's approved
  library" (research §1.2, §1.5) — so it is the common architecture, not an invention.
- **(c) Stay on YouTube**, file the extension now, and accept an unbounded dependency on one company's
  discretion for the feature's only entrance.

**Recommend (a) for release 1 and (b) as the thing that makes the rest of the design honest**, because the
catalogue mismatch is the hidden root of four other rows: genre blocking is impossible on YouTube and
trivial on a library the DJ curated (1.13); the DJ's refusal rate is structural while a guest can pay for
a track the DJ does not own (1.12); "already played tonight can only mean played through Restro" stops
being a limitation; and finding 11 below disappears. (b) costs a library import, a matching step and a
venue setting, and it does not fit a venue with a different guest DJ every night — so it is a row, not an
assumption.

### 2. Who puts a request in front of the DJ? 1.6, 1.7 and 1.15 disagree — confident

Row 1.7: "the **top N of the queue sit in** an 'awaiting play' set" — the system fills it. Row 1.6,
mechanism 1: "**Accepting the next request** marks the previous one played… a set the DJ accepts
continuously" — the DJ fills it. Row 1.15 hangs the guest's withdraw on "once the DJ has **accepted** it".
The MVP the row cites as its precedent fills automatically: `fill` runs after every request, so on a quiet
night "the first three requests of an empty window lock at once" and support is refused from that instant
"whatever the page shows" (SR-188, SR-189, SR-180).

**If it ships as written:** on a quiet night — which every night is at opening — a guest's request enters
the set the moment he pays, so he can never withdraw (1.15 is dead on arrival), popularity never applies
(1.5's "only requests below the set reorder"), and there is no accept event for the play-mark to ride on,
so 1.6's "zero extra taps" is false exactly when the DJ has the most time and the least reason to tap.

**Proposal:** drop "accept" as an action. The set fills itself from the top, as the MVP does and as 1.7
reads — one less control on the DJ's screen. The **played** tap on a named card becomes the one tap that
cannot be removed (finding 3). Withdraw stays open until the song **starts**, which is the MVP's own line
(SR-220) and is both easier to explain to a guest and safe, because once it has started there is nothing
to take back.

### 3. The play-mark names no request, and 1.7 made it unnameable — confident

Row 1.7 removes all order inside the set ("inside that set there is no order at all"). Row 1.6 mechanism 1
marks "the previous one" played; mechanism 2 draws "one card in flight at the top of the tray". With N=3
and no order there are up to three unmarked cards and no "previous one", and no top.

**If it ships as written:** the DJ plays B, accepts a fourth request, and the by-product marks A played —
so guest A is charged for a song that has not played and B's money is released at night end. That is worse
than an extra tap: it is money on the wrong guest.

Worth recording that **1.7's "no order at all" is a new design, not the keep it is filed as**: in the MVP
the locked three were strictly ordered and only the head carried a control ("Подготви"; SR-S21, SR-S24,
SR-188). The idea is a good one — #3 may beat-match better than #2 — but nothing has tested it with a DJ,
and the row's stated provenance does not support it.

**Proposal:** the tray shows N cards, each with *played* and *didn't play*. No by-product marking. Keep
the nudge (mechanism 3), the end-of-night sweep (4) and the generous floor (5) exactly as written. The cost
is one tap per song; the MVP charged five (prepare, started, confirm, finish, confirm).

### 4. Nothing caps intake, so a busy night sells places that cannot arrive — confident

**Where:** row 1.9's eleven settings, and §"The queue". The MVP had no cap either — its queue "has no
length limit" (SR-186) — and the map did not flag it.

A six-hour night is about 100 tracks; a DJ gives requests some share of that, realistically 30 to 50. With
500 guests, one price and unbounded intake, a Friday night takes 200 requests and plays 40. Every one of
the other 160 settles correctly — released at night end, nobody charged — and 160 people spent the night
watching a place number that was a fact and a lie at the same time.

**Proposal:** a venue setting, **maximum open paid requests**, and when it is full the feature stops
*selling* and says so ("The DJ has all he can take tonight — try again later") instead of selling place
190. Default derived from N, and once play-marks exist from the venue's own measured rate — which row 1.14
already permits for a measured number. This is the one place the design is too simple, and it is the
difference between a feature and a complaints desk.

### 5. Row 1.5 is recorded firm and then deferred, and duplicates fall through the gap — confident

Row 1.5 is `firm` ("yes, as popularity, not bidding"). §"One price now, more later", point 5, says release
1 ships "one today, **no chip-in screen**, no succession, no partial capture", and then: 1.5 "becomes a
product question for a later release rather than something this one must settle". Both cannot be true, and
§"What popularity may and may not do" is written as if it ships.

**If it ships as written:** two guests ask the same song four seconds apart and the set has no answer. The
MVP refused the second and pointed him at the open request — "Песента вече е заявена. Подкрепи отворената
заявка." (SR-179) — which only works if supporting exists. Without it, either the second guest is refused
with nowhere to go, or two requests for one song sit in the queue, the DJ plays it once, one is marked
played and captured and the other is released at night end with its guest told nothing coherent.

**Proposal:** ship popularity in release 1. Point 5 already mandates payments-plural from day one, so the
delta is a distinct-guest count and one button — cheaper than it looks, and it is what makes 1.17's
cooldown humane rather than a dead end. If it must wait, then write the duplicate rule explicitly: a
second ask of a song already in the queue is refused **before payment**, in plain words, and the venue
earns nothing from it.

### 6. A tied greeting cannot be refused on its own — confident

**Where:** §"Greetings": "A tied greeting is never a separate item… One mark covers both… If he rejects
the song, the greeting goes with it and both are released."

There is no path for the commonest moderation case there is: good song, unreadable text. The DJ's choices
are to read it or to reject a song he wanted, losing the song's money too.

**Proposal:** the card carries *refuse greeting* separately — releases the greeting payment, keeps the
song, tells the guest the song is still coming and the greeting was not accepted. One extra control, the
same one-tap reason list as 1.12.

### 7. Greeting text and guest names are unscreened, and the port loses a control the MVP had — confident

**Where:** row 1.13 (screening matches song metadata only), row 1.3 (names shown by default), §"Greetings".

The MVP screened display names: 1 to 5 words, letters only, no digits or emoji, against a hard-coded
Bulgarian and English profanity list (SR-175). Greeting text was only trimmed to 180 characters, silently
(SR-183). The grilling carries neither forward, and 1.3 makes names visible by default.

**If it ships as written:** a guest pays €3 to have a stranger read a named third party's phone number, or
a slur, over a club PA, with a DJ mid-mix as the only filter — and the person named never consented and
has no route, because 1.18's report button belongs to the payer.

**Proposal:** (a) the blocked artists-and-words list applies to greeting text and guest names as well as
song metadata — one setting, three surfaces, no new screen; (b) carry the MVP's name rules forward; (c)
add "names someone else" to 1.12's refusal reasons. **Suspicion, marked as such:** whether a greeting
naming a third party needs more than this is an interpretation question, so it belongs on the lawyer
reminder list rather than in a row (`lawyer-only-for-interpretation`).

### 8. Night end is the only release trigger, so "with the DJ now" can be true for four hours — confident

Row 1.6 releases an unplayed hold at the end of the night; 1.14 rightly forbids inventing a time; 1.15
closes withdraw once it is with the DJ. So a request that enters the set at 00:30 and is never played
reads "with the DJ now" until 05:00, and the guest can do nothing. The one published neighbour the set
itself cites bounds exactly this: TipTunez refunds if an approved song has not played within 45 minutes
(research §2.3). The set cites that rule and then declines its shape without saying why.

**Proposal:** a venue-set age at which an unplayed request in the set is released automatically and the
guest told plainly — "the DJ didn't get to it tonight; you have not been charged" — default 60 to 90
minutes. It is not a time promise, so it does not break 1.14; it shrinks the night-end sweep; and it turns
the worst screen in the design into an honest one.

### 9. "Refunded automatically" is not what 1.6 does, and decision 148 does not reach a song request — confident

Row 1.18: "A song that never plays is **refunded automatically**." Under 1.6 nothing is captured until
*played*, so such a song is **released** — a different operation, with no fee, no refund key and a
different Log entry. Worse, decision 148's route, which 1.18 and §"Identity" both lean on, is written
around *a paid line on a bill*: its safeguards are "only the amount the POS closed that line for", "once
per line", and a POS storno. A song request has no bill, no line and no POS. Decision 148 also requires a
**staff member to confirm** every refund, which "automatically" contradicts; and its alarm (1 % of the
night's captures and three or more) was calibrated for a venue where refunds are rare.

**Proposal:** say "released" where it is a release, and write one row extending decision 148's rule — same
key, same Log, same staff confirmation — to a captured song request, instead of citing it as already
covering this.

### 10. The entry point that D99 and D100 both deferred to this grilling is still missing — confident

D99's "Not decided here" and D100's last paragraph both say that how a guest without a table reaches the
request page — a link, a QR on the club's screens, a share button — is grilled when the prototype is
ported. That is this grilling. Row 1.8 settles "no table at all" but never says what address the guest
opens, or what carries the venue's identity in place of the table code D121 puts in a header. Today every
QR leads to a table.

**Proposal:** one row before the spec. Recommend a venue-wide public request address plus the venue's own
QR for screens and posters, and state what replaces the table code on `POST /api/guest/actions`.

### 11. The DJ plays it off his own laptop and the venue loses the sale — confident the path is missing

A guest pays for the club's anthem; the DJ was playing it in twenty minutes anyway; he plays it without
touching the queue. The request is never accepted, never marked, released at night end. Nobody did
anything wrong and the venue gave away exactly what it sold. The state machine assumes accept-then-play; a
club is often play-then-notice. How often is a suspicion, but it will not be rare.

**Proposal:** the DJ can mark *played* on any request in the queue, not only inside the set. One control,
and it is the honest answer to §"Screening"'s "already played tonight can only mean played through
Restro".

### 12. Free requests are on by default, can never play, and are the cheapest way to flood the tray — confident

Row 1.2 queues free requests behind every paid one; the set fills from the top; so wherever a price is set
a free request is inert and its place number only ever grows. And with no table (1.8), a session cookie
the guest can mint by clearing site data, and no cost, the free path has no anchor for a limit: D122 §9's
abuse controls all hang off a table code this feature does not have. D121 closes session *forgery*, which
was the MVP's hole (SR-142), but not minting.

**Proposal:** free requests default **off** where a price is set; where a venue turns them on, show no
place number at all (just "suggested to the DJ"), and gate the free path with Turnstile and a per-phone
count.

### 13. Request #2 costs as much as request #1, and the tap counts measure a simulation — confident on the gap

Decision 127 puts 3-D Secure on every card payment; decision 125 keeps the guest's e-mail away from the
provider; D9 forbids an account. So a guest's second €5 request means the card form again, with a bank
challenge, in a dark room — and the business case for this feature is a guest asking two to four times a
night. The MVP's 3-to-6-tap checkout (SR-S8, SR-S9) was **simulated**: there was no provider at all, so
nothing in the stories measures the real cost. **Proposal:** a row on the repeat payment. Apple Pay and
Google Pay are already decided on and solve it with a biometric; for raw cards, either reuse the payment
method inside the guest session (not an account) or accept that card is the slow path and say so. The
real-phone check that decision 125 already requires should count the taps for request #2.

### 14. Five hundred phones with no table change the polling arithmetic — confident on the arithmetic

D121's cadence (every 2 to 10 seconds) was designed for a table's phones — perhaps 40 tables. A table-less
feature polls per **phone**: 500 phones at 10 seconds is 50 requests a second of guest state on one venue,
and what they are all reading is identical. D99's own answer was a live overlay file polled every few
seconds. **Proposal:** publish the public queue as the venue's live overlay file, where the CDN absorbs
500 readers, and keep only the guest's own small slice — his requests, his places — on D121's endpoint at
the slow cadence. Say which in the spec.

### Smaller points

- **Eleven settings, two of which are not the owner's to know.** The awaiting-play set size and the repeat
  interval are tuning numbers, and the person who knows them is the DJ, who is not in Settings. "Who may
  open and close requests" is not a new setting at all — 1.9's own entry says it reuses the ordering pause
  roles. The honest release-1 list is about eight, plus a + / − for N on the DJ's own screen.
- **The sale has no receipt route.** Money lands in the venue's account for a sale its till never saw (map
  Q13), there is no fiscal receipt and no e-mail by decision 125, and the MVP itself printed "Справката не
  е фискален документ" (SR-8). Nothing carries this forward. It is an interpretation question for the
  accountant and the lawyer, and it should be on the reminder list before the pilot takes money.
- **A handover mid-night** is normal in a club and is not covered. In the MVP the handover changed nothing
  on screen and named nobody (SR-S30). The unmarked cards of the DJ who left are the next DJ's, or the
  sweep's; one sentence settles it.

---

## What I checked and found sound

- **The direction of generosity (1.6, point 5).** Verified against the research: the market leader's
  no-refund term and the complaints it draws are exactly as cited (§1.1, §6), and the two products that
  say the opposite in plain words do what 1.6 does. Releasing rather than capturing an unmarked request is
  right, and the sources carry it.
- **One price instead of bidding (1.10, 1.10a).** The claim that no product runs an open auction is what
  the research found (§5), and the leader's own tiers are platform-set rather than guest-against-guest.
  The five structural points are the right five; points 3 (a pricing policy table, not a column) and 4
  (record which policy priced each request) are the two I would also have insisted on, and D122 §9's
  service write path with payments as their own rows does support all three futures.
- **No amounts on screen, optional name (1.3).** Research §1.4 and §5 confirm both halves.
- **No genre control (1.13).** The strongest document in the set. The 15-topic list is complete and
  quoted, the deprecations are real, `topicId` filters *to* a topic and cannot exclude one, and the
  Discogs probe is measured rather than assumed — including the cross-language false positive, which is
  the right reason to stop rather than tune. The conclusion survives, and recording that the lead's first
  reason for it was wrong is what makes the row trustworthy.
- **Dropping the greeting revision loop (1.4) and turning the typed refusal reason into a one-tap list
  (1.12).** Both spend less of the only scarce thing on the DJ's screen, which is the right currency.
- **Dropping the e-mail recovery flow and the two-working-day promise (map §3, 1.18).** D9 settles the
  first; nobody had agreed to keep the second.
- **The licensing position (map §4).** Supported by every product read, and Restro supplies no audio.
- **No table (1.8) as D100's declaration.** Correct, and right for a room where most people are standing.
- **Row 1.11's correction.** Martin is right and the round-2 answer was wrong: a place in our own
  timestamped queue is a fact, a time is not. Absorbing beat-matching into an unordered working set rather
  than into the queue is the right place to put it (its ordering problem is finding 3, not this).

## Ambiguous rather than wrong

- **Whose set is it (finding 2).** I have read 1.7 as automatic and 1.6 as DJ-driven and cannot tell which
  was meant; the cited precedent auto-fills. One sentence from Martin settles it, and three other rows
  depend on the answer.
- **Where a guest's name is shown** — on other guests' phones, on a club screen, or both. It decides
  whether a guest-typed name is published to a CDN file, which is a different question from 1.3's.

## What I did not check

The 408-row inventory was read only where a decision rested on it (the lock window, withdraw, names,
duplicates, the queue's length, the greeting fields, the status machine). I did not re-verify the market
research's product-by-product claims beyond the four the decisions lean on, and I did not test any API.
