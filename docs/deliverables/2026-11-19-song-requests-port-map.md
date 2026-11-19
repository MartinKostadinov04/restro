# Song requests: the map and the verdict (stage 3)

Stage 3 of the Port flow over the song-requests half of the pinned Club Biad MVP. Written by the lead, 2026-11-19, from three stage-2 deliverables on this branch:

- `2026-11-18-song-requests-port-inventory.md` — 408 rows read out of the MVP's code (`SR-n`).
- `2026-11-18-song-requests-how-others-do-it.md` — about 25 comparable products, read from their own pricing pages and terms.
- `2026-11-18-song-requests-port-stories.md` — the demo walk. **Not yet written** when this map was made; see "What this map still owes the stories".

Nothing here is built, and nothing here is settled with Martin. The verdicts are the lead's reading; the rows marked **product** are exactly the questions that go to him in stage 4, each with a recommendation.

## How to read this file

- **Four verdicts**, as the Port flow defines them: **keep** (the MVP's rule survives as it is), **rebuild differently** (the behaviour survives, the mechanism does not), **drop** (it does not come across), **add from D99** (D99 or D100 asks for something the MVP never built).
- **Three sorts for a rule**: **covered** — Restro's own platform already does this and the row needs no thought (the command door, provenance, the Log, the snapshot, money in minor units); **technical** — a choice the lead makes and reports, never a question for Martin (`technical-tuning-from-best-practice`); **product** — a question only Martin can answer, because it changes what a guest or a venue experiences.
- **"Keep or bug."** The Port flow's rule: a row that breaks one of the nine rules or a binding decision is a rebuild, never a keep, however well it works in the MVP.
- **Rows** are cited by their inventory id (`SR-176`). A verdict that covers a block of rows names the block.
- **Decisions above D123** do not exist as files on this branch, so they are written in words ("decision 125") with their branch. D1–D123 are cited normally.

---

## 1. The verdict in one page

The MVP is a working product and the shape of it survives: a guest finds a song on their phone, puts money on it, the money is held, the DJ decides, and the money is taken only when the song is real. That shape matches what the rest of the industry does, so it is not one club's invention.

What does **not** survive is most of the machinery under it. The MVP keeps its whole world in one JSON row under a version check, has no venue, no table, no roles on the guest actions, no provider behind the money, and an e-mail recovery flow that is an account in all but name. Every one of those is a nine-rule or decision conflict, so they are rebuilds by the flow's own rule, not judgements of taste.

Three things the MVP has are **alone in the market** and are the real questions for Martin:

1. **Public amounts and open outbidding.** No product read shows other guests what anyone paid. The nearest, Enjoy the Club in Spain, orders its queue by amount but does not publish the amounts.
2. **Paid greetings.** No product sells them. They cost seven rules, a revision counter, a moderation flow, a second payment kind and an interaction with succession, and they are the most likely thing to need moderation at 02:00.
3. **No free request at all.** D99 says free requests queue behind the paid ones; the club removed them (interview answer 41). Several comparable products run free requests with a paid priority tier on top, which is the other way round from both.

And one thing the MVP does that the industry agrees with and **D99 does not**: the money is captured late. D99 captures when the DJ accepts; the MVP captures at "prepare"; Enjoy the Club and TipTunez charge only if the song actually plays. D99 is the outlier here, not the club.

Counting the rules: of 130 rule rows, **38 are covered** by platform work that already exists or is being built, **54 are technical** and mine to decide, and **38 are product** — but those 38 collapse into **14 questions** for Martin, listed in §5.

---

## 2. Rules sorted: covered

These need no decision. Restro's own machinery already answers them, and the MVP's version is replaced by it without a question to anyone.

| MVP rows | What it is | What covers it |
|---|---|---|
| SR-145, SR-146 | A command needs an idempotency key; the same key with the same body returns the saved answer, with a different body is refused | `applyService(command)` in `core/service` is the one service write path (rule 1) and carries this already (D122 §9) |
| SR-147 | One command per commit, version check, retry with backoff, a size ceiling on the state | Postgres and `apply()`; there is no single state blob to version |
| SR-148 | Origin check, JSON content type, body size ceiling, GET and POST only | The web app's own request handling; D121 fixes how a guest page talks to the platform |
| SR-151 | A tick that settles payments, run on every command and every snapshot | `apps/worker`; a payment provider's notices are read back and acted on (decision 127, `or/foundation`), never a poll from the page |
| SR-152 | An ETag on the snapshot so an unchanged view costs nothing | The shell reads published files, not the database (rule 4); caching is the publisher's |
| SR-153 | A command whose answer never arrives is held, the banner says so, and nothing else may run until it is checked | D72: no local success. Already how every Restro face behaves |
| SR-192, SR-193, SR-194, SR-196 | Who is sent what: the DJ sees everything, a guest sees their own | Rule 3 (POS ids and internal fields stay in the backend) and the snapshot/overlay split (rule 4) decide this by construction |
| SR-197 | Every action writes an audit entry; no screen shows them | The venue Log (D120) is where this lives, and it is built |
| SR-200, SR-229 | A night, its end, whether it is closed | Restro's service day and the night close built in the ordering wave |
| SR-241–SR-253 (the mechanics of J) | Hold, capture, release, refund as statuses that move | Decision 125 and decision 127 on `or/foundation`: the venue's own Stripe account, direct charges, manual capture, the card form, the provider's notices. The MVP simulates all of this; we do not have to |
| SR-254 | Nothing expires a hold | Stripe's own hold lifetime decides it, not us. A technical row inside the paying wave, not a new one |
| SR-255 | The guest pays exactly what they typed; no fee is added | D98, firm: Restro's fee is invoiced to the venue, never split inside the payment |
| SR-257 | A Stripe adapter exists but nothing calls it | We have the real one |
| SR-260, SR-258, SR-259 | Constants duplicated as literals; sample data | Not a rule of the product |

**Note on SR-404.** The MVP never reaches a provider at all: its statuses are words changed inside one transaction. Everything in section J is therefore a *description of intent*, not tested behaviour. The real money behaviour comes from decision 125 and decision 127, and from decision 148's refund route — not from this port.

---

## 3. Rules sorted: technical

Mine to decide and report. Listed by what they are about, with the verdict and, where it is not obvious, the reason.

### Identity and access
- **SR-142 — rebuild differently.** The MVP's guest id is a cookie the server never records, so any 64-hex string is an identity and one phone can mint unlimited ones. That is a real hole once money and a cooldown hang off identity. Restro's guest session (D121) replaces it.
- **SR-143 — rebuild differently.** No role check on the guest actions, so a signed-in DJ can request as themselves. Restro's roles apply.
- **SR-144 — covered by Restro's roles**, with one product question attached (§5 Q11: is the DJ an organisation role, as D100 says).
- **SR-150 — technical.** Rate limits per identity. Numbers are mine; the MVP's (30 searches, 1500 commands, 5 e-mails a minute) are a starting point, not a finding.
- **SR-234, SR-235 — rebuild differently.** The personal link is the right idea for a guest with no account (D9) and survives; the MVP's 30-day re-issuing token is replaced by Restro's guest session.
- **SR-236 to SR-239 — drop.** An e-mail address, a verification code, attempt counters and a recovery flow is an account. D9 says guests need no app and no account. "Keep or bug" makes this a drop, not a judgement call. What it was for — a guest who loses their phone getting their money back — is answered by decision 148's refund route through staff, not by a login.

### Search
- **SR-155 to SR-157, SR-164 to SR-172 — rebuild differently.** Searching YouTube to find a song's title, artist, duration and thumbnail is metadata only; we never play audio, so this is not a licensing act (§4). The behaviour survives: a minimum query length, a cache, a quota back-off, filters that drop podcasts and interviews, the venue's region. The implementation is written fresh against the live docs, inventing nothing.
- **SR-158 — rebuild differently, and it is a bug.** The "song family" that powers both the duplicate rule and the cooldown is built by deleting substrings without word boundaries, so `live` turns "deliver" into "de r". Two different songs can collide into one family and block each other. Whatever replaces it needs a test.
- **SR-159 to SR-163 — technical.** Cache freshness (6 h), maximum age (7 days), the back-off after a quota error (15 min) and the behaviour with no API key. Best practice decides, not Martin.
- **SR-171 — drop.** A copy of search results in the phone's `localStorage`, used when the server fails. Restro's guest page does not carry its own fallback store.

### The command and the night
- **SR-145 to SR-149, SR-151 to SR-154** — see §2.
- **SR-223, SR-226, SR-227, SR-228, SR-230 — rebuild differently.** Opening and closing a night, a planned end, the warning past it, the handover that writes nothing but a log line. Restro's night already exists; song requests attach to it rather than keeping their own.
- **SR-225 — rebuild differently** with one product edge (§5 Q8: the 30-minute cut-off before the planned end).
- **SR-229 — keep the idea.** A service day boundary at 06:30 is already Restro's (the venue's service day, default 07:00). The MVP's 06:30 is the club's; the venue's own setting wins.

