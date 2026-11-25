# What hospitality systems measure and report: research for Restro analytics

Research date: 2026-11-09. Requested by the lead. Facts only; no design recommendation.

**Summary.** The trade measures four things from live events that rows alone cannot give. First, durations inside a visit: Toast and Resy compute turn time from status changes (seated to finished; check opened to paid). Toast also reports quoted versus actual wait, kitchen fulfilment time by hour, and a timestamp chain per booking (created, started, ordered, paid, ended). Second, the guest funnel before an order exists: me&u and Flipdish report channels, rejected orders with reasons, tip conversion, new versus repeat customers and days between orders. Scan counts and menu views are what a QR product would add, and I found no vendor documenting them. Third, outcomes that leave no row: cancelled and no-show bookings and their lead time (Resos), bookings by source (SevenRooms "Booked By", Tablelist), and walk-ups. Fourth, nightclub control reports: a bottle pulled with no matching sale, and pour cost per night. Our order and reservation rows give totals, averages and counts; they cannot give these intervals or funnel steps unless the moment was recorded.

Legend: **[V]** = I opened the page and it says this. **[S]** = seen only in a search-result summary, page not opened or blocked (403/timeout). **[I]** = my inference.

Source quality: the products' own help pages mostly name metrics but rarely define them. Where a definition was missing I say so rather than fill it in.

## 1. Reservations and the door

| Metric (name as used) | Definition found | Source |
|---|---|---|
| Covers | Number of guests. Toast Guests report: "No. of covers" excludes bookings marked Cancelled or No-Show; the Bookings report has no stated exclusion. [V] | Toast Tables Reports, updated 2026-09-18: https://support.toasttab.com/en/article/Toast-Tables-Reports ; daily guest count: https://intercom.help/toast-central/en/articles/9337164-toast-tables-daily-guest-count |
| Covers split reservation / walk-in / waitlist, plus no-show covers, average daily covers by service period | Resy Analytics "Covers" page [S, via search summary of the Resy help centre]. Page itself returned truncated: https://helpdesk.resy.com/en/articles/3108034-resy-analytics | Resy |
| Seated vs no-show covers | OpenTable bills only seated diners; a host marks a booking cancelled or no-show within 48 hours. [S] OpenTable also says operators can compare seated guests and no-shows with other local restaurants. [S] | https://www.opentable.com/restaurant-solutions/resources/?p=1504 ; https://www.opentable.ca/restaurant-solutions/en/?p=79882 |
| No-show rate (OpenTable formula) | No-show covers / total covers. Revenue loss = no-show covers x average price per head. [S, quoted in a search summary; page timed out] | https://www.opentable.com/restaurant-solutions/resources/?p=682 |
| No-show rate (Resos formula) | Recorded no-shows / (recorded no-shows + attended reservations). Attended = approved, arrived, seated or left. Walk-ins and cancellations excluded from both sides. Only bookings ended 72 h or more before extraction. Counts reservations, not covers. [V] | https://resos.com/restaurant-no-show-rate/ (published 2026-08-19) |
| No-show rate (generic) | No-shows / total reservations; example 8 of 200 = 4%. Not stated whether cancellations are in the denominator; notes the count depends on the platform. [V] | https://www.eatloyalist.com/glossary/no-show-rate/ |
| Cancellation rate, no-show rate by venue/timeframe | Named by SevenRooms, no formula given. [V] | https://sevenrooms.com/platform/reporting/ |
| Late-cancellation window | Resos reports the share of cancellations made within 24 h of booking or after the booking started: 56%. [V] No vendor help page defining a "late cancel" window was found. | Resos, as above |
| Lead time | Resos buckets no-show rate by days between booking and visit (same day, 1, 2-6, 7-13, 14-29, 30+). [V] No vendor dashboard metric named "lead time" was found. | Resos |
| Walk-in share | Resy splits covers by reservation, walk-in, waitlist [S]. Toast defines no walk-in term in the pages I read [V]. | as above |
| Waitlist: quoted vs actual wait | Toast Bookings report column "Quoted vs. Actual Wait Time"; no formula given. [V] Resy "Timing Report" includes waitlist stats [S]; the Resy turn-time page says nothing on quoted/actual wait [V]. | Toast Tables Reports; https://helpdesk.resy.com/en_us/how-to-setup-flexible-seating-to-maximize-covers-BkL3bvQLO.md |
| Turn time (Resy) | From status Seated to status Finished. Parties never set Finished, or set after four hours, are excluded. By party size, day, service; also by server (Advanced Analytics) [S]. [V] | Resy turn-times page above |
| Turn time (Toast) | From check opened (first item added) to check paid with $0 balance. Excludes tip entry, time seated before ordering, time after paying. [V] Updated 2026-09-16. | https://support.toasttab.com/en/article/How-is-turn-time-calculated |
| Booking timestamps (Toast) | Created At, Started At, Ordered At, Paid At, Ended At per booking; filters on status, source, type, party size. [V] | Toast Tables Reports |
| Table turns per night, seat occupancy / utilisation | Not defined by any product page I could read. Resos Tables report counts bookings per table, combination and area; mentions occupancy and utilisation without a formula. [V] Resy pacing = maximum covers per time increment (default 10 per 15 min); a setting, not a result. [S] | https://resos.com/support/tables-reports |
| Party-size mix | Toast filter and column "Party Size"; Resy turn time by party size; Resos no-show by party size. [V] | as above |
| Repeat-guest share | SevenRooms "repeat visit percentage" (no formula) [V]; Resy "repeat guests", "guest visit frequency" [V]; Tablelist total visits, first and last visit [V]. | https://sevenrooms.com/platform/reporting/ ; https://resy.com/join/analytics/ ; https://www.tablelistpro.com/features/crm |
| Booking source | SevenRooms "Booked By" report (which channels are most effective) [V]; Toast filter "Booking Source" [V]; Tablelist source = online, promoter, walk-up [V]. No source value lists for Toast or SevenRooms. | as above |

