# Circuit-breaker and alerting practice for the venue pause

Made by: research subagent (Sonnet), 10-20, for the #39 grilling "Failure and pause during service" (map #29). Informs, never binds (D114).

Scope: how an automatic venue pause should lift (A) and how often alerts go out (B). The pause triggers, the guest text and the receivers are already decided and not reopened. The numbers below are recommendations. Where a number is mine and not a source's, it says so.

## A. How an automatic venue pause lifts

### Sources
- Fowler, CircuitBreaker: https://martinfowler.com/bliki/CircuitBreaker.html (half-open lets one trial call through; alert when it opens; frequent trips are an early warning; operators can trip or reset by hand).
- Azure Architecture Center, Circuit Breaker: https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker (half-open lets a limited number of requests through; close after a set number of consecutive successes; timeout may grow; a ping or health-check operation may replace a timer; manual override; opening too fast or too slowly both hurt).
- Azure, Retry pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry (retry only idempotent operations; fail fast for interactive use).
- Resilience4j: https://resilience4j.readme.io/docs/circuitbreaker
- Polly: https://www.pollydocs.org/strategies/circuit-breaker
- Hystrix: https://github.com/Netflix/Hystrix/wiki/Configuration and https://github.com/Netflix/Hystrix/wiki/How-it-Works (one request after the sleep window; failure restarts a full window).
- AWS, backoff and jitter: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ (full jitter recommended) and https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter (retries add load during recovery; do not retry side-effecting calls unless idempotent; caps).
- Nygard, Release It!: I could not read the book. The only confirmation is secondhand, through Fowler's article, which credits Nygard, and it matches the single-trial-call description above.

### Defaults per library

| Library | Wait while open | Probes in half-open | Closes after | Source note |
|---|---|---|---|---|
| Fowler / Nygard | example 0.1 s, configurable | 1 trial call | 1 success | Fowler |
| Resilience4j | `waitDurationInOpenState` 60 s | `permittedNumberOfCallsInHalfOpenState` 10 | failure rate of those 10 under 50% | half-open waits forever unless `maxWaitDurationInHalfOpenState` set (default 0); `automaticTransitionFromOpenToHalfOpenEnabled` default false |
| Polly v8 | `BreakDuration` 5 s; `BreakDurationGenerator` allows growth | 1 probe | 1 success | `ManualControl` can isolate (hold open) and close |
| Hystrix | `sleepWindowInMilliseconds` 5000 ms | 1 request (How-it-Works) | 1 success | tripping needs 20 requests at 50% errors |
| Azure (generic) | not fixed; "a few seconds, then a few minutes" | "limited number" | N consecutive successes | recommends a manual reset |

I could not confirm the Hystrix 5000 and 20 defaults from the wiki page itself; they come from third-party posts.