### The state machine
- **SR-208 — drop.** "Accept" sets a flag, takes no money, is not needed for anything, has no undo, and nothing on the guest page reads it. It is dead weight; D99's "accept" means capture, which the MVP moved to prepare anyway.
- **SR-209, SR-212, SR-214 — rebuild differently.** "Prepare" exists to wait up to ten seconds for the money. With a real provider the wait and its failure paths are different, so the mechanism is rebuilt even though the step survives (whether the step survives at all is §5 Q5).
- **SR-210, SR-211 — drop.** The simulated-payment selector is scaffolding for a demo with no provider.
- **SR-215, SR-216 — keep.** "Song started" is the real moment, it is atomic, and finishing is optional because the next start finishes the previous song. That is correct and cheap.
- **SR-217 — keep.** Undo a start within 60 seconds, refused if anything else happened meanwhile. It is the cheapest protection against the DJ's thumb, and the club asked for it (interview answers 8, 13).
- **SR-218, SR-219 — keep the behaviour, rebuild the mechanism.** A skip needs a typed reason; every action is logged. Both are right, and the Log (D120) is where the second one goes.
- **SR-240 — rebuild.** Nothing is ever deleted in the MVP. Restro deletes nothing from app code either (the never-list), and the purge job (D83) is the one path.

