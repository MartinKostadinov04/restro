Made by: research subagent (Sonnet), 10-20, for the #39 grilling "Failure and pause during service" (map #29). Informs, never binds (D114).

# How comparable products handle a pause and a failing POS

Public help pages only. "Not found" means I looked and the vendor does not say. Sunday, Qerko and GonnaOrder have no public documentation on any of this (searches returned only marketing pages).

## 1. What pauses, and what triggers it

| Product | Scope | Automatic trigger | Source |
|---|---|---|---|
| Toast online ordering | The whole online page of the restaurant | The system notices orders are not reaching the restaurant: "up to five minutes". Also an offline "auto-fire" device for about 5 min | [Toast](https://support.toasttab.com/en/article/Outages-and-Disruptions-Toast-Online-Ordering) |
| Toast Order & Pay | Guests can browse but cannot place new orders in offline mode | Offline mode itself | [Toast O&P](https://support.toasttab.com/article/Order-Pay-During-Offline-Mode) |
| Square | Whole location (online ordering) | None found; manual only | [Square](https://squareup.com/help/us/en/article/8566-set-up-an-online-ordering-profile) |
| Lightspeed Order Anywhere | One "profile" (e.g. a table profile) | None found; manual only | [Lightspeed](https://resto-support.lightspeedhq.com/hc/en-us/articles/4411448924571) |
| storekit (Lightspeed partner) | Whole store, manual | None: orders keep flowing and fail one by one | [storekit](https://storekit.com/docs/guides/integrations/pos/lightspeed/till-offline), [disable](https://storekit.com/docs/guides/orders/disable-ordering) |
| Uber Eats | Whole store | Several orders in a row unaccepted; store seems too busy; no numbers published | [Uber](https://www.uber.com/au/en/blog/automatic-pausing-for-merchants) |
| Wolt | Whole venue | Tablet app in background or idle (about 20 min) takes the venue offline | [Wolt](https://merchant.wolt.com/en/est/learning-center/improve-venue-availability) |
| Deliveroo | Not found. Deliverect says platforms auto-close stores that miss too many orders; no thresholds | Missed orders, cancellations | [Deliverect](https://www.deliverect.com/en/blog/online-food-delivery/why-restaurant-go-offline-delivery-apps-ubereats-doordash-deliveroo-grubhub) |
| me&u, Mr Yum, Flipdish, Mobi2Go | No automatic pause found; failures handled order by order | n/a | see section 4 |

Pattern: only Toast pauses on a POS-unreachable signal, after a delay of minutes. Delivery apps pause on "staff not responding". Most others leave ordering open and fail each order.

## 2. What the guest sees

- Toast: checkout shows that the restaurant is offline or payment was not accepted; Order & Pay still shows the menu ([Toast](https://support.toasttab.com/en/article/Outages-and-Disruptions-Toast-Online-Ordering)).
- Lightspeed: table profile says "Orders are closed" when adding to the cart ([Lightspeed](https://resto-support.lightspeedhq.com/hc/en-us/articles/4411448924571)).
- storekit: "not currently accepting orders" ([storekit](https://storekit.com/docs/guides/orders/disable-ordering)).
- Uber: store shows as "currently unavailable" when set offline ([Uber dev](https://developer.uber.com/docs/eats/guides/store-integration)). Wolt: venue disappears from the app.
- Mobi2Go: after a failed send, guest is told the order failed and to contact the store; not charged ([Mobi2Go](https://help.mobihq.com/troubleshoot-order-failures-dispatcher-offline)).
- me&u: guest may get an SMS that the order may not have reached the venue ([me&u](https://help.meandu.com/hc/en-us/articles/10808811945743-Comprehensive-Guide-to-Preventing-Managing-Missed-Orders), via search summary; page itself blocked).

## 3. How it resumes

- Toast: ordering comes back by itself once orders get through. Staff then approve held orders in "Pending Orders" and may "snooze" online orders 20 or 40 minutes to catch up ([Toast](https://support.toasttab.com/en/article/Outages-and-Disruptions-Toast-Online-Ordering)).
- Square: person resumes from the POS Orders tab or dashboard; timed pause (hours, until tomorrow) per the official POS help (search summary; the page I opened lists only the clock icon and the dashboard toggle). Forum posts report timed pauses failing to reactivate ([Square forum](https://community.squareup.com/t5/Online-Store/Pausing-online-orders-results-in-Out-of-Stock-message-across-the/m-p/651146)).
- Lightspeed, storekit: only a person, from the back office or dashboard; storekit says "Orders resume immediately".
- Uber: tap "Resume orders" on the tablet, or in Uber Eats Manager; otherwise it unpauses itself by 6:00 the next morning.
- Wolt: bring the app to the front, or switch to Online in the Merchant App.

Pattern: automatic pause by a system is lifted either by the system (Toast) or by a person (Uber, with a morning fallback). Manual pause is lifted by a person or a timer.

## 4. Failed or unknown orders: who sees them, what staff do

- **storekit** (the most detailed): up to five attempts, shown as "Retrying x2"; then "Failed", a red banner, an email with the error, and a printed ticket marked "POS FAILED" on the cloud printer. Staff use "Resend order to POS"; resend is blocked if the POS already has it, to prevent doubles; if missing, ring it in by hand and do not charge again. A manager reviews the failed-orders report ([till offline](https://storekit.com/docs/guides/integrations/pos/lightspeed/till-offline), [fallback printing](https://storekit.com/docs/guides/printing/fallback-printing), [injection](https://storekit.com/docs/guides/integrations/pos/order-injection.md)).
- **me&u:** orders turn green or red on a Live Orders page; red shows the POS error ([me&u](https://help.meandu.com/hc/en-us/articles/6539839181199-Lightspeed-Kounta-POS-What-to-do-when-you-see-red-orders-on-the-Live-Orders-page-or-orders-are-not-printing)). Fallbacks (search summary): a second "rejected order, check Live Orders" ticket, a backup printer, SMS to a venue number. The guest is still charged, so staff enter the order by hand.
- **Deliverect:** statuses "POS Failed" and "Retry Failed"; filter Orders by status, read the error, retry once fixed ([alerts](https://help.deliverect.com/en/articles/7979009-set-up-and-manage-alerts)). Delivery to the POS: 3 s to connect, 30 s to answer, retries after 10 s doubling, five retries, then failed ([failover flow](https://developers.deliverect.com/page/pos-order-webhook-failover-flow)). No automatic reroute to a tablet found.
- **Lightspeed:** partners accept and take payment first; a confirmed order must be served and keyed in by hand ([Lightspeed](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329319365659)).
- **Toast:** orders placed just before the cutoff arrive after reconnection and wait for approval; old ones may need a call to the guest or a void.
- **Mobi2Go:** failed-order notification; the example says the order was refunded ([Mobi2Go](https://help.mobihq.com/troubleshoot-order-failures-unable-to-reach-pos)).

Common staff rule: enter the order by hand first, find the cause after.

## 5. Alerts

- Deliverect: alert "Order injection failed" by email or WhatsApp; first event sent at once, later ones grouped every 10 minutes; recipients chosen per person or per location. Plus "Store closed by channel" (paid tier) ([Deliverect](https://help.deliverect.com/en/articles/7979009-set-up-and-manage-alerts)).
- storekit: email after the final failure plus a printed ticket.
- me&u: SMS to a chosen number only when the POS rejects; none on timeouts (search summary).
- Toast: no dedicated staff alert documented; banner on devices and Pending Orders.
- Uber, Wolt, Flipdish, Square: merchant notification of an auto-pause not found.
- Phone-call or night-time escalation: not found for any product. No rate limit found beyond Deliverect's 10-minute grouping.

## 6. What the owner sees afterwards

storekit has a failed-orders report; Deliverect has order filters by status; me&u keeps a Live Orders history. Incident history for pauses: not found for any product. Deliverect sells "Pulse Sentinel", a dashboard of which stores are switched off on which delivery platform, with real-time alerts and downtime cost ([Deliverect](https://www.deliverect.com/en/blog/online-food-delivery/why-restaurant-go-offline-delivery-apps-ubereats-doordash-deliveroo-grubhub)).

## 7. Watching the platform itself

No comparable vendor publishes how it watches its own servers. For a dead-man's switch (our server pings an outside service; silence triggers the alert) the common options:

| Service | Free tier | Telegram | Source |
|---|---|---|---|
| Healthchecks.io | 20 checks | Yes (listed under chat); also email, SMS, phone call (quotas on paid plans), Pushover "Emergency" repeating every 5 min until acknowledged | [home](https://healthchecks.io/), [notifications](https://healthchecks.io/docs/configuring_notifications/), [pricing](https://healthchecks.io/pricing/) |
| Better Stack | 10 monitors and heartbeats | Not found; free alerts are Slack and email only | [pricing](https://betterstack.com/pricing) |
| UptimeRobot | 50 monitors, 5-min checks, but heartbeat is a paid feature | Paid plan lists Telegram; free tier unconfirmed | [pricing](https://uptimerobot.com/pricing.md) |
| Cloudflare Health Checks | Not checked | Not found; email and webhook only | [Cloudflare](https://developers.cloudflare.com/health-checks/how-to/health-checks-notifications/) |

Cloudflare checks the web server from outside; it is not a heartbeat for a background job.

## What this suggests for Restro

- Separate "ordering paused" (guests blocked, no new orders) from "an order failed" (one order needs a human). Everyone does both, with different screens.
- The safest automatic trigger is a clear signal that orders are not getting through (Toast: a few minutes), not a guess about staff. Use a small count of failed sends in a row, not a single failure.
- While paused, keep the menu visible and say plainly that ordering is closed and to call a waiter (Lightspeed, storekit and Toast all keep the menu).
- Do not auto-resume blindly. Toast does it, but then makes staff approve held orders. Safer for a nightclub: system suggests resuming when the POS answers again, a person taps to confirm, and a morning reset clears it (Uber's 6:00 rule).
- A failed order must reach a human somewhere they already look: a printed ticket or a red item on the staff screen, plus a message. The rule "key it in first, investigate later" is standard.
- Never resend an order the POS may already hold. storekit blocks the resend and tells staff to check the POS and not charge twice; this matches D118's concern with fake or duplicate orders.
- One alert per incident, then a reminder, not a flood (Deliverect: first at once, then grouped every 10 minutes). No product documents a phone call at night; that is open ground.
- Our own downtime needs an outside watchdog. Healthchecks.io is the one found with a free dead-man's switch and Telegram; the owner should see an incident list afterwards, which none of these products documents.
