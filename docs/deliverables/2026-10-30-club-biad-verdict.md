# Verdict: should Club Biad's functionalities go into the platform?

Asked by Martin on 2026-10-30, before the port of the outside MVP (`restro-flow` → Port) goes further. Written by an independent read-only Fable agent that was not given the lead's opinion, then checked by the lead. Not legal advice. "Inferred" marks what the agent reasoned rather than read. MVP pinned at commit `4c15319` in `C:\Ports\restro-club-biad\restro-club-biad-main`.

## The lead's check

Checked against the decisions on `or/foundation`, the MVP and the outside pages.

**Confirmed:**
- Restro makes no refunds and its Stripe key cannot (D125). D99 still says a skipped request "is refunded", so D99 is out of date on this whichever way Martin decides.
- Restro never holds money, and no split inside a payment (D98).
- The pilot's till is Mistral and that connector is parked (D79).
- YouTube allows 100 search calls a day by default; more needs a compliance audit.
- Clubinno's public site is a marketplace for booking performers, not a reservation tool, while the MVP's records say Restro replaces it for reservations. That needs one question to the club.
- The MVP is one JSON row and plain JavaScript, with 129 KB of tests.
- The MVP's question M03 (a "DJ request" sale with no table) is missing from our Mistral list, `docs/deliverables/2026-10-21-mistral-questions.md`.

**Corrected or weaker than the agent states:**
- **Size:** the active MVP source is about 304 KB, not 200 KB. The conclusion stands.
- **"Legally a sale":** this is our own research's reading, marked for the lawyer (L7, L8), not settled law.
- **The Mistral argument:** a parked connector holds back ordering too, so it does not by itself separate song requests from ordering. What is specific to song requests is the sale with no table and one receipt per backer.
- **"A club night burns the quota in minutes":** overstated. The MVP caches searches for six hours and shares them. Running out on a busy night is still plausible (inferred).
- **"A forgotten close costs nothing":** the lead disagrees. A guest's hold stays on the card for up to seven days, which is a complaint even when no money moves.
- **Demand:** the evidence is one owner's interviews and weak outside sources. "No Bulgarian product exists" means none was found.

## 1. Overall verdict

**Song requests: later** (and, when it comes, reduced). Confidence: medium-high on "not now", medium on "ever". Paid requests are legally a sale by the venue: a fiscal receipt from the venue's device per backer per capture, 20% VAT, consumer consent for a service used the same night, and refunds that Restro's Stripe key is forbidden to make (D125). Every one of those depends on the pilot's POS registering a "DJ request" sale without a table and issuing an electronic receipt, and that connector is parked (D79). So song requests sit on ordering's critical path with far less evidence of value: one owner's interview, no second club, no Bulgarian product to copy, and the comparable products that make paid priority work (TouchTunes) control the music themselves, which Restro never will.

**Reservations: put it in, reduced**, after ordering as D101 says, as a staff tool only. Confidence: medium-high. No money moves, so none of the fiscal weight applies; the rules the owner gave (a place is held for the whole service day, waiting list in arrival order, swap, blocks, close evening with undo) are sound and match how reservation tools work; and it fits the platform's Areas, Tables, roles and Tonight. Two parts must change: personal client lists per staff member go, and the floor plan becomes its own layer of "places", not the POS's tables.

**What the MVP is worth to a port:** plain JavaScript on one SQLite row with a JSON blob, not React, TypeScript or Postgres. Nothing of the code fits Restro's stack; what carries over is the rulebook, the test cases (129 KB) and one club's hand-traced floor plan. Porting means rebuilding.

## 2. Feature by feature