### Failure
- **SR-213, SR-249 — rebuild differently.** A request whose every payment fails is removed and the holds released. Right behaviour, provider-specific mechanism.
- **SR-256 — rebuild.** The MVP cannot represent an answer that never comes. A real provider can, and decision 127's notices are how we hear it.

---

## 4. Licensing: why the search is not the problem

Worth stating plainly because it is the first thing a lawyer would ask. Of every product read, licensing is pushed to the venue or the performer: Enjoy the Club says so in its terms, Soundtrack tells the venue to add its own collecting-society licences, Rockbot covers only the audio it streams itself and explicitly not DJs or live music, Tringbox says it is enabled only where the venue holds the licences. Only the background-music services, which supply the audio, carry any licence themselves.

Restro supplies no audio. The DJ plays from their own software, as they already do, and the venue already holds its public-performance licence. A song request is a message to the DJ with money attached; the YouTube call reads titles and thumbnails. So the common industry position is available to us and costs nothing. It still wants a line in a decision and a sentence in the venue's terms — the lawyer's, not a blocker (`ask-them-keep-it-simple`).

---

## 5. Rules sorted: product — the fourteen questions for Martin

Each carries the club's own answer where they have one (their 55-answer interview is the recommended default under the Port flow), what the comparable products do, and my recommendation. These are stage 4's agenda; none is settled.

**Q1 — Are there free requests?** *(SR-184, SR-176, SR-177, SR-392; club answer 41: no free requests, €5/€3/€3, and they asked that the departure from D99 be reconciled explicitly.)* D99 says free requests queue behind every paid one. Several products run exactly that (free requests, paid priority on top). The club removed free requests entirely. **Recommend:** a venue setting, defaulting to free requests allowed and queued behind the paid ones, as D99 says — because a club that wants the club's model just turns it off, while the reverse is not true.

