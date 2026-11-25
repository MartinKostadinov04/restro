# Where our song table's rows come from, and how long we may keep them

Research and a recommendation, by the lead, 2026-11-25, after D173 settled *which writer owns* the song
table and left *what may be in it, and for how long* open. This is the question that blocks #522; #521 is
unaffected and can be cut today, because the table, the writer and the purge path are the same whichever
way this goes.

Nothing here is a decision. All citations read 2026-11-25. It continues two earlier files and closes the
one read each of them left open: the [metadata research](2026-11-22-song-request-metadata.md) (#509) and
the [catalogue probe](2026-11-22-song-request-catalogue-probe.md).

**Verdict in one line: #522 cannot keep songs "permanently" if they come from the provider's search — the
provider's own policies cap stored data at 30 calendar days — but the goal behind that word survives
intact, and cheaply, by keeping a song while it is in use and refreshing it from the abundant quota bucket
rather than the scarce one.**

---

## 1. The thing #522 is actually trying to buy

#522's sentence is worth reading closely, because it names the goal and not the mechanism:

> **Our own song table keeps songs permanently**, not for a day: a song seen once is searchable from our
> own rows for ever after. This is what makes the budget survive a real night.

The budget is the binding constraint on the whole feature: `search.list` has **its own quota bucket of 100
calls a day for the entire platform** (§2 of the metadata research), and one club night of guests typing,
retyping and paging can exhaust it before midnight. So the goal is: **never spend a search on a song
somebody has already asked for.** "For ever" is how the ticket reached for that goal, not the goal itself.

What has to be stored to reach it, read off the decisions as they stand:

| What | Why | Where it is decided |
|---|---|---|
| A stable identity per song | the cooldown ("the same song cannot be asked again at once") and popularity ("a second guest asking for the same song … moves it up") both need one | D168, D166 |
| Enough to find it by typing | so a known song is answered from our rows and no search is spent | #522 |
| Enough for the DJ to recognise it | his eyes are release 1's only screening | D167 |
| **Not** a playable link | #526's cards carry the song and its two buttons; no link, no preview, no thumbnail | #526's screen plan |

That last row is the one that changes the arithmetic, and it is a real divergence from the MVP rather than
an oversight. The MVP puts a **"YouTube ↗" link on every DJ row and a thumbnail on every guest result card**
(port stories SR-S3, SR-S19). Restro's own DJ screen has neither: a card is the title, the artist and
*played* / *didn't play*. A club DJ plays from his own library, so Restro's job is to tell him **what** was
asked for, not to hand him the audio. Nothing in release 1 needs us to keep a provider's reference to a
recording in order to work.

## 2. What the provider's policies allow us to store

The catalogue probe closed with one unread page: "the exact licence bucket of each field we would store,
which is a read of its licence page rather than a probe". Read now, on both sources.

**The provider's search results.** Our search uses a developer key with no user signing in, which makes
everything it returns **Non-Authorized Data**, and that is the stricter of the two buckets. Section
**III.E.4.d** of the [API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies),
in full:

> API Clients may temporarily store limited amounts of Non-Authorized Data for as long as is necessary for
> the purposes of the API Client but not longer than 30 calendar days. As in section (III.E.4.c)
> immediately above, this means that after 30 calendar days, the API Client must either delete or refresh
> the stored data.

Three things in it bear on #522:

1. **A hard 30-day clock,** with "delete **or** refresh" as the two ways out. A refresh resets it.
2. **"temporarily store limited amounts"** — neither word is defined anywhere on the page, and no quantity,
   size or proportion is given.
3. **A freshness duty** beside the clock (III.E.4.e): "reasonable efforts to ensure that their stored API
   Data is consistent with the current data", with "metadata changes and viewcount updates" reflected "as
   quickly as possible". III.E.4.f adds that a client "must display the most updated API Data available".

And three things it does **not** say, each checked rather than assumed:

- **No exception for identifiers.** The policies say nothing about video IDs, channel IDs or any opaque
  identifier. A stored video ID is covered by the same clause as a stored title. The only
  longer-than-30-days allowance, III.E.4.b, is for Analytics and Reporting data and statistics, and it is
  Authorized Data only; it explicitly adds that a client "must not store statistics retrieved as
  Non-Authorized Data for more than 30 days".
- **Nothing about caching search results** specifically, in either direction. III.E.1.a's ban on caching
  copies is about audiovisual content, not metadata.
- **Nothing that permits an indefinite rolling cache.** See §5 for the one place this needs an opinion
  rather than a reading.

**The open catalogue (MusicBrainz).** The probe measured its coverage and found it good — 18 of 20
Bulgarian artists, 115 to 252 recordings each, both scripts, remixes and sped-up edits included — and
found its hosted free-text search unusable for a guest. The licence split, from
[Data License](https://musicbrainz.org/doc/About/Data_License) and
[MusicBrainz Database](https://musicbrainz.org/doc/MusicBrainz_Database):

| Bucket | Licence | What is in it |
|---|---|---|
| **Core** | **CC0** — "anyone can download and use the core data in any way they see fit. No restrictions, no worries!" | Artist: name, sort name, aliases, MBID. **Recording: title, artist credit, duration, ISRC, MBID.** Release and track titles. Genre *entity* names. |
| Supplementary | CC-BY-NC-SA 3.0 | "user submitted annotations, tags (including genre associations) and ratings", derived statistics, **search indexes**, edit history |

**Everything a song row needs is in the CC0 bucket** — title, artist, duration, a stable MBID — and nothing
it needs is in the non-commercial one. Genre associations are non-commercial, which costs us nothing: D167
already closed genre screening. The dumps are
[split by licence](https://musicbrainz.org/doc/MusicBrainz_Database/Download): `mbdump.tar.bz2` is "the
core MusicBrainz database, including the tables for Artist, Release, Recording, etc." and is listed under
Public Domain / CC0; the user tags that carry genre live in `mbdump-derived.tar.bz2`, which is the
non-commercial one, so we simply never take it. A "complete data snapshot of the entire database is
generated twice a week."

Two things about MusicBrainz stay unresolved and are named as unknowns rather than filled in:

- **The Live Data Feed replication packets are CC-BY-NC-SA**, so the normal way of keeping a local copy in
  sync is not available to a commercial product. Re-importing the CC0 core snapshot is, and it is
  published twice a week.
- **Whether a commercial user may take the CC0 dump without a MetaBrainz support tier is not stated** on
  either page I read. The account-type page says "To access our datasets or the MusicBrainz Live Data Feed,
  please choose between non-commercial and commercial use below", and lists commercial tiers from
  **Bronze, $100/month and up** ("popular mobile apps and … small to mid-size start-ups with public
  products") through Silver $600 and Gold $1250, with a **Stealth Start-Up tier at $0.00/month and up**
  "for start-ups that are in early stealth mode, and are not publicly offering their services". The CC0
  licence on the file imposes nothing; the sign-up request sits beside it. The datasets page
  (`metabrainz.org/datasets/postgres-dumps`) would settle it, and the honest reading of what I did read is
  that a pilot is plausibly the stealth tier at no cost and a shipped product is Bronze.

## 3. The quota insight that makes the clock affordable

The 30-day clock looks fatal to the table's purpose — if a row dies every month, does the ration not get
spent again? No, and the reason is in the quota table the metadata research already published:

| Call | Bucket | Cost |
|---|---|---|
| `search.list` | **its own bucket, 100 calls a day, platform-wide** | 1 per call |
| `videos.list` | the general bucket, **10,000 units a day** | 1 unit, and it takes **up to 50 ids per call** |

A **refresh is not a search.** Refreshing a known song means `videos.list` by its id — the abundant bucket,
fifty songs to a call. Ten thousand stored songs refresh for about **200 units of a 10,000-unit daily
allowance**, and the scarce 100-search bucket is untouched. The same call is what satisfies III.E.4.e's
freshness duty and tells us a recording has been taken down, which is the row we then have to drop.

So the clock costs a nightly worker job and roughly two per cent of the general quota. It does not cost a
single search.

## 4. The three shapes, measured

**A — #522 as written: provider rows, kept permanently.** Not available. III.E.4.d caps stored
Non-Authorized Data at 30 calendar days with no identifier exception, and "permanently" is the one word the
clause forbids outright. This is not a close call and not an interpretation.

**B — provider rows, kept while in use and refreshed monthly.** The table holds a song while something
actually refers to it — a request at a venue, a live cooldown, the night's queue — and a nightly job
refreshes those rows by id through `videos.list` before their 30 days are up, dropping any the provider no
longer returns. A row that a search merely *returned* and no guest ever chose is never kept at all.

This delivers #522's goal rather than its wording. The ration is spent only on a song nobody has asked for
before, which is exactly the sentence in the ticket; what it gives up is a song nobody has asked for in
eighteen months, which is a row of no value. It fits "limited amounts" far better than "every song we have
ever seen", because the table's size is then set by a club's repertoire and not by every speculative
search. And it is the shape D173's writer was already written for: one entry point taking a first sight
*and* a refresh, with expiry in the purge tick beside `purgeProviderNotices`.

Costs: a refresh job (#522 or a follow-up), an eviction rule in the purge tick, and the retention rule
written down. No new dependency, no import, no index.

**C — our own catalogue from the CC0 core dump, with our own search over it.** What the probe recommended
on its own evidence, now with the licence question answered in its favour. It does not mitigate the
hundred-search ceiling; it **removes** it, because nothing is called during service. It removes the 30-day
clock, because CC0 data carries none. And it removes a problem the Discogs probe exposed in passing but
which applies to the provider's search too: the only string we have to match on today is **a title an
uploader typed**, decoration and all — `Goldie - Inner City Life (Official Video)` matched nothing until
the decoration was stripped. A catalogue of recordings has clean titles by construction. It also makes the
music-only property stronger than D167 assumed: a music database contains no podcasts at all, so the
MVP's three stacked filters and two hand-written word lists stop being load-bearing.

Costs, all of them real: an import job over a twice-weekly snapshot, an index, a matcher with
transliteration (the probe showed cross-script matching is needed in both directions and that its own
hosted free-text search cannot do it), duplicate collapsing across releases (the probe showed the same
title appears once per release), probably a MetaBrainz tier, and a Bulgarian long tail that is good but not
complete — two of twenty artists were not found, and streaming-only tracks are thin on any release
database.

## 5. Recommendation

**Cut #521 now.** Nothing in this file touches it. The table's shape, the writer and the purge path are
identical under B and C.

**Ship B in release 1, and put C in front of Martin as the follow-on it has now earned.** Three reasons,
in order of weight:

1. **Row 1.23 is firm and it fixed release 1's screening as "only what the MVP already does: the music-only
   search"** (D167). Swapping the source is a change to the spec, not a choice a ticket's author may make
   — even a change that improves the thing 1.23 was worried about.
2. **B is small, legal under the cautious reading, and loses nothing anybody wanted.** The sentence #522
   wrote the table for stays true word for word.
3. **C is a build, not a switch,** and the probe already said so: an import job, an index and a refresh
   schedule, which is the same machinery a DJ-library import would need. It deserves its own ticket and its
   own decision, not a line in #522.

**Two things to do regardless of which way it goes.**

- **File the quota extension form now.** The metadata research flagged it, the probe called the ceiling "a
  bigger risk to this feature than genre ever was", and the form states no criteria and no timing — which
  is a reason to file early, not late. Under B it is the difference between a quiet night and a dead search
  box; under C it stops mattering, and by then it has cost nothing.
- **Say the retention rule out loud in the venue's settings or help, not only in the code.** A venue whose
  DJ asks why a song the club played in March is not in the box deserves an answer that exists.

**The one thing worth a lawyer, and only this.** III.E.4.d says "temporarily store limited amounts … but
not longer than 30 calendar days", and then "after 30 calendar days, the API Client must either delete or
**refresh** the stored data". Read literally, an indefinite rolling refresh is permitted by the second
sentence and sits badly with the first. B is deliberately built to the cautious reading — a row lives only
while something refers to it, so the table stays bounded by a club's repertoire and is in no sense a
permanent mirror of the provider's catalogue. If anyone ever wants the literal reading instead, that is an
interpretation question and the one place in this file where plain research runs out.

## 6. What this changes in what is already decided

Nothing is contradicted. Three things are made more specific.

- **D173 stands exactly as written,** and B is why its fourth point was right: the one entry point owns
  refreshes as well as first sights, and expiry belongs to the purge job. A writer that only remembered
  would have made B unbuildable.
- **D167's "music-only search" stays the screening of release 1.** B keeps it unchanged. C would make it
  stronger, which is an argument for C and not a reason to call D167 wrong.
- **#522's scope line needs one edit** before it is cut: "keeps songs permanently" becomes "keeps a song
  while it is in use, refreshed before its thirty days are up", with the eviction rule named. Its
  acceptance criterion — "with the budget spent, a guest can still find and request any song already in our
  table" — passes unchanged.

## Unknowns, stated as unknowns

1. **Whether a commercial user may download the CC0 core dump without a MetaBrainz tier** (§2). The
   datasets page would say; the licence on the file imposes nothing. Only matters under C.
2. **What "limited amounts" means** (§5). Undefined on the policy page. Only matters if anyone wants the
   literal reading of the rolling refresh.
3. **Whether `videos.list` by id returns a usable row for every song we would hold** — it should, and the
   prototype already makes this exact call per result page, but nobody has run it over a thousand stored
   ids in one job. Cheap to settle inside #522.
4. **MusicBrainz's Bulgarian long tail,** measured at 18 of 20 artists by name and not measured at all for
   the songs a club actually gets requested. Only matters under C, and it is the thing to measure before
   committing to C.