Disagreement on no-show rate: the denominator is covers (OpenTable, via snippet), all reservations (generic glossary), or attended plus no-show reservations only (Resos). The same venue yields different rates under each. Resos also measures only recorded no-shows; staff must mark them, so the true rate is higher. OpenTable's 48-hour marking window is a further recording rule. [V/S]

## 2. Bar and nightclub service

Findings are thinner here; much of what I found is vendor marketing, and no standard definitions were found for sales per head, items per check or product mix.

- **Avg/Guest and Guest Count.** Toast's reporting has an Avg/Guest figure (average sales per guest) and a Guest Count card; the Guest Information report lists "Customers on orders". [S for Avg/Guest, V for Guest Count] The guest count comes from the number entered on the check. https://support.toasttab.com/article/How-to-Use-the-Toast-Reporting-Dashboard (updated 2026-09-17).
- **Voids and discounts.** Toast: Void Summary (void amount, order count, item count, amount %) and Voided Orders (void reason, counts, percent); Discounts Report with discount summary. [S] https://support.toasttab.com/en/article/Exceptions-Report-Overview
- **Sales by hour; speed of service.** Toast Kitchen Operations (KDS customers only): Tickets by Hour shows net sales and average fulfilment time per hour; Tickets by Fulfillment; Ticket Details per ticket. Fulfilment is measured from fire (ticket appears, or later by fire time) to fulfilled on the station or expediter screen. No data on printed tickets. [S] https://support.toasttab.com/en/article/Kitchen-Reports-Overview
- **Nightly pour cost and variance.** BinWise nightclub page names: Nightly Pour Cost Report (actual pour cost % per product per bar, nightly), Bar-Level Variance (theoretical usage from POS vs actual from counts, by main/VIP/secondary bar), Bottle Service Cost and Margin Report (cost as % of bottle-service revenue per event night), Premium Product Variance Alerts, Bottle Service POS Reconciliation (each bottle pulled from the storeroom matched to a POS sale; unmatched flagged). Vendor marketing. [V] https://home.binwise.com/nightclub-venue-inventory-software . Formula for pour cost is not given there.
- **Bottle service / table in clubs.** Tablelist per-guest fields: admission type, total visits, booking source, party size, gender split, lifetime spend, average minimum. [V] Discotech (consumer help): minimum spend is the shortfall charged if the guest does not reach it; fees add 20-38% to the final bill depending on venue. [S] A bottle-service software listing mentions live minimums versus actual spend by booth. [S, low quality]
- Not found in any source: sales per head as a named late-night metric, items per check, product mix definitions, order-to-delivery time at a bar (only kitchen fulfilment).