**Q2 — Do other guests see who paid what?** *(SR-191, SR-186, SR-394; club answers 42–43: all contributors shown with aggregate amounts, greetings excluded.)* No product read publishes amounts. TouchTunes shows names unless a guest picks "Anonymous"; VIBY shows who ordered; nobody shows the money. **Recommend:** show the queue and the names, never the amounts. It is the one place the MVP is alone in the whole market, and public amounts are what turns a queue into a bidding war between guests — the loudest complaint found anywhere in the field.

**Q3 — Do paid greetings come across?** *(SR-182, SR-201 to SR-207, SR-399; the club built them at €3 with a revision-and-approval flow.)* No product sells them. The 2026-10-30 verdict already said drop. They are seven rules, a second payment kind, a moderation step and a text a stranger reads aloud in a club. **Recommend:** not in the first release. Revisit once requests themselves work; nothing in the design prevents adding them.

**Q4 — Can several guests put money on one song?** *(SR-177, SR-180, SR-191, SR-221.)* Enjoy the Club does exactly this ("several people can chip in on the same song"), and it is the one piece of the MVP's auction with a clear precedent. **Recommend:** keep, but with the amounts private (Q2) and without succession (Q6).

**Q5 — When is the money taken?** *(SR-209, SR-210, SR-247, SR-396; club answers 29 then 36: hold at submission, capture at "prepare", then a separate "song started".)* D99 says capture when the DJ accepts — earlier than both. Enjoy the Club charges only if the song plays; TipTunez refunds if it is not played within 45 minutes. **Recommend:** hold when the guest asks, capture when the song actually starts, and keep the DJ's two-step (prepare, then start) because the DJ needs to know the money is good before announcing it. This makes the capture moment match the industry and makes D99's sentence the thing that changes.

**Q6 — What happens when one backer's card fails and others succeed?** *(SR-212, SR-221, SR-397, SR-207.)* No product read describes this at all. The MVP captures each backer separately, excludes the slow ones, hands the request to the earliest paying backer and throws away the greeting. **Recommend:** drop succession. With one capture moment and private amounts, the song either has enough money or it does not; a request whose captures fail is skipped and everything is released. The MVP's complexity here exists to serve the public auction, and the auction is what Q2 removes.

**Q7 — Can a guest take their money back before the song plays?** *(SR-220, SR-245.)* The MVP allows a withdraw while the request is queued, releasing that guest's holds. **Recommend:** keep. It is cheap, it is honest, and it is what a hold is for.

**Q8 — When does the venue stop taking requests?** *(SR-174, SR-225, SR-226; club answer 17: stop 30 minutes before the planned end.)* **Recommend:** keep as a venue setting with the club's 30 minutes as the default. Technical in shape, but it is the venue's money and the guest's expectation, so Martin should see it.

**Q9 — Can the same song be asked for again, and how soon?** *(SR-178, SR-179, SR-408; club answer 4 as amended: 30 minutes from an explicit play start, the two-plays cap removed.)* Almost no product publishes a repeat rule. **Recommend:** keep, as a venue setting defaulting to 30 minutes, and keep the refusal of a song already in the queue with "support the open one instead" — that one is both a kindness and the thing that makes Q4 useful.

**Q10 — How many songs does the DJ hold, and do guests see them?** *(SR-188 to SR-190, SR-192, SR-393, SR-394; the club locks three and hides them.)* D99 says the window is the playing song plus N, N a venue setting with default 1, and that guests see the whole queue. **Recommend:** make the size a venue setting as D99 says, default 3 as the club runs it, and show guests that the songs are locked without showing which — because a guest who cannot see why their €5 song is not moving will ask a waiter.

**Q11 — Does a song request need a table?** *(SR-407, D100.)* The MVP has no table at all. D100 says a feature declares whether it needs a table code and that a request without one is marked "online" on the DJ's screen. **Recommend:** follow D100 — allow both, mark the table where there is one. It costs little and the DJ wants to know where to look.

**Q12 — Who answers a guest whose song never played?** *(SR-231 to SR-233, and decision 148 on `docs/pos-support-answers`.)* The MVP has a complaints inbox with a published two-working-day promise. Decision 148 gives staff a route to send the money back on their own confirmation. **Recommend:** drop the inbox and the promise; use decision 148's route and the venue Log. The promise is a commitment to guests that nobody has agreed to keep.