### Recommendation for Restro
Restro differs from the libraries in two ways. There is no call traffic while paused (the guest page is closed), so a timer must drive the probes (Resilience4j's `automaticTransition...` flag is for exactly this). And a guest order is not idempotent, so it must never be the test.

| Parameter | Recommendation | Basis |
|---|---|---|
| Minimum time paused | 60 s | Mine; matches the 60 s needed to open. Stops sub-minute flapping. |
| First probe | 15 s after opening | Mine; between Polly/Hystrix 5 s and Resilience4j 60 s. Probes are cheap reads. |
| Probe kind | Read-only POS call that also checks credentials, that the cash desk exists, is open and is in the right approval mode (the same facts as pause cause 2). The exact barsy method is not chosen here; it must come from docs.lukanet.com. | Azure "failed operations testing": health-check operation. |
| Closing | 3 consecutive successful probes about 10 s apart (about 30 s) | Azure: consecutive successes. 3 is mine. |
| Wait growth | Probe gaps 15 s, 30 s, 60 s, 120 s, then stay at 120 s | Azure and Polly allow growth; AWS: cap it. The cap is short because staff are waiting. |
| Jitter | Each gap randomised to 50-100% of its value | AWS prefers full jitter; I keep a 50% floor so probes never bunch near zero. It matters when many venues probe a down barsy at once. |
| Refusals (credentials, cash desk) | Probe gaps start at 60 s, cap 5 min | Mine; hammering refused credentials risks a lockout (not confirmed for barsy). |
| Failed probe in a series | Restart the series, do not reset the growth | Hystrix and Fowler: failure restarts the wait. |
| Anti-flapping (hysteresis) | Opening needs 60 s and 3 attempts; closing needs about 30 s of green probes. After closing, a 5-minute probation: one Unconfirmed order or two consecutive failed calls reopens at once, and growth continues from the earlier step. Growth resets after 10 minutes stable. | Google SRE (below) on a minimum duration against flapping; the numbers are mine. |
| Flap limit | The 3rd automatic pause in 30 minutes holds at least 10 minutes and sends the Restro team one "unstable" message | Fowler: frequent trips are an early warning; numbers mine. |
| Counter reset | On lifting, restart the "3 orders at different tables" count; older Unconfirmed orders stay with the waiters | Otherwise the old ones trip it again at once. |
| Manual pauses | Kept as a separate flag. Automatic logic never lifts an owner's pause. The Restro team's lift closes the breaker and starts probation. | Polly `ManualControl`; Azure and Fowler manual override. |

**Should real guest orders be half-open probes? No.** The libraries do allow real calls, but they assume the call is safe to repeat. AWS and Azure Retry both warn against repeating non-idempotent calls, and an order that ends Unconfirmed costs a waiter a check and counts toward pause trigger 3, so a probe could re-pause the venue. The residual risk is that a read can succeed while a write fails. Probation covers it: the first real order after the lift is watched, and one Unconfirmed in the first 5 minutes reopens the pause.

## B. How often alerts go out

### Sources
- Alertmanager configuration: https://prometheus.io/docs/alerting/latest/configuration/
- Grafana notification policies: https://grafana.com/docs/grafana/latest/alerting/configure-notifications/create-notification-policy/
- PagerDuty alerts and dedup: https://docs.pagerduty.com/incident-management/incidents/alerts and https://docs.pagerduty.com/developer/send-alert-event; services: https://docs.pagerduty.com/incident-management/services/configurable-service-settings
- Google SRE book, monitoring: https://sre.google/sre-book/monitoring-distributed-systems/ ; practical alerting: https://sre.google/sre-book/practical-alerting/
- Web Push, RFC 8030 (Topic, Urgency, TTL): https://www.rfc-editor.org/rfc/rfc8030
- Not confirmed: Opsgenie (not researched), Telegram's `disable_notification` and per-chat rate limits (page not read in full).

### Defaults

| Tool | group_wait | group_interval | repeat_interval | Resolve |
|---|---|---|---|---|
| Alertmanager | 30 s | 5 min | 4 h | `send_resolved` true for Telegram and PagerDuty, false for email and Slack; an alert that clears inside group_wait sends nothing |
| Grafana | 30 s | 5 min | 4 h | mute timings are not inherited |
| PagerDuty | n/a | n/a | n/a | same `dedup_key` folds repeats into one open alert; resolve needs that key; auto-resolve off by default; urgency can differ inside and outside support hours, with a raise at the start of support hours |

Google: a page must be "urgent, actionable, and actively or imminently user-visible"; a rote response is a red flag; alert on symptoms; use a minimum duration against flapping; inhibit dependent alerts.

### Recommendation

An incident (venue pause) and an item (one Unconfirmed order) are different. An incident is a symptom for the venue; one message at start, one at end. An item is actionable by one waiter at one table.

| | Staff push | Owner push | Restro team (Telegram) |
|---|---|---|---|
| Venue pause starts | Yes, at once (the 60 s detection is already the debounce) | Yes, if the owner did not cause it | Yes, with cause class and venue |
| Venue pause lifts | Yes, one "ordering is back" message | Yes | Yes, one line, with duration |
| Repeat while open | None. The panel banner stays. | One reminder at 60 min | Every 60 min, at most 3, then stop |
| One Unconfirmed order | Yes: group_wait 10 s, group_interval 60 s, so several tables become one push ("check tables 7, 12, 14"); one reminder at 10 min if still unchecked, then the panel badge only | No | No; only the count when it triggers a pause |
| Dedup key | order id for items; `venue:{id}:pause:{incident}` for pauses | same | same |
| Resolution | Marking the order checked clears it quietly (no push) | | |

Other points:
- Group by venue. While a venue pause is open, suppress Telegram's per-order messages (Alertmanager inhibition) but keep the staff's, since their tables still need a check.
- A pause that reopens within 10 minutes of lifting reuses the same incident: no second "start" to staff, one "reopened" line to the team. This follows PagerDuty's dedup-while-open behaviour; the 10 minutes is mine.
- Use RFC 8030's Topic (one per incident or order) so a resolve replaces the pending start, and Urgency `high` only for staff Unconfirmed items. A TTL of about 5 minutes for staff keeps a stale "paused" from arriving after it lifted. Values are mine.
- Nothing wakes anyone outside the venue's service hours. An automatic pause then is logged and shown on the panel, with Telegram silent (flag not confirmed). If a pause is still open at opening time, send one "still paused" message to owner and team, as PagerDuty raises urgency when support hours begin.
- Never page for: a single failed probe, a pause that lifts inside its 60 s minimum, a closed venue's pause, a resolved item, a cron-style repeat of an unchanged state.

## Plain summary
- While paused, Restro tests the till on its own with a harmless read-only check, never with a guest's order.
- First test after 15 seconds, then 30, 60 and 120 seconds, and never slower than every two minutes.
- Ordering comes back after three good checks in a row, about 30 seconds of calm.
- It stays paused at least one minute, so guests do not see it flick on and off.
- After it comes back, the next five minutes are watched: one unconfirmed order closes it again straight away.
- Staff, owner and team each get one message when a pause starts and one when it ends.
- Staff get one grouped message for unconfirmed orders; owners never get those.
- Nothing wakes anyone when the venue is closed; one message at opening time if it is still paused.