## 3. QR / self-ordering on the guest's phone

- **me&u Insights Glossary** is the most concrete public definition list, but the page returned 403 to me. What I have comes from a search summary [S]: Tip Conversion Rate = tipped transactions / transactions; Average Tip Value (tipped orders only, dollars); Average Tip Percentage (tip as share of order total, tipped orders only); Average Customer Spend = total revenue / total customers (per unique customer in the period). https://help.meandu.com/hc/en-us/articles/13815948303247-Insights-Glossary . Needs re-checking by a human with a browser.
- **Flipdish Business Review report** [V]: orders and revenue by channel (iOS, Android, Web, Kiosks, QRCOP), delivery type, rejected orders and rejection reasons, average order value by channel/day of week/store, new / unique / repeat customers, average days between orders, menu item ranking. Most fields are named, not defined. https://help.flipdish.com/en/articles/9619314-business-review-report
- **Toast Mobile Order & Pay overview** [V]: no reporting metrics on the page. **Square QR ordering** [S]: each QR code maps to one table or location; reporting by "dining option" is suggested by a community moderator, not documented; I could not confirm scans are tracked at all.
- **Scan counts, menu views, scan-to-first-order time, abandonment, language chosen, payment completion rate:** I found no QR or self-ordering product that documents any of these as a named report. QR short-link tools can count scans [S, vendor blog], but that is not an ordering funnel. Sunday, Bbot, Mr Yum did not yield help-centre metric lists.
- Sunday's own page reports tip rate, "basket size increase", table time saved and adoption (share of tables paying by QR); no methodology (see section 4).

## 4. Benchmarks

| Figure | Value | Source | Independent? |
|---|---|---|---|
| Average recorded no-show rate, advance reservations | 2.33% (3.77 m reservations, 2,417 venues, 2025-08-01 to 2026-07-31; UK 54% of data; US 3.17%, Italy 4.71%, France 5.88%) | Resos No-Show Index, https://resos.com/restaurant-no-show-rate/ [V] | Platform data, vendor-run, but methodology disclosed. Recorded rate, so a floor. |
| No-show with deposit/card hold vs none | 0.80% vs 2.47% (Resos says association, not causation) | same [V] | same |
| No-show by party size | 1-2: 2.63%; 3-4: 2.13%; 5-6: 2.28%; 7-9: 1.73%; 10+: 1.15% | same [V] | same |
| OpenTable-era phone vs online | about 5.7% phone vs 4.6% OpenTable, undated, second-hand | search summary [S] | Weak |
| Other "5-20%" and "12-18% phone" claims | vendor blogs without method | search summaries [S] | No |
| Tabletop ordering, full-service chain | Sales per check about +1% (95% CI 0.8-1.02%) in the published version, +2.9% in the 2017 working paper; meal duration about -10%; sales per minute about +11%; staffing unchanged; one chain, tablets at the table, staggered rollout | Tan and Netessine, Management Science 66(10), 2020: https://econpapers.repec.org/RePEc:inm:ormnsc:v:66:y:2020:i:10:p:4496-4515 [V abstract] | Yes, peer reviewed. Tablets, not phone QR. |
| Sunday: tip 20-22%; basket size +11 to +19%; 8-10 min saved per table; adoption 55-88% | selected named customers, no baselines | https://sundayapp.com/qr-code-payments-for-restaurants-real-roi/ [V] | Vendor marketing |
| me&u: average order size +20-40%; tips up over 30% | vendor claims | search summaries [S] | Vendor marketing |
| Toast Order & Pay: guests tip on 18% more transactions at QSRs; Rossotti's +45% average check | press release (2022) and case study | https://www.businesswire.com/news/home/20220523005148/en (403, snippet only) [S] | Vendor marketing |
| Flipdish QR case study: +25% AOV | one customer | search summary [S] | Vendor marketing |
| QR scan rate at tables "40-70%" | vendor blog, no method | search summary [S] | No |