**Q13 — Where does the money land, and who is the seller?** *(SR-404; D98, firm.)* Martin answered the first half on 2026-11-19: the venue's own account. Most comparable products do the same (the host's own Stripe). One, Enjoy the Club, makes itself the seller and issues the guest's receipt. **Recommend:** no change — D98 stands. What is left is the bookkeeping consequence: money arrives in the venue's account for a sale its till never saw. That is the accountant's question, written down and not a blocker.

**Q14 — What is Restro's charge for this?** *(Q77, still open in D98.)* Enjoy the Club takes about 10%, Rekwest 10% + €0.30, RequestSongs 10–17%, DJ Requestify 5%; several take nothing and sell a subscription instead. **Recommend:** nothing decided here. Q77 is the whole platform's charging model, not this feature's, and it should not be settled from one feature.

---

## 6. Add from D99 and D100: what the MVP never built

| What | Where it comes from | Verdict |
|---|---|---|
| Free requests, queued behind the paid ones | D99 | Q1 |
| Venue settings: requests on or off, the minimum paid request | D99 ("no further caps") | **Add.** The MVP has no venue at all. Lock-window size (Q10), cooldown (Q9) and the cut-off (Q8) join the list, which is more than D99's "no further caps" allows — a point for stage 4 |
| The night's totals, for the owner | D99 | **Add.** The MVP has no totals anywhere. It belongs on the venue's own screen, not the DJ's |
| Duplicates grouped for the DJ | D99 | **Drop as written.** The MVP refuses a duplicate and points the guest at the open request instead, which is better and is what Q4 keeps |
| A table code, or the "online" mark | D100 | Q11 |
| The queue published as a live overlay file, polled | D99, and rule 4 | **Add.** Non-negotiable: guest pages never read the database |
| Captures and refunds as outbox jobs with idempotency keys | D99 | **Add**, through decision 127's provider work, not freshly |
| The DJ as an organisation role with access only to the request queue | D100 | **Add.** The MVP's DJ is a staff role on one venue |

---

## 7. Feature sets

Stages 5 to 7 of the Port flow run once per feature set. Cut so that each set is worth building on its own and the first one is usable without the others.

- **FS-1 — A guest asks for a song and pays.** Identity, search, the checkout, the hold, the guest's own list, withdraw. Rows: section B, SR-173 to SR-184, SR-220, SR-241 to SR-245.
- **FS-2 — The DJ runs the queue.** The queue, the lock window, prepare, start, finish, undo, skip with a reason. Rows: section D, section F, SR-218, SR-219.
- **FS-3 — The money settles.** Capture at start, release, refund through decision 148's route, the Log. Rows: section J, SR-212, SR-213. Leans entirely on the paying wave; builds after it, not beside it.
- **FS-4 — The venue decides.** Requests on or off, the minimum, the cut-off, the cooldown, the window size, the night's totals. Rows: the "add" table above, SR-174, SR-225, SR-226.
- **FS-5 — Later, each on its own.** Boosts from several guests (Q4), greetings (Q3), the table mark (Q11).

The first three are the product. FS-4 is small and makes it sellable to a second club. FS-5 is everything the grilling may cut.

---

## 8. What this map still owes the stories

The stories half of the inventory was not written when this map was made. When it lands it adds tap counts and the screens as a person meets them. It cannot change a keep/drop verdict above — those come from rules — but it is needed before stage 5, because the screen plans (D123) are built from stories and taps. Two things to check against it in particular: whether the first three requests of an empty night really lock the moment they are made (SR-189), and what a guest actually sees while their song sits behind the locked three (Q10).

## 9. What is not here

- No ticket, no spec, no code. Stage 4 (the grilling) runs first.
- No verdict on looks; the MVP's screens are all redesigned (Martin, 2026-11-18).
- Nothing about reservations; that port ran separately and is merged.
- The questions for the MVP's own author (Round A of stage 4) are not in this file. They are the rows the inventory marks "no record" and the seven open questions at its end.
