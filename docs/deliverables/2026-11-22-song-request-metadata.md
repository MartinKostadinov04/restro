# What we can reliably know about a requested song, and whether a venue can block a genre

Made by a research session (Opus) for row 1.13 of `2026-11-22-song-requests-grilling-answers.md`, the last
open row of the song-requests grilling (T82). Research only: no code, no dependency chosen.

**Verdict: partly, and not from YouTube.** YouTube can keep requests to *music as a whole* — the prototype
already does, and Martin was right that it does — but the API exposes nothing that names a musical genre at
search time, and only 15 coarse topics (`Rock music`, `Electronic music`, `Pop music`…) anywhere. A block on
a named sub-genre such as "no drum and bass" is deliverable only by adding Discogs, whose release `styles` do
carry that grain. Probed against real titles it would stop **most** drum-and-bass that exists as a release,
**almost none** of the mixes, bootlegs and streaming-only tracks a club actually gets, and it **cannot name
chalga at all** — the one genre a Bulgarian club is most likely to want blocked.
Recommendation: ship blocked artists and title words only, as decided in 1.13, and tell the venue plainly why
there is no genre switch. A genre list is a setting we could not keep.

All citations read **2026-11-22**. Official documentation and the services' own APIs are primary; two sources
could not be reached and are marked as unknown rather than filled in.

---

## 1. What the YouTube Data API v3 returns that classifies a video

| Field | Which call | Available at search time? | Grain | What the docs say |
|---|---|---|---|---|
| `snippet` (search result) | `search.list` | yes | no classification at all | The `search` resource returns `publishedAt`, `channelId`, `title`, `description`, `thumbnails`, `channelTitle`, `liveBroadcastContent`. No tags, no `categoryId`, no duration, no topics. |
| `snippet.categoryId` | `videos.list` only | no — needs a second call | **one** `Music` category (id `10`) | "The YouTube video category associated with the video." |
| `snippet.tags[]` | `videos.list` only | no | free text, uploader-set | "A list of keyword tags associated with the video… The property value has a maximum length of 500 characters." The docs **do not state who sets them**; in practice the uploader does, which makes them unreliable for a rule. |
| `topicDetails.topicIds[]` | `videos.list` | no | — | **Dead.** "This property has been deprecated as of November 10, 2016… The API no longer returns values for this property". |
| `topicDetails.relevantTopicIds[]` | `videos.list` | no | — | **Dead.** "This property has been deprecated as of November 10, 2016. It will be supported until November 10, 2017." That date is nine years past; the page does not say what happens after it. |
| `topicDetails.topicCategories[]` | `videos.list` | no | "high-level" | "A list of Wikipedia URLs that provide a high-level description of the video's content." The page shows **no example values**. |
| `videoCategories.list` | own call | n/a | the category list only | "Returns a list of categories that can be associated with YouTube videos." Categories are things like Music, Gaming, Sports — **not genres**. |
| `topicId` (a *filter*, not a field) | `search.list` | yes, as a filter | 15 coarse music topics | "indicates that the API response should only contain resources associated with the specified topic." |

