# A probe: can an open catalogue stand in for the guest's search box?

Run by the lead on 2026-11-22, against the live MusicBrainz web service, after the
[cross-review](2026-11-22-song-requests-cross-review.md) proposed it (finding 1, option (a)) and the
[metadata research](2026-11-22-song-request-metadata.md) found that the prototype's search is capped at
about 100 queries a day for the whole platform. Method: the public web service, no key, a generic client
name, 1.1 to 1.5 seconds between calls, well inside its 1-per-second limit. Nothing here is a decision.

Decisions above 123 do not exist on this branch and are written without the D.

## What was measured

**1. Does it know Bulgarian artists?** Twenty searched by name: **eighteen found**, each scored 100 and
flagged `BG`. Two not found at all (Крум, Малина — both are also ambiguous words, so the miss may be the
query rather than the catalogue). Two of my six apparent misses were **my own spelling**, not gaps: the
band is Ъпсурт, not Упсурт, and Деси Слава and Графа resolve when the query is transliterated. Cross-script
matching works in both directions — `100 Кила` returns `100 Kila`, `Криско` returns `Krisko`.

**2. Does it hold their tracks, or only their names?** Recordings held, counted per artist:
Преслава 170, Азис 119, Галена 190, Графа 252, Криско 115. The titles are real and current, in both
scripts, and include remixes and sped-up edits (`Burnout (Dian Solo radio remix)`, `100 живота`,
`#OET Още един танц`). Chalga is **not** a blind spot here. One wrinkle: the same title appears several
times, once per release, so anything built on this needs to collapse duplicates before a guest sees them.

**3. Can a guest find a song by typing?** **No.** Typed the way a guest types, free text:

| typed | what came back |
|---|---|
| `Сен Тропе` | nothing at all |
| `бавно графа` | nothing at all |
| `preslava 100 prichini` | `03 Greedo — 100 100 100`, `旺福 — 100 100`, `Lorenzo Senni — 100. 100.` |
| `dua lipa levitating` | three fan remixes and covers; not the record itself |

**4. Is the song missing, or just unfindable?** Just unfindable. The same catalogue, queried in its own
field syntax, returns the exact record first try: `recording:"Сен Тропе"` → `Азис — Сен Тропе`;
`recording:"100 причини" AND artist:Преслава` → `Преслава — 100 причини`. The record Preslava query that
returned Greedo in free text is in the catalogue the whole time.

## What this means for the review's finding 1

The review's option (a) — call the open catalogue instead of the prototype's search — **does not work as a
drop-in**. The catalogue is good, Bulgarian coverage included; its hosted search is built for cataloguers
writing field queries, not for a guest thumbing a title into a phone in a dark room. Swapping one hosted
search for another trades a daily ceiling for a search that cannot find the song.

What the measurement does support is **importing a catalogue and running our own search over it**: the
data is there and freely usable, the per-request ceiling disappears because we stop calling anyone during
service, and we control matching, transliteration and duplicate collapsing — all three of which this probe
shows are needed and none of which a hosted search gives us. It costs an import job, an index and a
refresh schedule, and it is the same machinery a DJ-library import (the review's option (b)) would need,
so the two stop being alternatives and become one build with two sources.

Two things stay unknown and are not worth guessing: whether the catalogue's own genre tags are dense
enough for Bulgarian music to reopen genre screening (row 1.13 closed it on the prototype's search, and
that conclusion is untouched by this probe), and the exact licence bucket of each field we would store,
which is a read of its licence page rather than a probe.