| Functionality | Verdict | Reason in one line | Main thing missed |
|---|---|---|---|
| Paid requests, queue ordered by amount | keep changed, later | An open auction; the industry sells a fixed "play sooner" fee (TouchTunes Fast Pass, dynamic but fixed per song), not bidding | Cash at the booth outranks the app; a DJ keeping 100% of a cash tip versus 50% of app money will keep the cash channel |
| Several backers on one song | keep changed | Sensible pooling; each backer is a separate capture | Each backer is also a separate fiscal receipt and a separate possible dispute (€20 on a €5 sale) |
| Paid greetings (€3, DJ moderates text) | drop | Delivery can't be proven; the one thing a cash tip does better; a second product with its own refunds | Rejected greeting after capture = manual refund in Stripe at 3 a.m. |
| DJ-private locked three vs D99's window | keep changed | Keep D99's lock window (N a venue setting); drop the secrecy | Guests see a public "#1" that isn't next; it reads as rigged |
| Public ranks with names and amounts | drop names and amounts | Personal data with no operational need (their A07 is open); fuels bidding wars among drunk guests and name abuse | Public amounts are the social engine of their revenue model, so dropping them weakens the case; still right |
| Prepare/start, capture at prepare | keep changed | Capture at start or after, never before: a hold confirmed with 3-D Secure captures reliably; D125 gives Restro no refund | They designed around myPOS's slow captures, which Stripe doesn't have |
| Withdrawal before prepare | keep | Cancelling a hold is free | — |
| Repeat cooldown (30 min, "song family" heuristic) | keep changed | A DJ's call, not a server rule; title heuristics misfire | The DJ can play any song from the floor anyway |
| YouTube as the search | keep changed, at risk | Default quota is 100 searches a day; a club night burns that in minutes; more needs a compliance audit and the use case must be declared | Quota; and a paid service built on search results is the kind of use YouTube audits |
| Personal links, email recovery, payment "signals" | keep changed | Email recovery is an account in all but name (D9); but an email is also the only lawful route to an electronic receipt, so ask once, for the receipt | Signals need someone answering in two working days (their Q10–Q12): a new job at the club |
| DJ night controls (intake, planned end, handover, close, undo start) | keep, simplified | Map onto service hours (D122) and Tonight; undo-start within 60 s is fine | A forgotten close costs nothing with holds (they lapse at 7 days), so the elaborate fallback is unneeded |
| Night list and date calendar | keep | Core of a hostess tool | — |
| Floor plan with individual bar stools | keep changed | Needs its own "places" layer plus an editor; stools and merged 40/41 don't exist in the POS (D95) | The MVP is one club's photo-traced SVG, capacities unverified; a generic editor is the real build |
| Waiting list, walk-ins, move, swap, copy | keep | Standard, sound rules | — |
| Blocked places; close evening and undo | keep | Clear, auditable | — |
| Informational deposits | keep as information | A card deposit through the payment account starts the same fiscal path as a song (receipt at capture, VAT at receipt, no-show VAT open: L4–L6) | The club doesn't use deposits today (their Q26) |
| Personal regular clients per staff member | drop; replace with a venue guest book | The venue is the data controller and can't answer an access or erasure request for a list only one hostess can see; the list leaves with them | Staff turnover; GDPR accountability (Art. 5(2); Art. 29: staff process only on the controller's instructions) |
| Audit history | keep as Log entries | Restro's Log already exists (18-month record class) | Names in history need a retention rule (their L2 is open) |
| Replacing Clubinno | unknown | Online, Clubinno is a Bulgarian marketplace for booking performers, not a reservation tool | What the club really uses for reservations needs one question to the hostess |
| D101's additions (public booking page, emails, deposits via payment account) | later | A new guest channel outside QR-to-phone (D38), spam and no-shows, and emails need a sender domain the club lacks (their Q32) | Prove the staff tool first |

## 3. Strongest arguments against this verdict

1. The owner asked for paid requests, has a DJ willing to split 50%, and the chalga scene has a living practice of paid greetings and tipping singers; Restro would formalise a cash market that exists, and nobody in Bulgaria does it yet.
2. Ordering and paying already force Restro to solve receipts per capture, Stripe holds and sale registration in Mistral; once that works, song requests are a marginal cost on a solved path.
3. A menu with ordering is a commodity; a paid DJ queue is the feature an owner talks about: it sells.
4. Against reservations: it is a second product with its own screens, off-the-shelf tools exist (SevenRooms, TablelistPro, resOS), ordering isn't accepted yet, and a hand-drawn floor plan per club is a services business, not software.
5. Dropping public names and amounts removes the status display that drives spending in these clubs; the honest version may earn too little to matter.

## 4. What would change the verdict

- **Mistral confirms in writing** that it can register a "DJ request" sale with no table and issue the venue's electronic receipt by email (the MVP's M03/M04; absent from Restro's own Mistral list). Then song requests move to "put in, reduced". Who: Mistral, via Martin.
- **The lawyer's L7/L8/L3**: a hold is not a payment; one receipt per backer is acceptable; an anonymous session may carry an electronic receipt. And whether a voluntary "tip the DJ with a wish", no promise, is a tip in the NRA's sense (group А, no VAT) rather than a sale.
- **Two more clubs** saying they would use it, and what their DJs take in cash tonight. Who: the owners and DJs.
- **YouTube's audit answer** for the real use case, or a licensed catalogue instead.
- **For reservations:** weekend booking volume, no-show rate, whether stools are booked one by one, and what tool is used today. Who: the hostess.
- **KZLD or the lawyer** on public names with amounts (A07) and phone-number retention (A08).

## 5. Questions only Martin can decide

1. **Does Restro want to take money for the DJ at all**, knowing it is a venue sale at 20% VAT with a receipt per backer, and the DJ's share becomes payroll or an invoice outside Restro (D98: Restro never holds money, no split inside a payment)? Recommendation: not for the pilot; revisit when ordering is accepted and Mistral has answered; then only the reduced form (fixed "play sooner" fee, capture at start, no greetings, no public names).
2. **Downgrade D99** from "direction" to parked, and record that the MVP already departs from it (paid only; locked three; capture at prepare). Recommendation: yes.
3. **Amend D101's "on Areas and Tables"** to "on a places layer the venue draws, linked to POS tables where they exist", and let that layer be designed (not built) before ordering ends so Tables & QR and Tonight aren't reworked. Recommendation: yes, design only.
4. **Guest phone numbers**: hold them at venue level with a retention default and an export, never in private per-staff lists. Recommendation: yes; the period is technical.