Sources: [search/list](https://developers.google.com/youtube/v3/docs/search/list),
[search resource](https://developers.google.com/youtube/v3/docs/search),
[videos resource](https://developers.google.com/youtube/v3/docs/videos),
[videos/list](https://developers.google.com/youtube/v3/docs/videos/list),
[videoCategories/list](https://developers.google.com/youtube/v3/docs/videoCategories/list).

### The curated topic list is the whole of YouTube's genre vocabulary

`topicId` survived Freebase's retirement, but narrowed: "Due to the deprecation of Freebase and the Freebase
API, the `topicId` parameter started working differently as of February 27, 2017… YouTube started supporting
a small set of curated topic IDs, and you can only use that smaller set of IDs as values for this parameter."

The Music section of that curated set is **15 entries, verbatim and complete**:

`/m/04rlf` Music (parent topic) · `/m/02mscn` Christian music · `/m/0ggq0m` Classical music · `/m/01lyv`
Country · `/m/02lkt` Electronic music · `/m/0glt670` Hip hop music · `/m/05rwpb` Independent music ·
`/m/03_d0` Jazz · `/m/028sqc` Music of Asia · `/m/0g293` Music of Latin America · `/m/064t9` Pop music ·
`/m/06cqb` Reggae · `/m/06j6l` Rhythm and blues · `/m/06by7` Rock music · `/m/0gywn` Soul music

Three things follow, each of which on its own sinks a genre switch built on YouTube:

1. **No sub-genres.** There is no drum and bass, no house, no techno, no metal, no chalga, no manele. The
   finest grain on offer is "Electronic music", which covers the entire floor of a nightclub.
2. **`topicId` filters *to* a topic; it cannot exclude one.** The docs state only that the response "should
   only contain resources associated with the specified topic", give no value format beyond a single ID, and
   say nothing about negation or multiple values. A venue's setting is "no X" — the opposite shape. To
   approximate it you would have to run one search per *allowed* topic and merge, multiplying a quota that is
   already the binding constraint (§2).
3. **The read side is gone.** Both topic-ID properties are deprecated and `topicIds[]` explicitly returns
   nothing. The only survivor, `topicCategories[]`, is documented as "high-level" with no examples given.

**Stated as unknown:** what `topicCategories[]` actually returns for a music video today — whether the
Wikipedia URLs reach genre pages (`/wiki/Drum_and_bass`) or stop at `/wiki/Music`. The documentation does not
say, gives no examples, and I had no API key to test it. It is the single thing that could soften this
verdict, and it is cheap to settle: one `videos.list` call with `part=topicDetails` against twenty known
tracks. I did **not** use the key in the prototype's git-ignored `.dev.vars` — it is a secret and not mine to
spend. Even if those URLs did reach genre pages, they arrive one `videos.list` call *after* the search, are
undocumented in grain, and would be a rule built on an unspecified field.

---

## 2. Quota: the real constraint, and it is not about genre

| Call | Cost | Source |
|---|---|---|
| `search.list` | own bucket, **100 calls per day**, 1 unit each | "The `search.list` and `videos.insert` methods have their own quota buckets. Each of these methods has a default daily limit of 100 per day. The quota cost is 1 per call." |
| `videos.list` | 1 unit | "A call to this method has a quota cost of 1 unit." |
| `videoCategories.list` | 1 unit | quota table |
| Default allocation | "100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day combined for all other endpoints" — and "subject to change" | getting-started |

Sources: [determine_quota_cost](https://developers.google.com/youtube/v3/determine_quota_cost),
[getting-started](https://developers.google.com/youtube/v3/getting-started). Also: "All API requests,
including invalid requests, incur a quota cost of at least one point", and each extra page of results costs
again.

**One hundred searches per day, per project, for every venue at once.** That is the headline number, and it
dwarfs the genre question. A single club night of 200 song requests, with guests typing, retyping and paging,
would exhaust the day's searches before midnight — which is exactly why the prototype caches results for six
hours and serves stale pages for up to seven days (`docs/search-reliability.md`). More quota is available by
"completing the Quota extension request form", with no criteria or timing stated.

A per-search genre check would make this worse in two ways: a `videos.list` follow-up per result page (cheap,
1 unit, out of the 10,000 bucket — the prototype already pays this), or a search-per-allowed-topic fan-out to
fake exclusion (14 allowed topics × every search = the 100-call ceiling reached after **seven searches a
day**). The second is not viable at any club size.

---

## 3. What the prototype actually does

The pinned MVP at `C:\Ports\restro-club-biad` (read-only; nothing edited, branched or committed there). The
search lives in one function, `youtubeMusic`, in `restro-club-biad-main/lib/dj-youtube.mjs`.

**Martin is right: the demo does restrict to music and does exclude podcasts.** Line 47 sends:

| Parameter | Value | Effect |
|---|---|---|
| `videoCategoryId` | `'10'` | Music category only |
| `topicId` | `'/m/04rlf'` | the Music **parent** topic — not a genre |
| `type` | `'video'` | required alongside `videoCategoryId` |
| `q` | the query **+ `-podcast -подкаст -interview -интервю -audiobook`** | Boolean NOT; the docs confirm "Your request can also use the Boolean NOT (`-`) and OR (`\|`) operators to exclude videos." |
| `order`, `maxResults`, `safeSearch` | `relevance`, `25`, `moderate` | |
| `part`, `fields` | `snippet`, trimmed to `items(id/videoId)` | the search snippet is discarded — it classifies nothing |

A second call (line 51) fetches `part=snippet,contentDetails` and the code then drops anything that is not
`categoryId === '10'`, is live or upcoming, has zero duration, or is region-blocked for BG (line 56), plus two
hand-written filters: `SPOKEN_FORMAT` (line 5 — podcast, интервю, audiobook, ток-шоу, reaction, tutorial, in
both languages) and `songEvidence` (lines 7–9 — "official video", "lyrics", "remix", a ` - ` in the title, or
a `VEVO` / ` - Topic` channel).

So the music restriction is real, and it is three mechanisms stacked: the API's Music category, the Music
parent topic, and hand-written Bulgarian/English word lists. **None of them knows a genre.**

**Where the impression of genre comes from.** The prototype does show a genre label, and that is worth being
exact about, because it is the heart of row 1.13:

- A real YouTube result gets the literal string `'YouTube'` — `lib/dj-youtube.mjs:59`:
  `[{id,title,artist,genre:'YouTube',durationSeconds:seconds}]`.
- The genres that look real — `House`, `Dance`, `Latino`, `Classics`, `Funk`, `Pop` — are **hand-typed into a
  12-song demo catalogue**, `lib/dj-domain.mjs:26-37`, e.g. `{ id: "DkeiKbqa02g", title: "One Kiss", artist:
  "Calvin Harris, Dua Lipa", genre: "House" }`.
- The phone shows the genre label only when a song has no duration — `public/client/app.js:60` falls back to
  `s.genre || 'Музика'`. A genuine YouTube result always has a duration, so **the genre label is shown only
  for stub songs**.

As the task noted, the demo runs without a key and its results are stubs; `YOUTUBE-SETUP.md` confirms the UI
reads "Демо каталог" with no key, and says of the strict music mode: "YouTube категоризацията не е абсолютна
гаранция за «само песни»" — YouTube's categorisation is not an absolute guarantee of "songs only" — "DJ-ят
запазва правото да откаже." The prototype's own documentation already concedes that a licensed metadata
source would be needed for a real catalogue: "A truly independent venue catalogue requires a licensed
metadata source or an imported DJ-library track list" (`docs/search-reliability.md`).

---

## 4. If YouTube cannot do it, what could

| Service | Genre for a track? | Grain | Free tier / limits | Licence for this use |
|---|---|---|---|---|
| **Discogs** | **yes, best of the five** — `genres` + `styles`, on the **release** | sub-genre: `Drum n Bass`, `Jungle`, `Euro-Disco` | **25 req/min** unauthenticated (`x-discogs-ratelimit: 25`, read from the live API); search needs no auth | **monthly dumps are CC0** — "This data is made available under the CC0 No Rights Reserved license" (data.discogs.com). API terms **unknown**: both terms pages are Cloudflare-blocked (403). |
| **MusicBrainz** | yes, `inc=genres` on a recording lookup | genre list, user-voted | **1 request/second**; User-Agent header required; no key | core data CC0, "The remaining portions… under the Creative Commons Attribution-NonCommercial-ShareAlike 3.0 license" — and the docs do **not** say which bucket tags/genres fall in. Non-commercial use free; commercial plans exist. |
| **Spotify** | **no** — none on the Track object; album `genres` is "Deprecated. The array is always empty"; artist `genres` exists but is **marked Deprecated** | artist-level at best | no fixed number published; "rolling 30 second window" | **closed.** "Spotify is for personal, non-commercial use"; "commercial uses are not permitted"; "Do not analyze the Spotify Content… for any purpose"; no storing or compiling databases of Spotify Content. |
| **Deezer** | **unknown** — `/api/track`, `/api/album` and `/api/genre` are login-gated | unknown | not published; terms refer to unnamed "rate limits" | **closed.** "limited to the private, personal and non-commercial purpose(s)"; access "reserved to Developers who have been expressly selected and approved"; no local copies. |
| **Last.fm** | tags via `track.getTopTags` | user tags, not curated genres (the docs never call them curated; counts expose the folksonomy) | no published rate; 100 MB storage cap | **needs a deal.** "You are permitted to use the Last.fm Data solely for non-commercial purposes"; commercial use "must apply for a commercial use agreement", else "a material breach". |

Sources: [api.discogs.com](https://api.discogs.com/releases/249504) and
[data.discogs.com](https://data.discogs.com/); [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API),
[Genre](https://musicbrainz.org/doc/Genre), [Rate Limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting),
[Data License](https://musicbrainz.org/doc/About/Data_License); Spotify
[get-track](https://developer.spotify.com/documentation/web-api/reference/get-track),
[get-an-album](https://developer.spotify.com/documentation/web-api/reference/get-an-album),
[get-an-artist](https://developer.spotify.com/documentation/web-api/reference/get-an-artist),
[terms](https://developer.spotify.com/terms), [policy](https://developer.spotify.com/policy);
[Deezer terms](https://developers.deezer.com/termsofuse); Last.fm
[track.getTopTags](https://www.last.fm/api/show/track.getTopTags), [tos](https://www.last.fm/api/tos).
*Fallback only, not relied on:* a web search surfaced third-party claims of 60 req/min authenticated for
Discogs and a May 2025 terms date; neither is used above.

Three of the five are legally shut for a paid feature: Spotify and Deezer are non-commercial by their own
terms, and Last.fm needs an agreement it prices nowhere. MusicBrainz is open but its genres are voted tags
("Genres are subjective, so just like with any other tags, you can upvote and downvote genres"), it is
recording-level, and 1 req/s is thin. **Discogs is the only real candidate**, and its CC0 monthly dump
sidesteps both the rate limit and the unreadable API terms — you would hold the genre table yourself.

### So is it worth adding one?

**No.** Not for this. Two reasons, and the second is the one that decides it.

**It does not fit the data.** Discogs is a database of *releases* — pressings of vinyl, CDs, digital
releases. Its styles sit on the release, never the track: a `tracklist` entry has exactly four keys,
`position`, `type_`, `title`, `duration`, with no style of its own (checked against release 249504). A track
on a compilation inherits whatever that compilation is tagged, which is how a house track on a mixed CD gets
blocked for drum and bass. And the thing we have to match *from* is a YouTube title an uploader typed.

**It misses what the pilot would actually want blocked.** Measured, not assumed — Discogs search against real
titles, 2026-11-22:

| Query | Result | Styles returned |
|---|---|---|
| `Rudimental Feel The Love` | matched | `Drum n Bass` ✓ |
| `Sub Focus Turn Back Time` | matched | `Drum n Bass, Breakbeat, Jungle, Breaks` ✓ |
| `Dimension Whip Slap` | matched a 2-track 12" | `Drum n Bass` ✓ |
| `Goldie - Inner City Life (Official Video)` | **no match** | — (the same query *without* "(Official Video)" matches and returns `Drum n Bass, Jungle`) |
| `Wilkinson - Afterglow [Official Video]` | **no match** | — |
| `Hedex Pure Energy` | **no match** | — (streaming-era drum and bass, thin on a release database) |
| `Preslava` | matched | `Vocal, Folk` — **not chalga** |
| `chalga` (an anthology) | matched | `Country, Folk` — **not chalga** |
| `Azis Hop` | matched an unrelated US hip-hop record | `Hip Hop` — **a false positive across languages** |

Read the right-hand column against a Bulgarian nightclub. Cleaned titles resolve well. Raw YouTube
titles — the only kind we have — fail on the decoration alone, so a normaliser is mandatory before any of
this works at all. Streaming-only tracks are absent. **Chalga, the genre a Bulgarian club is most plausibly
going to ask to block, does not exist as a Discogs style**: Preslava comes back `Vocal, Folk`, which would
also block every acoustic ballad in the building. And a Bulgarian artist name matched an unrelated American
record outright, which is a *wrong* block — the worst failure of the set, because the guest has paid.

**The honest answer to a venue is the blocked artists and title words list, and only that.** It is exact, the
venue controls it, it needs no third party, no licence, no quota and no matching, and it already covers the
real case: a club that wants chalga out names the five artists, and a club that wants one song out names it.
That is what 1.13 settled for artists and words, and it is the right shape.

---

## 5. Verdict, and what the venue should be told

**Can a venue block a whole genre? Partly — and not well enough to ship.**

| If the venue sets… | What we could honestly do | Share stopped | Stopped by mistake |
|---|---|---|---|
| "music only, no podcasts" | **already works**, three ways (§3) | high | some songs lost to the word filters |
| "no spoken word / no mixes over N minutes" | works — duration is reliable from `contentDetails` | high | — |
| "nothing by these artists" / "nothing with these words" | **exact**, no third party | ~100% of what is named | only what the venue mis-types |
| "no electronic music" (a YouTube curated topic) | possible as a whitelist of the other 14 topics, but costs 14 searches per search against a 100-search day — **not viable** (§2) | moderate | heavy — "Electronic music" is most of a club's floor |
| **"no drum and bass"** (a sub-genre) | only via Discogs + a title normaliser | **most** tracks with a Discogs release, once titles are normalised (5 of the 6 probed, counting the two that match with the decoration stripped); **near zero** of mixes, bootlegs, remixes, live edits and streaming-only tracks — which on a drum-and-bass floor is a large share of what is actually requested | compilation tracks sharing a release's styles; cross-language name collisions (`Azis Hop` → a US hip-hop record) |
| **"no chalga"** | **nothing.** No vocabulary in any source names it | ~0% | — |

Those shares are reasoned from the matching evidence above, not measured over a real night, and the two kinds
of failure are worth keeping apart because only one of them is fixable. The three clean drum-and-bass titles
resolved; the two decorated ones failed on the decoration alone and would resolve once a normaliser strips
`(Official Video)` and `[…]`; the streaming-only one has no Discogs release and never will. So **matching is
an engineering problem and coverage is not** — build the normaliser and you still miss every track that was
never pressed or sold as a release, plus every DJ mix and bootleg edit. Treat the figures as the right order
of magnitude, and as the reason not to build it rather than a target to tune.

**What the venue should be told, on the setting itself.** A setting we cannot keep is worse than no setting —
the venue trusts it, a blocked song arrives anyway, and the guest has already paid. So the screen should
carry no genre control, and the blocked-list setting should say, in the venue's own words, what it does and
does not do. Suggested wording for the designer, to be put into next-intl properly:

> **Blocked artists and words.** Requests that match are refused before the DJ sees them. Name artists and
> words — one per line. Guests are never charged for a refused request.
>
> There is no genre setting. The song search can tell music from talk, but it cannot tell one genre from
> another, so a genre switch would let songs through and stop the wrong ones. Block the artists you do not
> want, and the DJ can still refuse anything else.

That last paragraph is the answer to row 1.13, and it is also the answer to give a venue that asks.

---

## Open questions

1. **`topicCategories[]` is the one unresolved fact** (§1). Settle it with one `videos.list` call,
   `part=topicDetails`, against twenty known tracks, using a key Martin authorises — not the prototype's.
   **Recommendation:** do not block 1.13 on it. Even the best case (Wikipedia genre URLs at
   `Electronic_music` grain) is coarser than the Discogs evidence that already failed, arrives a call late,
   and is undocumented in grain. Close 1.13 as "artists and words only" now, and record this as the thing to
   re-check if a venue ever insists.
2. **The Discogs API terms of use could not be read** — both pages 403 behind Cloudflare (§4). Not needed for
   this verdict, which says no. If Discogs is ever reconsidered, use the **CC0 monthly dump**, whose licence
   is stated plainly on Discogs' own host, rather than the API whose terms we have not seen.

## Out-of-scope observations

- **The 100-searches-a-day ceiling is a bigger risk to this feature than genre ever was** (§2) and is not yet
  a row anywhere in the grilling. One busy club night can exhaust it. The prototype survives on a six-hour
  cache and seven-day stale serving; whatever Restro builds needs that caching as a *requirement*, plus a
  decision on whether quota is per-Restro or per-venue, and a quota-extension request filed early. Worth its
  own row.
- `topicId` is undocumented in combination with `videoCategoryId` — the docs say nothing about how the two
  filters interact. The prototype sends both. Harmless, but it means the music restriction rests partly on
  undocumented behaviour; the two hand-written word filters are what actually carry it.
- The prototype's `genre` field (`'YouTube'` for real results, hand-typed for stubs) should not be ported as
  a field at all. If the guest page shows anything there, it can only be "Музика".