No independent figure for scan-to-order conversion was found.

## 5. Which metrics need an event recorded at the moment it happens

Rule used here [I]: a metric is derivable from rows if the row stores the needed timestamp or state; it needs an event if the fact is overwritten, never written, or happens before any order row exists.

**Needs a recorded event (cannot be rebuilt later from order and reservation rows alone):**
- **Turn time (Resy)**: needs the Seated and Finished status-change times. Resy ignores parties never marked Finished, so it depends on someone recording the moment. A reservation row with only its current status loses this.
- **Toast-style turn time** can come from order rows (first item added, paid), but only if both times are stored on the check.
- **Quoted vs actual wait**: needs the quote given at the time and the time seated. The quote is overwritten if the wait is revised.
- **Late cancellation / cancellation lead**: needs when the cancel happened, not only that the status is "cancelled". Resos counts cancels within 24 h of booking or after the booking started.
- **Lead time and booking source**: derivable if created-at and source are stored at creation (Toast stores Created At and Source). A source edited later loses the original.
- **Item-level status transitions, and speed of service** (order placed, accepted, fired, ready, delivered): Toast measures fire to fulfilled via screen taps. If only the final state is stored, order-to-delivery time is lost.
- **Voids and removed items**: a deleted line leaves no trace; Toast reports void reason and counts as separate records.
- **Comps and discounts with reason**: same.
- **Bottle pulled vs bottle sold**: the reconciliation needs a record of the physical event (pulled from storeroom), separate from the sale.
- **Sales by hour of night**: derivable from order timestamps if each order and payment is time-stamped; hour of lines added to a long-open bill needs per-line times.
- **Scan, menu view, session start, language chosen**: no row exists until an order is placed. Scan-to-order conversion, scans per table, time to first order, browse-only sessions and abandonment (basket built, not sent) can only be computed if scan, view and cart events are written when they happen.
- **Payment started vs completed** (payment completion rate): a failed or abandoned attempt leaves no order row unless the attempt is logged.
- **Tip offered vs tip given**: tip conversion divides tipped by all transactions; if only the final tip is stored, a zero tip is indistinguishable from "was never offered".
- **Walk-up arrivals** who never become a reservation or order: only a door event records them (Tablelist centralises walk-ups with online and promoter bookings).
- **Waitlist length at a given moment**: a snapshot over time; needs join and leave events.
- **Seat occupancy over the night**: needs seated and left times per party; with only current status it can be computed for now but not for earlier hours.

**Derivable from rows you already keep (if timestamps and provenance are stored):** covers, party-size mix, repeat-guest share, average check, items per check, tip percentage on paid orders, product mix, sales by hour, orders by channel, AOV by day/channel/store, new vs repeat customers, days between orders.

## 6. Open questions this research could not settle

1. me&u's full Insights Glossary and its Average Order Value / orders-per-session definitions (403). Needs a person with a browser, or a request to me&u.
2. Resy Analytics reports (Covers, Timing, Advanced Analytics): the pages returned truncated. Exact definitions of walk-in, no-show covers and waitlist stats are unverified.
3. OpenTable's own report definitions (covers, seated, no-show, walk-in). Its help pages are behind login; its no-show formula and 48-hour rule are from snippets and a timed-out fetch.
4. SevenRooms and Tock formulas: neither publishes them publicly (SevenRooms lists "50+ metrics"; Tock help returned 403).
5. Whether any QR or self-ordering product reports scans, views or abandonment. None found; this may exist only behind logins or in sales demos.
6. Sales per head and spend per cover for late-night venues, with a standard definition and a nightclub benchmark. None found.
7. Whether the Cornell/Tan-Netessine tablet results apply to guests' own phones.
8. Toast's "Avg/Guest" is only from a search summary; the dashboard page I opened does not mention it. Guest count is manually entered at the POS, so quality is uncertain.
9. Whether turn time or table turns for clubs (standing, bottle tables) mean anything; all definitions found are for seated restaurant dining.
10. The Toast 18% tip figure, the Resos method of defining "attended", and the me&u/Sunday uplifts all need their primary pages read before citing.