## 6. What could not be verified

- Eleven linked MVP files are missing (legal priority note L1–L3, both legal research notes, myPOS late-payment check, Mistral confirmation, plan, scenarios, legal pack, evidence list, implementation report). Their effects are known only from one-line summaries.
- What Clubinno is to this club; what kind of club Biad is (one weak page: central Sofia, "one of the oldest").
- Bulgarian paid-greeting practice: inferred from a 2018 Capital article (DJ sending "greeting after greeting" to celebrating groups; the article itself blocked the agent) and a travel guide. No prices found.
- TouchTunes Fast Pass terms: secondary sources. Visa's 2026 VAMP thresholds: vendor blogs. Prophon's DJ tariff: amounts readable (about €290 a year per DJ), headings garbled.
- Read verbatim: ЗЗП чл. 57, т. 1 (no withdrawal once a service is fully performed with express prior consent and confirmation); Закон за хазарта чл. 2 (gambling needs chance, a stake and a win or loss; a DJ's choice is not chance, inferred; their B19 is still for the lawyer).
- Nothing from the MVP was run; its "148 tests" is its own claim.

## 7. Sources

**Internal.** MVP: `docs/SYSTEM-AND-BACKEND-BG.md`, `docs/OPEN-QUESTIONS-BG.md`, `STRIPE.md`, `YOUTUBE-SETUP.md`, `docs/search-reliability.md`, `docs/personal-regulars.md`, `docs/plan-calibration.md`, `docs/venue-plan-2026-10-27.md`, `docs/decisions/*.txt`, `README.md`. Restro on `or/foundation`: `CLAUDE.md`, `GLOSSARY.md`, the decision files D9, D38, D71, D72, D79, D95, D98–D101, D103, D122, D125–D127, `docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md`, `2026-10-17-payment-providers-feasibility.md`, `2026-10-17-payments-and-fiscal-open-questions.md`, `2026-10-22-stripe-knowledge.md`, `2026-10-28-law-research-fiscal-tips.md`, `2026-10-28-law-research-consumer-privacy.md`, `2026-10-21-mistral-questions.md`, `docs/guides/menu-template-functionality.md`, `docs/open-items.md`, `docs/tracker.md` (Q75, Q77, Q78, Q80, T81–T83).

**Outside.**
- YouTube quota and audit: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- YouTube developer policies: https://developers.google.com/youtube/terms/developer-policies
- TouchTunes Fast Pass: https://digistatement.com/touchtunes-fastpass-not-available-how-to-fix-the-issue, https://apps.apple.com/app/id378351144
- TouchTunes scale: https://en.wikipedia.org/wiki/TouchTunes
- Rockbot priority picks: https://techcrunch.com/2011/02/15/roqbot
- DJ tip apps: https://forum.djtechtools.com/t/opinions-new-app-to-turn-song-request-and-shout-outs-into-tip-for-djs-w-your-help/71731, https://www.stork.ai/en/special-request, https://apps.apple.com/ee/app/tiptunez/id1503382483, https://www.getapp.com/all-software/a/enjoy-the-club/
- Visa VAMP: https://fraud.net/resources/visas-vamp-thresholds-drop-to-1-5-on-april-1-are-you-ready
- Chargebacks in nightlife: https://www.tablelistpro.com/blog/nightclub-chargeback-protection
- No-shows: https://resos.com/restaurant-no-show-rate/, https://www.tablelistpro.com/blog/eliminate-nightclub-no-shows, https://bloomintelligence.com/blog/restaurant-no-shows/
- SevenRooms nightlife: https://sevenrooms.com/newcustomer/nightlife/
- Clubinno: https://clubinno.com/
- Sofia clubs: https://europenightlife.com/bulgaria/sofia/best-clubs-in-sofia
- Chalga greetings: https://www.capital.bg/politika_i_ikonomika/obshtestvo/2018/12/21/3364688_jivotut_ni_e_popfolk/
- Prophon DJ licence: https://www.prophon.org/bg/public-places/dj, https://www.prophon.org/attachments/PageBlock/247/documents/10-DJ-tariff-2026.pdf
- Музикаутор tariffs: https://www.musicautor.org/bg/p/musicautor/tarifi-i-dogovori/tarifi
- ЗЗП чл. 50, 57: https://kik-info.com/normativna-baza/zakoni/zzp/
- Закон за хазарта чл. 2, 11: https://kik-info.com/normativna-baza/zakoni/0X2135783265/
- GDPR controller liability for staff: https://www.mondaq.com/data-protection/1470446/employers-liable-for-employees-gdpr-errors
